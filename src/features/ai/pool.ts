import { LIST_CACHE_PREFIX, listKeys, loadCachedList } from '../../lib/storage'
import type { Article } from '../../lib/types'

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
