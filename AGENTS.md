# feature/scene-dialogue-simulation 分支工作约定

> 本文件是**本分支专属**的 Agent 提示词，仅在 `feature/scene-dialogue-simulation` 这棵隔离工作树内生效。
> 合并进 `main` 之前**必须删除本文件**（见 §8）。

---

## 1. 这个分支是什么

| 项 | 值 |
|---|---|
| 分支 | `feature/scene-dialogue-simulation`（仅本地，远端不存在） |
| 工作树 | `C:\QMAI_C\QMAI-main\.worktrees\scene-dialogue-simulation` |
| 基点 | `main` 的 `dcf8b38`（2026-10-10） |
| 任务主题 | **人物对话 / 模拟情景（辩论机制）** |
| 依赖 | 已 `npm ci`（867 包）；Node 24（见 `.nvmrc`） |

---

## 2. 硬边界（不可违背）

### 2.1 同时并存的其他工作，一律不要碰

本仓库当前有**多个并行任务**，各有各的工作树。本分支只负责自己的主题：

| 位置 | 正在做什么 | 你的处置 |
|---|---|---|
| `C:\QMAI_C\QMAI-main`（主检出，`main`） | 章节「续写」（`src/lib/novel/continuation.ts`、`src/components/editor/**`、`preview-panel.ts`） | **只读，不写** |
| `.worktrees\scratch-20261010` | 事件细纲（落后 main 117 提交的长期分支） | **不要碰** |
| `.worktrees\character-skill` | 角色 skill | 另一个分支，**不要碰** |
| `.worktrees\chapter-co-creation` | 章节共创 | 另一个分支，**不要碰** |
| `.claude\worktrees\agent-ace3452a280eb9df5` | **locked**，遗留 | 不要碰、不要解锁 |
| `C:\Users\Administrator\.codex\worktrees\3085\QMAI-main` | detached HEAD，含未跟踪 `.workbuddy/` | 不要碰 |

在主检出中**不要**执行：修改/新建/删除文件、`git add`、`git commit`、`git stash`、`git checkout`、`git switch`、`git restore`、`git reset`、`git worktree remove`。
> ⚠️ **最容易犯的错**：在主检出跑 `git add -u` / `git add -A`，会把别人的改动暂存进去。

### 2.2 不要碰其他分支的工作树目录

`.worktrees/` 下**每一棵**都是别人的工作区。只在你自己的树里写文件。

### 2.3 未经明确指示不 push、不合并

不 `git push`（本分支远端不存在，也不要创建远端分支）、不合并进 `main`。

---

## 3. 在哪跑命令

```powershell
cd C:\QMAI_C\QMAI-main\.worktrees\scene-dialogue-simulation
```

自检：

```powershell
git rev-parse --git-dir          # → .../.git/worktrees/scene-dialogue-simulation
git rev-parse --git-common-dir   # → .../.git
git branch --show-current        # → feature/scene-dialogue-simulation
```

`--git-dir` ≠ `--git-common-dir` 即说明你在 linked worktree 里（正确状态）。

---

## 4. 测试与基线

| 命令 | 说明 |
|---|---|
| `npm run test:mocks` | 主测试套件（mock，不需要 LLM 密钥） |
| `npm run typecheck` | `tsc --build` |
| `npm run typecheck:tests` | `tsc -p tsconfig.test.json --noEmit` |

切出后已实测基线（本分支基点 `dcf8b38`）：**720 文件 / 6957 用例通过、6 todo、0 失败**（约 60 秒）。

> 注：若看到 `718/6938` 这类数字，那是更早的 `a5a2702` 基点上的统计，不是本分支。
> **已知环境抖动**：整套跑时偶发 `[vitest-pool]: Failed to start forks worker for test files <某文件>`，导致该文件被记为 `1 failed`。这是 vitest 进程启动失败，**不是断言失败**。判定方法：单独重跑该文件——
> ```powershell
> npx vitest run <该文件路径>
> ```
> 若单独跑通过，即为抖动，可复跑整套确认。

### 4.1 已知坑：跑测试会产生 **EOL 假阳性**

跑过 `test:mocks` 后 `git status` 会冒出约 **170 个「已修改」**文件（100% 集中在 `tests/fixtures/**` 与两个 `docs/*/dump.html`）。**这不是真实改动**：`core.autocrlf=true` 检出时索引 stat 记的是 CRLF 尺寸，测试把文件重写成了 LF。

```powershell
# 判定：真实内容差异应为 0
git diff HEAD --name-only | Measure-Object            # 应为 0
# 修掉（只刷新索引 stat，不产生内容变更）
git add -u
git diff --cached HEAD --name-only | Measure-Object   # 必须为 0，否则停下来查
```

**禁止**看到这 170 个 `M` 就 `git checkout -- .` / `git restore .`——那会真删改动。

### 4.2 `.worktrees/**` 排除规则

`vite.config.ts:136` 有 `"**/.worktrees/**"`：外层（主检出）跑测试会**忽略本工作树**（所以你不会污染别人的测试结果）；内层跑测试**照常收集**（实测 720 文件），不会出现「0 用例假绿」。

---

## 5. 本分支的任务：人物对话 / 模拟情景（辩论机制）

> 原文（图）：「这个『人物对话』功能主要是为了辅助用户在写小说时，遇到不知道如何写对话的情况。我们可以开启一个类似于『辩论』的机制，也就是一个『模拟情景』功能。」

### 具体操作流程（需求原文）

**1. 角色提取与选择**
系统会提取小说故事内容中已有的角色（类似于在「灵魂」中绑定的角色）。用户可以从中挑选 **2 到 4 个**角色参与模拟情景。例如，用户可以同时选择男主、丫鬟和妻子这三个角色。

**2. 模拟情景设置**
- (a) **主持人**：模拟情景中需要配备一名主持人。
- (b) **设定规则**：用户需要写入具体的情景规则。例如设定为「在房间内，成婚当夜」。

**3. 内容生成与互动**
- (a) **自动生成故事**：系统会根据设定的规则，结合每个角色的特征和灵感内容，整理并生成接下来要发生的故事。
- (b) **持续对话互动**：在模拟情景中，用户可以通过对话的形式不断发送内容进行互动。

---

## 6. 既有代码基础（只读调查结论，实施前请复核）

**核心判断：既有「剧情推演室」已覆盖需求骨架，本任务属于「在既有模块上扩展」，不是另起新功能。**

已存在（可直接复用）：

| 需求步骤 | 既有实现 |
|---|---|
| 提取角色 | `story-extractor.ts:50 extractStoryContent()`（大纲→灵魂文档→最近 N 章→记忆库→角色） |
| 角色→Agent | `agent-profile-builder.ts:121 buildAgents()`、`:234 buildAgentContext()` |
| 自动生成故事 | `simulation-engine.ts:1165 runSimulation()` + `multi-agent-orchestrator.ts`（黑板协作、信息隔离、谣言系统）+ `director-agent.ts:179 directorEvaluate()` |
| 持续对话互动 | `agent-interview.ts:149 interviewAgent()`（**但是单角色私聊形态**） |

**精确缺口（本分支要补的正是这三处）**：

1. **没有 2-4 人角色勾选器** —— 现有只能编辑框架节点里的自由文本 `involvedCharacters`（`framework-confirm-panel.tsx:479`）。
2. **没有「主持人」角色，也没有结构化情景规则** —— 只有自由文本 `userIdea`；而且 `SimulationInput.userIdea`（`types.ts:375` 声明、`story-simulation-view.tsx:660` 传入）在 `simulation-engine.ts` 内**0 处使用**，情景规则**不进**角色逐轮决策提示词（只影响框架生成与报告）。**这既是要补的缺口，也是一个既有缺陷。**
3. **没有多方同场、按顺序、围绕规则相互回应的辩论循环** —— 现有多智能体是「各做各的行为」，互动是间接的。

全库 grep `debate|辩论|主持人|模拟情景` → **0 命中**，确认是全新概念。

**角色来源提醒**：推演室**并不读「灵魂」绑定**。`story-extractor.ts:496-513` 只用 `getCharacterAuraBindings` 匹配 `aura`（光环），角色名来自章节摄入产物 / LLM 抽取 / `wiki/entities/*.md`。需求说「类似在灵魂中绑定的角色」，若要真的按灵魂绑定选人，需显式复用 `character-aura.ts:861 listBindableNovelCharacters()` + `:539 getCharacterAuraBindings()`。

### 预计触碰文件

**新建**（`src/lib/novel/story-simulation/`）：
- `scenario-types.ts` — `ScenarioSetup`(scene/rules/location/time)、`ScenarioParticipant`(2-4 角色 + `isModerator`)、`ScenarioTurn`、`ScenarioSession`、`ScenarioMessage`
- `scenario-participant-selector.ts` — 候选角色清单与打分
- `scenario-engine.ts` — 主持人 + 2-4 角色轮流发言循环，支持用户中途插话
- `scenario-moderator.ts` — 主持人智能体（开场/点名/串场/收束）
- `scenario-store.ts` — 落盘 `.qmai/simulations/scenarios/{id}.json`（仿 `interview-store.ts`）
- `scenario-export.ts` — 导出 MD（仿 `interview-export.ts:28`）
- `scenario-engine.spec.ts`、`scenario-participant-selector.spec.ts`

**组件**（`src/components/novel/story-simulation/`）：
- `scenario-setup-panel.tsx` — 第 1、2 步 UI（多选 2-4 角色 + 指定主持人 + 情景规则）
- `scenario-room-view.tsx` — 第 3 步 UI（多方对话流 + 用户输入）

**修改**：
- `src/stores/story-simulation-store.ts` — `SimulationPhase`（`:39-49`）加 scenario phase
- `src/components/novel/story-simulation/story-simulation-view.tsx` — `:1146-1300` 渲染分支加新 phase
- `src/i18n/zh.json` — 新增 `storySimulation.scenario*` key（**唯一 locale**）
- `src/lib/novel/task-router.ts` — 若要自然语言跳转，加「模拟情景/辩论」意图
- `src/lib/novel/story-simulation/simulation-engine.ts` — 若在既有引擎上扩展

**推荐最小路径**：不新增视图 id（复用 `storySimulation`），只加 scenario phase + 4 个 `scenario-*` lib 文件 + 2 个组件 + view 分支 + `zh.json` key。

> ⚠️ 若新增独立视图 id，`src/lib/bundle-boundaries.spec.ts` 之外的这些也要同步：`wiki-store.ts:661`、`icon-sidebar.tsx:53`、`content-area.tsx:60-64/162`、`sidebar-nav-preferences.ts:10`、`ui-test-primary-nav.ts:15`、`ui-test-shell.tsx:43`、`ui-test-tools.spec.tsx:463`、`help-links.ts:17`。

---

## 7. 提交规则

- 只提交**本分支职责范围**内的改动；
- 中文 conventional commits（`feat(模拟情景): …`、`fix(模拟情景): …`、`test(模拟情景): …`）；
- 提交前跑 §4 的基线；
- **暂存时点名文件**，不要 `git add -A`/`-u` 一把梭（除非已按 §4.1 判定那 170 个只是 EOL 假阳性）；
- 提交前 `git branch --show-current` 确认在自己的分支上；
- 本文件自身可随分支提交。

---

## 8. 收尾：合并前必须删除本文件

`AGENTS.md` 在工作树**根目录**，会被 DSH 指令加载器当作项目级指令加载（候选名 `AGENTS.md` / `CLAUDE.md`，项目根以 `.git` 为标记）：

- 在**本工作树内**工作：项目根 = 本工作树根，本文件**会**生效；
- 在**主检出**或**其他工作树**工作：本工作树是后代目录而非祖先，**不会**被加载 → 不干扰。

> 残余风险：加载器还会沿「被触碰路径」的后代目录探测指令文件。所以**不要**让别处的任务去触碰本工作树下的路径。

**一旦本分支合并进 `main`，本文件就会出现在主目录根、开始影响所有工作 → 合并前必须删除本文件**，单独提交一条如 `chore(分支约定): 合并前删除本分支专属的 AGENTS.md`。

```powershell
cd C:\QMAI_C\QMAI-main
git worktree remove .worktrees\scene-dialogue-simulation
git branch -d feature/scene-dialogue-simulation
```

---

## 9. 项目既有约定（不重复，直接遵守）

本文件**不复制** `.agents/AGENTS.md`。⚠️ 它在 `.agents/` 子目录下，**不会**因你站在工作树根就自动加载——**开工前先主动读**：

```
.agents/AGENTS.md     # = C:\QMAI_C\QMAI-main\.worktrees\scene-dialogue-simulation\.agents\AGENTS.md
```

要点：文档一律写 `docs/`（分支说明命名 `docs/<分支名>-分支说明.md`）；小说逻辑放 `src/lib/novel/` 并经 `mod.ts` 导出；草稿隔离与 `ingestChapter()` 摄取链不可违背；新增 LLM 调用走 `resolveNovelModel()` / `resolveReviewModel()`。

另注：本仓库 `src/lib/bundle-boundaries.spec.ts` 强制 `context-engine` / `review-adapter` 用**动态** `await import()` 引 `character-aura`（体积边界），改动时别改成静态 import。

---

## 10. 更新记录

- 2026-10-10 21:1x：创建本文件。记录隔离边界、基线 **720/6957**（基点 `dcf8b38`）、EOL 假阳性坑、vitest worker 抖动，以及只读调查得出的「属既有剧情推演室扩展」结论与三处精确缺口。
