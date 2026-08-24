---
sprint_slug: 2026-08-24-reading-preference
path: Feature
created: 2026-08-24
last_updated: 2026-08-24
req_ref: requirements/reading-preference.md
status: confirmed
---

# Design — 2026-08-24-reading-preference

用户确认：分类按信源主题；精选双路召回；其余用推荐默认。首页时间线不改。

## 目标 (goals)

本机阅读事件可追溯出品方与主题分类；精选设置条形+数字可改；每日阅读精修未锁定项；精选按画像挑稿。

## 非目标 (non-goals)

云同步、服务端模型、改默认时间线、搬 Phoenix/TwHIN/广告混排。

## 关键决策 (key decisions)

- 主题分类归因；`mix` 综合不算兴趣（可多标签）
- 精选双路：约 70% 当前分类未读 + 30% 高侧重跨分类；同出品方衰减；LLM Heavy Ranker
- 近 7 天统计、今日加权 2、一天一篇一次；拖动即锁定
- 借鉴 X 漏斗思想：`compound/2026-08-24-explore-x-for-you-borrow.md`

## 验收标准 (acceptance criteria)

- [ ] AC1: 打开正文后 read-log 含 sourceId 与非 mix 的主题分类（源可落入多个分类则都记）
- [ ] AC2: 从综合打开科技源，分类统计计入科技，不计入综合
- [ ] AC3: 智读设置在精选开启时展示分类/出品方条形与 0–100，拖动后该项锁定
- [ ] AC4: 近 7 天自动更新未锁定侧重；今日阅读加权高于更早日期
- [ ] AC5: mixPickCandidates 约 70/30 双路，同出品方后出现的候选被衰减；首页时间线调用路径不使用该混合
- [ ] AC6: 精选 prompt 含分类/出品方侧重；数据只写本机

## 实现要点 (implementation notes)

- `readingPrefs.ts` 归因与画像；`recommend.ts` `mixPickCandidates`
- `App.tsx` 打开时按 `sourceIdsForCategoryWithPrefs` 归因；`AiPicksScreen` 传入当前分类 + `availableArticles`
- 设置 `ReadingPrefsPanel`；seed 不含 mix

## File Structure Plan

```
src/features/ai/readingPrefs.ts
src/features/ai/recommend.ts
src/features/ai/readLog.ts
src/features/ai/ReadingPrefsPanel.tsx
src/screens/AiPicksScreen.tsx
src/screens/settings/AiSettingsScreen.tsx
src/App.tsx
scripts/reading-prefs.test.ts
scripts/ai-feature.test.ts
```

## 风险与权衡 (risks & trade-offs)

当前分类未加载的跨分类稿可能进不了 30% 池，只使用已在内存的 `availableArticles`，不为此预拉全站。
