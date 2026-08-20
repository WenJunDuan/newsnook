import { cleanSummaryText } from '../../lib/cleanSummary'
import { relativeTime } from '../../lib/time'
import type { Article } from '../../lib/types'

const BLOCK_TAG =
  /<\/(?:p|div|section|article|li|h[1-6]|blockquote|tr|figcaption|pre)>|<br\s*\/?\s*>/gi

/**
 * 已消毒正文 HTML → 纯文本（保留段落换行）。
 * 输入来自 sanitizeArticleHtml，无需再走完整 DOM 解析。
 */
export function htmlToPlainText(html: string, maxChars: number): string {
  const text = html
    .replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, '')
    .replace(BLOCK_TAG, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t　]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}…`
}

/** 候选/资料列表里单篇文章的紧凑一行描述 */
export function articleBrief(article: Article, maxSummaryChars = 60): string {
  const summary = cleanSummaryText(article.summary, article.title).slice(0, maxSummaryChars)
  const time = article.hasRealDate ? relativeTime(article.publishedAt) : '时间不详'
  return summary
    ? `${article.title}（${article.sourceName} · ${time}）：${summary}`
    : `${article.title}（${article.sourceName} · ${time}）`
}
