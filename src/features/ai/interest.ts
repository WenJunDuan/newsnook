import type { Article } from '../../lib/types'
import type { InterestSnapshot } from './types'

const MAX_READ_TITLES = 24
const MAX_LATER_TITLES = 12
const MAX_TOP_SOURCES = 6

/**
 * 本地阅读画像：全部来自本机的最近阅读与稍后读，
 * 只做标题/来源级快照，正文与已读明细不出本机。
 */
export function buildInterestSnapshot(input: {
  history: Article[]
  later: Article[]
}): InterestSnapshot {
  const sourceCounts = new Map<string, number>()
  for (const article of [...input.history, ...input.later]) {
    sourceCounts.set(article.sourceName, (sourceCounts.get(article.sourceName) ?? 0) + 1)
  }
  const topSources = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOP_SOURCES)
    .map(([name]) => name)

  return {
    recentReadTitles: input.history.slice(0, MAX_READ_TITLES).map((article) => article.title),
    laterTitles: input.later.slice(0, MAX_LATER_TITLES).map((article) => article.title),
    topSources,
  }
}

export function hasInterestSignal(snapshot: InterestSnapshot): boolean {
  return snapshot.recentReadTitles.length > 0 || snapshot.laterTitles.length > 0
}
