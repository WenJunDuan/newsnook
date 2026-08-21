import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUp,
  BotMessageSquare,
  LoaderCircle,
  Newspaper,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { MarkdownBody } from '../components/MarkdownBody'
import { useReducedMotion } from '../hooks/useReducedMotion'
import {
  parseSentimentCommand,
  runAssistantTurn,
  runSentimentReport,
} from '../features/ai/assistant'
import { isAiConfigured } from '../features/ai/config'
import { loadArticlePool } from '../features/ai/pool'
import { clearChatHistory, loadChatHistory, saveChatHistory } from '../features/ai/storage'
import type { AiChatMessage, AiPrefs } from '../features/ai/types'
import type { Article } from '../lib/types'

interface Props {
  prefs: AiPrefs
  /** 当前会话已拉取的文章，并入本地缓存池做检索 */
  liveArticles: Article[]
  onOpenArticle: (article: Article) => void
  onOpenAiSettings: () => void
  onBack: () => void
}

const QUICK_ACTIONS: { label: string; icon: typeof Sparkles; input: string; send: boolean }[] = [
  {
    label: '今日值得看',
    icon: Newspaper,
    input: '帮我梳理一下最近报道里值得关注的要点',
    send: true,
  },
  { label: '查找新闻', icon: Sparkles, input: '查找：', send: false },
  { label: '企业舆情', icon: BotMessageSquare, input: '舆情：', send: false },
]

export function AiAssistantScreen({
  prefs,
  liveArticles,
  onOpenArticle,
  onOpenAiSettings,
  onBack,
}: Props) {
  const reduced = useReducedMotion()
  const configured = isAiConfigured(prefs)
  const [messages, setMessages] = useState<AiChatMessage[]>(() => loadChatHistory())
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  /** 文章池只在进入助手时汇总一次；包含所有信源的本地列表缓存 */
  const pool = useMemo(() => loadArticlePool(liveArticles), [liveArticles])
  const poolById = useMemo(() => new Map(pool.map((article) => [article.id, article])), [pool])

  useEffect(() => {
    saveChatHistory(messages)
  }, [messages])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }, [messages, busy, reduced])

  useEffect(() => () => abortRef.current?.abort(), [])

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busy || !configured) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const userMessage: AiChatMessage = { role: 'user', content: text, at: Date.now() }
      const historyForTurn = messages
      setMessages((prev) => [...prev, userMessage])
      setInput('')
      setBusy(true)
      setError('')

      try {
        const entity = parseSentimentCommand(text)
        const result = entity
          ? await runSentimentReport({
              config: prefs.config,
              pool,
              entity,
              signal: controller.signal,
            })
          : await runAssistantTurn({
              config: prefs.config,
              pool,
              history: historyForTurn,
              userInput: text,
              signal: controller.signal,
            })
        if (controller.signal.aborted) return
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.content, refs: result.refs, at: Date.now() },
        ])
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'AI 助手回复失败，请重试')
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setBusy(false)
      }
    },
    [busy, configured, messages, pool, prefs.config],
  )

  const onQuickAction = (action: (typeof QUICK_ACTIONS)[number]) => {
    if (action.send) {
      void send(action.input)
      return
    }
    setInput(action.input)
    inputRef.current?.focus()
  }

  const openRef = (articleId: string) => {
    const article = poolById.get(articleId)
    if (article) onOpenArticle(article)
  }

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col bg-ink"
      style={{ animation: reduced ? undefined : 'settings-in 320ms var(--ease-ink) both' }}
    >
      <style>{`@keyframes settings-in { from { opacity: 0; transform: translateX(18px) } to { opacity: 1; transform: none } }`}</style>

      <header className="shrink-0 pt-2 pb-3">
        <div className="page-x lg:px-8 max-w-4xl mx-auto w-full">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={onBack}
              aria-label="返回"
              className="-ml-1.5 shrink-0 p-1.5 hover:text-paper"
            >
              <ArrowLeft size={19} strokeWidth={1.6} className="text-paper" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="truncate font-display text-[22px] leading-none text-paper sm:text-[24px] md:text-[28px]">
                    AI 助手
                  </h1>
                  <p className="mt-1.5 font-mono text-[10px] lg:text-[11px] tracking-[0.14em] text-paper-faint">
                    问答 · 查找新闻 · 企业舆情 · 本地检索 {pool.length} 篇
                  </p>
                </div>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      abortRef.current?.abort()
                      setBusy(false)
                      setMessages([])
                      setError('')
                      clearChatHistory()
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-haze bg-paper/5 px-3 py-1.5 font-mono text-[11px] text-paper-muted hover:text-paper transition-colors"
                  >
                    <Trash2 size={12} />
                    清空对话
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 h-px w-full bg-haze" />
        </div>
      </header>

      <div ref={listRef} className="scroll-hidden min-h-0 flex-1 overflow-y-auto">
        <div className="page-x lg:px-8 max-w-4xl mx-auto w-full pb-4">
          {!configured && (
            <div className="py-14 text-center">
              <BotMessageSquare size={24} strokeWidth={1.4} className="mx-auto text-paper-faint" />
              <p className="mt-4 text-[13.5px] leading-relaxed text-paper-muted">
                AI 助手需要先配置你自己的 OpenAI 兼容接口。
                <br />
                API Key 只保存在这台设备。
              </p>
              <button
                type="button"
                onClick={onOpenAiSettings}
                className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-cinnabar/50 bg-cinnabar/12 px-4 py-2 text-[12.5px] text-paper"
              >
                去配置 AI 智读
              </button>
            </div>
          )}

          {configured && messages.length === 0 && !busy && (
            <div className="pt-10 pb-6">
              <p className="text-center text-[13.5px] leading-relaxed text-paper-muted">
                我可以基于你订阅源的本地报道回答问题：
                <br />
                查找感兴趣的新闻、解读事件，或输入「舆情：企业名」生成舆情报告。
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon
                  return (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => onQuickAction(action)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-haze bg-ink-raised px-3.5 py-2 text-[12.5px] text-paper-muted transition-colors hover:border-cinnabar/40 hover:text-paper"
                    >
                      <Icon size={13} strokeWidth={1.7} className="text-cinnabar-soft" />
                      {action.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={`${message.at}-${index}`} className="pt-4">
              {message.role === 'user' ? (
                <div className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-cinnabar/30 bg-cinnabar/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-paper">
                    {message.content}
                  </p>
                </div>
              ) : (
                <div className="flex justify-start">
                  <div className="max-w-[92%] min-w-0">
                    <div className="rounded-2xl rounded-bl-md border border-haze bg-ink-raised px-3.5 py-2.5">
                      <MarkdownBody markdown={message.content} />
                    </div>
                    {message.refs && message.refs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {message.refs.map((ref) => (
                          <button
                            key={ref.articleId}
                            type="button"
                            onClick={() => openRef(ref.articleId)}
                            disabled={!poolById.has(ref.articleId)}
                            className="max-w-full truncate rounded-full border border-haze bg-paper/5 px-2.5 py-1 font-mono text-[10.5px] text-paper-muted transition-colors hover:border-cinnabar/40 hover:text-paper disabled:opacity-45"
                          >
                            {ref.title.slice(0, 24)}
                            {ref.title.length > 24 ? '…' : ''} · {ref.sourceName}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2 pt-4 text-[12.5px] text-paper-muted">
              <LoaderCircle size={14} className="animate-spin text-cinnabar-soft" />
              正在检索本地报道并思考…
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-2xl border border-cinnabar/35 bg-cinnabar/10 p-3.5 text-[12.5px] leading-relaxed text-cinnabar-soft">
              {error}
            </div>
          )}
        </div>
      </div>

      {configured && (
        <div className="shrink-0 border-t border-haze/50 bg-ink pb-[max(var(--sab),12px)] pt-2.5">
          <div className="page-x lg:px-8 max-w-4xl mx-auto flex w-full items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              placeholder="提问，或输入「舆情：企业名」…"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void send(input)
                }
              }}
              className="scroll-hidden max-h-28 min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-haze bg-ink-raised px-3.5 py-2.5 text-[13px] leading-relaxed text-paper outline-none placeholder:text-paper-faint/65 focus:border-cinnabar/55"
            />
            <button
              type="button"
              disabled={busy || !input.trim()}
              onClick={() => void send(input)}
              aria-label="发送"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-cinnabar/60 bg-cinnabar/15 text-cinnabar-soft transition-colors disabled:opacity-35"
            >
              {busy ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <ArrowUp size={17} strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
