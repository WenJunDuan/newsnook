import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react'

import type { Article } from '../../../lib/types'
import { cachedDigest, generateArticleDigest } from '../digest'
import type { AiConfig, AiSentiment, ArticleDigest } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  article: Article
  /** 当前展示的原文 HTML（未翻译版本） */
  bodyHtml: string
  config: AiConfig
  configured: boolean
  /** 未配置时跳去「我的 → AI 智读」 */
  onOpenAiSettings?: () => void
}

const SENTIMENT_LABEL: Record<AiSentiment, { text: string; className: string }> = {
  positive: { text: '偏正面', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' },
  neutral: { text: '中性', className: 'border-haze bg-paper/5 text-paper-muted' },
  negative: { text: '偏负面', className: 'border-cinnabar/45 bg-cinnabar/10 text-cinnabar-soft' },
  mixed: { text: '多空交织', className: 'border-amber-500/40 bg-amber-500/10 text-amber-500' },
}

export function AiDigestSheet({
  open,
  onClose,
  article,
  bodyHtml,
  config,
  configured,
  onOpenAiSettings,
}: Props) {
  const [digest, setDigest] = useState<ArticleDigest | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  // 正文经 ref 取最新值，避免解析中 html 增量更新反复触发生成
  const bodyHtmlRef = useRef(bodyHtml)
  bodyHtmlRef.current = bodyHtml

  const run = useCallback(
    async (force: boolean) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      setError('')
      try {
        const result = await generateArticleDigest(config, article, bodyHtmlRef.current, {
          signal: controller.signal,
          force,
        })
        if (controller.signal.aborted) return
        setDigest(result)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'AI 解读失败，请重试')
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setLoading(false)
      }
    },
    [article, config],
  )

  // 打开时命中缓存直接展示；有正文且未生成过则自动生成一次
  const hasBody = Boolean(bodyHtml)
  useEffect(() => {
    if (!open) return
    if (!configured) return
    const cached = cachedDigest(article.id, config.model)
    if (cached) {
      setDigest(cached)
      return
    }
    setDigest(null)
    if (hasBody) void run(false)
    // 依赖只跟踪正文有无，不跟踪 html 内容本身，避免翻译切换等抖动反复请求
  }, [open, article.id, configured, config.model, hasBody, run])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const sentiment = digest ? SENTIMENT_LABEL[digest.sentiment] : null

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center md:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI 解读"
        className="flex max-h-[min(82vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-haze bg-ink-raised shadow-2xl md:rounded-2xl"
        style={{ paddingBottom: 'max(var(--sab, 0px), 12px)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 justify-center pt-2.5 pb-1 md:hidden" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-haze" />
        </div>

        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-haze/50 px-5 pt-2 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles size={16} strokeWidth={1.7} className="shrink-0 text-cinnabar" />
            <div className="min-w-0">
              <h3 className="font-display text-[17px] font-medium text-paper">AI 解读</h3>
              <p className="truncate font-mono text-[10px] tracking-[0.08em] text-paper-faint">
                {article.title}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {configured && digest && !loading && (
              <button
                type="button"
                onClick={() => void run(true)}
                aria-label="重新生成解读"
                className="flex h-8 w-8 items-center justify-center rounded-full text-paper-muted hover:text-paper"
              >
                <RefreshCw size={14} strokeWidth={1.8} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭 AI 解读"
              className="flex h-8 w-8 items-center justify-center rounded-full text-paper-muted hover:text-paper"
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </div>
        </header>

        <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {!configured && (
            <div className="py-8 text-center">
              <p className="text-[13.5px] leading-relaxed text-paper-muted">
                AI 解读需要先配置你自己的 OpenAI 兼容接口。
                <br />
                API Key 只保存在这台设备。
              </p>
              {onOpenAiSettings && (
                <button
                  type="button"
                  onClick={onOpenAiSettings}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-cinnabar/50 bg-cinnabar/12 px-4 py-2 text-[12.5px] text-paper"
                >
                  <Sparkles size={13} />
                  去配置 AI 智读
                </button>
              )}
            </div>
          )}

          {configured && loading && (
            <div className="flex items-center gap-2.5 py-8 justify-center text-[12.5px] text-paper-muted">
              <LoaderCircle size={16} className="animate-spin text-cinnabar-soft" />
              正在解读全文，通常需要几秒…
            </div>
          )}

          {configured && !loading && error && (
            <div className="rounded-2xl border border-cinnabar/35 bg-cinnabar/10 p-4 text-[12.5px] leading-relaxed text-cinnabar-soft">
              <p className="break-words">{error}</p>
              <button
                type="button"
                onClick={() => void run(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-cinnabar/50 bg-cinnabar/15 px-3 py-1.5 font-mono text-[11px] text-cinnabar-soft"
              >
                <RefreshCw size={11} strokeWidth={2} />
                重试
              </button>
            </div>
          )}

          {configured && !loading && !error && !digest && !bodyHtml && (
            <p className="py-8 text-center text-[13px] text-paper-muted">
              正文尚未加载完成，请稍候再打开解读。
            </p>
          )}

          {configured && !loading && digest && (
            <div className="space-y-5">
              <section>
                <div className="flex items-center gap-2">
                  <h4 className="font-mono text-[10px] tracking-[0.28em] text-paper-faint">摘要</h4>
                  {sentiment && (
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] ${sentiment.className}`}
                    >
                      {sentiment.text}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-paper">{digest.summary}</p>
              </section>

              {digest.keyPoints.length > 0 && (
                <section>
                  <h4 className="font-mono text-[10px] tracking-[0.28em] text-paper-faint">要点</h4>
                  <ul className="mt-2 space-y-2">
                    {digest.keyPoints.map((point, index) => (
                      <li key={index} className="flex gap-2.5 text-[13px] leading-relaxed text-paper-muted">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-cinnabar" aria-hidden />
                        <span className="min-w-0">{point}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {digest.tags.length > 0 && (
                <section>
                  <h4 className="font-mono text-[10px] tracking-[0.28em] text-paper-faint">标签</h4>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {digest.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-haze bg-paper/5 px-2.5 py-1 font-mono text-[10.5px] text-paper-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <p className="pt-1 font-mono text-[9.5px] tracking-[0.08em] text-paper-faint">
                由 {digest.model} 生成 · 内容仅供参考，请以原文为准
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
