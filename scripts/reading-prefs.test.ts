import assert from 'node:assert/strict'

import {
  buildPortraitSentence,
  buildReadingProfile,
  isPortraitRefreshDue,
  PORTRAIT_REFRESH_MS,
  clearOverride,
  interestCategoriesForSource,
  localDayKey,
  mergeReadEntry,
  MIX_CATEGORY_ID,
  pruneReadLog,
  READ_LOG_MAX_AGE_MS,
  scoreArticleByProfile,
  setOverride,
  type ReadLogEntry,
} from '../src/features/ai/readingPrefs'
import type { Article } from '../src/lib/types'
import type { SourceGroup } from '../src/sources/registry'

const NOW = Date.parse('2026-08-24T12:00:00+08:00')

function entry(partial: Partial<ReadLogEntry> & Pick<ReadLogEntry, 'articleId'>): ReadLogEntry {
  return {
    title: partial.title ?? partial.articleId,
    sourceId: 'latepost',
    sourceName: '晚点',
    sourceLabel: '晚点',
    sourceGroup: 'cn',
    categoryId: 'tech',
    categoryLabel: '科技',
    openedAt: NOW,
    ...partial,
  }
}

function article(partial: Partial<Article> & Pick<Article, 'id'>): Article {
  return {
    title: 't',
    summary: '',
    publishedAt: NOW,
    hasRealDate: true,
    sourceId: 'latepost',
    sourceName: '晚点',
    sourceLabel: '晚点',
    sourceGroup: 'cn' as SourceGroup,
    originUrl: 'https://example.com',
    ...partial,
  }
}

console.log('Testing mergeReadEntry dedupes same article same day...')
{
  const first = entry({ articleId: 'a1', openedAt: NOW - 60_000 })
  const again = entry({ articleId: 'a1', openedAt: NOW })
  const other = entry({ articleId: 'a2', categoryId: 'biz', categoryLabel: '商业', sourceId: 'cls' })
  const merged = mergeReadEntry(mergeReadEntry([], first, NOW), again, NOW)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].openedAt, NOW)
  const two = mergeReadEntry(merged, other, NOW)
  assert.equal(two.length, 2)
}

console.log('Testing pruneReadLog drops old entries...')
{
  const fresh = entry({ articleId: 'new' })
  const stale = entry({ articleId: 'old', openedAt: NOW - READ_LOG_MAX_AGE_MS - 1000 })
  const pruned = pruneReadLog([fresh, stale], NOW)
  assert.deepEqual(
    pruned.map((item) => item.articleId),
    ['new'],
  )
}

console.log('Testing buildReadingProfile weights and today boost...')
{
  const todayTech = entry({ articleId: 't1' })
  const todayTech2 = entry({ articleId: 't2' })
  const yesterdayBiz = entry({
    articleId: 'b1',
    categoryId: 'biz',
    categoryLabel: '商业',
    sourceId: 'cls',
    sourceLabel: '财联社',
    openedAt: NOW - 24 * 60 * 60 * 1000,
  })
  const profile = buildReadingProfile(
    [todayTech, todayTech2, yesterdayBiz],
    { categories: {}, publishers: {} },
    { now: NOW, seedCategories: [{ id: 'sports', label: '体育' }] },
  )
  assert.equal(profile.todayCount, 2)
  assert.equal(profile.windowCount, 3)
  const tech = profile.categories.find((item) => item.id === 'tech')
  const biz = profile.categories.find((item) => item.id === 'biz')
  const sports = profile.categories.find((item) => item.id === 'sports')
  assert.ok(tech && biz && sports)
  assert.ok(tech.weight > biz.weight)
  assert.equal(sports.weight, 0)
  assert.equal(sports.locked, false)
  assert.equal(typeof localDayKey(NOW), 'string')
}

console.log('Testing locked overrides beat auto...')
{
  const log = [entry({ articleId: 't1' })]
  const locked = buildReadingProfile(
    log,
    { categories: { tech: 10, biz: 80 }, publishers: { latepost: 5 } },
    { now: NOW, seedCategories: [{ id: 'biz', label: '商业' }] },
  )
  assert.equal(locked.categories.find((item) => item.id === 'tech')?.weight, 10)
  assert.equal(locked.categories.find((item) => item.id === 'tech')?.locked, true)
  assert.equal(locked.categories.find((item) => item.id === 'biz')?.weight, 80)
  assert.equal(locked.publishers.find((item) => item.id === 'latepost')?.weight, 5)
}

console.log('Testing override helpers...')
{
  let overrides = { categories: {}, publishers: {} }
  overrides = setOverride(overrides, 'categories', 'tech', 66)
  assert.equal(overrides.categories.tech, 66)
  overrides = clearOverride(overrides, 'categories', 'tech')
  assert.deepEqual(overrides.categories, {})
}

console.log('Testing mix category is not an interest...')
{
  const mixOnly = entry({
    articleId: 'm1',
    categoryId: MIX_CATEGORY_ID,
    categoryLabel: '综合',
    interestCategories: [],
  })
  const techFromMix = entry({
    articleId: 't1',
    categoryId: MIX_CATEGORY_ID,
    categoryLabel: '综合',
    interestCategories: [{ id: 'tech', label: '科技' }],
  })
  const profile = buildReadingProfile([mixOnly, techFromMix], { categories: {}, publishers: {} }, { now: NOW })
  assert.equal(profile.categories.some((item) => item.id === MIX_CATEGORY_ID && item.count > 0), false)
  assert.equal(profile.categories.find((item) => item.id === 'tech')?.count, 1)
  assert.equal(profile.categories.find((item) => item.id === 'tech')?.preferred, true)
  assert.match(profile.portrait, /科技/)
  assert.match(profile.portrait, /1篇/)
  assert.match(buildPortraitSentence(profile), /近 7 天读了/)
}

console.log('Testing interestCategoriesForSource skips mix...')
{
  const found = interestCategoriesForSource('latepost', [
    { id: MIX_CATEGORY_ID, label: '综合', sourceIds: ['latepost'] },
    { id: 'tech', label: '科技', sourceIds: ['latepost', 'ithome'] },
    { id: 'biz', label: '商业', sourceIds: ['cls'] },
  ])
  assert.deepEqual(found, [{ id: 'tech', label: '科技' }])
}

console.log('Testing 4-hour portrait refresh due...')
{
  assert.equal(isPortraitRefreshDue(undefined, NOW), true)
  assert.equal(isPortraitRefreshDue(0, NOW), true)
  assert.equal(isPortraitRefreshDue(NOW - PORTRAIT_REFRESH_MS + 1000, NOW), false)
  assert.equal(isPortraitRefreshDue(NOW - PORTRAIT_REFRESH_MS, NOW), true)
}

console.log('Testing scoreArticleByProfile...')
{
  const profile = buildReadingProfile(
    [
      entry({ articleId: 't1' }),
      entry({
        articleId: 'b1',
        sourceId: 'cls',
        sourceLabel: '财联社',
        categoryId: 'biz',
        categoryLabel: '商业',
      }),
    ],
    { categories: {}, publishers: {} },
    { now: NOW },
  )
  const latepost = scoreArticleByProfile(article({ id: 'x', sourceId: 'latepost', openedCategoryId: 'tech' }), profile)
  const cls = scoreArticleByProfile(article({ id: 'y', sourceId: 'cls', openedCategoryId: 'biz' }), profile)
  assert.ok(latepost > 0)
  assert.ok(cls > 0)
}

console.log('reading-prefs: ok')
