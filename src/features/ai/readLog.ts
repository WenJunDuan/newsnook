import { readRaw, removeLocalKeys, writeRawOrThrow } from '../../lib/storage'
import {
  isReadLogEntry,
  mergeReadEntry,
  pruneReadLog,
} from './readingPrefs'
import type { ReadLogEntry } from './types'

const STORAGE_KEY = 'read-log:v1'

export function loadReadLog(): ReadLogEntry[] {
  const raw = readRaw(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return pruneReadLog(parsed.filter(isReadLogEntry), Date.now())
  } catch {
    return []
  }
}

export function saveReadLog(entries: ReadLogEntry[]): void {
  const next = pruneReadLog(entries, Date.now())
  try {
    writeRawOrThrow(STORAGE_KEY, JSON.stringify(next))
  } catch {
    const halved = next.slice(0, Math.max(40, Math.floor(next.length / 2)))
    try {
      writeRawOrThrow(STORAGE_KEY, JSON.stringify(halved))
    } catch {
      // 配额不足时放弃本次写入，阅读本身不受影响
    }
  }
}

export function appendReadLog(entry: ReadLogEntry): void {
  saveReadLog(mergeReadEntry(loadReadLog(), entry, Date.now()))
}

export function clearReadLog(): void {
  removeLocalKeys([STORAGE_KEY])
}
