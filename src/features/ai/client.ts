import { Capacitor, CapacitorHttp } from '@capacitor/core'

import {
  extractOpenAiChatContent,
  normalizeOpenAiBaseUrl,
} from '../translation/openai'
import type { AiConfig } from './types'

export interface AiChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompleteOptions {
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

/** 校验并返回规范化 Base URL；HTTPS 强制与翻译云配置一致 */
export function assertAiConfig(config: AiConfig): string {
  if (!config.apiKey.trim()) throw new Error('请先填写 API Key')
  if (!config.endpoint.trim()) throw new Error('请先填写 API 地址')
  if (!config.model.trim()) throw new Error('请先填写 Model')
  const base = normalizeOpenAiBaseUrl(config.endpoint)
  let parsed: URL
  try {
    parsed = new URL(base)
  } catch {
    throw new Error('API 地址格式不正确')
  }
  if (parsed.protocol !== 'https:') throw new Error('为保护 API Key，API 地址必须使用 HTTPS')
  return base
}

interface JsonResponse {
  status: number
  data: unknown
}

function coerceJsonData(data: unknown): unknown {
  if (typeof data !== 'string') return data
  const trimmed = data.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return data
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return data
  }
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<JsonResponse> {
  if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', ...headers },
      data: body,
      connectTimeout: 15000,
      readTimeout: 90000,
    })
    return { status: response.status, data: coerceJsonData(response.data) }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', ...headers },
    body: JSON.stringify(body),
    signal,
  })
  const data = (await response.json().catch(() => null)) as unknown
  return { status: response.status, data: coerceJsonData(data) }
}

function requestError(response: JsonResponse): Error {
  const data = response.data as {
    error?: { message?: string }
    message?: string
  } | null
  const detail = data?.error?.message ?? data?.message
  if (detail) return new Error(`AI 智读：${detail}`)
  if (response.status === 429) {
    return new Error('AI 智读：触发速率限制（429），请稍候重试。')
  }
  return new Error(`AI 智读：请求失败（HTTP ${response.status}）`)
}

/** 单次 Chat Completions 调用（非流式），返回正文文本 */
export async function chatComplete(
  config: AiConfig,
  messages: AiChatTurn[],
  options?: ChatCompleteOptions,
): Promise<string> {
  const base = assertAiConfig(config)
  const response = await postJson(
    `${base}/chat/completions`,
    {
      model: config.model.trim(),
      temperature: options?.temperature ?? 0.4,
      stream: false,
      ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
      messages,
    },
    { Authorization: `Bearer ${config.apiKey.trim()}` },
    options?.signal,
  )
  if (response.status < 200 || response.status >= 300) throw requestError(response)
  const content = extractOpenAiChatContent(response.data)
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 智读：返回内容为空')
  }
  return content.trim()
}

/**
 * 从模型回复中提取 JSON 载荷：容忍 ```json 围栏、前后解释性文字。
 * 解析失败返回 null，由调用方给出可重试的错误提示。
 */
export function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidates = fence ? [fence[1], trimmed] : [trimmed]

  for (const candidate of candidates) {
    const objStart = candidate.indexOf('{')
    const arrStart = candidate.indexOf('[')
    const starts = [objStart, arrStart].filter((index) => index >= 0)
    if (!starts.length) continue
    const start = Math.min(...starts)
    const closer = candidate[start] === '{' ? '}' : ']'
    const end = candidate.lastIndexOf(closer)
    if (end <= start) continue
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown
    } catch {
      continue
    }
  }
  return null
}
