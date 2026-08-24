---
doc_type: learning
slug: confirm-design-before-impl
created: "2026-08-24"
sprint_slug: "2026-08-24-reading-preference"
status: accepted
---

# Learning: confirm-design-before-impl

## 现象

用户要做阅读偏好 + AI 精选，并问历史是否保存分类/出品方。主 agent 直接写了 read-log、条形设置和精选排序。用户随后要求：先按 `.ai_state` 存档，再确认设计细节，然后再动手。

## 原因

把「能写验收草案」当成「可以开工」。偏好归因、统计窗口、手动锁定、精选候选池都还没拍板，却已经进了源码。

## 教训

新能力：先 `requirements/` + brainstorm 未决问题，用户确认后再 design/impl。exploratory 代码不得当验收契约。用户说「先确认再动手」时停止改产品代码。

## 复用场景

以后凡是「设置里可视化 + 用历史自动精修 + 影响精选」这类产品规则题，先问归因和覆盖规则，再写存储形状。
