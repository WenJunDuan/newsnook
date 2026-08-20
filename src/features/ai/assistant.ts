import type { Article } from '../../lib/types'
import { chatComplete } from './client'
import {
  ASSISTANT_SYSTEM_PROMPT,
  SENTIMENT_SYSTEM_PROMPT,
  sentimentUserPrompt,
} from './prompts'
import { searchArticles, searchArticlesByEntity } from './pool'
import { articleBrief } from './text'
import type { AiChatMessage, AiConfig, ChatArticleRef } from './types'

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

/** 企业/主题舆情报告：实体检索 → 结构化 Markdown 报告 */
export async function runSentimentReport(input: {
  config: AiConfig
  pool: Article[]
  entity: string
  signal?: AbortSignal
}): Promise<AssistantResult> {
  const { config, pool, entity, signal } = input
  const matches = searchArticlesByEntity(pool, entity, CONTEXT_ARTICLES)
  if (!matches.length) {
    return {
      content: `本地缓存中没有检索到与「${entity}」相关的报道。可以先刷新相关分类或频道，让列表缓存覆盖更多来源后再试。`,
      refs: [],
    }
  }

  const content = await chatComplete(
    config,
    [
      { role: 'system', content: SENTIMENT_SYSTEM_PROMPT },
      { role: 'user', content: sentimentUserPrompt(entity, contextBlock(matches)) },
    ],
    { temperature: 0.3, signal },
  )

  const refs = citedRefs(content, matches)
  return { content, refs: refs.length ? refs : toRefs(matches.slice(0, 6)) }
}
