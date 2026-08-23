import { LIST_CACHE_PREFIX, listKeys, loadCachedList } from '../../lib/storage'
import { SOURCE_GROUPS, SOURCE_GROUP_ORDER } from '../../sources/registry'
import type { Article } from '../../lib/types'
import type { CorpusArticle, CorpusScope, CorpusSection, EntityTerms } from './types'

/** 助手检索池上限：覆盖全部信源近几日的列表缓存即可 */
const MAX_POOL_ARTICLES = 1500

/**
 * 本地文章池：汇总所有信源的列表缓存（含未启用分类），
 * 供助手问答与舆情分析做全库检索；不发起任何网络请求。
 */
export function loadArticlePool(extra?: Article[]): Article[] {
  const byId = new Map<string, Article>()
  for (const article of extra ?? []) {
    byId.set(article.id, article)
  }
  for (const key of listKeys(LIST_CACHE_PREFIX)) {
    const sourceId = key.slice(LIST_CACHE_PREFIX.length)
    const cached = loadCachedList(sourceId)
    if (!cached) continue
    for (const article of cached.items) {
      if (!byId.has(article.id)) byId.set(article.id, article)
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, MAX_POOL_ARTICLES)
}

interface ScoredArticle {
  article: Article
  score: number
}

const QUERY_STOPWORDS = new Set([
  '新闻', '资讯', '报道', '消息', '相关', '最近', '最新', '今天', '本周',
  '帮我', '给我', '我想', '查找', '搜索', '查询', '找找', '看看', '有什么',
  '什么', '怎么', '如何', '哪些', '分析', '总结', '舆情', '情况', '一下',
  '请问', '关于', '这个', '那个', '以及', '还有', '文章', '内容',
])

/**
 * 从中文/混合查询里枚举 2–8 字的候选词窗（含英文单词），
 * 供无分词条件下的本地匹配使用。
 */
export function extractQueryTerms(query: string): string[] {
  const terms = new Set<string>()

  for (const match of query.matchAll(/[A-Za-z][A-Za-z0-9.-]{1,23}/g)) {
    const word = match[0].toLowerCase()
    if (word.length >= 2) terms.add(word)
  }

  for (const match of query.matchAll(/\p{Script=Han}{2,}/gu)) {
    const run = match[0]
    const maxLen = Math.min(8, run.length)
    for (let len = 2; len <= maxLen; len += 1) {
      for (let start = 0; start + len <= run.length; start += 1) {
        const term = run.slice(start, start + len)
        if (!QUERY_STOPWORDS.has(term)) terms.add(term)
      }
    }
  }

  return [...terms]
}

/**
 * 本地相关性检索：更长的命中词权重更高，标题命中优于摘要命中。
 * 无外部索引，纯字符串匹配，1500 篇量级毫秒可完成。
 */
export function searchArticles(pool: Article[], query: string, limit = 12): Article[] {
  const terms = extractQueryTerms(query)
  if (!terms.length) return []

  const scored: ScoredArticle[] = []
  for (const article of pool) {
    const title = article.title
    const summary = article.summary ?? ''
    let score = 0
    let longestHit = 0
    for (const term of terms) {
      const inTitle = title.includes(term) || title.toLowerCase().includes(term)
      const inSummary = !inTitle && (summary.includes(term) || summary.toLowerCase().includes(term))
      if (!inTitle && !inSummary) continue
      const weight = term.length * term.length
      score += inTitle ? weight * 3 : weight
      longestHit = Math.max(longestHit, term.length)
    }
    // 仅命中孤立双字词的条目噪音大，要求至少一个 3 字以上词或多处命中
    if (score > 0 && (longestHit >= 3 || score >= 12)) {
      scored.push({ article, score })
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || b.article.publishedAt - a.article.publishedAt)
    .slice(0, limit)
    .map((item) => item.article)
}

/** 精确子串检索：舆情模式用企业/主题名直接匹配 */
export function searchArticlesByEntity(pool: Article[], entity: string, limit = 20): Article[] {
  const needle = entity.trim()
  if (needle.length < 2) return []
  const lower = needle.toLowerCase()
  return pool
    .filter((article) => {
      const haystack = `${article.title}\n${article.summary ?? ''}`
      return haystack.includes(needle) || haystack.toLowerCase().includes(lower)
    })
    .slice(0, limit)
}

// —— 舆情语料收集：从「搜一个公司名」升级为「把相关报道整体抓过来」 ——

/**
 * 单个检索词的匹配：中日韩用子串，纯拉丁词用词边界，
 * 避免「AI」命中 said、「US」命中 use 这类噪音。
 */
function matchesTerm(haystack: string, lowerHaystack: string, term: string): boolean {
  const needle = term.trim()
  if (needle.length < 2) return false
  if (/^[\x20-\x7e]+$/.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9])${escaped.toLowerCase()}($|[^a-z0-9])`, 'i').test(lowerHaystack)
  }
  return haystack.includes(needle)
}

interface TermWeight {
  term: string
  /** 命中标题的权重；命中摘要按六折计 */
  weight: number
  /** 命中即视为直接相关（而非板块背景） */
  core: boolean
}

function buildTermWeights(terms: EntityTerms): TermWeight[] {
  const weights: TermWeight[] = []
  const seen = new Set<string>()
  const push = (list: string[], weight: number, core: boolean) => {
    for (const raw of list) {
      const term = raw.trim()
      const key = term.toLowerCase()
      if (term.length < 2 || seen.has(key)) continue
      seen.add(key)
      weights.push({ term, weight, core })
    }
  }
  push(terms.aliases, 100, true)
  push(terms.related, 50, true)
  push(terms.industry, 12, false)
  return weights
}

export interface EntityCorpus {
  entity: string
  /** 已按相关度排序，core 在前 */
  articles: Article[]
  meta: Map<string, CorpusArticle>
  scope: CorpusScope
}

export interface CollectCorpusOptions {
  /** 语料总量上限，控制送模型的规模 */
  maxArticles?: number
  /** 板块背景类报道的上限，防止行业词把主体报道淹没 */
  maxContext?: number
}

/**
 * 按扩展检索词在整个本地池子里做全量召回，并标注每篇是「直接相关」还是「板块背景」。
 * 与旧的 searchArticlesByEntity 的区别：不再只认公司名本身，
 * 别名 / 子公司 / 产品 / 高管 命中同样算直接相关，行业与竞对词则带入板块背景。
 */
export function collectEntityCorpus(
  pool: Article[],
  entity: string,
  terms: EntityTerms,
  options?: CollectCorpusOptions,
): EntityCorpus {
  const maxArticles = options?.maxArticles ?? 160
  const maxContext = options?.maxContext ?? 40
  const weights = buildTermWeights(terms)

  const core: { article: Article; meta: CorpusArticle }[] = []
  const context: { article: Article; meta: CorpusArticle }[] = []

  for (const article of pool) {
    const title = article.title ?? ''
    const summary = article.summary ?? ''
    const haystack = `${title}\n${summary}`
    const lowerHaystack = haystack.toLowerCase()
    const lowerTitle = title.toLowerCase()

    let score = 0
    let isCore = false
    const hits: string[] = []

    for (const { term, weight, core: coreTerm } of weights) {
      if (!matchesTerm(haystack, lowerHaystack, term)) continue
      const inTitle = matchesTerm(title, lowerTitle, term)
      score += inTitle ? weight : Math.round(weight * 0.6)
      hits.push(term)
      if (coreTerm) isCore = true
    }

    if (!hits.length) continue
    // 只靠行业词命中的，要求命中面更广或词更具体，否则噪音太大
    if (!isCore && hits.length < 2 && hits.every((term) => term.length <= 3)) continue

    const meta: CorpusArticle = {
      articleId: article.id,
      relevance: isCore ? 'core' : 'context',
      score,
      hits,
    }
    ;(isCore ? core : context).push({ article, meta })
  }

  const byScore = (
    a: { article: Article; meta: CorpusArticle },
    b: { article: Article; meta: CorpusArticle },
  ) => b.meta.score - a.meta.score || b.article.publishedAt - a.article.publishedAt

  core.sort(byScore)
  context.sort(byScore)

  const keptContext = context.slice(0, Math.min(maxContext, Math.max(0, maxArticles - core.length)))
  const keptCore = core.slice(0, maxArticles)
  const kept = [...keptCore, ...keptContext].slice(0, maxArticles)
  const dropped = core.length + context.length - kept.length

  const meta = new Map(kept.map((item) => [item.article.id, item.meta]))
  const articles = kept.map((item) => item.article)

  const sectionCounts = new Map<string, number>()
  const sources = new Set<string>()
  let earliest: number | undefined
  let latest: number | undefined
  for (const article of articles) {
    sectionCounts.set(article.sourceGroup, (sectionCounts.get(article.sourceGroup) ?? 0) + 1)
    sources.add(article.sourceId)
    if (article.hasRealDate) {
      if (earliest === undefined || article.publishedAt < earliest) earliest = article.publishedAt
      if (latest === undefined || article.publishedAt > latest) latest = article.publishedAt
    }
  }

  const sections: CorpusSection[] = SOURCE_GROUP_ORDER.filter((group) =>
    sectionCounts.has(group),
  ).map((group) => ({
    group,
    label: SOURCE_GROUPS[group].title,
    count: sectionCounts.get(group) ?? 0,
  }))

  return {
    entity,
    articles,
    meta,
    scope: {
      total: articles.length,
      core: kept.filter((item) => item.meta.relevance === 'core').length,
      context: kept.filter((item) => item.meta.relevance === 'context').length,
      sourceCount: sources.size,
      sections,
      earliest,
      latest,
      dropped,
      terms,
    },
  }
}
