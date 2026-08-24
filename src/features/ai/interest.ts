import type { Article } from '../../lib/types'
import type { InterestSnapshot, ReadingProfile } from './types'

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
  profile?: ReadingProfile
}): InterestSnapshot {
  const sourceCounts = new Map<string, number>()
  for (const article of [...input.history, ...input.later]) {
    sourceCounts.set(article.sourceName, (sourceCounts.get(article.sourceName) ?? 0) + 1)
  }
  const topSources = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOP_SOURCES)
    .map(([name]) => name)
  const notable = (bars: { label: string; weight: number }[]) =>
    bars
      .filter((bar) => bar.weight > 0)
      .slice(0, MAX_TOP_SOURCES)
      .map((bar) => ({ label: bar.label, weight: bar.weight }))

  return {
    recentReadTitles: input.history.slice(0, MAX_READ_TITLES).map((article) => article.title),
    laterTitles: input.later.slice(0, MAX_LATER_TITLES).map((article) => article.title),
    topSources,
    categoryPrefs: notable(input.profile?.categories ?? []),
    publisherPrefs: notable(input.profile?.publishers ?? []),
    portrait: input.profile?.portrait ?? '',
  }
}

export function hasInterestSignal(snapshot: InterestSnapshot): boolean {
  return (
    snapshot.recentReadTitles.length > 0 ||
    snapshot.laterTitles.length > 0 ||
    snapshot.categoryPrefs.length > 0 ||
    snapshot.publisherPrefs.length > 0
  )
}
