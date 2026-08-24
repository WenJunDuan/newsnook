import { chatComplete } from './client'
import { PORTRAIT_SYSTEM_PROMPT, portraitUserPrompt } from './prompts'
import {
  buildReadingProfile,
  isPortraitRefreshDue,
  portraitFingerprint,
} from './readingPrefs'
import { loadReadLog } from './readLog'
import { loadPortraitCache, savePortraitCache } from './storage'
import type { AiConfig, ReadingPrefOverrides } from './types'

/** 用已配置模型把统计画像改写成一句自然语言，失败则抛错由调用方回退 */
export async function polishPortraitSentence(
  config: AiConfig,
  localSentence: string,
  signal?: AbortSignal,
): Promise<string> {
  const raw = await chatComplete(
    config,
    [
      { role: 'system', content: PORTRAIT_SYSTEM_PROMPT },
      { role: 'user', content: portraitUserPrompt(localSentence) },
    ],
    { temperature: 0.3, maxTokens: 80, signal },
  )
  const sentence = raw.replace(/^["「]|["」]$/g, '').trim()
  if (!sentence) throw new Error('画像为空')
  return sentence.slice(0, 80)
}

/**
 * 到点则按阅读日志重算画像。条形侧重始终由日志现算；本函数主要刷新一句画像。
 * 未配置模型时仍写入本地统计句，避免反复空跑。
 */
export async function refreshReadingPortrait(input: {
  config: AiConfig
  configured: boolean
  overrides: ReadingPrefOverrides
  now?: number
  signal?: AbortSignal
}): Promise<{ refreshed: boolean; sentence: string }> {
  const now = input.now ?? Date.now()
  const profile = buildReadingProfile(loadReadLog(), input.overrides, { now })
  const fingerprint = portraitFingerprint(profile)
  const cached = loadPortraitCache()
  if (!isPortraitRefreshDue(cached?.adjustedAt, now)) {
    return { refreshed: false, sentence: cached?.sentence ?? profile.portrait }
  }

  let sentence = profile.portrait
  if (input.configured && profile.windowCount > 0) {
    try {
      sentence = await polishPortraitSentence(input.config, profile.portrait, input.signal)
    } catch {
      sentence = profile.portrait
    }
  }
  savePortraitCache({ fingerprint, sentence, adjustedAt: now })
  return { refreshed: true, sentence }
}
