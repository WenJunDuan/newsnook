/**
 * AI 智读领域类型。
 *
 * 分工：client/config/prompts/storage/text 接口；digest 解读；
 * readingPrefs/readLog/interest/pickCandidates/recommend 偏好与精选；assistant/pool 助手。
 */

/** OpenAI 兼容接口配置；Key 仅保存在本机，与翻译云配置同规格 */
export interface AiConfig {
  apiKey: string
  endpoint: string
  model: string
}

/** 主题分类（不含综合）或设置页种子项 */
export interface InterestCategory {
  id: string
  label: string
}

/** 用户锁定的阅读侧重，0–100；未出现的键仍跟每日统计走 */
export interface ReadingPrefOverrides {
  categories: Record<string, number>
  publishers: Record<string, number>
}

export interface AiPrefs {
  config: AiConfig
  /** 首页顶栏「AI 精选」入口 */
  recommendEnabled: boolean
  /** 阅读器「AI 解读」入口 */
  digestEnabled: boolean
  /** 阅读偏好手动侧重；空对象表示全部自动 */
  readingPrefs: ReadingPrefOverrides
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

/** 设置页一条可调侧重 */
export interface PrefBar {
  id: string
  label: string
  /** 近窗统计占比 0–100 */
  auto: number
  /** 精选实际使用的 0–100（锁定则用手动值） */
  weight: number
  locked: boolean
  count: number
  /** 由阅读日志标出的偏好项 */
  preferred: boolean
}

export interface ReadingProfile {
  todayCount: number
  windowCount: number
  categories: PrefBar[]
  publishers: PrefBar[]
  /** 根据日志生成的一句画像（含数字） */
  portrait: string
}

export interface ReadLogEntry {
  articleId: string
  title: string
  sourceId: string
  sourceName: string
  sourceLabel: string
  sourceGroup: string
  categoryId: string
  categoryLabel: string
  /** 信源所属主题分类（不含综合）；缺省时回退 categoryId */
  interestCategories?: InterestCategory[]
  openedAt: number
}

/** 本地阅读偏好画像：只做统计快照，不出本机 */
export interface InterestSnapshot {
  recentReadTitles: string[]
  laterTitles: string[]
  topSources: string[]
  categoryPrefs: { label: string; weight: number }[]
  publisherPrefs: { label: string; weight: number }[]
  portrait: string
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
  /** 舆情报告：本次分析覆盖的语料范围一句话 */
  scopeText?: string
  at: number
}

/** 舆情语料：实体检索词的三个层次 */
export interface EntityTerms {
  /** 本名、简称、英文名、股票代码等指向同一主体的说法 */
  aliases: string[]
  /** 子公司、品牌、产品、关键人物等强关联主体 */
  related: string[]
  /** 行业、赛道、主要竞对等板块背景词 */
  industry: string[]
}

/** 语料中单篇报道与实体的关系 */
export type CorpusRelevance = 'core' | 'context'

export interface CorpusArticle {
  articleId: string
  relevance: CorpusRelevance
  score: number
  /** 命中的检索词，供排查召回质量 */
  hits: string[]
}

/** 按来源板块聚合的一组报道 */
export interface CorpusSection {
  group: string
  label: string
  count: number
}

/** 一次舆情分析所覆盖的语料范围，用于向用户交代「分析了什么」 */
export interface CorpusScope {
  total: number
  core: number
  context: number
  sourceCount: number
  sections: CorpusSection[]
  earliest?: number
  latest?: number
  /** 超出上限被舍弃的条数 */
  dropped: number
  /** 实际用于检索的扩展词 */
  terms: EntityTerms
}

/** 舆情分析各阶段，供界面显示进度 */
export type SentimentStage = 'expanding' | 'collecting' | 'digesting' | 'synthesizing'
