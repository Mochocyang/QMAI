# feature/chapter-co-creation 分支工作约定

> 本文件是**本分支专属**的 Agent 提示词，仅在 `feature/chapter-co-creation` 这棵隔离工作树内生效。
> 合并进 `main` 之前**必须删除本文件**（见 §8）。

---

## 1. 这个分支是什么

| 项 | 值 |
|---|---|
| 分支 | `feature/chapter-co-creation`（仅本地，远端不存在） |
| 工作树 | `C:\QMAI_C\QMAI-main\.worktrees\chapter-co-creation` |
| 基点 | `main` 的 `dcf8b38`（2026-10-10） |
| 任务主题 | **章节「共创」模式（用户口中的「反诘」模式）** |
| 依赖 | 已 `npm ci`（867 包）；Node 24（见 `.nvmrc`） |

---

## 2. 硬边界（不可违背）

### 2.1 同时并存的其他工作，一律不要碰

| 位置 | 正在做什么 | 你的处置 |
|---|---|---|
| `C:\QMAI_C\QMAI-main`（主检出，`main`） | 章节「续写」 | **只读，不写** |
| `.worktrees\scratch-20261010` | 事件细纲 | **不要碰** |
| `.worktrees\scene-dialogue-simulation` | 人物对话 / 模拟情景 | 另一个分支，**不要碰** |
| `.worktrees\character-skill` | 角色 skill | 另一个分支，**不要碰** |
| `.claude\worktrees\agent-ace3452a280eb9df5` | **locked**，遗留 | 不要碰、不要解锁 |
| `C:\Users\Administrator\.codex\worktrees\3085\QMAI-main` | detached HEAD，含未跟踪 `.workbuddy/` | 不要碰 |

在主检出中**不要**执行：修改/新建/删除文件、`git add`、`git commit`、`git stash`、`git checkout`、`git switch`、`git restore`、`git reset`、`git worktree remove`。
> ⚠️ **最容易犯的错**：在主检出跑 `git add -u` / `git add -A`，会把别人的改动暂存进去。

### 2.2 ⚠️ 本分支与 `main` 上的「续写」任务同属章节链路 —— 重点注意

`main` 正在做**章节「续写」**，改动落在：
`src/lib/novel/continuation.ts`、`src/components/editor/**`、`src/components/layout/preview-panel.ts`、`src/lib/llm-client.ts`。

**实测本分支的落点（`chat-panel.tsx`、`workflow-mode.ts`、`deep-chapter-generation.ts`、`chat-store.ts`）与上述文件不重叠**，所以并行是安全的。
但两者**都在章节生成链路上**，后续 `main` 若继续推进，冲突风险集中在这几处，实施与合并时请留意：
- `src/components/layout/preview-panel.ts`（续写已改；本分支若需在正文区加入口则重叠）
- `src/lib/novel/deep-chapter-generation.ts`（本分支要加 discuss 档）
- `src/lib/llm-client.ts`（两边都可能碰底层调用）

### 2.3 不要碰其他分支的工作树目录

`.worktrees/` 下**每一棵**都是别人的工作区。只在你自己的树里写文件。

### 2.4 未经明确指示不 push、不合并

不 `git push`、不合并进 `main`。

---

## 3. 在哪跑命令

```powershell
cd C:\QMAI_C\QMAI-main\.worktrees\chapter-co-creation
```

自检：

```powershell
git rev-parse --git-dir          # → .../.git/worktrees/chapter-co-creation
git rev-parse --git-common-dir   # → .../.git
git branch --show-current        # → feature/chapter-co-creation
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
> **已知环境抖动**：整套跑时偶发 `[vitest-pool]: Failed to start forks worker for test files <某文件>`，导致该文件被记为 `1 failed`。这是 vitest 进程启动失败，**不是断言失败**。本分支首次跑时 `src/lib/novel/retrieval/snapshot-projection.spec.ts` 就是这样被误记失败，单独重跑 **11 用例全过**。判定方法：
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

`vite.config.ts:136` 有 `"**/.worktrees/**"`：外层（主检出）跑测试会**忽略本工作树**；内层跑测试**照常收集**，不会出现「0 用例假绿」。

---

## 5. 本分支的任务：章节「共创」模式

> 原文（图）：「在章节当中现在有『快速』、『标准』和『严格』这几种模式。我建议再增加一个『反诘』模式，也就是类似于大纲当中的『共创模式』，我们也就将其定义为『共创』。这个『共创模式』主要适用于针对某一章的内容。比如用户写到第二章、第三章的时候，后面突然卡顿，不知道怎么写了，这个时候就可以点击『共创』模式。」
>
> 「该模式相当于一种带有故事框架的『剧情推演』模式。」

### 具体运作流程（需求原文）

**1. 读取与分析**
系统读取前面的内容，并按照类似剧情推演的功能故事框架分析后面应该如何发展。

**2. 弹出想法**
最后会弹出 **3 到 4 个**关于接下来内容的想法（提问），每个想法会显示出**不同的故事类型**，并附带**约 300 字**的后续故事介绍。

**3. 用户选择**
用户觉得哪个故事好就选择哪个。如果觉得都不好，可以继续生成新的故事。

「这样一来，用户再去写的时候，就会有一种知道后面故事该如何去写的方向感。」

---

## 6. 既有代码基础（只读调查结论，实施前请复核）

### 6.1 章节侧的「快速 / 标准 / 严格」在哪

- **`src/lib/agent/workflow-mode.ts`**：
  - `:1` `export type AiWorkflowMode = "fast" | "standard" | "strict"`（**章节/写作侧专用**）
  - `:8` `DEFAULT_AI_WORKFLOW_MODE = "standard"`；`:11` `AI_WORKFLOW_MODES` 白名单；`:14` `isAiWorkflowMode`；`:22` `resolveAiWorkflowMode`
  - `:32` `getWorkflowModeLabel()` → `fast→快速`、`strict→严格`、`standard→标准`
  - `:6` 对照：`OutlineWorkflowMode = "fast" | "standard" | "plan" | "discuss"`（**大纲侧已多出「计划/共创」两档**，与写作侧刻意解耦）
- UI 选择器：**`src/components/chat/chat-panel.tsx:196-220`** `aiWorkflowModeOptions`（数据驱动）；真实渲染 `:2915-2946`（`data-ui-ai-menu="mode"`）；**加第 4 项即自动出现在下拉里**
- 状态：`src/stores/wiki-store.ts:714` `aiWorkflowMode`、`:798 setAiWorkflowMode`；持久化 `src/lib/project-store.ts:189-190`；启动恢复 `src/App.tsx:368`
- 模式如何影响流程：`chat-panel.tsx:334-419 buildChatAgentSystemPrompt()`（`:389-400` 三模式文案）、`src/lib/agent/plan-execute-policy.ts:23 buildPlanExecutePolicyPrompt(mode)`、`src/lib/novel/deep-chapter-generation.ts:221 ChapterWorkflowProfile` / `:232 resolveChapterWorkflowProfile` / `:272 workflowModeLabel`
- ⚠️ **双重校验**：`src/lib/agent/tools/run-chapter-workflow.ts:59-62 normalizeParams` 与 `:114-118 workflowMode.enum` 都只认 `["fast","standard","strict"]`——**加 `discuss` 必须同时改这两处**，否则模型侧参数会被静默丢弃

### 6.2 大纲「共创模式」（discuss）完整实现 —— 主要复用资产

**协议层 `src/lib/novel/outline-discuss-protocol.ts`**：
- `:1-2` 标记 `<!-- outline_discuss -->` / `<!-- /outline_discuss -->`；`:4-5` `OUTLINE_DISCUSS_CUSTOM_OPTION_ID = "CUSTOM"`；`:7 MIN_OPTIONS = 2`；`:9 MAX_DECISIONS = 3`
- `:17-44` `OutlineDiscussOption / Decision / Agreed / Protocol`（`{status, module, judgment, nextStep, decisions[], agreed[]}`）
- `:161 parseOutlineDiscussProtocol`、`:224 validateOutlineDiscussProtocol`（**代码闸门**：needs_decision 必须有 1-3 分歧、每问真实选项 ≥2、`preferenceId` 必须命中真实选项；ready 必须有 `judgment`）
- `:265 buildOutlineDiscussPhaseSystemRules`、`:294 hasOutlineDiscussRepairableContent`、`:308 buildOutlineDiscussRepairMessages`、`:348 buildOutlineDiscussAnswerPrompt`、`:367 buildOutlineDiscussExecutionPrompt`、`:383 isOutlineDiscussFinalizeRequest`、`:400 isOutlineDiscussProtocol`、`:426 stripOutlineDiscussMarkers`
- ⚠️ `:197` 把缺省 `module` **硬编码为「大纲」**、错误文案写死「共创协议」→ 泛化时必须参数化，否则章节侧报错会串味

**补协议修复 `src/lib/novel/outline-discuss-repair.ts:26 repairOutlineDiscussProtocolWithAi()`** —— 模型只吐正文不吐协议块时，用一次便宜确定性调用把判断转写成协议。**该函数本身已通用**（content + module + llmConfig + signal）。

**卡片 UI `src/components/sources/outline-discuss-card.tsx`**：
- `:47 OutlineDiscussCard`（按 status 分派）、`:93 OutlineDiscussDecisionCard`（选项按钮 + 「AI 倾向」徽标 + CUSTOM 文本框）、`:242 OutlineDiscussFinalizeCard`
- 接口纯协议驱动：`{protocol, onSubmitAnswers, onConfirm, onContinue, disabled, disabledReason}` → **可原样复用或薄包装**

**状态持久化 `src/stores/outline-chat-store.ts`**：`:143-157` 消息字段 `outlineDiscussPhase / outlineDiscussProtocol / outlineDiscussError / outlineDiscussDecision`；`:222` 落盘 `<project>/.qmai/outline-chats.json`；`:505-507 loadFromDisk` 用 `isOutlineDiscussProtocol` **丢弃结构不完整的共创数据**

**面板接线 `src/components/sources/outline-chat-panel.tsx`**：`:594-624 OUTLINE_WORKFLOW_MODE_OPTIONS`（discuss → `label:"共创", description:"边聊边定"`）；`:677-696` 讨论轮/定稿轮两套 rules；`:1046 buildOutlineDiscussionPrompt`；`:4018-4062` 解析→补协议→校验；`:4736 markOutlineDiscussDecision`、`:4751 handleSubmitOutlineDiscussAnswers`、`:4780 handleConfirmOutlineDiscuss`

**阶段机 `src/lib/novel/outline-workflow-state.ts`**：`:1 OutlineWorkflowStage`、`:24 ALLOWED_TRANSITIONS`、`:50 canTransitionOutlineWorkflow`

### 6.3 章节侧现状与复用差距

| 能力 | 大纲侧 | 章节侧现状 |
|---|---|---|
| 协议解析/闸门/修复 | 有 | **无**，需泛化（`module` → 章节号/章标题） |
| 决策点卡片 UI | `outline-discuss-card.tsx` | **无**，接口纯协议驱动可复用 |
| 会话 store + 协议字段 | `outline-chat-store.ts` | `src/stores/chat-store.ts`（`DisplayMessage` `:36-54`）**无任何协议字段** |
| 落盘形状校验 | `outline-chat-store.ts:505` | `src/lib/persist.ts:242`（`chat-history.json`）**无校验** |
| 前情读取 | 靠工具 | **已有更强的** `story-simulation/story-extractor.ts:50 extractStoryContent` |

**章节侧已有的「标记协议 + 卡片确认」先例**（最值得照抄的范式）：`src/lib/agent/plan-execute-policy.ts`、`src/components/chat/chapter-plan-confirm-dialog.tsx`（`:7-8 <!-- chapter_plan -->` 标记、`:37 extractChapterPlan`、`:103 ChapterPlanConfirmDialog`）、面板状态 `chat-panel.tsx:1207 pendingChapterPlans`

### 6.4 「剧情推演」的故事框架生成（需求第 1 步要复用）

- **核心生成器**：`src/lib/novel/story-simulation/story-framework-generator.ts:48 generateStoryFramework(options)`（`FrameworkGenerationOptions:27`）；`:101 buildMessages`（起承转合四段式，节点字段 `phase/title/coreConflict/involvedCharacters/goal/causeFromPrev/expectedOutcome`）；`:158 buildUserPrompt`；`:298 parseFrameworkJson`；`:343 normalizeNodes`
- **内容提取**：`src/lib/novel/story-simulation/story-extractor.ts:50 extractStoryContent(projectPath, {sourceChapters, llmConfig, onProgress})` → 大纲、灵魂文档、最近 N 章正文、记忆库、角色特征
- **类型**：`src/lib/novel/story-simulation/types.ts:259 StoryFramework`、`:273 StoryNode`、`:388 calcNodeCount`
- **绑定到章节上下文**：`src/lib/novel/story-simulation/framework-binding.ts:54 loadBinding / :70 saveBinding / :105 buildBindingContext`；上下文数据源 `src/lib/novel/context-data-sources.ts:516 storyFrameworkBindingDataSource`（priority 19）

⚠️ **关键缺口**：现有 `generateStoryFramework` **只产出 1 个框架**，没有「3-4 个候选想法」概念，也没有「故事类型标签」和「约 300 字后续介绍」字段。这部分必须**新建**（可内部循环调用 `generateStoryFramework` 或另写多候选生成器）。

### 预计触碰文件

**复用（不改语义或薄泛化）**：`outline-discuss-protocol.ts`、`outline-discuss-repair.ts`、`outline-discuss-card.tsx`、`outline-workflow-state.ts`、`story-framework-generator.ts`、`story-extractor.ts`、`story-simulation/types.ts`、`framework-binding.ts`、`chapter-plan-confirm-dialog.tsx`（范式）

**新建（建议）**：
- `src/lib/novel/chapter-discuss-protocol.ts` — `<!-- chapter_discuss -->` 标记与 `ChapterDiscussProtocol {status, chapterNumber, chapterTitle, judgment, nextStep, decisions[], agreed[]}` 及 parse/validate/rules/answer/execution/finalize/strip 全套
- `src/lib/novel/chapter-idea-generator.ts` — 「3-4 个想法」生成（`storyType` + 约 300 字介绍 + 可选框架骨架；支持「都不满意→再生成一批」）
- `src/lib/novel/chapter-discuss-repair.ts`、`src/components/chat/chapter-discuss-card.tsx`、`src/components/chat/chapter-idea-card.tsx` + 对应 spec

**修改**：
- `src/lib/agent/workflow-mode.ts` — `AiWorkflowMode` 加 `"discuss"`；`:11` 白名单；`:32 getWorkflowModeLabel` 加「共创」
- `src/lib/agent/tools/run-chapter-workflow.ts` — **`:59-62` 与 `:114-118` 两处都要放行 `"discuss"`**
- `src/components/chat/chat-panel.tsx` — `:196-220` 加第 4 项；`:334-419` 加共创分支；`handleSend` 加路由；`pendingChapterDiscuss` 状态；`:2995` 附近渲染卡片；`:2872/:2947` 计划开关与共创的互斥策略
- `src/lib/novel/deep-chapter-generation.ts` — `ChapterWorkflowProfile` / `resolveChapterWorkflowProfile` 加档
- `src/stores/chat-store.ts` — `DisplayMessage` 加协议字段
- `src/lib/persist.ts` — `chat-history.json` 加协议形状校验
- `src/i18n/zh.json` — 「共创」档位文案（**唯一 locale**）

### 关键风险（务必遵守）
1. **扩联合类型会打红一批测试**：`workflow-mode.spec.ts:37`、`deep-chapter-generation.spec.ts:185` 等以 `"fast" | "standard" | "strict"` 做 `it.each` 枚举；`run-chapter-workflow.spec.ts` 也断言 enum。**扩类型后必须同步核查这些用例。**
2. 大纲协议层 `:197` 硬编码 `module = "大纲"`、错误文案写死「共创协议」→ 泛化时**参数化**，否则章节侧报错信息会串味。
3. 章节侧落盘目前**没有**协议形状校验 → 需像 `outline-chat-store.ts:505` 那样补过滤，否则残缺卡片会在重载后渲染出错。

---

## 7. 提交规则

- 只提交**本分支职责范围**内的改动；
- 中文 conventional commits（`feat(章节共创): …`、`fix(章节共创): …`、`test(章节共创): …`）；
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
git worktree remove .worktrees\chapter-co-creation
git branch -d feature/chapter-co-creation
```

---

## 9. 项目既有约定（不重复，直接遵守）

本文件**不复制** `.agents/AGENTS.md`。⚠️ 它在 `.agents/` 子目录下，**不会**因你站在工作树根就自动加载——**开工前先主动读**：

```
.agents/AGENTS.md     # = C:\QMAI_C\QMAI-main\.worktrees\chapter-co-creation\.agents\AGENTS.md
```

要点：文档一律写 `docs/`（分支说明命名 `docs/<分支名>-分支说明.md`）；小说逻辑放 `src/lib/novel/` 并经 `mod.ts` 导出；草稿隔离与 `ingestChapter()` 摄取链不可违背；新增 LLM 调用走 `resolveNovelModel()` / `resolveReviewModel()`。

---

## 10. 更新记录

- 2026-10-10 21:1x：创建本文件。记录隔离边界（含与 `main`「续写」任务的链路重叠提醒）、基线 **720/6957**（基点 `dcf8b38`）、EOL 假阳性坑、vitest worker 抖动，以及调查结论——**大纲共创（discuss）是主要复用资产，但「3-4 个想法 + 故事类型 + 300 字介绍」必须新建**，并列明扩展 `AiWorkflowMode` 的三处必改点与打测试风险。
