import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'

import { SettingsHint, SettingsShell } from '../components/SettingsShell'
import { buildInterestSnapshot, hasInterestSignal } from '../features/ai/interest'
import { loadReadLog } from '../features/ai/readLog'
import { buildReadingProfile, scoreArticleByProfile } from '../features/ai/readingPrefs'
import { mixPickCandidates, pickArticles } from '../features/ai/recommend'
import { isAiConfigured } from '../features/ai/config'
import type { AiPrefs } from '../features/ai/types'
import { articleRelativeTime } from '../lib/time'
import type { Article } from '../lib/types'

interface Props {
  prefs: AiPrefs
  /** 当前分类下的文章（召回路 A） */
  articles: Article[]
  /** 已加载的全部文章（召回路 B：兴趣跨分类） */
  poolArticles: Article[]
  sourceInterestIds: Record<string, string[]>
  categoryLabel?: string
  history: Article[]
  later: Article[]
  readIds: Set<string>
  onOpen: (article: Article) => void
  onOpenAiSettings: () => void
  onBack: () => void
}

interface PickItem {
  article: Article
  reason: string
}

export function AiPicksScreen({
  prefs,
  articles,
  poolArticles,
  sourceInterestIds,
  categoryLabel,
  history,
  later,
  readIds,
  onOpen,
  onOpenAiSettings,
  onBack,
}: Props) {
  const configured = isAiConfigured(prefs)
  const [picks, setPicks] = useState<PickItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasRun, setHasRun] = useState(false)
  /** 换一批时排除已经推荐过的文章 */
  const shownIdsRef = useRef<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)
  /** 进入页面只自动生成一次；失败后由用户手动重试，避免错误态循环请求 */
  const autoRanRef = useRef(false)

  const profile = buildReadingProfile(loadReadLog(), prefs.readingPrefs)
  const snapshot = buildInterestSnapshot({ history, later, profile })

  const run = useCallback(
    async (excludeShown: boolean) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      setError('')
      try {
        const readingProfile = buildReadingProfile(loadReadLog(), prefs.readingPrefs)
        const candidates = mixPickCandidates({
          articles,
          outNetwork: poolArticles,
          readIds,
          excludeIds: excludeShown ? shownIdsRef.current : undefined,
          scoreOf: (item) =>
            scoreArticleByProfile(item, readingProfile, sourceInterestIds[item.sourceId] ?? []),
        })
        const result = await pickArticles(
          prefs.config,
          buildInterestSnapshot({ history, later, profile: readingProfile }),
          candidates,
          controller.signal,
        )
        if (controller.signal.aborted) return
        for (const item of result) shownIdsRef.current.add(item.article.id)
        setPicks(result)
        setHasRun(true)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'AI 精选生成失败，请重试')
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setLoading(false)
      }
    },
    [articles, history, later, poolArticles, prefs.config, prefs.readingPrefs, readIds, sourceInterestIds],
  )

  useEffect(() => {
    if (!configured || (!articles.length && !poolArticles.length)) return
    if (autoRanRef.current) return
    autoRanRef.current = true
    void run(false)
    // 进入页面自动生成一次；后续由「换一批」或错误态的重试按钮驱动
  }, [configured, articles.length, poolArticles.length, run])

  useEffect(() => () => abortRef.current?.abort(), [])

  return (
    <SettingsShell
      title="AI 精选"
      caption={
        categoryLabel
          ? `${categoryLabel} · 按阅读偏好挑选（含跨分类）· 不改变时间线`
          : '按阅读偏好挑选 · 不改变时间线'
      }
      action={
        configured && articles.length > 0 ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => void run(true)}
            className="flex items-center gap-1.5 rounded-full border border-cinnabar/50 bg-cinnabar/12 px-3.5 py-1.5 font-mono text-[11px] text-cinnabar-soft disabled:opacity-40"
          >
            {loading ? (
              <LoaderCircle size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} strokeWidth={2} />
            )}
            换一批
          </button>
        ) : null
      }
      onBack={onBack}
    >
      {!configured && (
        <div className="page-x py-14 text-center">
          <Sparkles size={22} strokeWidth={1.5} className="mx-auto text-paper-faint" />
          <p className="mt-4 text-[13.5px] leading-relaxed text-paper-muted">
            AI 精选需要先配置你自己的 OpenAI 兼容接口。
            <br />
            API Key 只保存在这台设备。
          </p>
          <button
            type="button"
            onClick={onOpenAiSettings}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-cinnabar/50 bg-cinnabar/12 px-4 py-2 text-[12.5px] text-paper"
          >
            去配置 AI 助手
          </button>
        </div>
      )}

      {configured && !articles.length && !poolArticles.length && (
        <p className="page-x py-14 text-center text-[13px] leading-relaxed text-paper-faint">
          还没有已加载的文章。
          <br />
          先回首页刷新，再来生成精选。
        </p>
      )}

      {configured && (articles.length > 0 || poolArticles.length > 0) && (
        <>
          {loading && (
            <div className="flex items-center justify-center gap-2.5 py-14 text-[12.5px] text-paper-muted">
              <LoaderCircle size={16} className="animate-spin text-cinnabar-soft" />
              正在按你的阅读偏好挑选…
            </div>
          )}

          {!loading && error && (
            <div className="page-x pt-6">
              <div className="rounded-2xl border border-cinnabar/35 bg-cinnabar/10 p-4 text-[12.5px] leading-relaxed text-cinnabar-soft">
                <p className="break-words">{error}</p>
                <button
                  type="button"
                  onClick={() => void run(false)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-cinnabar/50 bg-cinnabar/15 px-3 py-1.5 font-mono text-[11px] text-cinnabar-soft"
                >
                  <RefreshCw size={11} strokeWidth={2} />
                  重试
                </button>
              </div>
            </div>
          )}

          {!loading && !error && hasRun && !picks.length && (
            <p className="page-x py-14 text-center text-[13px] leading-relaxed text-paper-faint">
              这一批候选里没有挑出新的推荐。
              <br />
              可以刷新列表获取更多文章后再试。
            </p>
          )}

          {!loading && picks.length > 0 && (
            <ul className="mt-2 divide-y divide-haze border-y border-haze">
              {picks.map(({ article, reason }) => (
                <li key={article.id} className="bg-ink">
                  <button
                    type="button"
                    onClick={() => onOpen(article)}
                    className="page-x flex w-full flex-col gap-1.5 py-4 text-left transition-colors hover:bg-ink-raised/30 active:bg-ink-raised/50"
                  >
                    <span
                      className={`text-[14.5px] leading-snug ${
                        readIds.has(article.id) ? 'text-paper-muted' : 'text-paper'
                      }`}
                    >
                      {article.title}
                    </span>
                    <span className="font-mono text-[10px] tracking-[0.1em] text-paper-faint">
                      {article.sourceName} · {articleRelativeTime(article)}
                    </span>
                    {reason && (
                      <span className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-cinnabar-soft">
                        <Sparkles size={11} strokeWidth={1.8} className="mt-[3px] shrink-0" />
                        <span className="min-w-0">{reason}</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!hasInterestSignal(snapshot) && !loading && (
            <SettingsHint>
              还没有阅读记录，本次按大众重要性挑选。多读几篇文章或收藏「稍后读」，精选会越来越贴合你的兴趣。
            </SettingsHint>
          )}
          <SettingsHint>
            精选只发送候选文章的标题与摘要、以及本机阅读偏好（分类 / 出品方侧重与最近标题）给你配置的接口；结果不影响首页时间线排序。
          </SettingsHint>
        </>
      )}
    </SettingsShell>
  )
}
