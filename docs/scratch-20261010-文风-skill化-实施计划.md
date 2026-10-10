# work/scratch-20261010 第五批（丁）实施计划：文风 skill 化 + 统一可选技能面

> 设计依据：《`docs/scratch-20261010-文风-skill化-设计.md`》——**先读它**，本文只讲怎么落地。
> 用户原话见《`docs/scratch-20261010-文风与拆书库-设计.md`》§6「丁 · 文风 skill 化」
> 及其下的「丁 · 用户已确认的两个决定」。

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
     `WritingStylePreset { id, name, sourceBook, profile, … }`
     （`writing-style-store.ts:21-30`）——**没有** tags/kind/priority，不要假装有。
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
   `buildWritingStyleContext(projectPath, { task })`（`:238-322`）内部先取
   `getEnabledWritingStyle`（`:242-243`）。抽出「由 preset → 注入文本」的公共函数，
   新增按 **preset id** 生成注入文本的导出。
   ⚠️ **抽出后 `buildWritingStyleContext` 的行为必须逐字节不变**——
   `writing-style-store.spec.ts` 有 361 行断言（注入顺序、`【已启用文风画像】` 前缀、
   DNA 降级、预算截断）。这是**重构而非改行为**，测试应当全绿通过。
2. **打通参数**（`src/lib/novel/deep-chapter-generation.ts`，非守门文件）：
   - `DeepChapterGenerationInput`（`:90`）加一个**独立命名**的可选参数
     （如 `styleOverridePrompt?: string`）。**不要**塞进 `skillsPrompt`。
   - 组装 `contextPrompt` 处（`:778-788`）：当覆盖存在时，给 `contextPackToPrompt`
     传**浅拷贝** `{ ...contextPack, writingStyle: override }`。
     **不要原地改 `contextPack`**——它可能来自 context-hub 缓存，原地改会污染缓存。
   - 「本次不用文风」= `writingStyle: ""`。
3. **接到工具层**：照 `skillsPrompt` 的通路形状（`run-chapter-workflow.ts:138`
   → `tools/index.ts:127` → `useAgentConfig` → `chat-panel.tsx:1084-1087`），
   新增一个同形状的 getter/参数。**独立命名**，不要与 skills 混用。
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

1. `src/components/reference/types.ts:3` `SkillSubtype` 加新成员（如 `"style"`）。
2. `ReferencePickerDialog.tsx:12-15` `SKILL_SUBTABS` 加对应子 tab；
   过滤逻辑 `:104-106` 不需改（按 `skillSubtype` 相等过滤，天然支持新值）。
3. Provider 注入点**两处都要改**：`chat-panel.tsx:1178-1196`、
   `outline-chat-panel.tsx:2225`（`subtype` 现在是硬编码 `"deai"`/`"writing"`）。
   实施前先全仓搜其它 `skillSubtype`/`skillSubtype ===` 分支，确认没有遗漏第三处。
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

## 4. 子批丁-4：拆书库 skill（**取决于侦察结论**）

设计 §3.1 的侦察结论决定这一子批的形态：

- **若「角色 skill / 灵魂」已存在** → 按「投影到统一可选面 + 可引用」做，与 §1/§3 同构。
- **若不存在** → **不要**在本批悄悄做半成品。两个选择，**必须先问用户**：
  (a) 本批只交付文风与已存在的拆书库产物，把「角色灵魂 skill」明确标为未实现（推荐）；
  (b) 另开一批做「角色 skill + 绑定到人物灵魂」的完整设计。

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
