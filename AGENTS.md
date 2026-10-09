# work/scratch-20261009 分支工作约定

> 本文件是**本分支专属**的 Agent 提示词，仅在 `work/scratch-20261009` 这棵隔离工作树内生效。
> 合并进 `main` 之前**必须删除本文件**（见 §6）。

---

## 1. 这个分支是什么

| 项 | 值 |
|---|---|
| 分支 | `work/scratch-20261009`（仅本地，远端不存在） |
| 工作树 | `C:\QMAI_C\QMAI-main\.worktrees\scratch-20261009` |
| 基点 | `main` 的 `d87485a`（含本地全部 78 个未推送提交） |
| 主检出 | `C:\QMAI_C\QMAI-main`（**另一个任务正在那里进行**） |
| 依赖 | 已 `npm ci`（867 包）；Node 24（见 `.nvmrc`） |

它与主检出并行存在、共享同一个 `.git` 对象库，但**工作区、索引、HEAD 完全独立**。
从 `main` 切出时是空分支（领先 0 提交）。

---

## 2. 硬边界（不可违背）

### 2.1 绝不写主检出

主检出 `C:\QMAI_C\QMAI-main` 里有**另一个正在进行中的任务**。在本分支工作期间，**不要**在主检出中：

- 修改 / 新建 / 删除任何文件；
- 执行 `git add`、`git commit`、`git stash`、`git checkout`、`git switch`、`git restore`、`git reset`；
- 执行 `git worktree remove`，也不要删除 `.worktrees/` 目录。

> ⚠️ **最容易犯的错**：在主检出跑 `git add -u` 或 `git add -A`。那会把正在进行的任务的**已跟踪改动**直接暂存进去，污染它的提交。这类改动随时在变，不要靠「看一眼有没有东西」来判断是否安全。

### 2.2 主检出的 `docs/` 改动全属于另一个任务，一律不要碰

主检出当前有 **9 个已跟踪文件被修改 + 48 个未跟踪文件**，全部集中在 `docs/` 下。分两类：

1. **正在活跃写入的任务**：`docs/font-scaling-fix-20261007/**`
   —— 「字体缩放修真实机验证」任务，**此刻仍在持续产出**（验证脚本 `.mjs`、结果 JSON、实机截图 PNG 都在更新）。
2. **更早的交付物**：`docs/book-analysis-*`、`docs/model-settings-skill-reliability-*`、`docs/portable-character-soul.html`、`docs/soul-page-redesign.html` 等。

**规则**：不要把上述任何文件读来改写、不要 `git add`、不要提交、不要删除。
本分支要产出文档时，写在**本工作树自己的** `docs/` 里。

> 这里故意**不写死文件清单**：另一个任务在持续新增文件，任何硬编码列表都会立刻过期。请按**路径规则**判断，而不是对照某个固定名单。

### 2.3 不要碰其他工作树

| 工作树 | 状态 |
|---|---|
| `C:\QMAI_C\QMAI-main\.claude\worktrees\agent-ace3452a280eb9df5` | **locked**，分支 `worktree-agent-ace3452a280eb9df5` |
| `C:\Users\Administrator\.codex\worktrees\3085\QMAI-main` | detached HEAD，含未跟踪 `.workbuddy/` |

这两棵都不是你的：不要在其中改文件、不要 `git worktree prune`、不要解锁。

### 2.4 未经明确指示不 push、不合并

- 不执行 `git push`（本分支在远端不存在，也不要创建远端分支）；
- 不把本分支合并进 `main`；
- `main` 当前领先 `origin/main` **78 个提交**——不要试图「顺手」同步或推送。

---

## 3. 在哪跑命令

**所有** `git` / `npm` / 测试命令都在工作树里执行：

```powershell
cd C:\QMAI_C\QMAI-main\.worktrees\scratch-20261009
```

自检（确认你在正确的树里）：

```powershell
git rev-parse --git-dir          # → .../.git/worktrees/scratch-20261009
git rev-parse --git-common-dir   # → .../.git
git branch --show-current        # → work/scratch-20261009
```

`--git-dir` ≠ `--git-common-dir` 即说明你在 linked worktree 里（正确状态）。

---

## 4. 测试与验证

### 4.1 基线（切出后已实测，全绿）

| 命令 | 结果 |
|---|---|
| `npm run test:mocks` | **701 文件 / 6610 用例通过**，6 todo，0 失败，约 71 秒 |
| `npm run typecheck` | `tsc --build` |
| `npm run typecheck:tests` | `tsc -p tsconfig.test.json --noEmit` |

改代码前后都应能回到这个基线。出现新失败时，先确认是不是自己引入的。

### 4.2 已知坑：跑测试会产生 **EOL 假阳性**（重要）

跑过 `test:mocks` 之后，`git status` 会冒出大量「已修改」文件（实测 **170 个**，集中在 `tests/fixtures/**` 与两个 `docs/*/dump.html`）。
**这不是真实改动。** 成因：`core.autocrlf=true` 检出时索引记录的 stat 是 CRLF 尺寸，而测试运行把文件重写成了 LF。

判定与处理：

```powershell
# 判定：真实内容差异应为 0（0 = 全是换行符假象）
git diff --quiet HEAD; echo "exit=$LASTEXITCODE"      # 0 = 无真实差异
(git diff HEAD --name-only | Measure-Object).Count    # 应为 0 个文件

# 修掉假阳性（只刷新索引 stat，不产生任何内容变更）
git add -u
(git diff --cached HEAD --name-only | Measure-Object).Count   # 必须为 0，否则停下来查
```

**禁止**因为看到这 170 个 `M` 就去 `git checkout -- .` 或 `git restore .`——那会真删改动。先判定。

### 4.3 `.worktrees/**` 排除规则的含义

`vite.config.ts:136` 里有 `"**/.worktrees/**"` 排除项。两个后果：

- **外层**（主检出）跑测试会**忽略本工作树** → 你在这里写代码/夹具**不会污染**另一个任务的测试结果（这是隔离生效的原因之一）；
- **内层**（本工作树）跑测试**照常收集**，实测 706 个测试文件——该排除规则匹配的是相对根目录的路径，你在树内时路径形如 `src/...`，不含 `.worktrees` 路径段。所以**不会**出现「0 用例假绿」。

---

## 5. 提交规则

- 只提交**本分支职责范围**内的改动，不要顺手带上无关文件；
- 提交信息沿用仓库中文 conventional commits 风格，例如 `fix(写作现场): …`、`test(排版): …`、`docs(计划): …`；
- 提交前先跑 §4.1 的基线；
- 提交前用 `git branch --show-current` 确认当前在 `work/scratch-20261009` 上，避免误在主检出执行写操作；
- 本文件自身可以随分支提交。

---

## 6. 收尾：合并前必须删除本文件

`AGENTS.md` 位于工作树**根目录**，会被 DSH 的指令加载器当作**项目级指令**加载（候选名 `AGENTS.md` / `CLAUDE.md`，项目根以 `.git` 为标记）：

- 在**本工作树内**工作时：项目根 = 本工作树根（它有 `.git`），本文件**会**被作为基线指令加载 → 生效；
- 在**主检出**工作时：项目根 = 主检出，本工作树是**后代目录而非祖先** → 本文件**不会**被加载 → 不干扰。

> 残余风险：加载器还会沿「被触碰路径」的后代目录探测指令文件。所以**不要**让主检出的工作去触碰 `.worktrees/scratch-20261009/` 下的路径。

**因此：一旦本分支合并进 `main`，本文件就会出现在主目录根、开始影响所有工作。**
所以 **合并前必须删除本文件**（或在合并时排除它）。删除后的收尾命令：

```powershell
cd C:\QMAI_C\QMAI-main
git worktree remove .worktrees\scratch-20261009
git branch -D work/scratch-20261009
```

---

## 7. 项目既有约定（不重复，直接遵守）

本文件**不复制** `.agents/AGENTS.md` 的内容，避免两处漂移。

⚠️ `.agents/AGENTS.md` 在 `.agents/` 子目录下，**不会**因为你站在工作树根就自动加载——**开工前先主动读它**：

```
.agents/AGENTS.md        # 即 C:\QMAI_C\QMAI-main\.worktrees\scratch-20261009\.agents\AGENTS.md
```

其中必须遵守的要点：

- **文档放置**：功能分支说明、开发备忘、设计笔记一律写 `docs/`，**不要**新建到仓库根目录；分支说明命名 `docs/<分支名>-分支说明.md`；
- **代码分层**：小说逻辑放 `src/lib/novel/` 并经 `mod.ts` 导出，不要散落在 UI 组件里；
- **核心工作流不可违背**：草稿隔离、`ingestChapter()` 摄取链、上下文包 `SECTION_PRIORITY` 顺序与 token 预算；
- **改动检查清单**：是否破坏草稿隔离 / 影响 token 预算 / 新增 LLM 调用是否走 `resolveNovelModel()`、`resolveReviewModel()`。

---

## 8. 更新记录

- 2026-10-09 10:50：创建本文件。记录隔离边界、测试基线、EOL 假阳性坑，以及合并前删除规则。
