/** OpenAI 兼容接口配置；Key 仅保存在本机，与翻译云配置同规格 */
export interface AiConfig {
  apiKey: string
  endpoint: string
  model: string
}

export interface AiPrefs {
  config: AiConfig
  /** 首页顶栏「AI 精选」入口 */
  recommendEnabled: boolean
  /** 阅读器「AI 解读」入口 */
  digestEnabled: boolean
}

export type AiSentiment = 'positive' | 'neutral' | 'negative' | 'mixed'

/** 阅读器内单篇文章的 AI 解读结果 */
export interface ArticleDigest {
  articleId: string
  /** 两三句话的核心摘要 */
  summary: string
  keyPoints: string[]
  tags: string[]
  sentiment: AiSentiment
  model: string
  createdAt: number
}

/** AI 精选：从候选列表中挑出的文章与推荐理由 */
export interface AiPick {
  articleId: string
  reason: string
}

/** 本地阅读偏好画像：只做统计快照，不出本机 */
export interface InterestSnapshot {
  recentReadTitles: string[]
  laterTitles: string[]
  topSources: string[]
}

export interface ChatArticleRef {
  articleId: string
  title: string
  sourceName: string
}

export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 回答引用到的本地文章 */
  refs?: ChatArticleRef[]
  at: number
}
