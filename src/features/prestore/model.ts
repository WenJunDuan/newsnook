import type { Article } from '../../lib/types'
import type { CategoryId } from '../../sources/categories'
import {
  FOLLOWS_ENABLED_SOURCES,
  categorySourceIds,
  visibleCategories,
  type Preferences,
} from '../../sources/preferences'
import { findSource, type NewsSource } from '../../sources/registry'

export interface PrestoreSourceTarget {
  categoryId: CategoryId
  categoryLabel: string
  source: NewsSource
}

export interface PrestorePlan {
  presetId: string
  key: string
  sources: PrestoreSourceTarget[]
}

/**
 * Resolve the exact source traversal order for the active preset/runtime layout.
 * A source is visited once at its first concrete visible category; mix-only sources are appended last.
 */
export function buildPrestorePlan(
  presetId: string,
  prefs: Preferences,
  enabledIds: string[],
): PrestorePlan {
  const seen = new Set<string>()
  const sources: PrestoreSourceTarget[] = []

  const categories = visibleCategories(prefs)
  const aggregateCategory = categories.find((category) => category.id === FOLLOWS_ENABLED_SOURCES)

  const appendSource = (categoryId: CategoryId, categoryLabel: string, sourceId: string) => {
    if (seen.has(sourceId)) return
    const source = findSource(sourceId, prefs.customSources)
    if (!source) return
    seen.add(sourceId)
    sources.push({ categoryId, categoryLabel, source })
  }

  // mix/综合是全局启用源的聚合视图，不让它在首位把所有真实分类提前“吃掉”。
  // 真实分类按用户顺序先走；最后只补综合独有、此前未出现的启用源。
  for (const category of categories) {
    if (category.id === FOLLOWS_ENABLED_SOURCES) continue
    for (const sourceId of categorySourceIds(category.id, prefs)) {
      appendSource(category.id, category.label, sourceId)
    }
  }

  if (aggregateCategory) {
    for (const sourceId of enabledIds) {
      appendSource(aggregateCategory.id, aggregateCategory.label, sourceId)
    }
  }

  return {
    presetId,
    key: `${presetId}:${sources
      .map((item) => `${item.categoryId}/${item.source.id}@${item.source.kind}:${item.source.url}`)
      .join('|')}`,
    sources,
  }
}

/**
 * Build the next fixed-size rolling window.
 * Fresh successfully stored entries win in remote order; previous stored entries
 * only fill holes caused by body failures or an upstream window shorter than N.
 */
export function mergeRollingWindow(
  successfulFreshIds: readonly string[],
  previousIds: readonly string[],
  limit: number,
): string[] {
  const target = Math.max(0, Math.floor(limit))
  if (target === 0) return []

  const seen = new Set<string>()
  const result: string[] = []
  const append = (id: string) => {
    if (!id || seen.has(id) || result.length >= target) return
    seen.add(id)
    result.push(id)
  }

  successfulFreshIds.forEach(append)
  previousIds.forEach(append)
  return result
}

/** Extra candidates help a fresh pack still reach N when a few bodies fail. */
export function prestoreCandidateLimit(limit: number): number {
  const target = Math.max(1, Math.floor(limit))
  return Math.min(160, Math.max(target, Math.ceil(target * 1.25)))
}

export function compactPrestoreArticle(article: Article): Article {
  const { contentHtml: _contentHtml, ...metadata } = article
  return metadata
}
