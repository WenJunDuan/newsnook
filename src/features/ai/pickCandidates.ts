import type { Article } from '../../lib/types'

/** 送入模型的候选上限 */
export const MAX_CANDIDATES = 60
/** 精选双路：当前分类占比，其余为兴趣跨分类 */
export const IN_NETWORK_RATIO = 0.7
const AUTHOR_DECAY = 0.5

export interface PickCandidatesInput {
  articles: Article[]
  readIds: Set<string>
  excludeIds?: Set<string>
  /** 未读/已读组内再按偏好分排序；不改变首页时间线 */
  scoreOf?: (article: Article) => number
}

export interface MixPickCandidatesInput extends PickCandidatesInput {
  /** 当前分类外的已加载文章（兴趣跨分类） */
  outNetwork: Article[]
}

function byTime(left: Article, right: Article): number {
  return right.publishedAt - left.publishedAt
}

function rankArticles(list: Article[], scoreOf?: (article: Article) => number): Article[] {
  const copy = [...list]
  if (!scoreOf) return copy.sort(byTime)
  return copy.sort((left, right) => {
    const delta = scoreOf(right) - scoreOf(left)
    return delta !== 0 ? delta : byTime(left, right)
  })
}

function partitionByRead(
  articles: Article[],
  readIds: Set<string>,
  skip: Set<string>,
): { unread: Article[]; read: Article[] } {
  const unread: Article[] = []
  const read: Article[] = []
  const seen = new Set(skip)
  for (const article of articles) {
    if (seen.has(article.id)) continue
    seen.add(article.id)
    if (readIds.has(article.id)) read.push(article)
    else unread.push(article)
  }
  return { unread, read }
}

function rankUnreadThenRead(
  articles: Article[],
  readIds: Set<string>,
  skip: Set<string>,
  scoreOf?: (article: Article) => number,
): Article[] {
  const parts = partitionByRead(articles, readIds, skip)
  return [...rankArticles(parts.unread, scoreOf), ...rankArticles(parts.read, scoreOf)]
}

/** 未读在前、时间新在前的单路候选；换一批时排除上一轮结果 */
export function buildPickCandidates(input: PickCandidatesInput): Article[] {
  const skip = input.excludeIds ?? new Set<string>()
  return rankUnreadThenRead(input.articles, input.readIds, skip, input.scoreOf).slice(0, MAX_CANDIDATES)
}

function greedyTake(
  ranked: Article[],
  limit: number,
  scoreOf: ((article: Article) => number) | undefined,
  sourceCounts: Map<string, number>,
): Article[] {
  const remaining = [...ranked]
  const taken: Article[] = []
  while (taken.length < limit && remaining.length) {
    let bestAt = 0
    let bestScore = Number.NEGATIVE_INFINITY
    for (let index = 0; index < remaining.length; index += 1) {
      const article = remaining[index]
      const repeats = sourceCounts.get(article.sourceId) ?? 0
      const base = scoreOf ? scoreOf(article) : remaining.length - index
      const score = base * AUTHOR_DECAY ** repeats
      if (score > bestScore) {
        bestScore = score
        bestAt = index
      }
    }
    const [picked] = remaining.splice(bestAt, 1)
    if (!picked) break
    taken.push(picked)
    sourceCounts.set(picked.sourceId, (sourceCounts.get(picked.sourceId) ?? 0) + 1)
  }
  return taken
}

/**
 * 精选召回：约 70% 当前分类 + 30% 跨分类兴趣，同出品方衰减。
 * 不用于首页时间线。
 */
export function mixPickCandidates(input: MixPickCandidatesInput): Article[] {
  const exclude = input.excludeIds ?? new Set<string>()
  const inNetwork = rankUnreadThenRead(input.articles, input.readIds, exclude, input.scoreOf)
  const skip = new Set([...exclude, ...inNetwork.map((item) => item.id)])
  const outNetwork = rankUnreadThenRead(input.outNetwork, input.readIds, skip, input.scoreOf)
  const inSlots = Math.max(1, Math.round(MAX_CANDIDATES * IN_NETWORK_RATIO))
  const sourceCounts = new Map<string, number>()
  const inPicked = greedyTake(inNetwork, Math.min(inSlots, inNetwork.length), input.scoreOf, sourceCounts)
  const outSlots = Math.max(0, MAX_CANDIDATES - inPicked.length)
  return [...inPicked, ...greedyTake(outNetwork, outSlots, input.scoreOf, sourceCounts)]
}
