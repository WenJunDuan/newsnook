---
doc_type: explore
slug: x-for-you-borrow
created: "2026-08-24"
sprint_slug: "2026-08-24-reading-preference"
status: accepted
---

# Explore: x-for-you-borrow

## 查了什么

- 2023 开源：https://github.com/twitter/the-algorithm （Home Mixer / SimClusters / Heavy Ranker）
- 2026 开源：https://github.com/xai-org/x-algorithm README（Thunder / Phoenix / SimClusters / RankingScorer）

For You 请求路径：查询补水（近期行为）→ 双路召回（关注内 Thunder + 关注外 Phoenix/SimClusters）→ 过滤（去重、已看、屏蔽、过旧）→ 打分（预测行为加权和 + 同作者衰减 + 站外折扣）→ TopK → 可见性过滤。排序与「能不能出现」分开。Following 时间线仍是倒序，For You 才混排。

## 可借鉴（精选页，不碰首页时间线）

1. 漏斗：召回 → 轻量分 → 过滤 → LLM 当 Heavy Ranker（已有 chatComplete）
2. 双路：订阅源内 ≈ Thunder；兴趣跨分类 ≈ SimClusters（用本机分类/出品方侧重当稀疏簇，不训嵌入）
3. 同出品方衰减、已看/本批已推过滤、时效窗
4. 查询补水：把 read-log 当 action sequence 喂给模型

## 不借鉴

Phoenix/TwHIN 大模型、关注图、广告混排、可见性标签体系、把默认时间线改成 For You。权重乘的是「预测你会点」的概率，不是原始计数，本地没有点赞图，不能照搬 468 倍那套民间误读。

## 对 design 的含义

精选是否跨分类抽，等价于要不要第二条召回路。推荐做，且配额限制；首页仍纯时间序。
