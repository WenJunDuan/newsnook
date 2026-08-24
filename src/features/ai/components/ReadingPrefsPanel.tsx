

import {
  buildReadingProfile,
  clearAllOverrides,
  clearOverride,
  portraitFingerprint,
  setOverride,
} from '../readingPrefs'
import { loadReadLog } from '../readLog'
import { loadPortraitCache } from '../storage'
import { relativeTime } from '../../../lib/time'
import type { AiPrefs, InterestCategory, PrefBar, ReadingPrefOverrides } from '../types'

interface Props {
  prefs: AiPrefs
  seedCategories: InterestCategory[]
  onChange: (overrides: ReadingPrefOverrides) => void
}

function PrefRow({
  bar,
  kind,
  overrides,
  onChange,
}: {
  bar: PrefBar
  kind: 'categories' | 'publishers'
  overrides: ReadingPrefOverrides
  onChange: (overrides: ReadingPrefOverrides) => void
}) {
  return (
    <li className="px-5 py-2.5">
      <div className="flex items-center gap-3">
        <span className="w-[4.5rem] shrink-0 truncate text-[12.5px] text-paper">{bar.label}</span>
        <label className="relative min-h-8 min-w-0 flex-1">
          <span className="sr-only">{`${bar.label}侧重 ${bar.weight}`}</span>
          <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-haze" />
          <span
            className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-cinnabar"
            style={{ width: `${bar.weight}%` }}
          />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={bar.weight}
            aria-valuetext={`${bar.weight}`}
            onChange={(event) =>
              onChange(setOverride(overrides, kind, bar.id, Number(event.target.value)))
            }
            className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent accent-cinnabar"
          />
        </label>
        <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-paper-muted">
          {bar.weight}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 pl-[4.5rem] font-mono text-[10px] text-paper-faint">
        {bar.preferred ? (
          <span className="rounded-full border border-cinnabar/40 bg-cinnabar/12 px-1.5 py-px text-cinnabar-soft">
            偏好
          </span>
        ) : null}
        <span>{bar.count} 篇</span>
        <span>{bar.locked ? '手动' : '自动'}</span>
        {bar.locked ? (
          <button
            type="button"
            className="text-cinnabar-soft"
            onClick={() => onChange(clearOverride(overrides, kind, bar.id))}
          >
            恢复自动
          </button>
        ) : null}
      </div>
    </li>
  )
}

export function ReadingPrefsPanel({ prefs, seedCategories, onChange }: Props) {
  const overrides = prefs.readingPrefs
  const profile = buildReadingProfile(loadReadLog(), overrides, { seedCategories })
  const lockedCount =
    profile.categories.filter((item) => item.locked).length +
    profile.publishers.filter((item) => item.locked).length
  const cached = loadPortraitCache()
  const sentence =
    cached?.fingerprint === portraitFingerprint(profile) ? cached.sentence : profile.portrait
  const adjustedHint = cached?.adjustedAt
    ? `上次调整 ${relativeTime(cached.adjustedAt)} · 每 4 小时按阅读日志重算`
    : '每 4 小时按阅读日志自动调整画像'

  return (
    <div className="page-x pt-4 pb-2">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-haze bg-ink-raised shadow-[var(--shadow-lift)]">
        <div className="px-5 pt-4 pb-3">
          <p className="text-[14px] text-paper">阅读画像</p>
          <p className="mt-2 text-[13px] leading-relaxed text-paper">{sentence}</p>
          <p className="mt-2 font-mono text-[10px] leading-relaxed tracking-[0.04em] text-paper-faint">
            近 7 天 {profile.windowCount} 篇 · 今日 {profile.todayCount} 篇 · {adjustedHint}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 pb-2">
          <p className="font-mono text-[10px] tracking-[0.18em] text-paper-faint">分类</p>
          {lockedCount > 0 ? (
            <button
              type="button"
              className="font-mono text-[10px] text-cinnabar-soft"
              onClick={() => onChange(clearAllOverrides())}
            >
              全部恢复自动
            </button>
          ) : null}
        </div>
        <ul className="divide-y divide-haze border-y border-haze">
          {profile.categories.map((bar) => (
            <PrefRow
              key={`cat-${bar.id}`}
              bar={bar}
              kind="categories"
              overrides={overrides}
              onChange={onChange}
            />
          ))}
        </ul>

        <p className="px-5 pt-4 pb-1 font-mono text-[10px] tracking-[0.18em] text-paper-faint">
          出品方
        </p>
        {profile.publishers.length === 0 ? (
          <p className="px-5 pb-4 text-[12px] leading-relaxed text-paper-faint">
            打开文章后，会按出品方统计并标记偏好。
          </p>
        ) : (
          <ul className="divide-y divide-haze border-t border-haze">
            {profile.publishers.map((bar) => (
              <PrefRow
                key={`pub-${bar.id}`}
                bar={bar}
                kind="publishers"
                overrides={overrides}
                onChange={onChange}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
