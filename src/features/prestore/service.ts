import { mapConcurrent } from '../../lib/asyncPool'
import { log } from '../../lib/logger'
import { resolveArticleBody } from '../../lib/resolveBody'
import type { Article } from '../../lib/types'
import type { NewsSource } from '../../sources/registry'
import { revokeBlobUrl } from '../proxy/hydrateImages'
import {
  mergeRollingWindow,
  prestoreCandidateLimit,
  type PrestorePlan,
  type PrestoreSourceTarget,
} from './model'
import { fetchSourcePrestoreCandidates } from './sourceWindow'
import {
  commitPrestoreManifest,
  loadPrestoreManifest,
  writePrestoredBody,
  type PrestoreArticleEntry,
  type PrestoreManifest,
} from './store'

const BODY_CONCURRENCY = 2

export type PrestoreProgressPhase = 'listing' | 'bodies' | 'source-complete'

export interface PrestoreProgress {
  phase: PrestoreProgressPhase
  sourceIndex: number
  totalSources: number
  sourceId: string
  sourceName: string
  storedInSource: number
  targetPerSource: number
  completedSources: number
  failedBodies: number
  failedSources: number
}

export interface PrestoreSyncResult {
  manifest: PrestoreManifest | null
  syncedSources: number
  failedSources: number
  failedBodies: number
}

interface SyncOptions {
  plan: PrestorePlan
  perSourceLimit: number
  signal: AbortSignal
  extraSources?: NewsSource[]
  onProgress?: (progress: PrestoreProgress) => void
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('操作已取消', 'AbortError')
}

function carryPreviousSource(
  target: PrestoreSourceTarget,
  previous: PrestoreManifest | null,
  limit: number,
  nextArticles: Record<string, PrestoreArticleEntry>,
): string[] {
  const ids = previous?.sources[target.source.id]?.articleIds ?? []
  const kept: string[] = []
  for (const id of ids) {
    const entry = previous?.articles[id]
    if (!entry) continue
    nextArticles[id] = entry
    kept.push(id)
    if (kept.length >= limit) break
  }
  return kept
}

function emitProgress(
  options: SyncOptions,
  target: PrestoreSourceTarget,
  sourceIndex: number,
  phase: PrestoreProgressPhase,
  storedInSource: number,
  completedSources: number,
  failedBodies: number,
  failedSources: number,
): void {
  options.onProgress?.({
    phase,
    sourceIndex,
    totalSources: options.plan.sources.length,
    sourceId: target.source.id,
    sourceName: target.source.name,
    storedInSource,
    targetPerSource: options.perSourceLimit,
    completedSources,
    failedBodies,
    failedSources,
  })
}

function makePortableBodyHtml(html: string): string {
  const blobUrls = [...new Set(html.match(/blob:[^"'()<>\s]+/g) ?? [])]
  const portable = html.replace(/blob:[^"'()<>\s]+/g, '')
  blobUrls.forEach(revokeBlobUrl)
  return portable
}

async function prepareBody(
  article: Article,
  previous: PrestoreManifest | null,
  nextArticles: Record<string, PrestoreArticleEntry>,
  signal: AbortSignal,
  extraSources?: NewsSource[],
): Promise<{ id: string; entry: PrestoreArticleEntry } | null> {
  if (article.contentType === 'video') return null

  const alreadySelected = nextArticles[article.id]
  if (alreadySelected) return { id: article.id, entry: alreadySelected }

  const previousEntry = previous?.articles[article.id]
  if (previousEntry) return { id: article.id, entry: previousEntry }

  const resolved = await resolveArticleBody(article, signal, extraSources)
  if (resolved.bodySource === 'video' || resolved.bodySource === 'blocked') return null
  const entry = await writePrestoredBody(article, {
    // resolveArticleBody may hydrate tunneled images to process-local blob: URLs.
    // A durable offline body must never persist those ephemeral addresses.
    html: makePortableBodyHtml(resolved.contentHtml),
    bodySource: resolved.bodySource,
  })
  return { id: article.id, entry }
}

/**
 * 严格按当前预设的分类/信源顺序同步。信源之间串行；只有当前信源的正文并发 2。
 * 新正文全部先落盘，最后再提交新清单，因此失败/中断不会提前淘汰上一轮可读内容。
 */
export async function syncPrestore(options: SyncOptions): Promise<PrestoreSyncResult> {
  const { plan, signal, extraSources } = options
  const perSourceLimit = Math.max(1, Math.floor(options.perSourceLimit))
  const previous = await loadPrestoreManifest()
  const nextArticles: Record<string, PrestoreArticleEntry> = {}
  const nextSources: PrestoreManifest['sources'] = {}

  let syncedSources = 0
  let failedSources = 0
  let failedBodies = 0
  const candidateLimit = prestoreCandidateLimit(perSourceLimit)

  for (let sourceIndex = 0; sourceIndex < plan.sources.length; sourceIndex += 1) {
    if (signal.aborted) throw abortError(signal)
    const target = plan.sources[sourceIndex]
    emitProgress(
      options,
      target,
      sourceIndex,
      'listing',
      0,
      syncedSources + failedSources,
      failedBodies,
      failedSources,
    )

    let candidates: Article[]
    try {
      candidates = await fetchSourcePrestoreCandidates(target.source, candidateLimit, signal)
      if (signal.aborted) throw abortError(signal)
      syncedSources += 1
    } catch (error) {
      if (signal.aborted) throw abortError(signal)
      failedSources += 1
      log.storage.warn('Prestore source list failed', target.source.id, error)
      const carried = carryPreviousSource(target, previous, perSourceLimit, nextArticles)
      if (carried.length) {
        nextSources[target.source.id] = {
          categoryId: target.categoryId,
          articleIds: carried,
        }
      }
      emitProgress(
        options,
        target,
        sourceIndex,
        'source-complete',
        carried.length,
        syncedSources + failedSources,
        failedBodies,
        failedSources,
      )
      continue
    }

    const freshIds: string[] = []
    for (
      let offset = 0;
      offset < candidates.length && freshIds.length < perSourceLimit;
      offset += BODY_CONCURRENCY
    ) {
      if (signal.aborted) throw abortError(signal)
      const batch = candidates.slice(offset, offset + BODY_CONCURRENCY)
      const results = await mapConcurrent(
        batch,
        BODY_CONCURRENCY,
        async (article) => {
          try {
            return await prepareBody(article, previous, nextArticles, signal, extraSources)
          } catch (error) {
            if (signal.aborted) throw abortError(signal)
            failedBodies += 1
            log.storage.debug('Prestore body failed', article.id, error)
            return null
          }
        },
        signal,
      )

      for (const result of results) {
        if (!result || freshIds.length >= perSourceLimit) continue
        nextArticles[result.id] = result.entry
        freshIds.push(result.id)
      }

      emitProgress(
        options,
        target,
        sourceIndex,
        'bodies',
        freshIds.length,
        syncedSources + failedSources - 1,
        failedBodies,
        failedSources,
      )
    }

    const previousIds = (previous?.sources[target.source.id]?.articleIds ?? []).filter(
      (id) => Boolean(previous?.articles[id]),
    )
    const retainedIds = mergeRollingWindow(freshIds, previousIds, perSourceLimit)
    for (const id of retainedIds) {
      if (nextArticles[id]) continue
      const entry = previous?.articles[id]
      if (entry) nextArticles[id] = entry
    }
    if (retainedIds.length) {
      nextSources[target.source.id] = {
        categoryId: target.categoryId,
        articleIds: retainedIds,
      }
    }

    emitProgress(
      options,
      target,
      sourceIndex,
      'source-complete',
      retainedIds.length,
      syncedSources + failedSources,
      failedBodies,
      failedSources,
    )
  }

  if (signal.aborted) throw abortError(signal)

  // 完全失败或一篇可用正文都没有时，绝不能用空清单覆盖上一轮通勤内容。
  if (syncedSources === 0 || Object.keys(nextArticles).length === 0) {
    return { manifest: previous, syncedSources, failedSources, failedBodies }
  }

  const manifest: PrestoreManifest = {
    version: 1,
    revision: (previous?.revision ?? 0) + 1,
    presetId: plan.presetId,
    planKey: plan.key,
    perSourceLimit,
    updatedAt: Date.now(),
    sources: nextSources,
    articles: nextArticles,
  }
  await commitPrestoreManifest(manifest)
  return { manifest, syncedSources, failedSources, failedBodies }
}
