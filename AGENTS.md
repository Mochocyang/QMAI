# feature/character-skill 分支工作约定

> 本文件是**本分支专属**的 Agent 提示词，仅在 `feature/character-skill` 这棵隔离工作树内生效。
> 合并进 `main` 之前**必须删除本文件**（见 §8）。

---

## 1. 这个分支是什么

| 项 | 值 |
|---|---|
| 分支 | `feature/character-skill`（仅本地，远端不存在） |
| 工作树 | `C:\QMAI_C\QMAI-main\.worktrees\character-skill` |
| 基点 | `main` 的 `dcf8b38`（2026-10-10） |
| 任务主题 | **角色 skill（技能库里的「角色 skill」，可持续学习提升）** |
| 依赖 | 已 `npm ci`（867 包）；Node 24（见 `.nvmrc`） |

---

## 2. 硬边界（不可违背）

### 2.1 同时并存的其他工作，一律不要碰

| 位置 | 正在做什么 | 你的处置 |
|---|---|---|
| `C:\QMAI_C\QMAI-main`（主检出，`main`） | 章节「续写」（`continuation.ts`、`components/editor/**`、`preview-panel.ts`） | **只读，不写** |
| `.worktrees\scratch-20261010` | 事件细纲 | **不要碰** |
| `.worktrees\scene-dialogue-simulation` | 人物对话 / 模拟情景 | 另一个分支，**不要碰** |
| `.worktrees\chapter-co-creation` | 章节共创 | 另一个分支，**不要碰** |
| `.claude\worktrees\agent-ace3452a280eb9df5` | **locked**，遗留 | 不要碰、不要解锁 |
| `C:\Users\Administrator\.codex\worktrees\3085\QMAI-main` | detached HEAD，含未跟踪 `.workbuddy/` | 不要碰 |

在主检出中**不要**执行：修改/新建/删除文件、`git add`、`git commit`、`git stash`、`git checkout`、`git switch`、`git restore`、`git reset`、`git worktree remove`。
> ⚠️ **最容易犯的错**：在主检出跑 `git add -u` / `git add -A`，会把别人的改动暂存进去。

### 2.2 不要碰其他分支的工作树目录

`.worktrees/` 下**每一棵**都是别人的工作区。只在你自己的树里写文件。

### 2.3 未经明确指示不 push、不合并

不 `git push`、不合并进 `main`。

---

## 3. 在哪跑命令

```powershell
cd C:\QMAI_C\QMAI-main\.worktrees\character-skill
```

自检：

```powershell
git rev-parse --git-dir          # → .../.git/worktrees/character-skill
git rev-parse --git-common-dir   # → .../.git
git branch --show-current        # → feature/character-skill
```

`--git-dir` ≠ `--git-common-dir` 即说明你在 linked worktree 里（正确状态）。

---

## 4. 测试与基线

| 命令 | 说明 |
|---|---|
| `npm run test:mocks` | 主测试套件（mock，不需要 LLM 密钥） |
| `npm run typecheck` | `tsc --build` |
| `npm run typecheck:tests` | `tsc -p tsconfig.test.json --noEmit` |

切出后已实测基线（本分支基点 `dcf8b38`）：**720 文件 / 6957 用例通过、6 todo、0 失败**（约 74 秒）。

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

`vite.config.ts:136` 有 `"**/.worktrees/**"`：外层（主检出）跑测试会**忽略本工作树**；内层跑测试**照常收集**，不会出现「0 用例假绿」。

---

## 5. 本分支的任务：角色 skill

> 原文（图）：「另外，关于当前小说中的人物，我们也将其定义为『技能库』。在技能库中还需要增加一个功能，我们将其称为『角色 skill』。这个『角色 skill』是会不断学习、不断提升的。」

### 具体运作机制（需求原文）

**1. 初始生成**
当写到第一章内容时出现了一个角色，AI 会分析这个角色一开始的风格是什么样的、说话方式是什么样的，然后为其制作一个 skill，定义他的性格。有了这个 skill 之后，它会自动加入到技能库的「角色 skill」中。

**2. 持续完善**
当这个角色第二次出现时，AI 会再次去完善这个 skill。这样的话，每一个人物的形象都是饱满的。

**3. 人为编辑**
用户也可以去编辑这个 skill 的内容。

---

## 6. 既有代码基础（只读调查结论，实施前请复核）

### ⚠️ 最重要的一条：仓库里有**三套**都叫「角色 skill」的东西，必须先分清

| 代号 | 名称 | 落盘位置 | 绑定「本作人物」 | 可持续完善 | 已注入写作上下文 |
|---|---|---|---|---|---|
| **A** | 拆书库角色 Skill | `book-analysis/<bookId>/skills/<名字>-skill.md` + `characters/<id>.json` | ❌ 绑定的是**别的作品**里的角色 | ⚠️ 可重新生成 | 仅通过 C 间接进入 |
| **B** | 写作 Skill 库的「角色」分类 | `<project>/writing-skills.json` 内 `categoryId="skill-category:character"` | ❌ 全局通用技能 | ❌ | ✅ 走 skill-route |
| **C** | **角色灵魂 CharacterAura** | `<project>/.qmai/character-aura.json` + `.qmai/character-auras/<slug>-perspective/SKILL.md` | ✅ **按 characterName 绑定本作人物** | ✅ `updateCustomCharacterAura` | ✅ 直接注入 |

**结论：C 才是最佳复用底座**——已具备「按人物绑定 + SKILL.md 落盘 + LLM 生成 + 编辑 UI + 写作注入」，缺的只是「由章节摄取自动触发」+「在技能库页露出」。
**A 是别人的角色、B 没有人物维度，都不是恰当的复用对象。**

### 6.1 C 的既有能力（`src/lib/novel/character-aura.ts`，2342 行）

- `CharacterAura` `:42-67`；**`CharacterAuraBinding { characterName, auraId, aliases? }` `:69-74`** ← 人物↔skill 绑定关系
- 存储：**`storePath()` `:2138-2140` → `<project>/.qmai/character-aura.json`**；`loadCharacterAuraStore()` `:304-315`、`saveCharacterAuraStore()` `:317-319`、`listCharacterAuras()` `:321-324`
- **每角色一份 SKILL.md 目录**：`createCustomCharacterAuraSkill()` `:326-`（`skillFolder = <project>/.qmai/character-auras/<slug>-perspective` `:334`）；`createCustomCharacterAuraFromGeneratedSkill()` `:426-`（`:433`）
- **`updateCustomCharacterAura(projectPath, auraId, patch)` `:475-` ← 「持续完善」的现成写入口**
- `bindCharacterAura()` `:505`、`unbindCharacterAura()` `:522`、`getCharacterAuraBindings()` `:539`
- 读盘：**`loadCharacterAuraSkillDocument(aura, projectPath)` `:554-557`**
- 本作人物枚举：**`listBindableNovelCharactersLocal()` `:809-812`**、`listBindableNovelCharacters()` `:861`、`refineBindableCharactersWithLlm()` `:894`；缓存 `.qmai/bindable-characters.json`
- 「编辑角色 skill 正文」的 UI **已经存在**：`src/components/novel/character-aura-view.tsx`（`AuraDetails` `:608-`、读 SKILL.md `:646-651`、**「编辑灵魂」按钮 `:690`**、`CustomAuraForm` `:765-`、`handleSave` → `updateCustomCharacterAura` `:363-376`、`CharacterBindingControl` `:941-`）

**注入点（已经通了，不用改）**：`context-engine.ts:310-319` 动态 `await import("./character-aura")` → `:340 characterAuras`；`review-adapter.ts:242-253`；`composer.ts:98`（「人物气质」）。

### 6.2 章节摄取的挂钩点

`ingestChapter()` 定义在 **`src/lib/novel/chapter-ingest.ts:327-521`**：

```
读文件:365 → 校验:366-372 → 日志:383 → buildEstablishedContextForExtraction:396
→ extractSnapshotWithLLM:398 → canonicalizeSnapshotCharacters:404 → 校验:414-418
→ saveChapterIngestOutput:424 → syncSnapshotToMemory:442 → wiki-patch:444-454
→ [isReingest] 重建:456-458 → 社区摘要:462-482 → 检索索引:484-500
→ updateTrackingAfterChapter:503-510 → 日志:512 → return:520
```

- `ChapterSnapshot` `:91-133` 含 **`characters: string[]`（`:96`）**、`characterAliases?: Record<string,string[]>`（`:97`）
- **挂钩点①「首次出现→生成」**：`:442`（`syncSnapshotToMemory` 之后）或 `:503-510` 同一段。此处的 `snapshot.characters` 已是规范名，`characterAliases` 可一并写进绑定的 `aliases`
- **首次判定**：`loadValidMemorySnapshots(pp)`（`:823-844`，一次拿全部快照，成本最低）或 `listSnapshots`（`:1340`）+ `loadSnapshot`（`:1320`），取 `chapterNumber < 当前章` 的 `characters` 并集，差集即首次
- **挂钩点②「第二次出现→完善」**：同位置分支。先前出现次数 `0`→生成；`1`→**完善**（`loadCharacterAuraSkillDocument` 读现有 SKILL.md + 本章正文 → LLM 重写 → `updateCustomCharacterAura` 落盘）；`≥2`→可选增量补充
- **次佳位置**：`src/lib/novel/tracking-updater.ts:37 updateTrackingAfterChapter()`（已在收尾被调用），但拿不到 `characterAliases`，需改签名

### 6.3 技能库页现状

- 导航 id `skillLibrary`：`icon-sidebar.tsx:49-50` → `content-area.tsx:118-130`（懒加载 `UnifiedSkillLibraryView`）
- `src/components/skill-library/unified-skill-library-view.tsx`：`skillLibraryTabs` `:36-40`（**只有 3 个 tab：去AI味技能 / 写作 Skill / 收藏**）→ 要露出「角色 skill」需在此加 tab 或复用写作 tab 的「角色」分类 chips
- 写作 Skill 编辑表单：`src/components/skill-library/writing-skill-library-view.tsx`（`WritingSkillLibraryView` `:672-1184`、`handleSaveSkill()` `:794-827`）
- 类型单点 `src/lib/novel/skill-library.ts`：`UserSkill` `:28-45`、`SkillKind` `:3-10`、`SKILL_KIND_LABELS` `:65-73`；**⚠️ 没有任何 character 字段**，这是走 B 路线时必须扩展的第一个点
- 落盘 `src/lib/novel/user-skill-store.ts`：`USER_SKILL_CONFIG_FILE = "writing-skills.json"` `:18`、`resolveEnabledWritingSkills()` `:406-409`（启用的唯一判据）
- 「角色」分类**已经存在**：`skill-route.ts:3-13` 的 `SKILL_ROUTE_CATEGORY_IDS.character`、`:21` 的 `{ id: "skill-category:character", name: "角色" }`，目前只装 SkillHub/JueseSkill 的 3 个通用内置技能

### 预计触碰文件

**新建**：
- `src/lib/novel/character-skill-learning.ts` — 核心：首次/第二次判定、`generateCharacterSkillFromChapter()`、`refineCharacterSkillFromChapter()`、幂等标记（内部复用 C 的 create/update/bind/load）
- `src/lib/novel/character-skill-prompt.ts` — 「起始风格/说话方式/性格」与「完善人物形象」两套提示词
- `src/lib/novel/character-skill-learning.spec.ts`
- `src/components/skill-library/character-skill-view.tsx` + `.spec.tsx` — 技能库「角色 skill」tab

**修改（按必要性排序）**：
- **`src/lib/novel/chapter-ingest.ts`** — 核心挂钩（见 6.2）
- **`src/lib/novel/character-aura.ts`** — 扩展学习进度字段（`CharacterAura` `:42-67`、`CharacterAuraBinding` `:69-74`）
- `src/lib/novel/skill-library.ts` + `user-skill-store.ts` + `skill-route.ts` — 仅当走 B 路线（让角色 skill 进写作 Skill 库）
- `src/components/skill-library/unified-skill-library-view.tsx` — 加 tab / chips
- `src/components/novel/character-aura-view.tsx`、`src/components/layout/soul-sidebar-panel.tsx` — 若在灵魂页同步编辑/展示

### 明确**不要**误改（易混淆）
- `src/lib/novel/book-analysis/**`（`skill-generator.ts`、`skill-character-match.ts`、`character-disk-store.ts`、`aura-adapter.ts`）— 拆书库，**别人的角色**
- `src/lib/novel/de-ai-skill-library.ts` + `src/components/skill-library/skill-library-view.tsx` — 去AI味库，与角色无关
- `src/lib/novel/skill-seed.ts` / `skill-hub-seed.ts` — 内置技能种子

### 关键风险 / 既有约定（务必遵守）
1. **保存正式章节不自动摄取**：`preview-panel.tsx:1351-1360` 注释明确写了「保存正式章节时已按用户要求不再自动提取记忆」。自动生成 skill **不要**挂在「保存章节」上；挂在 `ingestChapter` 内（用户点「提取记忆」时）更安全。
2. `ingestChapter` 是**同步长链路**，内部 LLM 调用必须走**后台异步**，照抄 `chapter-ingest.ts:463-482` 的 `communitySummaryAsync` + `void rebuildCommunitySummaries()` 范式，否则会拖慢「提取记忆」按钮。
3. `buildCharacterSoulContext()` 要求 `store.bindings.length > 0`（`:617`）→ **生成 skill 时必须同时 `bindCharacterAura()`**，否则写作时读不到。
4. 内置 aura **不可编辑**（`character-aura-view.tsx:363/376/440/574` 都判 `!selected.builtIn`）；`createCustomCharacterAura*` 产出的才是可编辑的 custom。
5. `isReingest`（`:411`）必须短路：重提取不应重复生成/重复消耗 LLM。
6. `chapter-ingest.spec.ts:26` 用**源码字符串**断言 `export async function ingestChapter`——改动其签名会触发该测试。
7. `src/lib/bundle-boundaries.spec.ts:27-37` **强制** `context-engine.ts` / `review-adapter.ts` 对 character-aura 用动态 `await import()`（体积边界）→ **别改成静态 import**，否则该测试会红。

---

## 7. 提交规则

- 只提交**本分支职责范围**内的改动；
- 中文 conventional commits（`feat(角色skill): …`、`fix(角色skill): …`、`test(角色skill): …`）；
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
git worktree remove .worktrees\character-skill
git branch -d feature/character-skill
```

---

## 9. 项目既有约定（不重复，直接遵守）

本文件**不复制** `.agents/AGENTS.md`。⚠️ 它在 `.agents/` 子目录下，**不会**因你站在工作树根就自动加载——**开工前先主动读**：

```
.agents/AGENTS.md     # = C:\QMAI_C\QMAI-main\.worktrees\character-skill\.agents\AGENTS.md
```

要点：文档一律写 `docs/`（分支说明命名 `docs/<分支名>-分支说明.md`）；小说逻辑放 `src/lib/novel/` 并经 `mod.ts` 导出；草稿隔离与 `ingestChapter()` 摄取链不可违背；新增 LLM 调用走 `resolveNovelModel()` / `resolveReviewModel()`。

---

## 10. 更新记录

- 2026-10-10 21:1x：创建本文件。记录隔离边界、基线 **720/6957**（基点 `dcf8b38`）、EOL 假阳性坑、vitest worker 抖动，以及关键调查结论——**仓库有三套「角色 skill」，应以角色灵魂 CharacterAura（C）为复用底座**，并附章节摄取的两个挂钩点与既有产品决策风险。
