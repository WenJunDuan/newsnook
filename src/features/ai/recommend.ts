import type { Article } from '../../lib/types'
import { chatComplete, extractJsonPayload } from './client'
import { PICKS_SYSTEM_PROMPT, picksUserPrompt } from './prompts'
import { articleBrief } from './text'
import type { AiConfig, AiPick, InterestSnapshot } from './types'

/** 候选送入模型的上限：未读优先，超出部分截断 */
const MAX_CANDIDATES = 60
const MAX_PICKS = 8

export interface PickCandidatesInput {
  articles: Article[]
  readIds: Set<string>
  excludeIds?: Set<string>
}

/** 未读在前、时间新在前的候选序列；换一批时排除上一轮结果 */
export function buildPickCandidates(input: PickCandidatesInput): Article[] {
  const { articles, readIds, excludeIds } = input
  const seen = new Set<string>()
  const unread: Article[] = []
  const read: Article[] = []
  for (const article of articles) {
    if (seen.has(article.id) || excludeIds?.has(article.id)) continue
    seen.add(article.id)
    if (readIds.has(article.id)) read.push(article)
    else unread.push(article)
  }
  const byTime = (a: Article, b: Article) => b.publishedAt - a.publishedAt
  return [...unread.sort(byTime), ...read.sort(byTime)].slice(0, MAX_CANDIDATES)
}

export function parsePicksPayload(raw: unknown, candidates: Article[]): AiPick[] {
  if (!Array.isArray(raw)) return []
  const picks: AiPick[] = []
  const used = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { index, reason } = item as { index?: unknown; reason?: unknown }
    if (typeof index !== 'number' || !Number.isInteger(index)) continue
    const candidate = candidates[index - 1]
    if (!candidate || used.has(candidate.id)) continue
    used.add(candidate.id)
    picks.push({
      articleId: candidate.id,
      reason: typeof reason === 'string' ? reason.trim().slice(0, 60) : '',
    })
    if (picks.length >= MAX_PICKS) break
  }
  return picks
}

/** AI 精选：从当前列表中按本地阅读画像挑选，返回文章与理由 */
export async function pickArticles(
  config: AiConfig,
  snapshot: InterestSnapshot,
  candidates: Article[],
  signal?: AbortSignal,
): Promise<{ article: Article; reason: string }[]> {
  if (!candidates.length) return []
  const lines = candidates.map((article) => articleBrief(article))
  const content = await chatComplete(
    config,
    [
      { role: 'system', content: PICKS_SYSTEM_PROMPT },
      { role: 'user', content: picksUserPrompt(snapshot, lines) },
    ],
    { temperature: 0.3, signal },
  )
  const picks = parsePicksPayload(extractJsonPayload(content), candidates)
  const byId = new Map(candidates.map((article) => [article.id, article]))
  return picks
    .map((pick) => {
      const article = byId.get(pick.articleId)
      return article ? { article, reason: pick.reason } : null
    })
    .filter((item): item is { article: Article; reason: string } => Boolean(item))
}
