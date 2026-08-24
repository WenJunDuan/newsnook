import type { Article } from '../../lib/types'
import { chatComplete, extractJsonPayload } from './client'
import { DIGEST_SYSTEM_PROMPT, digestUserPrompt } from './prompts'
import { loadDigest, saveDigest } from './storage'
import { htmlToPlainText } from './text'
import type { AiConfig, AiSentiment, ArticleDigest } from './types'

/** 正文送入模型的上限：兼顾长文覆盖与 token 成本 */
const BODY_CHAR_LIMIT = 6000

const SENTIMENTS = new Set<AiSentiment>(['positive', 'neutral', 'negative', 'mixed'])

function toStringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim().slice(0, maxChars))
    .slice(0, maxItems)
}

export function parseDigestPayload(
  raw: unknown,
  articleId: string,
  model: string,
): ArticleDigest | null {
  if (!raw || typeof raw !== 'object') return null
  const payload = raw as {
    summary?: unknown
    keyPoints?: unknown
    tags?: unknown
    sentiment?: unknown
  }
  const summary = typeof payload.summary === 'string' ? payload.summary.trim() : ''
  if (!summary) return null
  return {
    articleId,
    summary: summary.slice(0, 600),
    keyPoints: toStringArray(payload.keyPoints, 6, 80),
    tags: toStringArray(payload.tags, 4, 12),
    sentiment: SENTIMENTS.has(payload.sentiment as AiSentiment)
      ? (payload.sentiment as AiSentiment)
      : 'neutral',
    model,
    createdAt: Date.now(),
  }
}

export function cachedDigest(articleId: string, model: string): ArticleDigest | null {
  const digest = loadDigest(articleId)
  // 换模型后旧结果口径不同，视为未生成
  return digest && digest.model === model ? digest : null
}

/** 生成（或返回缓存的）单篇文章 AI 解读 */
export async function generateArticleDigest(
  config: AiConfig,
  article: Article,
  bodyHtml: string,
  options?: { signal?: AbortSignal; force?: boolean },
): Promise<ArticleDigest> {
  if (!options?.force) {
    const cached = cachedDigest(article.id, config.model)
    if (cached) return cached
  }

  const bodyText = htmlToPlainText(bodyHtml, BODY_CHAR_LIMIT) || article.summary || article.title
  const content = await chatComplete(
    config,
    [
      { role: 'system', content: DIGEST_SYSTEM_PROMPT },
      { role: 'user', content: digestUserPrompt(article.title, bodyText) },
    ],
    { temperature: 0.3, signal: options?.signal },
  )

  const digest = parseDigestPayload(extractJsonPayload(content), article.id, config.model)
  if (!digest) throw new Error('AI 智读：解读结果格式异常，请重试')
  saveDigest(digest)
  return digest
}
