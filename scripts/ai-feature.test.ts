import assert from 'node:assert/strict'

import { citedRefs, parseSentimentCommand } from '../src/features/ai/assistant'
import { extractJsonPayload } from '../src/features/ai/client'
import { DEFAULT_AI_PREFS, isAiConfigured, normalizeAiPrefs } from '../src/features/ai/config'
import { parseDigestPayload } from '../src/features/ai/digest'
import { buildInterestSnapshot } from '../src/features/ai/interest'
import {
  extractQueryTerms,
  searchArticles,
  searchArticlesByEntity,
} from '../src/features/ai/pool'
import { buildPickCandidates, parsePicksPayload } from '../src/features/ai/recommend'
import { htmlToPlainText } from '../src/features/ai/text'
import type { Article } from '../src/lib/types'

function makeArticle(partial: Partial<Article> & { id: string; title: string }): Article {
  return {
    summary: '',
    publishedAt: Date.now(),
    hasRealDate: true,
    sourceId: 'src',
    sourceName: '测试源',
    sourceLabel: '测试',
    sourceGroup: 'cn',
    originUrl: 'https://example.com',
    ...partial,
  }
}

console.log('Testing normalizeAiPrefs...')
{
  const defaults = normalizeAiPrefs(undefined)
  assert.deepEqual(defaults, DEFAULT_AI_PREFS)
  assert.equal(isAiConfigured(defaults), false)

  const restored = normalizeAiPrefs({
    config: { apiKey: 'sk-1', endpoint: ' https://ai.example.com/v1 ', model: ' m1 ' },
    recommendEnabled: false,
    digestEnabled: true,
  })
  assert.equal(restored.config.endpoint, 'https://ai.example.com/v1')
  assert.equal(restored.config.model, 'm1')
  assert.equal(restored.recommendEnabled, false)
  assert.equal(isAiConfigured(restored), true)

  // 脏数据回退默认值，不抛错
  const dirty = normalizeAiPrefs({ config: { apiKey: 42 }, recommendEnabled: 'yes' })
  assert.equal(dirty.config.apiKey, '')
  assert.equal(dirty.recommendEnabled, true)
}

console.log('Testing extractJsonPayload...')
{
  assert.deepEqual(extractJsonPayload('{"a":1}'), { a: 1 })
  assert.deepEqual(extractJsonPayload('好的，结果如下：\n```json\n[{"index":2}]\n```\n以上。'), [
    { index: 2 },
  ])
  assert.deepEqual(extractJsonPayload('前缀 {"summary":"s","keyPoints":[]} 后缀'), {
    summary: 's',
    keyPoints: [],
  })
  assert.equal(extractJsonPayload('完全没有结构化内容'), null)
}

console.log('Testing parseDigestPayload...')
{
  const digest = parseDigestPayload(
    {
      summary: '  核心摘要  ',
      keyPoints: ['要点一', 42, '要点二', '', '要点三', '要点四', '要点五', '要点六', '要点七'],
      tags: ['AI', '芯片', '超过六个字的标签会被截断'],
      sentiment: 'negative',
    },
    'a1',
    'gpt-test',
  )
  assert.ok(digest)
  assert.equal(digest.summary, '核心摘要')
  assert.equal(digest.keyPoints.length, 6)
  assert.equal(digest.tags[2].length, 12)
  assert.equal(digest.sentiment, 'negative')
  assert.equal(digest.model, 'gpt-test')

  assert.equal(parseDigestPayload({ keyPoints: [] }, 'a1', 'm'), null)
  assert.equal(parseDigestPayload(null, 'a1', 'm'), null)
  const badSentiment = parseDigestPayload({ summary: 's', sentiment: 'great' }, 'a1', 'm')
  assert.equal(badSentiment?.sentiment, 'neutral')
}

console.log('Testing buildPickCandidates & parsePicksPayload...')
{
  const articles = [
    makeArticle({ id: 'old-unread', title: '旧未读', publishedAt: 100 }),
    makeArticle({ id: 'read-1', title: '已读', publishedAt: 300 }),
    makeArticle({ id: 'new-unread', title: '新未读', publishedAt: 200 }),
  ]
  const candidates = buildPickCandidates({ articles, readIds: new Set(['read-1']) })
  assert.deepEqual(
    candidates.map((item) => item.id),
    ['new-unread', 'old-unread', 'read-1'],
  )

  const excluded = buildPickCandidates({
    articles,
    readIds: new Set(),
    excludeIds: new Set(['new-unread']),
  })
  assert.ok(!excluded.some((item) => item.id === 'new-unread'))

  const picks = parsePicksPayload(
    [
      { index: 1, reason: '匹配兴趣' },
      { index: 1, reason: '重复' },
      { index: 99, reason: '越界' },
      { index: 3, reason: '' },
      { reason: '缺序号' },
    ],
    candidates,
  )
  assert.deepEqual(
    picks.map((pick) => pick.articleId),
    ['new-unread', 'read-1'],
  )
  assert.equal(picks[0].reason, '匹配兴趣')
  assert.deepEqual(parsePicksPayload({ not: 'array' }, candidates), [])
}

console.log('Testing interest snapshot...')
{
  const history = [
    makeArticle({ id: 'h1', title: 'AI 芯片竞争', sourceName: '晚点' }),
    makeArticle({ id: 'h2', title: '新能源车企财报', sourceName: '晚点' }),
    makeArticle({ id: 'h3', title: '大模型进展', sourceName: '机器之心' }),
  ]
  const later = [makeArticle({ id: 'l1', title: '稍后读文章', sourceName: '财联社' })]
  const snapshot = buildInterestSnapshot({ history, later })
  assert.equal(snapshot.topSources[0], '晚点')
  assert.equal(snapshot.recentReadTitles.length, 3)
  assert.deepEqual(snapshot.laterTitles, ['稍后读文章'])
}

console.log('Testing query terms & local search...')
{
  const terms = extractQueryTerms('帮我找宁德时代的新闻')
  assert.ok(terms.includes('宁德时代'))
  assert.ok(!terms.includes('新闻'))

  const englishTerms = extractQueryTerms('OpenAI 最新进展')
  assert.ok(englishTerms.includes('openai'))

  const pool = [
    makeArticle({ id: 'p1', title: '宁德时代发布新一代电池', publishedAt: 300 }),
    makeArticle({ id: 'p2', title: '车市观察', summary: '宁德时代与多家车企合作', publishedAt: 200 }),
    makeArticle({ id: 'p3', title: '完全无关的报道', publishedAt: 400 }),
  ]
  const hits = searchArticles(pool, '帮我找宁德时代的新闻')
  assert.deepEqual(
    hits.map((item) => item.id),
    ['p1', 'p2'],
  )

  // 孤立双字弱命中不应把无关报道捞进来
  const weak = searchArticles(pool, '看看观察')
  assert.ok(!weak.some((item) => item.id === 'p3'))

  const entityHits = searchArticlesByEntity(pool, '宁德时代')
  assert.equal(entityHits.length, 2)
  assert.deepEqual(searchArticlesByEntity(pool, '茅'), [])
}

console.log('Testing sentiment command & cited refs...')
{
  assert.equal(parseSentimentCommand('舆情：宁德时代'), '宁德时代')
  assert.equal(parseSentimentCommand('企业舆情: 腾讯控股'), '腾讯控股')
  assert.equal(parseSentimentCommand('舆情：a'), null)
  assert.equal(parseSentimentCommand('普通提问'), null)

  const provided = [
    makeArticle({ id: 'c1', title: '报道一' }),
    makeArticle({ id: 'c2', title: '报道二' }),
    makeArticle({ id: 'c3', title: '报道三' }),
  ]
  const refs = citedRefs('结论来自【1】与【3】。', provided)
  assert.deepEqual(
    refs.map((ref) => ref.articleId),
    ['c1', 'c3'],
  )
  assert.deepEqual(citedRefs('没有引用标注', provided), [])
}

console.log('Testing htmlToPlainText...')
{
  const text = htmlToPlainText(
    '<p>第一段&nbsp;内容</p><div>第二段</div><script>alert(1)</script>',
    1000,
  )
  assert.ok(text.includes('第一段 内容'))
  assert.ok(text.includes('\n'))
  assert.ok(!text.includes('alert'))

  const truncated = htmlToPlainText(`<p>${'长'.repeat(50)}</p>`, 10)
  assert.equal(truncated.length, 11)
  assert.ok(truncated.endsWith('…'))
}

console.log('All AI feature tests passed.')
