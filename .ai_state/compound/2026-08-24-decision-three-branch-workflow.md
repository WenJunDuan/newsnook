---
doc_type: decision
slug: three-branch-workflow
created: "2026-08-24"
sprint_slug: ""
status: accepted
deciders: ["WenJunDuan (user)", "Claude Opus 5"]
---

# Decision: three-branch-workflow

## 背景 (context)

项目 fork 自 `t59688/newsnook`。改造前只有一条 `main` 主线, 历史里上游同步
提交 (偶尔 merge upstream PR, 如 e-ink 模式) 和自己的功能提交 (dlna-cast /
mediaSniffer / reader 等) 混在一起; 另外还平行存在 4 条已通过 PR 合入
`origin/release` 的开发分支 (`claude/ai-news-analysis-recommend-0jv0di` →
`chore/sync-upstream-1.6.1` → `claude/ai-sentiment-corpus` → `claude/ai`,
承载 AI reading suite), 与 `main` 的 dlna-cast 工作彼此不知道对方存在。
用户要求收敛成固定 3 分支: `main` 只同步上游, `dev` 承载个人开发,
`release` 是发布基线。

## 选项 (options considered)

### 选项 A: 保留 main 现有历史, 仅约定未来角色 (采纳)
- ✅ 不改写已推送的 `main`, 零 force-push 风险
- ✅ `origin/claude/ai` 已验证是 `origin/release` 的等价 tip, 且完整包含
  另外 3 条分支的祖先, 合并 1 次即可拿到全部提交历史
- ❌ `main` 历史本身仍混有旧的自定义提交, 不是纯上游镜像 (接受的代价)

### 选项 B: 把 main 强制指向 upstream/main, 重建三分支
- ✅ `main` 语义上彻底纯净
- ❌ 需要对已推送的 `origin/main` force-push, 违反 git 安全规范
  (`~/.claude/rules/git-conventions.md` 明确禁止), 且所有基于旧 main
  的下游引用会失联

## 决定 (decision)

采纳选项 A。执行步骤:
1. 新增 `upstream` remote → `https://github.com/t59688/newsnook.git`。
2. `dev` = `main` (4f1b1d4) merge `origin/claude/ai` (3217f84, 验证为
   `origin/release` 的等价 tip, 且是另 3 条 claude/ai-* 分支的后代),
   merge 无冲突。
3. `release` = 新建自 `main`, 再 `--no-ff` merge `dev`, 显式记录
   "release = main + dev" 的合并点, fast-forward 推送 (旧
   `origin/release` 是新 tip 的祖先, 无需 force)。
4. push `dev`/`release` 到 origin; 删除已完全并入的
   `claude/ai` / `claude/ai-news-analysis-recommend-0jv0di` /
   `claude/ai-sentiment-corpus` / `chore/sync-upstream-1.6.1` 4 条
   remote 分支 (内容已保留在 `dev`/`release` 的合并历史里)。
5. 本地工作分支切到 `dev`。

## 权衡 (trade-offs)

- `main` 的历史清白程度是"从今往后", 不是"从头". 已有的自定义提交
  仍留在 `main` 里, 不做回溯清理。
- `upstream` remote 的 push URL 与 fetch 相同 (git 默认行为), 但用户
  对 `t59688/newsnook` 没有 push 权限, 误 push 会直接被拒绝, 无实际风险。

## 影响 (consequences)

- 对本次: 3 分支 (`main`/`dev`/`release`) 已推送 origin, 4 条冗余分支
  已删除, `origin` 上现在只有这 3 条分支。
- 对后续: 上游同步只走 `git fetch upstream && git checkout main &&
  git merge upstream/main`; 新功能一律在 `dev` 上做, 不再直接提交到
  `main`; 发版前重复 `release` 的 merge-both 流程。
- 对 architecture/: 不触发架构档案更新 (纯分支拓扑变更, 无代码/设计变更)。
