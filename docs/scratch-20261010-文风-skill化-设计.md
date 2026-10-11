# work/scratch-20261010 第五批（丁）设计：文风 skill 化 + 统一可选技能面

> 用户原话见《`docs/scratch-20261010-文风与拆书库-设计.md`》§6「丁 · 文风 skill 化」
> 及该节下「丁 · 用户已确认的两个决定」。
> 本文的每条事实都来自对当前代码的**直读**（含两轮专门侦察），并标注了被推翻/修正的说法。
> 实施步骤见《`docs/scratch-20261010-文风-skill化-实施计划.md`》。

---

## 0. 范围与用户已确认的决定

用户原话（本节是需求的权威表述）：

> 「关于技能库，用户可以在其中选择技能，也可以选择『文风』以及『拆书库』中的 skill。
> 具体来说，以下内容都需要参考进去，并且都是可以使用的：
> 1. 用户在输入框中指定，使用某人的角色 skill 作为这个人物的灵魂；
> 2. 用户在输入框中明确要求使用某一个具体的 skill；
> 3. 包括『文风』的 skill、『故事』的 skill 等。」

**决定 1（用户确认）**：技能库要成为**统一的可选面**——技能、**文风**、**拆书库产出的 skill**
（文风 skill、故事 skill……）都要能被**选中**，并且能在**输入框里被引用生效**。
**这不只是「加一个文风 tab」，而是把三类来源统一到同一条「可选 + 可引用」链路上。**

**决定 2（用户确认）**：「文风写作」选择的作用域是**每次生成临时覆盖**
（本次生效，**不改项目设置**）。项目级 `enabledStyleId` 仍作为默认值。

**明确不在本批的**：不改 `.qmai/writing-style.json` 的落盘格式；不删拆书库既有流程；
不碰守门文件（§4）。

---

## 1. 已实读的关键事实

### 1.1 文风已经是一套完整实现，但它不是 `UserSkill`

| 项 | 事实 | 出处 |
|---|---|---|
| 类型 | `WritingStylePreset { id, name, sourceBook, profile, sourceBookId?, evidenceIds?, createdAt, updatedAt }` | `writing-style-store.ts:21-30` |
| 容器 | `{ version: 1, enabledStyleId: string \| null, styles: [] }`（**未导出**） | `:32-36` |
| 落盘 | `<项目>/.qmai/writing-style.json`，`JSON.stringify(store, null, 2)` | `:61-63`、`:79-82` |
| 冷启动 | 读写失败一律回落空 store；**无 schema 校验、不逐字段 normalize** | `:65-77` |
| 启用 | `enabledStyleId` **每项目同时只能启用一个**；传不存在的 id **静默降级为 null** | `:129-137` |
| 结构 | **没有** tags / categoryId / kind / priority 等 `UserSkill` 字段 | `:21-30` 对比 `skill-library.ts:28-45` |

**订正两处侦察措辞**（原文供参考，避免误导后续实现）：
1. 不是「**全局**单启用」，而是「**每项目**单启用」——文件在项目目录内，换项目即换启用态。
2. 「完全没有删除能力」不准确：删除 API **存在**且被生产代码用
   （`removeWritingStylePresetBySourceBook` ← `workbench-remove.ts:101`），
   缺的只是**文风库 UI 入口**与按 id 调用的路径。

### 1.2 文风今天如何抵达正文（这条决定了「临时覆盖」该怎么实现）

- 数据源：`context-data-sources.ts:376-406` `writingStyleDataSource`，
  `name: "writingStyle"`、`priority: 12`，主路径调
  `buildWritingStyleContext(projectPath, { task })`（`:382`）。
- 文本生成：`buildWritingStyleContext`（`writing-style-store.ts:238-322`）
  - **结构化画像**（`profile.workbenchStyle?.styleFingerprint` 存在）→
    头部 `【已启用文风画像】` + `compileStyleFingerprint(...)`（`:258-262`）；
  - 否则旧路径：`风格硬约束：` + `clip(constitution, 800)`（`:265`）；
  - 参考片段检索（目标 2500 字预算，`:280-305`）。
- 进入正文：`deep-chapter-generation.ts:778-788`
  `contextPrompt = [前情分析, deps.contextPackToPrompt(contextPack, restContextTokenBudget, { excludeOutline: true }), …].join()`
  → `:793` `cachePrefix = buildStableContextPrefix(outlinePrompt, contextPrompt)`
  → 被五个阶段共用 → **文风确实进入了正文每个阶段的提示词**。
  所以用户的「延续使用：在写作时，AI 可以延续使用这个 skill」**今天已经成立**；
  丁要补的是**选择**，不是「让它生效」。

### 1.3 ⚠️ 最大的技术风险：fail-closed 守卫只覆盖一条路径

```ts
// context-engine.ts:1132-1134（在 contextPackToPrompt 内）
if (pack.writingStyle?.startsWith("【已启用文风画像】") && !result.prompt.includes(pack.writingStyle)) {
  throw new Error("上下文预算不足，已启用的文风画像未完整保留。请减少本次参考内容或选择更大上下文模型，已停止生成。")
}
```

- 这道守卫**只在 `contextPackToPrompt` 这一条路径**上，且**只对结构化画像生效**
  （只有带 `styleFingerprint` 的预设才有 `【已启用文风画像】` 前缀，
  v1/旧画像被静默裁掉**不会**停机）。
- **另外两条路径没有守卫**：`trim-context-plugin.ts:47-60`（AI 会话 pre-plugin 链）
  与 context-hub `composer.ts:65`（把「写作风格」放 stable 层，
  用 `fitFragmentsProportionally` 按比例截断，只在 trace 里记 `budget_dropped`/`truncated`，
  **不抛错**）。`file-preview`/composer 只有 sourceCanon 会抛（`composer.ts:258-264`）。
- `chat-panel.tsx` 有 contextHub 时**不走** `contextPackToPrompt`（`:1849-1851`、`:1914-1915`）；
  无 hub 时才走（`:1917-1951`），而异常在 `:1953-1964` 被 catch，
  只有 `SourceCanonOverflowError` 会停机 → **文风溢出只 `console.warn`，
  且结果 `novelContextPrompt` 保持空串（整包上下文丢弃）**。
- 另有一条静默失效：`safeBuildChapterContextPack`（`deep-chapter-generation.ts:2625-2666`）
  在 `buildContextPack` 抛错时的兜底 pack 里 `writingStyle: ""`（`:2657`）
  → 该次生成**完全没有文风且不报错**。

**含义**：丁在实现「选文风」时必须明确回答「选中的文风走哪条路、被截断时怎么办」。
若走的是上面那两条无守卫的路径，就会出现「用户选了文风但生成时被静默丢掉」，
而这正是本批最该避免的用户可见缺陷。

### 1.4 生成管线里**没有** per-request 的文风参数

- `DeepChapterGenerationInput` 只有 `skillsPrompt?: string`（`deep-chapter-generation.ts:90`），
  **没有任何文风参数**；文风只能通过项目级 `enabledStyleId`（读盘）生效。
- 所以「每次生成临时覆盖」**需要新增一条管线**，不只是加 UI。

### 1.5 ⚠️ 硬约束：`context-engine.ts` 是守门文件，**不能改**

三项守门检查（见实施计划）第 1 条要求
`git diff a5a2702 --stat -- src/lib/novel/context-engine.ts …` **为空**。
`contextPackToPrompt` 的签名与选项**不能动**，因此
「让 `contextPackToPrompt` 支持排除/替换文风」这条最直觉的路**走不通**。

→ 临时覆盖必须**在 `context-engine.ts` 下游**实现（见 §2.3）。

### 1.6 死代码 / 死导出（丁可顺手清理，或至少不要依赖）

- `removeWritingStylePreset`（按 id）：**无任何生产调用方**（只有 spec）。
- `context-engine.ts:830` `readWritingStyle`：**无任何调用方**，
  且它那条 `@ts-expect-error - 函数通过动态导入在 context-data-sources.ts 中使用`
  的说明是**假的**——`context-data-sources.ts:14,25-33` 是**静态 import**
  `buildWritingStyleContext`，从未引用 `readWritingStyle`。
  ⚠️ 它同在守门文件里，所以**本批也不要动它**，只在文档里记着。
- 侦察还发现：仓库里**没有** `src/lib/novel/mod.ts` 或任何 `src/lib/**/mod.ts` 桶文件，
  与 `.agents/AGENTS.md` 里「经 mod.ts 导出」的描述不符（记录备查，不在本批范围）。
- ⚠️ **新发现（本轮实测，与丁-2 直接相关，但本批不修）：
  `getPlanBlueprint` 这条「应用侧兜底」通道在生产里根本没接上。**
  - 设计意图（`run-chapter-workflow.ts:30`/`:33-34` 的注释）是：
    章节计划**不作为工具参数**，而是由应用侧回调注入，**避免模型漏传**。
  - 实际读取逻辑是 `run-chapter-workflow.ts:137`：
    `params.planBlueprint?.trim() || options.getPlanBlueprint?.()?.trim() || undefined`
    ——即**主来源是模型传的工具参数**，回调只是兜底。
  - 而兜底**没有产出者**：全仓唯一的生产调用处
    `chat-panel.tsx:1095` 显式传 `undefined`
    （`useAgentConfig(agentSystemPrompt, undefined, getSelectedSkillsPrompt)`）。
    `git grep getPlanBlueprint` 在生产源码里只有
    `use-agent-config.ts:26`（形参）/`:158`/`:188`（转交）、
    `tools/index.ts:66`/`:126`（转交）、`run-chapter-workflow.ts:30`/`:137`（读），
    **没有任何地方提供一个实际的回调**；其余命中全在
    `run-chapter-workflow.spec.ts:286-332`（spec 自己造的回调）。
  - ⇒ **后果**：模型一旦漏传 `planBlueprint`，用户确认过的章节计划会**静默丢失**，
    而注释所声称的那层保护并不存在。这正是设计想要防的「静默失效」类型。
  - **本批处置：不修。** 理由：它属于 agent 工具链，与「文风 skill 化」无关，
    改了会扩大本批的审查面；且 `chat-panel.tsx` 是丙/丁多批都在动的文件。
    但 **丁-2 新增自己的通道时必须以它为戒**：加形参不等于接通，
    两端都要有产出者/消费者，并各配一条测试。
    （已在《实施计划》§2 步骤 3 写成硬要求。）

### 1.7 技能库 UI 的现状（决定「统一可选面」落在哪）

- 技能库共 10 个文件，**文风零涉及**：
  `unified-skill-library-view.tsx`（主壳）、`skill-library-view.tsx`（去AI味编辑）、
  `writing-skill-library-view.tsx`（写作 Skill 编辑）、`favorite-list-view.tsx`（收藏）、
  `de-ai-skill-picker.tsx`、`use-de-ai-skill-options.ts`、`de-ai-skill-errors.ts` + 3 个 spec。
- tab 定义（**唯一**一处）：`unified-skill-library-view.tsx:36-40`
  `[去AI味技能, 写作 Skill, 收藏]`；条目类型 `UnifiedSkillEntry.type: "writing" | "de-ai"`（`:50`）；
  卡片类型徽章是**二值分支**：`:363` `entry.type === "writing" ? "写作" : "去AI味"`。
- **没有 spec 钉死 tab 数量**（`unified-skill-library-view.spec.tsx` 用**文案**点击，
  不计数）。导航层反而有「`writingSkillLibrary` 不得出现在侧边栏」的断言
  （`icon-sidebar.test.tsx:51-53`、`sidebar-nav-preferences.spec.ts:68-70`）。
- 技能库 UI 文案**绝大多数是硬编码中文**，不是 i18n key。
- 已有**一个**跨系统转换器先例：`deAiSkillToUserSkill(DeAiSkill)`（`de-ai-skill-library.ts:630-647`）。
  **没有** `WritingStylePreset → UserSkill` 转换器，`UserSkill` 也**没有**指向文风的专用字段
  （只有通用 `linkedPath?: string`，且只在 `source === "linked"` 时有效）。

### 1.8 输入框引用弹窗（「在输入框中指定」的落点）

⚠️ **路径订正（第二轮侦察实测，本文件先前写错）**：
- 类型定义在 **`src/lib/reference/types.ts`**，**不是** `src/components/reference/types.ts`（后者不存在）。
- Provider 在 **`src/lib/reference/providers.ts`**，**不是** `src/components/chat/providers.ts`（后者不存在）。

已实测的事实：

- `src/lib/reference/types.ts:3` `export type SkillSubtype = "deai" | "writing"`；
  `:23` `skillSubtype?: SkillSubtype`；`:5-12` `ReferenceCategory`（所有技能共用 `"skill"` 一个分类）；
  `:14-32` `ReferenceToken`；`:49` `MAX_REFERENCE_COUNT = 10`。
- `ReferencePickerDialog.tsx:12-15` `SKILL_SUBTABS = [{key:"deai",…},{key:"writing",…}]`；
  初始子 tab `:35`、打开时重置 `:63`；
  过滤在 `:104-106`（`item.skillSubtype === skillSubtab`）——**是通用的**，
  加新子类型只需改数组与类型，过滤逻辑不用动。
- `providers.ts:17-26` `SkillSummary`（带 `subtype: SkillSubtype`）；
  `createSkillProvider` 在 `:273-292`（subtype 原样透传，本身通用）。
- **Provider 注入点恰好两处**（全仓 `createSkillProvider` 只有这两个生产调用）：
  - `chat-panel.tsx:1178`（其内 `"deai" as const` / `"writing" as const`，deps 在 `:1204`）
  - `outline-chat-panel.tsx:2258`（deps 在 `:2257`）
  两处都从**组件内局部 state** 拼列表，**不是**共享注册表 → 新类型要么改两遍，要么先抽公共源。
- `ReferenceChip.tsx:4-12` 颜色只按 `category` 取（所有技能共用黄色）——纯外观，无 subtype 分支。

### 1.9 ⚠️ 新子类型今天是**静默失效**的（丁-3 必须处理）

- `availableAgentSkills` = 写作 `UserSkill` + 去AI味 skills
  （`chat-panel.tsx:1165-1171`，消费在 `:1631-1637`）。
- 一条 `skill` token 的解析链：
  `ReferenceToken(category:"skill", skillId)` → `collectExplicitSkills`
  （`skill-route-registry.ts:288-313`；内部 `resolveSkillReference:253-266` 按
  id → name → route alias 匹配）→ `explicitSkills` → pre-plugin 的
  `selectedSkills`（`chat-panel.tsx:1846`）→ `select_skills` 合并（`select-skills-plugin.ts:75-80`）
  → `buildSelectedSkillsPrompt`（`:242-259`）→ `selectedSkillsPromptRef`（`:1867-1868`）
  → `getSelectedSkillsPrompt`（`:1084-1087`）→ `useAgentConfig`（`:1095`）
  → 注入 `run_chapter_workflow`（`run-chapter-workflow.ts:138`）。
- **文风/灵魂/故事的 id 不在这个池子里**，`resolveSkillReference` 返回 `undefined`，
  `collectExplicitSkills` 什么都不加（`:299-301`）。
  ⚠️ `isWritingSkill`（`select-skills-plugin.ts:223-226`，会把 `kind === "style"` 认作写作技能）
  **在这里不起作用**——它只过滤**已经在池子里**的对象，而对象根本没进去。
  token 只剩 `describeReferenceForAgent`（`chat-panel.tsx:421-430`）输出的那行文字，
  而**没有任何工具能读它**（`apply_skill` 只认 `UserSkill` + `DeAiSkill`，
  `lib/agent/tools/` 下也没有读文风/读灵魂的工具）。
- **反过来**：若照 `deAiSkillToUserSkill`（`de-ai-skill-library.ts:630-647`）把文风预设
  **适配成 `UserSkill`（`kind:["style"]`）**，则 (a) `collectExplicitSkills` 按 id 能匹配、
  (b) `isWritingSkill:224` 接受 `kind === "style"` 与 `drafting/output/rewrite` 阶段，
  所以它会**自动**进候选池并生效。
  ⚠️ **副作用**：它同时会成为 standard/strict 模式下的**自动兜底候选**
  （`selectPreferredNames:190-206`、`selectByShape:215-218`）——
  适配太多文风会让自动选中的技能变多，需实测确认不劣化。
  → 这正是 §2.2 选「引用式」而非「复制成 UserSkill」的**第二个技术理由**。
- **AI 大纲面板完全不同**：它从 token **从不解析技能**
  （`describeReferenceForOutlineAgent` `outline-chat-panel.tsx:566-592` 只打印元数据；
  技能来自向导/消息的 `skillNames`，`buildConfigForSkillNames` `:3316-3333`）。
  所以「在大纲面板里 `@` 一个技能」今天**根本不注入技能内容**——那是另一条待建通路。

### 1.10 独立选择器的先例（「单独新增一个选择功能」）

- `DeAiSkillPicker`（`de-ai-skill-picker.tsx:144-257`），挂在章节编辑器工具栏
  （`preview-panel.tsx:2102-2114`），按章记住选择
  （`setLastChapterDeAiSkill` `:1626`、状态 `chapterDeAiSkillId` `:287`、选项 hook `:537-541`）。
- 会话级开关：技能库里「参与 AI 会话」`unified-skill-library-view.tsx:522-543`
  → `disabledSkillIds` → `resolveEnabledWritingSkills`（`user-skill-store.ts:406-409`）
  → `use-agent-config.ts:62-64`。

---

## 2. 方案

### 2.1 统一可选面：一个「可选项」抽象 + 三类来源

不改三套存储，而是新增一层**投影**：把三类来源各自映射成同一个
「可选项」形状（沿用现有 `UnifiedSkillEntry` 的 `type` 字段扩展）：

- `type: "writing"` → `UserSkill`（现状）
- `type: "de-ai"` → `DeAiSkill`（现状）
- `type: "style"` → **引用式**指向 `WritingStylePreset`（见 §2.2）
- `type: "book-analysis"`（或按 §3 待确认的细分）→ 拆书库产出的 skill

要点：
1. 技能库加 tab 或分类 chips（`:36-40`）；徽章分支 `:363` 由二值改多值。
2. 引用弹窗加子 tab（`SKILL_SUBTABS`）与 provider 分支（两处注入点）。
3. **不要**为文风另建一套存储或转换器——`style` 类型是**引用**，本体仍在
   `.qmai/writing-style.json`。

### 2.2 文风库：**引用式**，不做复制

**决定（本设计做出，理由如下；用户未明确选择，若不同意可覆盖）**：
技能库里的文风条目是**指向 `WritingStylePreset` 的引用**，不是把文风文本拷成 `UserSkill`。

理由（都有实读依据）：
1. **复制会丢掉 fail-closed 守卫**：只有结构化画像（`styleFingerprint`）才有
   `【已启用文风画像】` 前缀，守卫也只认它（§1.3）。拷成纯文本后，
   「预算不足就停机」的保护对这份文风**永久失效**。
2. **复制会丢掉结构化注入**：`buildWritingStyleContext` 的价值在于
   按 task 检索原文片段 + `compileStyleFingerprint`（§1.2）；
   换成 `UserSkill.content` 后只剩一段静态文本，能力**下降**。
3. **双份真相**：预设会随「同一 `sourceBook` 的再次拆书」被 upsert 覆盖
   （去重键 `sourceBook`，`writing-style-store.ts:100`），复制件不会跟着变。
4. **复制路线技术上反而更省事——这正是它危险的地方。** 实测（§1.9）：
   照 `deAiSkillToUserSkill`（`de-ai-skill-library.ts:630-647`）写一个
   `writingStylePresetToUserSkill`（`kind:["style"]`），
   `collectExplicitSkills` **一行都不用改**就能按 id 匹配并生效。
   但副作用是它会**同时进入自动兜底候选池**
   （`selectPreferredNames:190-206`、`selectByShape:215-218`），
   于是「用户没点名文风」时也可能被自动选中，
   而且 `availableSkills` 被撑大还会影响 `resolveAvailableSkillsByNames` 的诊断（`:85-87`）。
   → 结论不变：**用引用式**。适配器路线留给「确实需要把文风当普通技能注入」的场景，
   并且必须显式排除在自动兜底之外。

### 2.3 「文风写作」选择器：每次生成临时覆盖

**目标**：生成时选一条文风，只影响这一次；项目级 `enabledStyleId` 不变。

**实现约束**：`context-engine.ts` 是守门文件**不能改**（§1.5），
所以不能给 `contextPackToPrompt` 加「排除/替换文风」的选项。

**方案（在下游替换，不改守门文件）**：
1. 在 `writing-style-store.ts`（非守门文件）新增一个**按 preset id 生成注入文本**的导出，
   内部复用 `buildWritingStyleContext` 的同一段拼装逻辑（抽出公共实现，避免两套文案）。
2. 在 `deep-chapter-generation.ts`（非守门文件）组装 `contextPrompt` 的那一处
   （**实测确认**：`:782` `deps.contextPackToPrompt(contextPack, restContextTokenBudget, { excludeOutline: true })`），
   当本次请求带文风覆盖时，**传一个浅拷贝**给 `contextPackToPrompt`：
   `{ ...contextPack, writingStyle: overrideText }`。
   - 用**浅拷贝**而不是改原对象：pack 可能来自 context-hub 缓存，
     原地改会污染缓存 → 后续不选文风的生成也会拿到被改过的文风。
   - 覆盖文本由**同一个渲染器**产出，所以它的守卫状态与「已启用」路径**逐条相同**
     —— 但这**不等于**「覆盖总带前缀」（本节原先的写法会让人读成这样，2026-10-11 订正）：
     `contextPackToPrompt` 的 fail-closed 守卫判的是**字面前缀** `【已启用文风画像】`，
     而该前缀**只在结构化画像分支**加（`profile.workbenchStyle.styleFingerprint` 存在时）。
     ⇒ **结构化画像**：覆盖与「已启用」都带前缀、都命中守卫（预算不够就停机）；
       **v1/旧画像**：两者都**不带**前缀 ⇒ 预算不够时**都静默消失**。
     即：覆盖**不会比**「已启用」路径更不安全，但也**不是**「覆盖一定受守卫保护」。
     ⚠️ **本批刻意不给旧画像补前缀**：那会把今天能静默截断并成功出稿的项目
     变成**硬停机**（用户可见的行为变更），需要单独评估存量项目。见实施计划 §2 的订正。
   - 「本次不用文风」= `writingStyle: ""`；此时不触发守卫（前缀不匹配），
     需**确认空 writingStyle 不会在提示词里留下一个空标题**
     （丁-2 已实测：`context-engine.ts` 的 `hasContent` 会跳过空字段 ⇒ 不留空标题）。
   - ❌ **原文此处要求「对 `writingStyle` 做 `includes` 检查，务必做」——该要求已被撤销
     （2026-10-11 订正），不要照做，原因有两条**：
     (i) **与归口裁决 (a) 互斥**：结构化画像**已经**被 `context-engine.ts:1132` 那条
       守卫兜住（再加一条是纯冗余）；而给旧画像加这条 `includes` 检查会
       让它在被裁时**无条件停机**，使**覆盖比「已启用」路径更严格** ——
       正是实施计划里明确**否定**的选项 (c)（「用户会遇到选了文风反而报错」）。
     (ii) 交付代码**没有**这条断言，且 丁-2 的独立审查判定「不补」是对的。
     ⇒ 正确落法：**结构化画像由既有守卫兜底；旧画像的静默丢弃是本批接受的不对称**
       （如实记录，不新造断言）。⚠️ 注意 `portablePersonalities` 那个先例**不能**
       直接类比：它的文本**总是**带前缀、总是受守卫，文风不是。
3. 参数如何传到这一层：沿用 `skillsPrompt` 那条已被验证的通路形状
   （`run-chapter-workflow.ts:138` 的 `options.getSelectedSkillsPrompt?.()` →
   `useAgentConfig` → `chat-panel.tsx:1084-1087`），
   但用**独立命名**的参数，**不要**塞进 `skillsPrompt`
   ——两者语义不同，混用会让「本次启用 Skill」段落出现文风文本。
   ⚠️ 名字以实施计划 §2「三态」那一节为准：**`writingStyleIdOverride?: string | null`**。
   这里原先举例的 `styleOverridePrompt` **装不下三态**（可选 `string` 只有「有/无」，
   无法表达「显式不用」的 `null`），已被 丁-2 实施改为前者（2026-10-11 订正）。
   ⚠️ 三态要在**每一个** hop 上原样透传，**不能**写 `?.() ?? undefined` /
   `|| undefined` —— 那会把 `null`（本次不用）抹成 `undefined`（用项目启用项），
   方向正好相反。

**必须实测的三件事**（写进实施计划）：
- 覆盖生效时不出现「两段文风并存」（项目级那条必须被替换掉，不是追加）。
- 代价：`buildStableContextPrefix` 里包含 `contextPrompt`，
  所以覆盖文本会进**稳定缓存前缀**。这**正确**（同一章的五个阶段共享同一份前缀，
  缓存仍命中），但跨章不可复用——与现状一致，不是新增成本。
- 「不用文风」时空 `writingStyle` 不产生空标题。

### 2.4 输入框引用（用户决定 1 的「都是可以使用的」）

- 引用弹窗加子 tab；provider 两处注入点补分支。
- 关键点：引用文风后，**必须走 §2.3 的覆盖通道**，否则「在输入框里点名文风」
  不会对这一次生成生效（今天点名文风在生成链上**没有任何消费者**）。
- 角色/故事 skill（用户决定 1 的第 1、3 条）的落点见 §3。

---

## 3. 待确认项（实施前必须先定，不留给实现者猜）

1. **拆书库到底产出哪些 skill 类型**，以及「角色 skill 作为这个人物的灵魂」
   是**已存在**还是**需要新建**。正在专门侦察；结论填在 §3.1。
2. **`style` 类型在生成链上的选中语义**：引用一条文风后，
   它应当**替换**项目启用文风，还是**叠加**？本设计按**替换**（用户决定 2 的
   「临时覆盖」字面含义）。若为叠加需另设计。
3. **技能库里的文风条目是否可编辑**：用户原话有「用户可以手动去编辑」这类诉求是针对
   事件细纲卡片的；文风预设的编辑能力本批**不新增**（只能选/用），
   除非 §3.1 的侦察显示已有编辑入口可复用。
4. **多选还是单选**：项目级 `enabledStyleId` 是单选（§1.1），
   临时覆盖沿用单选；输入框里同时引用两条文风时的行为需明确（建议后者覆盖前者 + 提示）。

### 3.1 拆书库 skill 与「角色灵魂」——**已侦察完毕，结论如下**

**结论：用户决定 1 的第 1 条「用某人的角色 skill 作为这个人物的灵魂」，
作为「能力」已经完整存在；缺的只是「输入框引用」这一半。**

#### 已存在的完整链路（全部实测）

1. 拆书产出**角色 Skill**：`CharacterSkill`（`book-analysis/types.ts:150-161`，
   含 `id/characterId/characterName/skillContent/sourceBook/chapterRange/filePath?/depth?/sixDimensionMeta?`），
   由 `skill-generator.ts:271-348` 生成，落 `<bookPath>/skills/<名>-skill.md`（`:323,:332`）。
2. 可发布进**自定义灵魂库**：`workbench-soul-actions.ts:39-43`
   → `workbench-publish.ts:117-141` → `character-aura.ts:426-473`，
   落 `.qmai/character-aura.json` + `.qmai/character-auras/<slug>-perspective/SKILL.md`。
3. **可以绑定到小说里的具体人物**——这就是用户说的「作为这个人物的灵魂」：
   `CharacterAuraBinding { characterName, auraId, aliases? }`（`character-aura.ts:69-74`）、
   `bindCharacterAura()`（`:505-520`，会拒绝不存在的 aura `:508` 与没有档案的人物 `:510-511`）、
   `bindCharacterToNovelCharacters()`（`workbench-soul-actions.ts:46-68`）。
   入口：拆书工作台卡片「绑定…」+ `BindingTargetDialog`
   （**导出自 `book-analysis-workbench.tsx:1045`**，使用 `:751-752`，确认处理 `:615-618`）、
   灵魂页「绑定小说人物」（`character-aura-view.tsx:964`）、
   灵魂侧栏（`soul-sidebar-panel.tsx:94`）。
4. 绑定结果**会注入生成**：`contextPack.characterAuras`（`context-engine.ts:311,:340`，
   优先级 10 在 `:51`），由 `buildCharacterSoulContext()`（`character-aura.ts:610-685`）
   按**姓名/别名/拼音**在任务文本里匹配（`:624-647`）。

⚠️ **订正一处先前侦察措辞**：不存在名为「灵魂卡 / 人物 skill」的独立产物——
「灵魂」在代码里就是 `CharacterAura`（类型名是 aura，但用户可见文案与拆书工作台都叫「灵魂」）。
另需区分：`character-aura.ts` 是**角色**灵魂；
`soul-doc.ts` / `project-soul-style-store.ts` 是**作品**灵魂（`contextPack.soulDoc`，优先级 5）——**不是一回事**。
`activeView` 里**有** `"soul"`（`wiki-store.ts:661`），但**没有** `style`/`story`。

#### 缺的那一半（丁的新增工作）

1. 引用弹窗**没有** `character`/`soul` 子类型，provider 也从不产出 aura ——
   `availableAgentSkills`（`chat-panel.tsx:1165-1171`）里没有 aura id，
   所以即使手工塞一条 token，`resolveSkillReference` 也匹配不到（见 §1.9）。
2. **绑定是持久的项目存储写入，不是「这一条消息」的行为**——
   今天没有任何办法表达「这条消息，把张三的灵魂当作李四用」。
   这属于**新建能力**，不是「暴露已有能力」。
3. 需要决定形态（**实施前必须再问用户，不要自行拍板**）：
   - (a) **不改存储**：选中的 aura 把其 `SKILL.md` 内容**内联**为本轮技能内容
     （便宜、无副作用，但不符合用户「作为这个人物的灵魂」的持久语义）；
   - (b) **执行绑定**：为这条消息里出现的人物名创建 `CharacterAuraBinding`
     （契合原话，但会写项目存储，属于有副作用的操作，必须有明确确认）。

#### 拆书库三类产物的现状（用户决定 1 第 3 条的「故事 skill」有真问题）

| 产物 | 存储 | 今天能从技能库/引用弹窗选吗 | 实际可达的入口 |
|---|---|---|---|
| 角色灵魂 `CharacterAura` | `.qmai/character-aura.json` | **否** | 灵魂页 / 灵魂侧栏 / 拆书工作台卡片 |
| 文风预设 `WritingStylePreset` | `.qmai/writing-style.json` | **否** | **只有全局启用/取消启用开关**，**根本没有预设列表 UI** |
| 故事框架 `PlotFramework` | `.qmai/plot-frameworks/library.json` | **否** | **只有**创建大纲对话框的下拉（`outline-editor.tsx:62-68`） |

⚠️ **「故事 skill」目前是断的**（实测）：拆书把 `PlotFramework` 发布到
`.qmai/plot-frameworks/library.json`（`workbench-publish.ts:233-246`），
但真正被注入的 `contextPack.storyFrameworkBinding` 读的是**另一个存储**——
`.qmai/simulations/frameworks/*.md`（`framework-store.ts:33,:46-50`）
+ 单一绑定 `.qmai/simulations/bindings/active-binding.json`（`framework-binding.ts:16`，
接线在 `context-data-sources.ts:516-527`）。
→ **发布出来的拆书故事 skill 今天无法被绑定、也无法被注入。**
所以「故事 skill 可以使用」这条**不是加个 tab 就能满足的**，需要先修这条存储/绑定断层。

#### 顺带发现的死代码（记录备查，**不在本批修**）

1. `book-analysis-library-layout.tsx:279-312` 的解构里**没有** `storyFrameworks`
   （由 `book-analysis-view.tsx:795` 传入）与 `onCreateOutlineFromFramework`（`:249`，传入在 `:826`）
   ——两处死管线。
2. `chat-panel.tsx:193` `const selectedSkillsPrompt = ""` 是死常量
   （活的通路是 `:1867` 的 `selectedSkillsPromptRef`）。

#### 本子批的处置——**已由用户拍板（2026-10-10）：三项全做**

用户选择了「**全部做：灵魂可真绑定 + 故事 skill 打通**」。所以丁的范围是：

| 子批 | 内容 | 形态 |
|---|---|---|
| 丁-1 | 统一可选面（技能库 / 去AI味 / 文风） | 新增 tab + 投影，**引用式**（§2.2） |
| 丁-2 | 「文风写作」选择器：每次生成临时覆盖 | 新增管线参数 + 下游浅拷贝替换（§2.3） |
| 丁-3 | 输入框引用（技能 / 文风） | 加子类型 + 两处 provider（§2.4） |
| 丁-4 | **角色灵魂 skill 引用 + 可真绑定** | 新建「按消息用某灵魂」的能力（有副作用，需确认交互） |
| 丁-5 | **故事 skill 打通** | 修 `plot-frameworks` 与 `simulations/frameworks` 的存储断层 |

⚠️ **丁-4 与丁-5 的必须前置结论**（见 §3.2 / §3.3，侦察后填入）：
- 丁-4 要定「内联 vs 真绑定」的交互形态——用户选了可真绑定，
  但**写项目存储必须有明确确认**，不能因为用户点了一下 `@` 就静默改绑定表。
- 丁-5 有一条**硬约束**：`context-engine.ts` 是守门文件**不能改**，
  所以**不能**通过「在上下文引擎里注册一个新的故事框架源」来打通。
  必须让拆书的发布结果**落到已经被注入的那个存储**，或走已有的注入字段。

---

### 3.2 丁-4：角色灵魂引用——**已侦察定稿**

#### ⚠️ 先订正一处**我先前写错的事实**

§1.3/§3.1 曾写「`buildCharacterSoulContext` 由 `context-data-sources.ts` 调用」——**错**。
实际调用点在 **`context-engine.ts:310-319`**（动态 `await import("./character-aura")`），
即**在守门文件内部**；结果赋值在 `:340`（`characterAuras`）与 `:341`（`portablePersonalities`）。
`context-data-sources.ts` **从不**引用 character-aura。
→ 结论方向不变（仍然不能改守门文件），但「接缝在哪」完全不同：见下。

#### 结论一：按消息注入灵魂**可以**做到，但**只能**走「真绑定」

- `characterAuras` **不是** data source，所以在 `context-data-sources.ts` 里加东西**没用**。
- ✅ **真实接缝是存储文件本身**：`buildCharacterSoulContext` 每次调用都**重新读盘**
  （`character-aura.ts:616` → `:304-315` 的 `loadCharacterAuraStore`，**无内存缓存**），
  所以只要在生成前写好 `.qmai/character-aura.json`，
  下一次 `buildContextPack` 就能看到——**不需要改守门文件，也不需要 UI 刷新**
  （`bindCharacterAura` 在 `:505`、`unbindCharacterAura` 在 `:522`，都是导出且 `writeFileAtomic` + await）。
- ❌ **「注入一个没有绑定行的 aura」在架构上不可能**：
  `buildCharacterSoulContext` 只过滤 `store.bindings`（`:616-617`、`:624`），
  连 `options.fallbackAuraId` 也过滤 `store.bindings`（`:648-650`）。
  没有任何参数、旁路存储或任务文本约定能触达未绑定的 aura。
- ✅ 因此**用户选的「真绑定」不仅是体验选择，还是唯一可行的实现路径**。
  若要「只对这一条消息生效」，做法是**生成前 bind、生成后 unbind**（用完清理）。

#### ✅ 已确认可用的下游第二接缝（不改守门文件）

浅拷贝替换 `contextPack.characterAuras` / `portablePersonalities`，
位置在 `deep-chapter-generation.ts`（非守门）组装 pack 之后、
喂给提示词之前。**生产先例就在仓库里**：`review-adapter.ts:250-254`
`contextPack = { ...baseContextPack, characterAuras: draftCharacterAuras }`。
参数通路照**已验证的** `skillsPrompt` 通道
（`deep-chapter-generation.ts:90` → `run-chapter-workflow.ts:138` →
`tools/index.ts:127` → `use-agent-config.ts:159` → `chat-panel.tsx:1084-1087`）。
⚠️ 但**走这条接缝就等于绕过绑定表**，与「真绑定」二选一，不要两套并存。
本设计**建议**：默认走真绑定（符合用户原话与「灵魂」语义），
浅拷贝接缝仅作为「临时预览」类需求的后备，且必须在文档里写明它绕过绑定表。

#### ⚠️ 结论二：本子批最大的风险是**把能跑的生成变成硬停机**

- `characterAuras` 是**优先级 10**（`context-engine.ts:51`），
  而 `portablePersonalities` 有 **fail-closed** 断言：
  `context-engine.ts:1129-1131` 在 `pack.characterAuras` 没完整进提示词时**抛错**；
  `deep-chapter-generation.ts:799-808` 另有 `renderBoundPersonalities` 的包含性断言与
  `PersonalityConstraintError`。
- **拆书产出的 aura 几乎都带 `portablePersonality`**。
  → 所以「按消息多绑一个灵魂」可能把一次本来正常的生成变成
  **「上下文预算不足，角色人格规则未完整保留」的硬停机**（预算偏小时）。
  **实施时必须**：要么在绑定前做预算检查并给出可读提示，
  要么明确接受并把这个失败模式写进文档与测试（不能让它变成一个无解释的报错）。
- **第二个风险：匹配是裸子串测试**（`character-aura.ts:624-647`）——
  「李四」会命中「李四光」；拼音包含同样会误命中。
  多绑一个灵魂会让它在**不该出现的章节**里泄漏进上下文。
  实施时必须说明如何避免（例如绑定要求用户明确确认适用章节范围）。

#### 其余已确认事实（实施时直接用）

- **存在性前置**：`bindCharacterAura` 要求该人物**已有档案**
  （`:510-511` + `hasCharacterProfile` `:733-747`，会查 `searchWiki` 的
  「人物小传/人物设定」），否则报
  「请先在大纲中添加人物小传或人物设定，再绑定角色灵魂」。
  ⚠️ 但**匹配器没有存在性检查**——手写的绑定行仍会被注入。
- **UI 反应性**：**没有** zustand 镜像绑定表。
  `soul-sidebar-panel.tsx:26` 的 `bindings` 是局部 `useState`，
  靠 `:31-39` 的 effect（deps `project?.path, dataVersion`）与
  `refreshProjectBindings()`（`:49-54`）刷新。
  → **UI 需要 `bumpDataVersion()`；生成路径什么都不需要**（每次都重读盘）。
- **现成的、与拆书无关的绑定入口**（可直接复用交互）：
  `soul-sidebar-panel.tsx:59`、`character-aura-view.tsx:393`、
  `book-analysis-result-viewer.tsx:198`、`workbench-soul-actions.ts:61`。
- `loadCharacterAuraStore`（`:304`）、`listCharacterAuras`（`:321`）、
  `getCharacterAuraBindings`（`:539`）、`loadCharacterAuraSkillDocument`（`:554`）均已导出。
  `saveCharacterAuraStore` **是私有的**（`:317`）——不要试图直接写文件绕过校验。

### 3.3 丁-5：故事 skill 打通——**已侦察定稿**

#### 结论：**可以**打通，且**首选路线不需要改任何注入代码**

- `contextPack.storyFrameworkBinding` 在 `context-engine.ts:342-344`（守门文件内），
  但它**只是 `rawData.storyFrameworkBinding` 的纯透传**；
  真正的值由 **`context-data-sources.ts:516-527`** 的 `storyFrameworkBindingDataSource` 产出
  （**非守门文件**）。
- ✅ **路线 A（首选）**：让拆书的发布**额外写进已经被注入的那个存储**——
  用**已导出**的 `saveFramework()`（`story-simulation/framework-store.ts:289-296`）
  写 `.qmai/simulations/frameworks/<id>.md`。
  **零新增注入代码**，且该目录已在缓存前缀里（`context-hub/source-paths.ts:82-85`）。
- ⚠️ **不要在发布时自动 `saveBinding()`**：`saveBinding` 会**无条件覆盖唯一的活跃绑定**
  （`framework-binding.ts:85-88`，单启用，像 `enabledStyleId`），
  等于劫持用户已有的仿真框架。**应让用户通过既有 UI 绑定**
  （`framework-binding-dialog.tsx:54-70`，入口在 `sidebar-panel.tsx:242`）。
- ❌ **路线 B（改 data source 去读 library.json）不推荐**：
  虽然 `context-data-sources.ts` 非守门文件、改起来合法，
  但 `.qmai/plot-frameworks/` **不在** `SOURCE_DEPENDENCY_PREFIXES`
  （`source-paths.ts:82-85`）里、会被归类为 `"other"`（`:33-57`），
  于是 `DataSourceCacheAdapter`（`data-source-cache.ts:56-71`、`:180-185`）
  会在 **AI 会话那条路径上发陈旧值**，直到某个无关的 `.qmai/simulations/` 文件变化才刷新。
  ⚠️ **写作路径不受影响**：`deep-chapter-generation.ts:2635` 走的是**裸 `buildContextPack`**
  （defaultDeps `:165-170`，且 `run-chapter-workflow.ts:167` 传 `deps = undefined`）
  → 无 loadAdapter → 无缓存。所以路线 B 只在 AI 会话面有问题——但那也是「打通」的一部分。

#### 转换是有损的——必须如实记录

两个结构**都是结构化 JSON，都不带 markdown**（markdown 只是 `framework-store` 的序列化产物）：

| `PlotFramework`（`plot-framework.ts:44-83`） | → | `StoryFramework`（`story-simulation/types.ts:259`） | 损失 |
|---|---|---|---|
| `beats.hook/buildup/payoff/endingHook` | → | `nodes[0..3]` 的 `起/承/转/合` | — |
| — | ← | `premise` | 需**新造** |
| `characters[{name,role}]` | → | `involvedCharacters[]` | **`role` 丢失** |
| `foreshadowing[]` | → | — | **整个丢失** |
| `line` / `tags` / `pacing` / `history` / `prev–nextConnector` | → | — | **全部丢失** |
| `createdAt: number` | → | `createdAt: string` | 需 ISO 转换 |
| — | ← | `targetWords` / `simulationMode` / `sourceChapters` | 需新造或由 `rangeChapterIds.length` 推 |

`simulationMode` 必须取自 `VALID_MODES`（`framework-store.ts:37-42`，默认 `"hybrid"`）。
⚠️ **不要手写 md 文件**：`framework-store` 的 `## 前提`/`## 故事节点` 解析较严
（`extractSection` `:122-139`、`parseNodeHeader` 要求含「节点」`:141-160`），
手写会静默产出 **0 个节点**。一定走 `saveFramework`。
→ 需要写一个 ~15 行的纯函数 `PlotFramework → StoryFramework` 转换器，并**单测其有损性**。

#### 必须同时覆盖**两个**发布方，否则只做一半

1. `workbench-publish.ts:233-246`（`upsertPlotFramework` 是那里**唯一**的写入）。
2. ⚠️ `story-analysis-adapter.ts:265-292`（`story-analysis-adapter.ts:69` 注入的 `upsertFramework`）
   ——旧提取路径，同样要桥接，否则从那条路来的故事 skill 仍然不可用。

#### 顺带确认的两处「其实没人用」

- **`formatPlotFrameworkForOutlinePrompt`（`plot-framework.ts:307`）生产代码零调用方**
  （只有 `plot-framework.spec.ts:253-255`）。这是现成的、写好的格式化器却没人用——
  丁-5 若选「注入到章纲层」正好可以让它复活。
- `DeepChapterGenerationInput.dismantlingReferenceDirective`（`:83`，用于 `:785`）
  **无生产调用方**，且它在 `buildStableContextPrefix`（`:793`）**之前**，
  用它装故事文本会**破坏按章缓存前缀**——不要用。

#### ⚠️ 一个内容质量隐患（与「能不能用」同等重要）

拆书故事维度的标签**是提示词要求但未做校验**：
`workbench-adapter.ts:36` 告诉模型用「目标与阻力/信息投放/冲突升级/转折条件/兑现/后续悬念」，
但 `parseWorkbenchItem` 只对 `characters` 强制 `PERSONALITY_FIELDS`
（`workbench-core.ts:153`）；story 的 `dimension` 是**自由文本**（`:152`）。
若模型跑偏，`pick()`（`workbench-publish.ts:235`）**匹配不到任何标签**，
于是**四个 beat 全部退化成同一句**
「本次没有充分依据，不固定该环节；由目标故事实际情境决定。」——
**结构合法、内容为空**，还能通过 `normalizeBeats`（`plot-framework.ts:217`）。
→ 丁-5 打通之后，用户可能绑定到这样一个「空框架」。
实施时应在发布或绑定时**检测并提示**这种退化（四个 beat 相同 / 全为 fallback 句子）。

#### ⚠️ 需要向用户澄清的一处范围差异

本批给实现者的硬边界写的是 **`src/lib/context-hub/**` 全部只读**，
而本分支设计文档 §4 与三项守门检查实际只钉 **`src/lib/context-hub/composer.ts`** 一个文件。
→ 差异有实质影响：按**严格**读法，`source-paths.ts` 与 `data-source-cache.ts` 不可改，
这正是路线 B 会发陈旧值的原因、也是路线 A 更优的原因。
本设计**按严格读法执行**（不动 `context-hub/` 任何文件），
因此丁-5 **必须走路线 A**。若用户希望走路线 B，需要先明确放宽该边界。

---

## 4. 硬边界（不可违背）

- **不改守门文件**：`src/lib/novel/context-engine.ts`、
  `src/lib/novel/outline-context-index.ts`、`src/lib/context-hub/composer.ts`、
  `src/lib/novel/chapter-outline-template.ts`。
  （因此 §1.6 的 `readWritingStyle` 死代码也**不清理**。）
- 不改 `src/lib/llm-client.ts`、`src/lib/reasoning-retry.ts`。
- 不改 `.qmai/writing-style.json` 的落盘格式（不新增 per-style 字段，
  除非实施时证明必须——那时要先说明兼容旧文件的方式）。
- 不改 `skills/de-ai-writing/**`。
- 不引用 `WelcomeScreen`（`ui-test-isolation.spec.ts:7` 反向守卫，文件已删除）。

---

## 5. 测试策略（要点）

- **必须保持绿**：`writing-style-store.spec.ts`（361 行，含注入顺序、DNA、删除族、
  `:326-336` 删启用项必须清 `enabledStyleId`）、
  `context-engine.spec.ts:41-47`（fail-closed 文风断言）、
  `deep-chapter-generation.spec.ts:1389-1396`（「injects the enabled writing style into
  the stage 3 draft prompt」）、`select-skills-plugin.spec.ts`（含 fast 为空）、
  `unified-skill-library-view.spec.tsx`（按文案点击，不计数）、
  `ReferencePickerDialog.spec.tsx`（上限 10、搜索、displayTitle 优先）。
- **新增**：
  - 临时覆盖生效且项目设置**未被写盘**（读回 `enabledStyleId` 必须不变）。
  - 覆盖时**不出现两段文风并存**。
  - 「不用文风」不产生空标题。
  - 引用弹窗里新子类型可选中、且选中的文风确实进了本次生成的提示词。
  - 技能库新条目的展示与分类。
- ⚠️ 注意 `writing-style-store.spec.ts:79-101`：结构化画像**所有维度都注入且不被
  旧字数预算截断**——若为覆盖通道改动了预算相关逻辑，这条会红，那是**真回归**，不要改断言。

---

## 6. 与甲/丙的边界

- 甲（已完成）改了 `de-ai-generation-rules.ts` 并在 `deep-chapter-prompts.ts` 的
  draft/expansion/revision 注入；丁若也要往正文提示词加东西，
  **必须同样排在 `buildStableContextPrefix` 之后**（缓存前缀不变式，
  `deep-chapter-prompts.cache.spec.ts` 钉着），并用 `asOwnParagraph()` 造段
  （`filter(Boolean)` 会吞掉 `""` 占位符——甲在复核阶段踩过这个坑）。
- 丙（进行中）改了 `preview-panel.tsx` 的工具栏 actions 数组
  （加「生成章节细纲」按钮）与 `outline-chat-panel.tsx`。
  丁的独立选择器若也落在 `preview-panel.tsx` 附近（先例 `:2102-2114`），
  **必须在丙合并之后再改**，且不要动丙加的那枚按钮。
- 丙的「按消息 id 的 override」与丁的「本次生成临时覆盖」是**两个不同层面**的
  override（前者是消息级数据，后者是请求级参数），不要合并成一个抽象。
