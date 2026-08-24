import { mapConcurrent } from '../../lib/asyncPool'
import { chineseDate } from '../../lib/time'
import type { Article } from '../../lib/types'
import { chatComplete, extractJsonPayload } from './client'
import {
  ASSISTANT_SYSTEM_PROMPT,
  CORPUS_NOTES_SYSTEM_PROMPT,
  corpusNotesUserPrompt,
  ENTITY_TERMS_SYSTEM_PROMPT,
  entityTermsUserPrompt,
  SENTIMENT_SYSTEM_PROMPT,
  sentimentUserPrompt,
} from './prompts'
import { collectEntityCorpus, searchArticles, searchArticlesByEntity } from './pool'
import { articleBrief } from './text'
import type {
  AiChatMessage,
  AiConfig,
  ChatArticleRef,
  CorpusScope,
  EntityTerms,
  SentimentStage,
} from './types'

/** 送入上下文的历史轮数与资料条数 */
const HISTORY_TURNS = 6
const CONTEXT_ARTICLES = 12

export interface AssistantResult {
  content: string
  refs: ChatArticleRef[]
}

/** 舆情快捷指令前缀：输入「舆情：企业名」触发结构化报告 */
const SENTIMENT_PREFIX = /^(?:企业)?舆情\s*[:：]\s*(.+)$/

export function parseSentimentCommand(input: string): string | null {
  const match = input.trim().match(SENTIMENT_PREFIX)
  const entity = match?.[1]?.trim()
  return entity && entity.length >= 2 ? entity : null
}

function contextBlock(articles: Article[]): string {
  return articles
    .map((article, index) => `【${index + 1}】${articleBrief(article, 120)}`)
    .join('\n')
}

function toRefs(articles: Article[]): ChatArticleRef[] {
  return articles.map((article) => ({
    articleId: article.id,
    title: article.title,
    sourceName: article.sourceName,
  }))
}

/** 只保留回答中实际引用（【n】）的文章；未标注引用时不展示来源条 */
export function citedRefs(content: string, provided: Article[]): ChatArticleRef[] {
  const cited = new Set<number>()
  for (const match of content.matchAll(/【(\d{1,2})】/g)) {
    cited.add(Number(match[1]))
  }
  if (!cited.size) return []
  const articles = provided.filter((_, index) => cited.has(index + 1))
  return toRefs(articles)
}

/** 普通问答：本地检索 → 拼接资料 → 单轮补全 */
export async function runAssistantTurn(input: {
  config: AiConfig
  pool: Article[]
  history: AiChatMessage[]
  userInput: string
  signal?: AbortSignal
}): Promise<AssistantResult> {
  const { config, pool, history, userInput, signal } = input
  const matches = searchArticles(pool, userInput, CONTEXT_ARTICLES)
  // 检索不中时退回最新报道：让「今天有什么值得看」这类泛问题也有据可答
  const context = matches.length ? matches : pool.slice(0, CONTEXT_ARTICLES)

  const userContent = context.length
    ? `${userInput}\n\n【本地资料】${matches.length ? '' : '（未命中检索，以下为最新报道）'}\n${contextBlock(context)}`
    : `${userInput}\n\n【本地资料】\n（本地缓存中暂无报道）`

  const turns = history.slice(-HISTORY_TURNS).map((message) => ({
    role: message.role,
    content: message.content,
  }))

  const content = await chatComplete(
    config,
    [
      { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
      ...turns,
      { role: 'user', content: userContent },
    ],
    { temperature: 0.4, signal },
  )

  return { content, refs: citedRefs(content, context) }
}

// —— 舆情：全量语料聚合分析 ——

/** 每批送模型归纳的报道条数；分批后再综合，避免一次塞爆上下文 */
const CORPUS_CHUNK_SIZE = 40
/** 归纳分批的并发上限，与翻译等模块保持同量级 */
const NOTES_CONCURRENCY = 2

function toTermList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const terms: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const term = item.trim()
    const key = term.toLowerCase()
    if (term.length < 2 || term.length > 24 || seen.has(key)) continue
    seen.add(key)
    terms.push(term)
    if (terms.length >= max) break
  }
  return terms
}

export function parseEntityTerms(raw: unknown, entity: string): EntityTerms {
  const payload = (raw ?? {}) as { aliases?: unknown; related?: unknown; industry?: unknown }
  const aliases = toTermList(payload.aliases, 8)
  // 主体本名永远是检索词，模型漏给也要补上
  if (!aliases.some((term) => term.toLowerCase() === entity.toLowerCase())) {
    aliases.unshift(entity)
  }
  return {
    aliases: aliases.slice(0, 9),
    related: toTermList(payload.related, 8),
    industry: toTermList(payload.industry, 8),
  }
}

/** 把语料范围写成一句话，既喂给模型也回显给用户 */
export function describeScope(scope: CorpusScope): string {
  const sections = scope.sections.map((s) => `${s.label} ${s.count} 篇`).join(' · ')
  const span =
    scope.earliest && scope.latest
      ? `${chineseDate(scope.earliest)} 至 ${chineseDate(scope.latest)}`
      : '时间范围不详'
  const parts = [
    `共 ${scope.total} 篇报道（直接相关 ${scope.core} 篇，板块背景 ${scope.context} 篇）`,
    `来自 ${scope.sourceCount} 个信源`,
    sections ? `板块分布：${sections}` : '',
    span,
  ].filter(Boolean)
  if (scope.dropped > 0) parts.push(`另有 ${scope.dropped} 篇因超出分析上限未纳入`)
  return parts.join(' · ')
}

export interface SentimentReportInput {
  config: AiConfig
  pool: Article[]
  entity: string
  signal?: AbortSignal
  onStage?: (stage: SentimentStage, detail?: string) => void
}

export interface SentimentReportResult extends AssistantResult {
  scope?: CorpusScope
}

/**
 * 企业/主题舆情：不是搜一次公司名就完事，而是
 * 扩展检索词 → 跨板块全量召回 → 分批归纳 → 汇总成报告。
 */
export async function runSentimentReport(
  input: SentimentReportInput,
): Promise<SentimentReportResult> {
  const { config, pool, entity, signal, onStage } = input

  // 1. 先用本名做种子检索，给扩展词模型一点本地线索
  const seeds = searchArticlesByEntity(pool, entity, 12)

  // 2. 扩展检索词：别名 / 子公司 / 产品 / 高管 / 行业赛道
  onStage?.('expanding')
  let terms: EntityTerms = { aliases: [entity], related: [], industry: [] }
  try {
    const raw = await chatComplete(
      config,
      [
        { role: 'system', content: ENTITY_TERMS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: entityTermsUserPrompt(entity, seeds.map((article) => article.title)),
        },
      ],
      { temperature: 0.2, signal },
    )
    terms = parseEntityTerms(extractJsonPayload(raw), entity)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    // 扩展失败不致命：退回只用本名检索，仍然比原来多做后面的聚合分析
  }

  // 3. 全量召回并按板块统计
  onStage?.('collecting')
  const corpus = collectEntityCorpus(pool, entity, terms)
  if (!corpus.articles.length) {
    return {
      content: `本地缓存中没有检索到与「${entity}」相关的报道。已尝试的检索词：${[
        ...terms.aliases,
        ...terms.related,
        ...terms.industry,
      ]
        .slice(0, 12)
        .join('、')}。可以先刷新相关分类或频道，让列表缓存覆盖更多来源后再试。`,
      refs: [],
    }
  }

  const scopeLine = describeScope(corpus.scope)
  const numbered = corpus.articles.map(
    (article, index) => `【${index + 1}】${articleBrief(article, 120)}`,
  )

  // 4. 分批归纳：语料多时先压成要点笔记，再汇总
  const chunks: string[][] = []
  for (let i = 0; i < numbered.length; i += CORPUS_CHUNK_SIZE) {
    chunks.push(numbered.slice(i, i + CORPUS_CHUNK_SIZE))
  }

  let notes: string
  if (chunks.length === 1) {
    notes = chunks[0].join('\n')
  } else {
    onStage?.('digesting', `0/${chunks.length}`)
    let done = 0
    const partNotes = await mapConcurrent(
      chunks,
      NOTES_CONCURRENCY,
      async (chunk, index) =>
        chatComplete(
          config,
          [
            { role: 'system', content: CORPUS_NOTES_SYSTEM_PROMPT },
            {
              role: 'user',
              content: corpusNotesUserPrompt(entity, chunk.join('\n'), index + 1, chunks.length),
            },
          ],
          { temperature: 0.2, signal },
        ),
      signal,
      () => {
        done += 1
        onStage?.('digesting', `${done}/${chunks.length}`)
      },
    )
    notes = partNotes
      .map((note, index) => `〔第 ${index + 1}/${chunks.length} 批要点〕\n${note}`)
      .join('\n\n')
  }

  // 5. 汇总成报告
  onStage?.('synthesizing')
  const content = await chatComplete(
    config,
    [
      { role: 'system', content: SENTIMENT_SYSTEM_PROMPT },
      { role: 'user', content: sentimentUserPrompt(entity, scopeLine, notes) },
    ],
    { temperature: 0.3, signal },
  )

  const cited = citedRefs(content, corpus.articles)
  return {
    content,
    refs: cited.length ? cited : toRefs(corpus.articles.slice(0, 8)),
    scope: corpus.scope,
  }
}
