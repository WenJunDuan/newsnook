import type { Article } from '../../lib/types'
import type {
  InterestCategory,
  PrefBar,
  ReadingPrefOverrides,
  ReadingProfile,
  ReadLogEntry,
} from './types'

export type { InterestCategory, ReadLogEntry }

export const READ_LOG_MAX_ENTRIES = 400
export const READ_LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** 画像与自动侧重按阅读日志重算的间隔 */
export const PORTRAIT_REFRESH_MS = 4 * 60 * 60 * 1000
/** 与 preferences.FOLLOWS_ENABLED_SOURCES 相同；兴趣统计排除综合 */
export const MIX_CATEGORY_ID = 'mix'
const PREF_WINDOW_DAYS = 7
const TODAY_WEIGHT = 2
const MAX_PUBLISHER_BARS = 8
const DAY_MS = 24 * 60 * 60 * 1000

export function isReadLogEntry(value: unknown): value is ReadLogEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.articleId === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.sourceId === 'string' &&
    typeof entry.sourceName === 'string' &&
    typeof entry.sourceLabel === 'string' &&
    typeof entry.sourceGroup === 'string' &&
    typeof entry.categoryId === 'string' &&
    typeof entry.categoryLabel === 'string' &&
    typeof entry.openedAt === 'number' &&
    (entry.interestCategories === undefined || Array.isArray(entry.interestCategories))
  )
}

export function interestCategoriesForSource(
  sourceId: string,
  categories: { id: string; label: string; sourceIds?: string[] }[],
): InterestCategory[] {
  return categories
    .filter((category) => category.id !== MIX_CATEGORY_ID && (category.sourceIds ?? []).includes(sourceId))
    .map((category) => ({ id: category.id, label: category.label }))
}

export function buildSourceInterestMap(
  categories: { id: string; label: string; sourceIds?: string[] }[],
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const category of categories) {
    if (category.id === MIX_CATEGORY_ID) continue
    for (const sourceId of category.sourceIds ?? []) {
      const list = map[sourceId] ?? (map[sourceId] = [])
      if (!list.includes(category.id)) list.push(category.id)
    }
  }
  return map
}

function interestCategoriesOf(entry: ReadLogEntry): InterestCategory[] {
  if (entry.interestCategories?.length) {
    return entry.interestCategories.filter((item) => item.id && item.id !== MIX_CATEGORY_ID)
  }
  if (entry.categoryId && entry.categoryId !== MIX_CATEGORY_ID) {
    return [{ id: entry.categoryId, label: entry.categoryLabel }]
  }
  return []
}

export function localDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function pruneReadLog(entries: ReadLogEntry[], now: number): ReadLogEntry[] {
  const oldest = now - READ_LOG_MAX_AGE_MS
  return entries
    .filter((entry) => entry.openedAt >= oldest)
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, READ_LOG_MAX_ENTRIES)
}

/** 同一篇文章在同一天只记一次，重复打开刷新时间 */
export function mergeReadEntry(
  log: ReadLogEntry[],
  entry: ReadLogEntry,
  now: number,
): ReadLogEntry[] {
  const day = localDayKey(entry.openedAt)
  const without = log.filter(
    (item) => !(item.articleId === entry.articleId && localDayKey(item.openedAt) === day),
  )
  return pruneReadLog([entry, ...without], now)
}

export function clampPrefWeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function normalizeReadingPrefs(value: unknown): ReadingPrefOverrides {
  const input = (value ?? {}) as Partial<ReadingPrefOverrides>
  return {
    categories: normalizeWeightMap(input.categories),
    publishers: normalizeWeightMap(input.publishers),
  }
}

function normalizeWeightMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: Record<string, number> = {}
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!id.trim()) continue
    const weight = clampPrefWeight(raw)
    if (weight == null) continue
    next[id] = weight
  }
  return next
}

interface CountBucket {
  label: string
  count: number
  weighted: number
}

function addCount(
  buckets: Map<string, CountBucket>,
  id: string,
  label: string,
  weighted: number,
): void {
  const current = buckets.get(id)
  if (current) {
    current.count += 1
    current.weighted += weighted
    return
  }
  buckets.set(id, { label, count: 1, weighted })
}

function toBars(
  buckets: Map<string, CountBucket>,
  overrides: Record<string, number>,
  extraIds: { id: string; label: string }[],
  limit?: number,
): PrefBar[] {
  const total = [...buckets.values()].reduce((sum, item) => sum + item.weighted, 0)
  const ids = new Set([...buckets.keys(), ...Object.keys(overrides), ...extraIds.map((item) => item.id)])
  const labels = new Map(extraIds.map((item) => [item.id, item.label]))
  const bars: PrefBar[] = []
  for (const id of ids) {
    const bucket = buckets.get(id)
    const locked = Object.prototype.hasOwnProperty.call(overrides, id)
    const auto = total > 0 && bucket ? Math.round((bucket.weighted / total) * 100) : 0
    bars.push({
      id,
      label: bucket?.label ?? labels.get(id) ?? id,
      auto,
      weight: locked ? overrides[id] : auto,
      locked,
      count: bucket?.count ?? 0,
      preferred: false,
    })
  }
  bars.sort((a, b) => b.weight - a.weight || b.count - a.count || a.label.localeCompare(b.label, 'zh'))
  const limited =
    limit == null
      ? bars
      : [...bars.filter((bar) => bar.locked), ...bars.filter((bar) => !bar.locked).slice(0, Math.max(0, limit - bars.filter((bar) => bar.locked).length))].sort(
          (a, b) => b.weight - a.weight || b.count - a.count,
        )
  const topIds = new Set(
    limited
      .filter((bar) => bar.weight > 0)
      .slice(0, 2)
      .map((bar) => bar.id),
  )
  return limited.map((bar) => ({ ...bar, preferred: topIds.has(bar.id) }))
}

export function buildPortraitSentence(profile: Omit<ReadingProfile, 'portrait'>): string {
  if (profile.windowCount <= 0) {
    return '还没有阅读记录。打开几篇文章后，会根据日志标出分类和出品方偏好。'
  }
  const today = profile.todayCount > 0 ? `，今日 ${profile.todayCount} 篇` : ''
  const cats = profile.categories.filter((item) => item.preferred || item.weight > 0).slice(0, 3)
  const pubs = profile.publishers.filter((item) => item.preferred || item.weight > 0).slice(0, 3)
  const catText = cats.map((item) => `${item.label}${item.weight}（${item.count}篇）`).join('、')
  const pubText = pubs.map((item) => `${item.label}${item.weight}（${item.count}篇）`).join('、')
  let sentence = `近 7 天读了 ${profile.windowCount} 篇${today}`
  if (catText) sentence += `，偏 ${catText}`
  if (pubText) sentence += `；常看 ${pubText}`
  return `${sentence}。`
}

export function isPortraitRefreshDue(adjustedAt: number | undefined, now = Date.now()): boolean {
  if (adjustedAt == null || adjustedAt <= 0) return true
  return now - adjustedAt >= PORTRAIT_REFRESH_MS
}

export function msUntilPortraitRefresh(adjustedAt: number | undefined, now = Date.now()): number {
  if (isPortraitRefreshDue(adjustedAt, now)) return 0
  return Math.max(0, PORTRAIT_REFRESH_MS - (now - (adjustedAt ?? 0)))
}

export function portraitFingerprint(profile: ReadingProfile): string {
  const cats = profile.categories.map((item) => `${item.id}:${item.weight}:${item.count}`).join(',')
  const pubs = profile.publishers.map((item) => `${item.id}:${item.weight}:${item.count}`).join(',')
  return `${profile.windowCount}|${profile.todayCount}|${cats}|${pubs}`
}

/**
 * 用近 7 天阅读记录生成分类 / 出品方侧重；今日篇目加权。
 * 锁定项用手动值，其余跟统计走。
 */
export function buildReadingProfile(
  log: ReadLogEntry[],
  overrides: ReadingPrefOverrides,
  options?: { seedCategories?: InterestCategory[]; now?: number },
): ReadingProfile {
  const now = options?.now ?? Date.now()
  const todayKey = localDayKey(now)
  const windowStart = now - PREF_WINDOW_DAYS * DAY_MS
  const window = log.filter((entry) => entry.openedAt >= windowStart)
  const today = window.filter((entry) => localDayKey(entry.openedAt) === todayKey)

  const categories = new Map<string, CountBucket>()
  const publishers = new Map<string, CountBucket>()
  for (const entry of window) {
    const weighted = localDayKey(entry.openedAt) === todayKey ? TODAY_WEIGHT : 1
    for (const category of interestCategoriesOf(entry)) {
      addCount(categories, category.id, category.label, weighted)
    }
    addCount(publishers, entry.sourceId, entry.sourceLabel || entry.sourceName, weighted)
  }

  const built = {
    todayCount: today.length,
    windowCount: window.length,
    categories: toBars(categories, overrides.categories, options?.seedCategories ?? []),
    publishers: toBars(publishers, overrides.publishers, [], MAX_PUBLISHER_BARS),
  }
  return { ...built, portrait: buildPortraitSentence(built) }
}

export function scoreArticleByProfile(
  article: Article,
  profile: ReadingProfile,
  sourceInterestIds: string[] = [],
): number {
  const publisher = profile.publishers.find((item) => item.id === article.sourceId)
  const categoryIds = sourceInterestIds.length
    ? sourceInterestIds
    : article.openedCategoryId && article.openedCategoryId !== MIX_CATEGORY_ID
      ? [article.openedCategoryId]
      : []
  let categoryScore = 0
  for (const id of categoryIds) {
    const weight = profile.categories.find((item) => item.id === id)?.weight ?? 0
    if (weight > categoryScore) categoryScore = weight
  }
  return (publisher?.weight ?? 0) * 2 + categoryScore
}

export function setOverride(
  overrides: ReadingPrefOverrides,
  kind: 'categories' | 'publishers',
  id: string,
  weight: number,
): ReadingPrefOverrides {
  const clamped = clampPrefWeight(weight) ?? 0
  return { ...overrides, [kind]: { ...overrides[kind], [id]: clamped } }
}

export function clearOverride(
  overrides: ReadingPrefOverrides,
  kind: 'categories' | 'publishers',
  id: string,
): ReadingPrefOverrides {
  const next = { ...overrides[kind] }
  delete next[id]
  return { ...overrides, [kind]: next }
}

export function clearAllOverrides(): ReadingPrefOverrides {
  return { categories: {}, publishers: {} }
}
