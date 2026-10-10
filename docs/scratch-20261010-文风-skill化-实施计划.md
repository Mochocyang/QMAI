# work/scratch-20261010 第五批（丁）实施计划：文风 skill 化 + 统一可选技能面

> 设计依据：《`docs/scratch-20261010-文风-skill化-设计.md`》——**先读它**，本文只讲怎么落地。
> 用户原话见《`docs/scratch-20261010-文风与拆书库-设计.md`》§6「丁 · 文风 skill 化」
> 及其下的「丁 · 用户已确认的两个决定」。
>
> **用户 2026-10-10 追加的范围决定**：三项全做——统一可选面（技能/文风/拆书库 skill）、
> 角色灵魂**可真绑定**、故事 skill **打通**。见 §4。
>
> **子批顺序**：丁-1 → 丁-2 → 丁-3 → 丁-4 → 丁-5。
> 丁-1/2/3 是文风主线（能力已完整、只缺选择面），风险最低，先做；
> 丁-4/5 要新建能力与修存储断层，放最后。

---

## 0. 前置条件

- **丙批必须先合并**：丙改了 `preview-panel.tsx` 的工具栏 actions 数组与
  `outline-chat-panel.tsx`。丁的独立选择器先例（`preview-panel.tsx:2102-2114`）
  与丙的位置接近，顺序做可避免互相踩。
- 甲的成果**不得回退**：`de-ai-generation-rules.ts` 与它在
  `deep-chapter-prompts.ts` 的注入点、`asOwnParagraph()`、以及缓存前缀不变式。
- 基线：丙完成后按实测填写（甲完成时是 724 文件 / 7124 用例 / 6 todo / 0 失败）。
- 硬边界见设计 §4（尤其：**`context-engine.ts` 是守门文件不能改**）。

---

## 1. 子批丁-1：文风库（引用式）

**目标**：技能库里能看到并选中项目里的文风预设，且条目是**引用**，不是复制。

### 步骤

1. **`src/components/skill-library/unified-skill-library-view.tsx`**
   - tab 数组 `:36-40` 加「文风」；`GalleryTab` 联合类型 `:43` 同步。
   - `UnifiedSkillEntry.type`（`:50`）扩展 `"style"`。
   - 卡片徽章 `:363`（现在是二值分支 `entry.type === "writing" ? "写作" : "去AI味"`）
     改为多值映射，**必须**为 `"style"` 给出「文风」。
   - 新增 `writingStylePresetToEntry(preset)` 映射（照 `writingSkillToEntry:72-83`
     与 `deAiSkillToEntry:59-70` 的形状），字段取自
     `WritingStylePreset { id, name, sourceBook, profile, sourceBookId?, evidenceIds?, createdAt, updatedAt }`
     （`writing-style-store.ts:21-30`）——**没有** tags/kind/priority，不要假装有。
     ⚠️ **已实测的坑：`WritingStyleStore` 接口本身没有 `export`**
     （`:32` 是 `interface WritingStyleStore`，而 `loadWritingStyleStore` 的返回类型写了它）。
     所以**引用不到这个类型名**。两种做法选一，说明选了哪种：
     (i) 用 `Awaited<ReturnType<typeof loadWritingStyleStore>>` 推导；
     (ii) 给它加 `export`（改动更小更可读，但要确认没别的同名冲突）。
     相关既有导出（`:65`/`:88`/`:129`/`:167`/`:176`/`:180`/`:238`）：
     `loadWritingStyleStore`、`upsertWritingStylePreset`、`setEnabledWritingStyle`、
     `removeWritingStylePreset`、`removeWritingStylePresetBySourceBook`、
     `getEnabledWritingStyle`、`buildWritingStyleContext`。
     store 形状是 `{ version: 1, enabledStyleId: string | null, styles: WritingStylePreset[] }`
     （`:32-36`）——**`enabledStyleId` 可用于在条目上标出「当前启用」**，
     但 ⚠️ 本批**不要**让技能库的选中动作去写它（用户决定 2：项目设置不得被改）。
   - 载入：`SkillGallery` 现在同时加载两库（`:409-427`），补
     `loadWritingStyleStore(projectPath)`。
   - 分类 chips（`:442-453`，现在只在 writing tab 生成）：按需扩展；
     `UnifiedSkillCategory`（`:45`）里 `"de-ai" | "writing"` 两个成员**实际未被使用**，
     实施时先确认再决定是否复用。
   - 动作区 `SkillLibraryActions`（`:160-309`）现在是按 activeTab 二分支，补文风分支。
2. **不要**为文风加编辑/改名/导出：设计 §3 待确认项 3 已明确本批不新增编辑能力。
   若侦察显示已有可复用入口，再议。
3. **i18n**：技能库 UI 文案现状是**硬编码中文**（`unified-skill-library-view.tsx` 多处），
   本批按现状写中文即可；但**新文案若走 i18n**，命名空间先例是
   `nav.*` / `novel.nav.*` / `novel.contextPack.*`。
   注意 `src/lib/hardcoded-ui-chinese-i18n.test.ts` 的既有约束。

### 必须保持绿

- `unified-skill-library-view.spec.tsx`：按**文案**点击（不计数 tab），
  含动作按钮文案断言 `:161` `["新建技能","导入"]` / `:171` `["新建 Skill","导入"]`。
  **加 tab 不该破坏它**；若破坏了，先查是不是文案撞车。
- `icon-sidebar.test.tsx:51-53`、`sidebar-nav-preferences.spec.ts:68-70`
  （`writingSkillLibrary` 不得出现在侧边栏 / 默认导航顺序）。
- `writing-style-store.spec.ts` 全部（尤其 `:79-101` 结构化画像不被截断）。

### 新增测试

- 文风预设出现在技能库条目里，类型徽章为「文风」。
- 空文风库时的空态。
- 条目是引用：**选中它不写 `writing-skills.json`**（证据链清晰）。

---

## 2. 子批丁-2：「文风写作」选择器（每次生成临时覆盖）

**目标**：生成时选一条文风，只影响这一次；项目级 `enabledStyleId` **不被写盘**。

### 步骤（顺序不能颠倒：先打通参数，再做 UI）

1. **抽公共拼装逻辑**（`src/lib/novel/writing-style-store.ts`，非守门文件）：
   `buildWritingStyleContext(projectPath, { task })`（`:238`）内部先取
   `getEnabledWritingStyle`（`:242-243`）。抽出「由 preset → 注入文本」的公共函数，
   新增按 **preset id** 生成注入文本的导出。
   ⚠️ **抽出后 `buildWritingStyleContext` 的行为必须逐字节不变**——
   `writing-style-store.spec.ts` 有 361 行断言（注入顺序、`【已启用文风画像】` 前缀、
   DNA 降级、预算截断）。这是**重构而非改行为**，测试应当全绿通过。

   #### 已实测确认：这个重构是**必须**的，不是可选的
   - **全仓只有一个渲染器，且只认「已启用」那条**：
     `buildWritingStyleContext(projectPath, options)`（`writing-style-store.ts:238`）
     → `getEnabledWritingStyle(projectPath)`（`:242-243`）。
     它的导出清单里**没有**任何「按 preset 渲染」的函数
     （`:65`/`:88`/`:129`/`:167`/`:176`/`:180`/`:238`，逐一核过）。
     底层原语 `compileStyleFingerprint`（`book-analysis/style-fingerprint.ts:110`）
     只渲染**结构化画像**，不含 `constitution`/`integratedDna`/样本的完整拼装，
     单独拿它拼不出等价文本。
   - **消费链只有两处**：`context-data-sources.ts:382`
     （`buildWritingStyleContext(context.projectPath, { task: context.task })`
     ——这就是填 `pack.writingStyle` 的地方）与 `context-engine.ts:835`
     （动态 import 的兜底路径）。
   - ⇒ 所以「选一条**不是**当前启用的文风」**今天做不到**，
     必须新增一个接受 `preset`（或 preset id）的渲染入口。
     ⚠️ **禁止**用 `setEnabledWritingStyle` 临时改项目设置来「实现」它——
     用户决定 2 明确要求项目设置不得被改，而且那会写盘、并发下还会互相踩。

   #### ⚠️ 覆盖文本**必须复用同一个渲染器**（否则 fail-closed 守卫静默失效）
   `contextPackToPrompt` 的文风守卫（`context-engine.ts:1132-1134`）判的是
   **字面前缀**：`pack.writingStyle?.startsWith("【已启用文风画像】")`。
   - 若覆盖文本由**同一个**渲染器产出，它会带上同一个 `【已启用文风画像】` 前缀
     → 守卫自动生效（覆盖被裁掉时**停机报错**，符合「用户明确选了就不能悄悄丢」）。
   - 若为覆盖另写一套拼装、少了这个前缀 → `startsWith` 为假 → **守卫完全不触发**，
     用户选的文风可能被静默裁掉而毫无提示。
   - ⚠️ 前缀文案里的「已启用」对「本次临时覆盖」语义上已不准确，
     但 `context-engine.ts` 是**守门文件不能改**，所以**不要**去改这个字面量，
     也不要为覆盖另造前缀。**照用同一个前缀**，并在代码注释里写明这是为了接上守卫。
   - 建议加一条测试：覆盖生效时最终提示词里含 `【已启用文风画像】`（钉住守卫仍生效）。
2. **打通参数**（`src/lib/novel/deep-chapter-generation.ts`，非守门文件）：
   - `DeepChapterGenerationInput`（`:90`）加一个**独立命名**的可选参数
     （如 `styleOverridePrompt?: string`）。**不要**塞进 `skillsPrompt`。
   - 组装 `contextPrompt` 处（`:782` 的
     `deps.contextPackToPrompt(contextPack, restContextTokenBudget, { excludeOutline: true })`）：
     当覆盖存在时，给 `contextPackToPrompt` 传**浅拷贝**
     `{ ...contextPack, writingStyle: override }`。
     **不要原地改 `contextPack`**——它可能来自 context-hub 缓存，原地改会污染缓存。
   - 「本次不用文风」= `writingStyle: ""`。
3. **接到工具层**：照 `skillsPrompt` 的**「getter 注入」**通路形状
   （**已实测确认为一条完整链**，不是参数一路透传）：
   - 产出（pull 模型）：`chat-panel.tsx:1084` 的 `getSelectedSkillsPrompt` 回调
     → `:1095` 传给 `useAgentConfig(agentSystemPrompt, undefined, getSelectedSkillsPrompt)`
     → `use-agent-config.ts:27`（形参）/`:159`（转交 tools）/`:189`（依赖）
     → `tools/index.ts:67`（选项类型）/`:127`（转发）
     → `run-chapter-workflow.ts:34`（选项）/`:138` 调 `options.getSelectedSkillsPrompt?.()`
     → `:147` 作为 `skillsPrompt` 进 `DeepChapterGenerationInput`
     → 消费点 `deep-chapter-generation.ts:830`/`:909`/`:1026`/`:1378`。
   - **独立命名**，不要与 skills 混用。
   - ⚠️ **为什么用 getter 而不是工具参数**：`run-chapter-workflow.ts:33-34` 的注释写明
     「不作为工具参数，避免模型漏传」——即这条通道是**应用侧兜底**，
     不依赖模型在工具调用里带上它。新通道照抄这个语义。

   #### ⚠️ 跨批整合要求（**必须处理，否则最主流的路径不生效**）

   **丙-2b 会新增第二个 `runDeepChapterGeneration` 直接调用方**（章节区「确认细纲 →
   就地生成正文」，见《`docs/scratch-20261010-事件细纲流程-实施计划.md`》§2 步骤 5）。
   那条调用**不在上面的 getter 链上**（它不经 agent 回合、不经 `useAgentConfig`）。

   → 丁-2 必须**同时**覆盖两个调用方：
   - 对话/写作助手路径：走上面的 getter 链；
   - **章节区直接调用路径**：在构造 `DeepChapterGenerationInput` 时**直接**把覆盖文本塞进去。
   → 否则「在章节区选了文风 → 在章节区生成正文」这条**最符合用户原话
   （『在生成功能中新增文风写作选择』）的路径不生效**，而对话路径却生效，
   会变成最难排查的那种「一半有用」的 bug。

   **裁决（避免实现者两头猜）**：**优先用参数**（`DeepChapterGenerationInput` 上的独立可选字段），
   两个调用方各自传值。**不要**让 `runDeepChapterGeneration` 自己去读一个全局
   transient store —— 虽然它已经在 `:529` 读 `novelConfig`，但
   「本次生成临时覆盖」是一次性语义，放进全局 store 极易**泄漏到下一次生成**
   （用户下次没选文风却仍被套上上次的），且难以测试。
   若确实要放 store，必须做成**一次性消费**（照
   `consumePendingReferenceTokens`（`chat-store.ts:429-433`）的「读+清」先例）并写单测。
4. **UI**：复用 `DeAiSkillPicker` 的形状（`de-ai-skill-picker.tsx:144-257`），
   在章节编辑器工具栏（先例 `preview-panel.tsx:2102-2114`）加一个「文风写作」选择器。
   - ⚠️ **不要动丙加的那枚「生成章节细纲」按钮**，也不要碰 `:174` 钉住的
     `openBodyFontPopover` 调用次数（恰好 2）。
   - 是否按章记住选择：照 `setLastChapterDeAiSkill`（`:1626`）的先例，
     但**项目设置不得被改**（用户决定 2）。

### 必须实测的三件事（缺一不可）

1. **覆盖生效且不并存**：选了 A 文风、项目启用的是 B 时，
   最终提示词里**只有 A**，不出现 A+B 两段文风。
2. **项目设置未被写盘**：生成后读回 `.qmai/writing-style.json`，
   `enabledStyleId` 必须仍是原值（用「读回验证」或断言 `saveWritingStyleStore`
   未被调用，二选一，说明选了哪种）。
3. **「不用文风」不产生空标题**：`writingStyle: ""` 时提示词里
   不出现空的「写作风格」段落。**实测确认**——
   `contextPackToPrompt` 走 `FIELD_CONFIGS`（`context-engine.ts:1073-1097`），
   空内容的字段是否仍输出标题必须实读代码或加断言确认。

### 必须保持绿

- `deep-chapter-generation.spec.ts:1389-1396`（「injects the enabled writing style into
  the stage 3 draft prompt」）、`:51`（pack 里的 `writingStyle` 夹具）。
- `context-engine.spec.ts:41-47`（fail-closed 文风断言）——**绝不能改**。
- `select-skills-plugin.spec.ts` 全部（含 fast 返回空）。
- `deep-chapter-prompts.cache.spec.ts`（缓存前缀不变式）。

### ⚠️ 已知风险（必须在报告里回答）

设计 §1.3：文风的 fail-closed 守卫**只覆盖 `contextPackToPrompt` 这一条路径**。
本批的临时覆盖走的就是这条路，所以**覆盖是受保护的**；
但项目级文风在 AI 会话的另两条路径
（`trim-context-plugin.ts:47-60`、context-hub `composer.ts:65`）上仍会被静默丢弃——
**那是既有缺陷，不在本批修**，但要在文档里如实写明，不要声称「文风不会被丢了」。

---

## 3. 子批丁-3：输入框引用（用户决定 1 的「都是可以使用的」）

### 步骤

1. `src/lib/reference/types.ts:3` `SkillSubtype` 加新成员（如 `"style"`）。
   （**注意**是 `src/lib/**reference**/types.ts`，不是 `src/components/reference/`；
   `ReferenceToken.skillSubtype` 在 `:23`。）
2. `ReferencePickerDialog.tsx:12-15` `SKILL_SUBTABS` 加对应子 tab；
   过滤逻辑 `:105` 不需改（按 `skillSubtype` 相等过滤，天然支持新值）。
3. Provider 注入点**两处都要改**：`chat-panel.tsx:1178-1196`、
   `outline-chat-panel.tsx:2269-2287`（**行号会随丙批改动而漂移，以内容为准**）。
   ⚠️ **实际形状与「硬编码 subtype 字段」不同，别找错地方**：
   `createSkillProvider(getSkills)`（`src/lib/reference/providers.ts:273`）只在
   `:284` 把 `skill.subtype` 透传成 `skillSubtype`；
   真正的 `"deai"`/`"writing"` 是在**两个调用点各自的 getter 内部**拼数组时写死的
   （`chat-panel.tsx:1183`/`:1190`、`outline-chat-panel.tsx:2274`/`:2281`）。
   所以做法是**在这两个 getter 里再加一组**文风条目，而不是改 provider。
   全仓生产代码里出现 `skillSubtype` 的只有 3 处
   （`providers.ts:284`、`ReferencePickerDialog.tsx:105`、`types.ts:23`）——
   可用这条 `git grep` 复核有没有第三处遗漏。
4. **关键**：引用了文风后，**必须走 §2 的覆盖通道**才会对本次生成生效。
   今天「在输入框里点名文风」在生成链上**没有任何消费者**——
   所以这条不做，用户决定 1 就是空的。
   实施时先在 `collectExplicitSkills`（`skill-route-registry.ts:288-313`）
   与 `select-skills-plugin.ts` 确认引用 token 如何流到
   `DeepChapterGenerationInput`，再决定在哪里转成 `styleOverridePrompt`。

### 必须保持绿

- `ReferencePickerDialog.spec.tsx`（上限 10、搜索、`displayTitle` 优先；
  **没有**断言 `SKILL_SUBTABS` 数量）。
- `chat-panel.spec.tsx:18`（chat-panel **不**含 `DeAiSkillPicker`）、
  `:146/:276/:278/:302`（源码断言含 `getSelectedSkillsPrompt` 等）。
- `select-skills-plugin.spec.ts`。

---

## 4. 子批丁-4 / 丁-5：拆书库 skill（**用户已拍板：三项全做**）

> 用户 2026-10-10 选择「**全部做：灵魂可真绑定 + 故事 skill 打通**」。
> 设计 §3.1 已确认：「用某人的角色 skill 作为这个人物的灵魂」**作为能力已完整存在**
> （拆书 → `CharacterSkill` → `CharacterAura` → `bindCharacterAura` 绑定到小说人物
> → `contextPack.characterAuras` 注入），缺的只是**输入框引用**这一半。
> 而「故事 skill」**是断的**（拆书发布到 `.qmai/plot-frameworks/library.json`，
> 但被注入的 `storyFrameworkBinding` 读 `.qmai/simulations/frameworks/*.md`）。

### 4.0 ⚠️ 两条子批共有的硬约束

**`context-engine.ts` 是守门文件，不能改。** 所以：
- **不能**「在上下文引擎里注册一个新的故事框架源」来打通故事 skill；
- **不能**「给 `buildCharacterSoulContext` 加一个按消息传参的入口」
  （它由 `context-data-sources.ts` 调用，而 pack 的组装在守门文件里）。

→ 两条路都必须在**别的**注入通道上解决。设计 §3.2 / §3.3 的专项侦察结论填入后
再落笔；**不要**为了绕开这个约束去偷偷改守门文件。

### 4.1 丁-4：角色灵魂引用（**侦察已定稿，按此实施，不要重新设计**）

**核心结论**：可按消息使用灵魂，但**只能**通过**真绑定**实现——
「注入一个没有绑定行的 aura」在架构上不可能
（`buildCharacterSoulContext` 只过滤 `store.bindings`，`character-aura.ts:616-617`、`:624`，
连 `fallbackAuraId` 也过滤它 `:648-650`）。

但**真绑定不意味着必须改守门文件**：
`buildCharacterSoulContext` 每次调用都**重新读盘**（`:616` → `:304-315`，**无内存缓存**），
所以**接缝就是存储文件** `.qmai/character-aura.json`。

#### 步骤

1. **可选面投影**：把 `CharacterAura` 投影成统一可选项（与 §1 的 `style` 同构）。
   来源：`listCharacterAuras(projectPath)`（`character-aura.ts:321`，已导出）。
   技能库里新增「灵魂/角色」分类，徽章文案给「角色灵魂」。
2. **引用弹窗**：加 `character`（或 `soul`）子类型到
   `src/lib/reference/types.ts:3` 的 `SkillSubtype` + `ReferencePickerDialog.tsx:12-15`
   的 `SKILL_SUBTABS`；两处 provider 注入点
   （`chat-panel.tsx:1178`、`outline-chat-panel.tsx:2258`）补新类型。
   ⚠️ **实施前先确认丙-2/丙-4 是否已改 `outline-chat-panel.tsx`**，避免并发改同一文件。
3. **真绑定的交互**（本子批的重点，**必须有明确确认**）：
   - 用户点 `@某人灵魂` 后，**不要**静默写盘。给出确认步骤，
     让用户指定「把这条灵魂绑给哪个小说人物」。
   - **可直接复用现成交互**：`BindingTargetDialog`
     （**导出自 `book-analysis-workbench.tsx:1045`**，用法见 `:751-752`、确认处理 `:615-618`），
     或照 `soul-sidebar-panel.tsx:59` / `character-aura-view.tsx:393` 的调用形状。
   - 写盘用 `bindCharacterAura(projectPath, { characterName, auraId, aliases? })`
     （`character-aura.ts:505`，**已导出、`writeFileAtomic` + await**）。
   - ⚠️ **不要**试图直接写 `.qmai/character-aura.json`：
     `saveCharacterAuraStore` 是**私有的**（`:317`），绕过它就会绕过 aura 存在性校验。
   - ⚠️ **存在性前置**：`bindCharacterAura` 要求该人物**已有档案**
     （`:510-511` + `hasCharacterProfile` `:733-747`，会查 `searchWiki` 的
     「人物小传/人物设定」），否则报
     「请先在大纲中添加人物小传或人物设定，再绑定角色灵魂」。
     **这个报错必须原样呈现给用户**，不要吞掉——它是可操作的指引。
4. **「只对这一条消息生效」**：生成前 `bindCharacterAura`，生成后
   `unbindCharacterAura(projectPath, characterName, auraId)`（`:522`）清理。
   ⚠️ 清理必须放在 `finally` 里，否则生成失败会把临时绑定**永久留在项目里**。
   ⚠️ 若用户本来就有这条绑定，清理会**误删用户的原有绑定**——
   实施前必须先读原绑定、只在「原本没有」时才解绑，并写单测覆盖这个分支。
5. **UI 刷新**：绑定后**没有** zustand 镜像，需要 `bumpDataVersion()`
   （先例 `soul-sidebar-panel.tsx:49-54`、`:59-61`）。
   **生成路径不需要任何刷新**（每次都重读盘）。
6. **⚠️ 必须处理的最大风险：fail-closed 硬停机**。
   `characterAuras` 优先级 10（`context-engine.ts:51`），
   而 `portablePersonalities` 有 fail-closed 断言：
   `context-engine.ts:1129-1131` 在未完整进入提示词时**抛错**；
   `deep-chapter-generation.ts:799-808` 另有包含性断言与 `PersonalityConstraintError`。
   **拆书 aura 几乎都带 `portablePersonality`** →
   「多绑一个灵魂」可能把一次本来正常的生成变成
   「上下文预算不足，角色人格规则未完整保留」的硬停机。
   **必须二选一并在报告里说明选了哪个**：
   - (甲) 绑定前做预算检查，超预算时**提前**给可读提示（推荐）；
   - (乙) 接受该失败模式，但**必须有测试**钉住它会抛出那条可读错误
     （不能让它变成一个无解释的报错）。
7. **⚠️ 第二个风险：子串误匹配**。
   匹配是裸子串/拼音包含（`character-aura.ts:624-647`），
   「李四」会命中「李四光」，多绑会让灵魂泄漏到**不该出现的章节**。
   **必须在报告里说明如何缓解**（例如确认交互里显示"该灵魂会在提到『李四』的章节生效"，
   让用户知道影响范围）。

### 4.2 丁-5：故事 skill 打通（**侦察已定稿：走路线 A**）

**路线 A（首选）**：让拆书的发布**额外写进已经被注入的那个存储**。
- `contextPack.storyFrameworkBinding` 在 `context-engine.ts:342-344`（守门文件内），
  但**只是纯透传**；真正的值由 `context-data-sources.ts:516-527` 产出（非守门文件）。
- 用**已导出**的 `saveFramework(projectPath, storyFramework)`
  （`story-simulation/framework-store.ts:289-296`）写
  `.qmai/simulations/frameworks/<id>.md`。**零新增注入代码**，
  且该目录已在缓存前缀里（`context-hub/source-paths.ts:82-85`）。

#### 步骤

1. **写转换器**（新纯函数，~15 行 + 单测）：
   `PlotFramework`（`plot-framework.ts:44-83`）→ `StoryFramework`
   （`story-simulation/types.ts:259`）。映射：
   - `beats.hook/buildup/payoff/endingHook` → `nodes[0..3]` 的 `起/承/转/合`；
   - `characters[{name,role}]` → `involvedCharacters[]`（**`role` 会丢**）；
   - `createdAt: number` → ISO **string**；
   - `simulationMode` 必须取自 `VALID_MODES`（`framework-store.ts:37-42`，默认 `"hybrid"`）；
   - `premise` / `targetWords` / `sourceChapters` 需新造或由 `rangeChapterIds.length` 推。
   **必须单测「有损字段」**（`foreshadowing` / `line` / `tags` / `pacing` / `history` /
   `prev–nextConnector` 全部丢弃），使损失是**已知且被钉住的**，而不是悄悄发生。
   ⚠️ **不要手写 md 文件**：`framework-store` 的解析较严
   （`extractSection` `:122-139`、`parseNodeHeader` 要求含「节点」`:141-160`），
   手写会**静默产出 0 个节点**。一定走 `saveFramework`。
2. **在两个发布方都加桥接**（否则只做一半）：
   - `workbench-publish.ts:245`（在 `upsertPlotFramework` 旁边）；
   - ⚠️ `story-analysis-adapter.ts:265-292`（旧提取路径，同样要桥）。
3. ⚠️ **不要在发布时自动 `saveBinding()`**：它会**无条件覆盖唯一的活跃绑定**
   （`framework-binding.ts:85-88`，单启用），等于劫持用户已有的仿真框架。
   **让用户通过既有 UI 绑定**（`framework-binding-dialog.tsx:54-70`，
   入口在 `sidebar-panel.tsx:242`）。
4. ⚠️ **不要走路线 B**（改 `context-data-sources.ts:519-526` 去读 `library.json`）：
   `.qmai/plot-frameworks/` **不在** `SOURCE_DEPENDENCY_PREFIXES`
   （`source-paths.ts:82-85`）、会被归类为 `"other"`（`:33-57`），
   于是 `DataSourceCacheAdapter`（`data-source-cache.ts:56-71`、`:180-185`）
   会在 **AI 会话那条路径上发陈旧值**；修它要改 `source-paths.ts`。
   本批硬边界按**严格读法**（不动 `context-hub/` 任何文件），所以必须走路线 A。
   （写作路径本身不受影响：`deep-chapter-generation.ts:2635` 走裸 `buildContextPack`。）
5. **可选（低成本高价值）**：`formatPlotFrameworkForOutlinePrompt`
   （`plot-framework.ts:307`）**生产代码零调用方**（只有 spec）。
   若还想在**章纲层**让故事 skill 生效，接它到
   `outline-chat-panel.tsx` 的系统提示词与技能装配
   （`buildConfigForSkillNames:3316-3333`）即可。
6. **⚠️ 内容质量隐患必须处理**：拆书故事维度的标签是**提示词要求但未校验**
   （`workbench-adapter.ts:36` vs `workbench-core.ts:152-153`）。
   模型跑偏时 `pick()`（`workbench-publish.ts:235`）匹配不到标签，
   **四个 beat 会全部退化成同一句**
   「本次没有充分依据，不固定该环节；由目标故事实际情境决定。」——
   **结构合法、内容为空**，还能通过 `normalizeBeats`（`plot-framework.ts:217`）。
   → 必须在**发布或绑定**时检测这种退化并提示用户
   （判据：四个 beat 相同，或全为那句 fallback），否则用户会绑定到一个空框架却不知道。

### 4.3 必须保持绿

- `character-aura` 相关全部既有 spec（绑定/解绑的拒绝分支与错误文案）。
- `workbench-publish.spec.ts`（三种产物各自的落盘断言）。
- `context-engine.spec.ts:41-47`（文风 fail-closed）——**绝不能改**。
- `framework-store` / `framework-binding` / `plot-framework-library` 的既有 spec。
- `plot-framework.spec.ts:253-255`（`formatPlotFrameworkForOutlinePrompt` 的现有断言）。

### 4.4 ⚠️ 需要用户澄清的一处范围差异（实施前确认）

本批给实现者的硬边界写的是 **`src/lib/context-hub/**` 全部只读**，
而本分支设计文档 §4 与三项守门检查实际只钉 **`src/lib/context-hub/composer.ts`** 一个文件。
→ 差异有实质影响：按**严格**读法，`source-paths.ts` 与 `data-source-cache.ts` 不可改，
这正是路线 B 会发陈旧值、而路线 A 更优的原因。
**本计划按严格读法执行**（不动 `context-hub/` 任何文件），丁-5 因此走路线 A。
若要保持宽松读法（允许改 `source-paths.ts`），需先明确放宽边界。

---

## 5. 提交与验证（每个子批各自做一遍）

1. `npm run typecheck` 与 `npm run typecheck:tests`，都要 exit 0。
2. `npm run test:mocks`，回到基线或**说明**增量。
3. **三项守门检查**必须不变（第一条尤其关键：设计 §1.5 说明它如何约束了方案）：
   - `git diff a5a2702 --stat -- src/lib/novel/context-engine.ts src/lib/novel/outline-context-index.ts src/lib/context-hub/composer.ts src/lib/novel/chapter-outline-template.ts` = **空**
   - `git grep -n "autoSaveable" -- src/lib/novel/outline-save-request.ts` 仍为 `[]`
   - `git grep -n "事件细纲" -- src/lib/novel/outline-context-index.ts` = **空**
4. 跑完测试按 `AGENTS.md` §4.2 判定 EOL 假阳性；**不要**用
   `git checkout -- .` / `git restore .`。
5. 暂存**点名文件**；中文 conventional commit；
   `git commit -F <UTF-8 无 BOM 临时文件>`
   （本机 `pwsh` 是 Windows PowerShell 5.1，`Set-Content -Encoding utf8` 会写 BOM，
   用 `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`）。
6. 每个子批跑一次**独立审查**（先 spec 合规、再代码质量），审查者只读、
   **不得相信实现者报告**。

---

## 6. 提交前自检清单

- [ ] `context-engine.ts` / `outline-context-index.ts` / `context-hub/composer.ts` /
      `chapter-outline-template.ts` **零改动**（守门检查 1 为空）
- [ ] 未改 `.qmai/writing-style.json` 的落盘格式
- [ ] 临时覆盖**不写盘** `enabledStyleId`
- [ ] `buildWritingStyleContext` 重构后行为逐字节不变
      （`writing-style-store.spec.ts` 全绿且**未改断言**）
- [ ] 未把文风文本塞进 `skillsPrompt`
- [ ] 未动甲的反 AI 腔规则与其注入点、未破坏缓存前缀不变式
- [ ] 未动丙加的那枚按钮与 `openBodyFontPopover` 的调用次数
- [ ] 未引用 `WelcomeScreen`
- [ ] 每条「故意改断言」都写明了理由
