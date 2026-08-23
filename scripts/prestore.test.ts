import assert from 'node:assert/strict'

import {
  buildPrestorePlan,
  mergeRollingWindow,
  prestoreCandidateLimit,
} from '../src/features/prestore/model'
import { CATEGORIES } from '../src/sources/categories'
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  type Preferences,
} from '../src/sources/preferences'

assert.deepEqual(normalizePreferences({}).prestore, {
  enabled: false,
  perSourceLimit: 10,
})
assert.deepEqual(
  normalizePreferences({ prestore: { enabled: true, perSourceLimit: 100 } }).prestore,
  { enabled: true, perSourceLimit: 100 },
)
assert.equal(
  normalizePreferences({ prestore: { enabled: true, perSourceLimit: 999 } }).prestore.perSourceLimit,
  10,
)

assert.deepEqual(
  mergeRollingWindow(
    ['new-3', 'new-2', 'old-100', 'old-99'],
    ['old-100', 'old-99', 'old-98', 'old-97'],
    5,
  ),
  ['new-3', 'new-2', 'old-100', 'old-99', 'old-98'],
)

// Failed fresh bodies do not punch holes: previous durable entries fill the window.
assert.deepEqual(
  mergeRollingWindow(['new-10', 'new-9'], ['old-5', 'old-4', 'old-3', 'old-2'], 4),
  ['new-10', 'new-9', 'old-5', 'old-4'],
)

assert.deepEqual(mergeRollingWindow(['a', 'a', 'b'], ['b', 'c'], 3), ['a', 'b', 'c'])
assert.equal(prestoreCandidateLimit(10), 13)
assert.equal(prestoreCandidateLimit(50), 63)
assert.equal(prestoreCandidateLimit(100), 125)
assert.equal(prestoreCandidateLimit(200), 160)

const visible = new Set(['tech', 'ai'])
const prefs: Preferences = {
  ...DEFAULT_PREFERENCES,
  categoryOrder: ['tech', 'ai'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter((id) => !visible.has(id)),
  categorySources: {
    tech: ['sspai', 'ithome'],
    ai: ['sspai', 'openai-news'],
  },
}
const plan = buildPrestorePlan('test-preset', prefs, [])
assert.deepEqual(
  plan.sources.map((target) => `${target.categoryId}:${target.source.id}`),
  ['tech:sspai', 'tech:ithome', 'ai:openai-news'],
)
assert.equal(plan.presetId, 'test-preset')
assert.ok(plan.key.startsWith('test-preset:'))

const mixVisible = new Set(['mix', 'tech', 'ai'])
const mixPrefs: Preferences = {
  ...DEFAULT_PREFERENCES,
  categoryOrder: ['mix', 'tech', 'ai'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter((id) => !mixVisible.has(id)),
  categorySources: {
    tech: ['sspai'],
    ai: ['openai-news'],
  },
}
const mixPlan = buildPrestorePlan(
  'mix-preset',
  mixPrefs,
  ['sspai', 'ithome', 'openai-news'],
)
assert.deepEqual(
  mixPlan.sources.map((target) => `${target.categoryId}:${target.source.id}`),
  ['tech:sspai', 'ai:openai-news', 'mix:ithome'],
)

console.log('prestore: ok')
