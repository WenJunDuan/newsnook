import { readRaw, removeLocalKeys, writeRawOrThrow } from '../../lib/storage'
import type { AiChatMessage, ArticleDigest } from './types'

const DIGESTS_KEY = 'ai:digests:v1'
const CHAT_KEY = 'ai:chat:v1'

/** 解读结果很小（<1KB/篇），单键存放并按时间截断即可 */
const MAX_DIGESTS = 80
const MAX_CHAT_MESSAGES = 60

function readJson<T>(key: string, fallback: T): T {
  const raw = readRaw(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    writeRawOrThrow(key, JSON.stringify(value))
  } catch {
    // 配额不足时放弃写入：AI 缓存均可重新生成，不挤占正文缓存空间
  }
}

export function loadDigest(articleId: string): ArticleDigest | null {
  const map = readJson<Record<string, ArticleDigest>>(DIGESTS_KEY, {})
  return map[articleId] ?? null
}

export function saveDigest(digest: ArticleDigest): void {
  const map = readJson<Record<string, ArticleDigest>>(DIGESTS_KEY, {})
  map[digest.articleId] = digest
  const entries = Object.values(map)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_DIGESTS)
  writeJson(DIGESTS_KEY, Object.fromEntries(entries.map((entry) => [entry.articleId, entry])))
}

export function loadChatHistory(): AiChatMessage[] {
  const messages = readJson<AiChatMessage[]>(CHAT_KEY, [])
  return Array.isArray(messages) ? messages : []
}

export function saveChatHistory(messages: AiChatMessage[]): void {
  writeJson(CHAT_KEY, messages.slice(-MAX_CHAT_MESSAGES))
}

export function clearChatHistory(): void {
  removeLocalKeys([CHAT_KEY])
}

export function clearAiCaches(): void {
  removeLocalKeys([DIGESTS_KEY, CHAT_KEY])
}
