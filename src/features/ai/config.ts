import type { AiConfig, AiPrefs } from './types'

export const DEFAULT_AI_CONFIG: AiConfig = {
  apiKey: '',
  endpoint: 'https://api.openai.com/v1',
  model: '',
}

export const DEFAULT_AI_PREFS: AiPrefs = {
  config: DEFAULT_AI_CONFIG,
  recommendEnabled: true,
  digestEnabled: true,
}

function normalizeAiConfig(value: unknown): AiConfig {
  const input = (value ?? {}) as Partial<AiConfig>
  return {
    apiKey: typeof input.apiKey === 'string' ? input.apiKey : DEFAULT_AI_CONFIG.apiKey,
    endpoint:
      typeof input.endpoint === 'string' && input.endpoint.trim()
        ? input.endpoint.trim()
        : DEFAULT_AI_CONFIG.endpoint,
    model: typeof input.model === 'string' ? input.model.trim() : DEFAULT_AI_CONFIG.model,
  }
}

export function normalizeAiPrefs(value: unknown): AiPrefs {
  const input = (value ?? {}) as Partial<AiPrefs>
  return {
    config: normalizeAiConfig(input.config),
    recommendEnabled:
      typeof input.recommendEnabled === 'boolean'
        ? input.recommendEnabled
        : DEFAULT_AI_PREFS.recommendEnabled,
    digestEnabled:
      typeof input.digestEnabled === 'boolean'
        ? input.digestEnabled
        : DEFAULT_AI_PREFS.digestEnabled,
  }
}

/** 接口三要素齐备才视为已配置；各入口据此显示引导态 */
export function isAiConfigured(prefs: AiPrefs): boolean {
  const { apiKey, endpoint, model } = prefs.config
  return Boolean(apiKey.trim() && endpoint.trim() && model.trim())
}

export function aiSummaryLabel(prefs: AiPrefs): string {
  if (!isAiConfigured(prefs)) return '未配置 · 自备 OpenAI 兼容接口'
  const features = [
    prefs.digestEnabled ? 'AI 解读' : null,
    prefs.recommendEnabled ? 'AI 精选' : null,
    '助手与舆情',
  ].filter(Boolean)
  return `${prefs.config.model} · ${features.join(' / ')}`
}
