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

     #### ✅ 已实读：这段载入逻辑有一个**共享 catch**，加第三个来源时必须处理
     ```ts
     Promise.all([loadUserSkillConfig(project?.path), loadDeAiSkillConfig(project?.path)])
       .then(([writing, deAi]) => { … })
       .catch(() => { setWritingConfig(null); setDeAiConfig(null); setLoadError("技能库加载失败") })
     ```
     - `:412` 是 `Promise.all` + `project?.path`（**可能为 `undefined`**，两个 loader 都接受）；
       依赖数组是 `[dataVersion, project?.path]`（`:427`）——**已正确包含 `dataVersion`**，
       所以 `bumpDataVersion()` 能让文风库刷新，不需要额外改依赖。
     - ⚠️ **陷阱**：`catch` 一旦触发就把**两个**配置都置 `null` 并报「技能库加载失败」。
       若把 `loadWritingStyleStore` 直接加进同一个 `Promise.all`，
       则**文风库读取失败会连带把写作 Skill 与去AI味技能也清空**（表现为整页报错、
       另外两个 tab 也空了）——一个来源的故障扩散成三个。
     - ⇒ **要求（二选一，并在报告里说明选了哪个）**：
       - **(i) 推荐**：给文风库单独一个 `.catch`（例如
         `loadWritingStyleStore(project?.path).catch(() => ({ version: 1, enabledStyleId: null, styles: [] }))`），
         让「文风库缺失/损坏」退化成「文风 tab 为空」，**不影响另外两库**；
       - **(ii)** 合进同一个 `Promise.all` 但把 `catch` 拆成按来源记录，
         并保证只有**全部**失败才显示整库错误。
     - ⚠️ 顺带确认：`loadWritingStyleStore`（`writing-style-store.ts:65-77`）**自身已经**
       在 `try/catch` 里返回空 store（`:74-76`），所以它**不会**因为文件不存在而 reject；
       真正的失败面是 `readFile` 抛出的非文件缺失错误与 `JSON.parse`。
       即使如此，(i) 仍然更稳（未来改动不会把风险转移给另外两库）。

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

### 🔴🔴 补漏（实施前必读）：加一个 tab 远不止「改 :36-40 与 :43」——
### 有 **7 处二元三元表达式**会静默走错分支，且 **`tsc` 抓不到任何一处**

上面步骤 1 只写了「tab 数组加一项 + `GalleryTab` 联合类型同步 + 动作区补分支」。
**这远远不够。** 已通读 `unified-skill-library-view.tsx`，发现关键区别：

> 本文件的 tab 分派**不是查表（lookup table）**，而是一串
> `activeTab === "writingSkillLibrary" ? A : B` 的**二元三元表达式**。
> 给联合类型加第三个成员后，**每一个三元仍然合法编译**
> （`"style" === "writingSkillLibrary"` 只是恒 false），于是它们**全部静默落到 else 分支**。
> ⇒ **`npm run typecheck` 通过在这里等于零证据**，必须靠行为测试。

#### (1) 最危险的一处：`activeTab` 的推导本身就是三元链（`:650-654`）
```ts
const activeTab: SkillLibraryTab = activeView === "writingSkillLibrary"
  ? "writingSkillLibrary"
  : activeView === "skillFavorites"
  ? "skillFavorites"
  : "skillLibrary"          // ← 兜底：任何未列出的 view 都被当成「去AI味」
```
⇒ 新增 `"writingStyleLibrary"` 视图时，若不同步这里，
`activeTab` 会推导成 **`"skillLibrary"`**，于是下游**全部**按去AI味处理：
tab 高亮错（`:700` 的 `aria-pressed` 会把「去AI味」标成选中）、
列表错（`:457`）、空态文案错（`:545`）、脏标记错（`:661`/`:664`）、
编辑区错（`:724`）。**首要目标视图会渲染成完全不相干的另一个库。**
**要求**：把这条链改成显式映射（`Record<activeView, SkillLibraryTab>` 之类），
或至少把新视图加进链里，并**加一条行为测试**：切到文风 tab 断言
「文风」tab 的 `aria-pressed === "true"` 且出现的是文风条目。

#### (2) 必须一并处理的 7 个点（逐个核对，缺一个就是静默错误）
| # | 位置 | 现状 | 不同步的后果 |
|---|---|---|---|
| 1 | `:650-654` | `activeTab` 三元链，兜底 `"skillLibrary"` | 见上，**最严重** |
| 2 | `:457` | `let list = activeTab === "writingSkillLibrary" ? writingEntries : deAiEntries` | 文风 tab 显示**去AI味技能列表** |
| 3 | `:545-547` | `emptyCopy` 二选一 | 空态说「还没有去AI味技能」 |
| 4 | `:661` | `dirty = activeTab === "writingSkillLibrary" ? writingDraftDirty : skillDraftDirty` | 脏标记张冠李戴 |
| 5 | `:664` | `if (activeTab === "writingSkillLibrary") setWritingDraftDirty(false)` | 返回列表时不清脏标记 |
| 6 | `:724` | `{activeTab === "writingSkillLibrary" ? <WritingSkillLibraryView/> : <SkillLibraryView/>}` | 编辑区渲染**去AI味编辑器** |
| 7 | `:287` / `:443` | 动作区与分类 chips 的二分支 | 动作按钮/分类 chips 错配 |

#### (3) tab 之外**还有 4 个跨文件挂点**，漏掉会有更硬的后果
| 位置 | 为什么必须动 |
|---|---|
| `wiki-store.ts:661` | `activeView` 是**字面量联合类型**，新视图**必须**加进去，否则 `setActiveView("writingStyleLibrary")` 直接编译失败 |
| `content-area.tsx:126` (`case "writingSkillLibrary":`) | 视图→内容的 `switch`。新视图不补 `case` 会掉进 default（白屏）。⚠️ `content-area.search-performance.test.tsx:23` 用源码断言钉着 `case "writingSkillLibrary"` 存在，别把它删了 |
| `ui-test-shell.tsx:113` | `fullWindowViews` 白名单：不在里面的视图**不是全窗口渲染**，会挤在错误的容器里 |
| `icon-sidebar.tsx:81` | `isActive = item.view === activeView \|\| (item.view === "skillLibrary" && activeView === "writingSkillLibrary")` —— 侧边栏高亮逻辑，新视图要不要折算到「技能库」图标必须**显式决定** |

#### (4) ⚠️ 还有 3 条**既有源码断言**会被这次改动撞到（先读再改，别盲改）
- `icon-sidebar.test.tsx:51-53`：断言 `iconSidebarSource` **不含** `id: "writingSkillLibrary"`，
  且 `contentAreaSource` **含** `case "writingSkillLibrary"`；
- `sidebar-nav-preferences.spec.ts:68-70`：`DEFAULT_SIDEBAR_NAV_ORDER` **不得含** `writingSkillLibrary`；
- `content-area.search-performance.test.tsx:23`：含 `case "writingSkillLibrary"`。
⇒ 结论：**新视图沿用「不在侧边栏、由技能库内部 tab 切换」的既有模式**，
不要顺手把它加进侧边栏或导航顺序（那三条断言会红，且不是本批目的）。
`icon-sidebar.tsx:81` 的折算要**保持**现有行为，只按需扩展。

#### (5) 一句话给实施者
> 加 tab 是**本批最容易做错的一步**：编译通过不代表接对了。
> 落地后必须**逐条**证明 (2) 的 7 个点 + (3) 的 4 个挂点都已处理，
> 并用**行为测试**（切 tab 后看到的是文风条目 + 文风 tab 高亮）兜住，
> 而不是靠 `tsc` 或源码文本断言。

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
   - 若覆盖文本由**同一个**渲染器产出，它与「已启用」路径**同形**
     → 二者要么都触发守卫、要么都不触发，**不会**出现「覆盖比正常路径更不安全」的分叉。
   - 若为覆盖另写一套拼装、少了这个前缀 → `startsWith` 为假 → **守卫完全不触发**，
     用户选的文风可能被静默裁掉而毫无提示。
   - ⚠️ 前缀文案里的「已启用」对「本次临时覆盖」语义上已不准确，
     但 `context-engine.ts` 是**守门文件不能改**，所以**不要**去改这个字面量，
     也不要为覆盖另造前缀。**照用同一个前缀**，并在代码注释里写明这是为了接上守卫。

   #### ⚠️⚠️ 订正：「复用同一渲染器」**并不保证**带上前缀（本计划原先写错了）
   本计划先前写着「若覆盖文本由同一个渲染器产出，它**会**带上同一个
   `【已启用文风画像】` 前缀」。**这句是错的**，实读 `writing-style-store.ts` 后订正：

   ```ts
   const structuredStyle = preset.profile.workbenchStyle?.styleFingerprint ? … : undefined
   if (structuredStyle) {
     lines[1] = "依据已核验的语言习惯写作，…"
     lines.unshift("【已启用文风画像】")   // ← 只有这一支加前缀（:261）
     lines.push(compileStyleFingerprint(structuredStyle))
   } else {
     lines.push("风格硬约束：", clip(preset.profile.constitution, constitutionCharLimit))  // ← 无前缀（:265）
   }
   ```

   - 前缀**只在结构化画像分支**加（`:258`/`:261`）；
     **v1/旧画像分支（`:263-266`）根本不产出这个前缀**。
   - ⇒ 对**旧画像**预设，守卫（`:1132`）`startsWith` 为假 →
     **静默不触发**，旧画像被裁掉**不会**停机。
     这是**既有行为**，不是丁引入的（设计 §1.3 已如实记录），
     但直接推翻「复用渲染器 ⇒ 守卫生效」这条推理。
   - 实测确认这条不对称**没有**被测试覆盖：
     - `writing-style-store.spec.ts:95` 只对**结构化**夹具断言含前缀；
     - `:225-229` 测的是旧画像降级分支，但只断言 `toContain("风格硬约束")`，
       **没有**断言「不含前缀」（所以后人改正它也不会红）；
     - `context-engine.spec.ts:42-47` 用的是**手写**的
       `"【已启用文风画像】\n" + …`，从不经过渲染器，覆盖不到旧画像形状。
   - **因此丁-2 必须显式做出选择并在报告里写明**（三选一，不要默认沉默）：
     - **(a) 推荐 · 照现状接受不对称**：覆盖文本仍由同一渲染器产出，
       于是覆盖与「已启用」路径**同形**。旧画像下二者都无守卫，
       行为与今天**完全一致**，不引入新的用户可见变化。
       报告里必须写明「已确认旧画像分支无守卫，本批不改变该行为」。
     - **(b) 顺手补齐旧画像的前缀**：让旧画像也带上 `【已启用文风画像】`。
       ⚠️ **这是用户可见的行为变更**：今天能静默截断并成功出稿的旧画像项目，
       此后会**硬停机**（`context-engine.ts:1133` 抛错）。属于「可能把能跑的生成
       变成硬停机」，正是设计 §3.2「结论二」点名的本批最大风险类型。
       **本批不做**，除非用户明确要求，并且要单独评估存量项目。
     - **(c) 为覆盖另加前缀而不动「已启用」路径**：
       ⚠️ 会让覆盖比正常路径**更严格**（覆盖被裁 → 停机；已启用被裁 → 静默），
       用户会遇到「选了文风反而报错」。**不推荐**，除非联同 (b) 一起做。
   - ⚠️ **禁止**为了让守卫生效而**改 `context-engine.ts` 的判据**（守门文件）。
     上面 (b)/(c) 都只改**产出方**（`writing-style-store.ts`，非守门文件），
     这是唯一允许的着力点。
   - 建议加一条测试：**结构化**预设下覆盖生效时最终提示词含 `【已启用文风画像】`
     （钉住守卫仍生效）。若要连旧画像一起钉，必须**同时**钉住它**不含**前缀，
     才能如实反映 (a) 的选择。
2. **打通参数**（`src/lib/novel/deep-chapter-generation.ts`，非守门文件）：
   - `DeepChapterGenerationInput`（`:90`）加一个**独立命名**的可选参数
     （如 `styleOverridePrompt?: string`）。**不要**塞进 `skillsPrompt`。
   - 组装 `contextPrompt` 处（`:782` 的
     `deps.contextPackToPrompt(contextPack, restContextTokenBudget, { excludeOutline: true })`）：
     当覆盖存在时，给 `contextPackToPrompt` 传**浅拷贝**
     `{ ...contextPack, writingStyle: override }`。
     **不要原地改 `contextPack`**——它可能来自 context-hub 缓存，原地改会污染缓存。
   - 「本次不用文风」= `writingStyle: ""`。

   #### 🔴 补漏（实施前必读）：`writingStyle` 是**恒定 key 的缓存源**，注入点**只能**在 `:782`
   上面说「与缓存有关」时留了话没说完。已实读 `context-hub/data-source-cache.ts:56-71`：
   ```ts
   const STATIC_SOURCES = new Set([
     "canonRules", "sourceCanon", "writingStyle", "soulDoc", …
   ])
   ```
   ⚠️ **但决定性证据不是注释，而是缓存 key 的计算函数**（已实读 `:116-124`）：
   ```ts
   async function sourceRequestKey(sourceName, context) {
     const scope = STATIC_SOURCES.has(sourceName)
       ? {}                                          // ← writingStyle 走这一支
       : CHAPTER_SCOPED_SOURCES.has(sourceName)
         ? { chapterNumber: context.chapterNumber ?? null, config: context.config }
         : { task: context.task, chapterNumber: context.chapterNumber ?? null, config: context.config }
     const version = SOURCE_CACHE_VERSIONS[sourceName]
     const versionSuffix = version ? `:v${version}` : ""
     return `data-source:${sourceName}${versionSuffix}:${await sha256Text(JSON.stringify(canonicalize(scope)))}`
   }
   ```
   ⇒ `writingStyle` 的 scope 是**空对象 `{}`**，缓存 key 因此退化成
   `data-source:writingStyle:<sha256("{}")>` —— **一个常量字符串**。
   它**不含** `task`、**不含** `chapterNumber`、**不含** `config`，
   更**不可能含**「本次临时覆盖了哪个文风」。
   ⚠️ 别引错注释：`:63` 那句「以下源加载的是项目级数据（不依赖章节号），
   改用恒定 key 跨章节/跨消息复用」**只修饰它下面的那几条**（`:64-70`），
   `writingStyle` 在 `:59`，属上一组——真正的依据是上面那个 `scope = {}` 分支。
   而 `writingStyle` 正是由数据源层产出的：
   `context-data-sources.ts:376-382` 的 `writingStyleDataSource`
   → `buildWritingStyleContext(context.projectPath, { task: context.task })`
   → 填进 `pack.writingStyle`（`composer.ts:65` 渲染成「写作风格」段）。

   ⇒ **因此「本次临时覆盖」绝对不能注入数据源层**（不要去改
   `context-data-sources.ts:382`）。恒定 key 会让**第一次**生成时的覆盖文本被永久缓存：
   - 第 1 次生成选文风 A → 缓存存下 A 的文本；
   - 第 2 次生成选文风 B（或**不选**）→ 缓存直接命中返回 **A**；
   - 结果：覆盖**静默失效**，更糟的是**上一轮的文风会泄漏进之后所有生成**。
   这是一个无声、难查、且会污染全书输出的缺陷——正是本计划反复警告的那一类。

   ⇒ **结论：`deep-chapter-generation.ts:782` 不只是「更保险的位置」，而是唯一正确的位置**
   ——它在缓存**之后**，拿到的是已返回的 `contextPack`，浅拷贝只影响本次调用。
   实施报告里请把这条因果写出来，不要当成风格偏好。

   #### 🔴 补漏（实施前必读）：覆盖文本**由谁渲染**——`buildWritingStyleContext` 现在渲染不了它
   上面只规定了「覆盖文本怎么用」，没规定「覆盖文本怎么来」。已实读发现一个硬阻塞：
   - `buildWritingStyleContext(projectPath, options)`（`writing-style-store.ts:238`）
     的**第一件事**就是 `const preset = await getEnabledWritingStyle(projectPath)`（`:242`）
     —— **它只认「当前启用」那一个预设，没有任何「渲染指定预设」的参数**。
   - ⇒ 直接调用它**无法**产出「这次临时选的文风」的文本。必须给它加一个覆盖选项
     （如 `styleIdOverride?: string | null`），把 `:242` 的取值从
     「无条件读启用项」改成「有覆盖就用覆盖，否则读启用项」。
   - ⚠️ **必须照抄 `getEnabledWritingStyle`（`:180-187`）的取值形状，尤其是
     `:186` 的 `migrateStyleProfile(preset.profile)`**：
     ```ts
     const preset = store.styles.find((s) => s.id === styleIdOverride)
     return preset ? { ...preset, profile: migrateStyleProfile(preset.profile) } : null
     ```
     **不要**直接 `store.styles.find(...)` 就把 preset 交给渲染器——那会**跳过 v1→v2 迁移**，
     旧画像的 `workbenchStyle.styleFingerprint` 就不存在，于是覆盖会**莫名掉进旧画像分支**
     （无前缀、无守卫、内容形状不同）。这是个只有存量项目才会踩的坑。
   - ⚠️ **不得改变「不传覆盖」时的行为**：`writing-style-store.spec.ts`（361 行）是
     逐字节级的行为契约，加参数后**必须全绿且不改任何断言**。覆盖选项应当是可选的、
     默认 `undefined`，走原路径。
   - 「本次不用文风」（用户显式清空）与「没有覆盖」是**两种不同状态**：
     前者要产出 `""`（真的不注入），后者要产出启用项的文本。
     用 `undefined` = 没覆盖、`null` = 显式不用，**不要把两者都当成 falsy 混用**
     （否则「不用文风」会退化成「用已启用的文风」，正好相反）。

   #### 🔴 补漏 2（实施前必读）：`deep-chapter-generation.ts` **拿不到渲染器**，
   #### 且 `:782` 处在**同步**表达式里 —— 三点必须照做，否则实施者会卡住或走偏
   上面已定「注入点在 `deep-chapter-generation.ts:782`」。但只说了「在哪儿用」，
   没说「在那儿**怎么拿到**渲染结果」。已实读确认三处硬事实：

   **(a) `DeepChapterGenerationDeps`（`:145-163`）里既没有渲染器、也没有项目路径。**
   它只有 `buildContextPack` / `contextPackToPrompt` / `reviewChapter` +
   3 个可选 dep（`runChapterPlanComplianceCheck` / `runChapterPlanDeviationRepair` /
   `runChapterExecutionContractBuild`）+ `streamChat` + `collectWritingEntityWebSearch`。
   ⇒ **必须新增一个可选 dep**，例如：
   ```ts
   buildWritingStyleContext?: typeof buildWritingStyleContext;
   ```
   ⚠️ **照抄既有可选 dep 的取值形状**：`deps.x ?? 真实实现`，先例三处 ——
   `:553` `deps.runChapterExecutionContractBuild || runChapterExecutionContractBuild`、
   `:1765` `deps.runChapterPlanComplianceCheck || runChapterPlanComplianceCheck`、
   `:2543` `args.deps.collectWritingEntityWebSearch ?? collectWritingEntityWebSearch`。
   ⚠️ **不要**加进 `defaultDeps`（`:165-170`）：它刻意只放 4 个必填项，
   3 个可选 dep 都不在里面。加进去会改变「省略 dep 时的行为」语义。
   ⚠️ **不要**把它改成**必填** —— `deep-chapter-generation.spec.ts` 等大量测试
   只构造部分 deps，必填会引发大面积编译失败（正是本批要避免的无谓返工）。

   **(b) 项目路径现成可用，不必新增参数：`input.projectPath`（`:79`）。**
   所以**不需要**再往 deps 里塞 projectPath，也不要去读全局 store。

   **(c) ⚠️ `:778-788` 的 `contextPrompt` 是 `join` 出来的**同步**表达式**，
   而 `buildWritingStyleContext` 是 `async`（`:238` 返回 `Promise<string>`）。
   ⇒ **不能**在 `:782` 那一行内 `await`。必须先在上面（`runDeepChapterGeneration`
   内部、`:778` 之前）**先把覆盖文本 await 出来**，再在构造 `contextPrompt` 时
   用它替换 `contextPack.writingStyle`。
   好消息：`runDeepChapterGeneration`（`:521`）本身就是 `export async function`，
   所以多一个 `await` **合法**，不需要改函数签名或调用方。
   推荐形状（浅拷贝 + 只改本次调用，见本文件上一段对缓存 key 的分析）：
   ```ts
   const styleOverrideText = input.writingStyleIdOverride === undefined
     ? undefined
     : await (deps.buildWritingStyleContext ?? buildWritingStyleContext)(
         input.projectPath,
         { task: …, styleIdOverride: input.writingStyleIdOverride },
       )
   const effectivePack = styleOverrideText === undefined
     ? contextPack
     : { ...contextPack, writingStyle: styleOverrideText }
   ```
   然后 `:782` 的 `contextPackToPrompt(effectivePack, …, { excludeOutline: true })`。
   ⚠️ 注意 `undefined`（无覆盖，保持原 pack）与 `null`（显式不用 → 渲染器返回 `""`）
   的区别要在这一层**同样保留**：`null` 走渲染器、拿到 `""`、覆盖掉原文本；
   `undefined` 连渲染器都不调。这正是上面第 2 条要求的延续，别在这一层丢掉。

   **(d) `writingStyleIdOverride` 放哪：放 `DeepChapterGenerationInput`（`:78-91`）。**
   已确认这两个字段的先例就在同一个接口里：`planBlueprint?`（`:88`）、
   `skillsPrompt?`（`:90`），都是「会话层选项经此接口进入生成」。
   ⇒ 新增 `writingStyleIdOverride?: string | null`，**两个调用方都传**
   （`chat-panel.tsx` 的正文生成、以及本批新加的章节区链路）。
   ⚠️ `input.projectPath`/`userRequest`/`llmConfig` 是必填；新字段必须**可选**，
   否则 `deep-chapter-generation.spec.ts` 里所有既有构造都会编译失败。

   #### 🔴🔴 补漏 3（**最重要的一条**）：覆盖会撞上 `contextPackToPrompt` 自己的
   #### 文风硬闸门，而 `context-engine.ts` 是**不可改**的守门文件
   ⇒ 这一条决定「覆盖文本用什么形状」，必须**先决定再写代码**。

   已实读 `contextPackToPrompt`（`context-engine.ts:1123-1137`），它内部有**两道**动作：
   ```ts
   const result = trimContextPack(pack, tokenBudget, options)      // :1128 按预算裁剪
   …
   if (pack.writingStyle?.startsWith("【已启用文风画像】") &&      // :1132
       !result.prompt.includes(pack.writingStyle)) {               // :1132
     throw new Error("上下文预算不足，已启用的文风画像未完整保留。…已停止生成。")  // :1133
   }
   ```
   ⚠️ 关键：上面 (c) 的推荐形状是把覆盖文本**当作 `pack.writingStyle` 传进
   `contextPackToPrompt`**。于是 `:1132` 的 `pack.writingStyle` **就是我们的覆盖文本**
   —— 闸门会**看见覆盖**。由此产生两个**相反**的后果，取决于覆盖文本走哪条渲染分支：

   | 覆盖文本的分支 | `:1132` 的 `startsWith` | 覆盖被裁剪丢弃时 |
   |---|---|---|
   | **结构化 DNA 分支**（`writing-style-store.ts:261` `lines.unshift("【已启用文风画像】")`） | **true** | **抛错**：`上下文预算不足，已启用的文风画像未完整保留…已停止生成` |
   | **v1 降级分支**（`:263-266` push `风格硬约束：`，**无**该前缀） | **false** | **静默丢弃**，用户本次明确选的文风**凭空消失**，无任何提示 |

   ⇒ 两个后果都不可接受，而**都不能靠改 `context-engine.ts` 解决**：
   `context-engine.ts` 是本批的**守门文件之一**（`git diff a5a2702 --stat` 必须为空）。
   **必须在下面三选一并写明理由（写进实施报告）：**

   - **(i) 推荐 · 覆盖路径统一产出「已启用文风画像」前缀形态。**
     即覆盖渲染时**总是**走上带 `【已启用文风画像】` 的那条分支（即使源预设是 v1 降级数据，
     也先按 `migrateStyleProfile` 迁移后按结构化形态渲染）。
     代价：同一份 v1 预设，「启用它」与「本次临时选它」产出的文本形状**不同**
     （前者可能仍是 `风格硬约束：` 降级形态）。
     好处：闸门对覆盖**生效** ⇒ 覆盖被挤掉时是**响亮的失败**而不是静默消失。
     ⚠️ 必须在报告里**明确写出这个不对称**，以及它只影响「v1 降级数据的预设」。
   - **(ii) 接受静默丢弃。** 覆盖走原分支、不强制前缀 ⇒ v1 预设的覆盖可能无声消失。
     若选这条，必须在报告里承认，并说明为什么可接受。
   - **(iii) 覆盖不放进 `pack.writingStyle`，另起一个不被闸门检查的字段。**
     ⚠️ 这会绕过 `trimContextPack` 的 `SECTION_PRIORITY` 预算记账
     （`writingStyle` 排第 19 位、整段丢弃），把文本**加在预算之外**，
     可能超出 `planChapterRequestBudget` 算出的窗口。**不推荐**，除非另行证明预算安全。

   #### 附带的一条预算事实（无论选哪条都要知道）
   `:1128` 的 `trimContextPack` 是**整段丢弃**语义（`writingStyle` 排第 19 位，
   见 `writing-style-store.ts:52-53` 的注释），**不是**逐字截断。
   ⇒ 覆盖文本**越大越容易被整段丢掉**。而用户手动选文风时**无从预知**这一点。
   「选了一条很长的文风 → 生成直接报错（(i)）或文风没生效（(ii)）」是**真实可达**的路径。
   **要求**：实施报告里必须写明这条可达路径，并说明 UI 侧是否需要提示
   （例如选文风时给出体量提示）。**不要**悄悄让它成为已知问题。

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

   #### ✅ 已实测：链上各点的真实状态（含一个**反面**例子，别踩）
   - **skills 通道是活的**：产出点是**一个 ref**，不是纯计算——
     `selectedSkillsPromptRef`（`chat-panel.tsx:1083`），
     在**发送时**由 `:1868` 写入
     `buildSelectedSkillsPrompt(sessionSelectedSkills)`，并在 `:1638` 清空；
     getter（`:1084-1087`）只做 `.trim() || undefined` 转发。
     渲染器是 `select-skills-plugin.ts:242`，它**不是** i18n、也不读 store。
   - ⚠️⚠️ **反面例子：隔壁那个 getter 参数其实是死的。**
     `useAgentConfig` 的**第二个**形参
     `getPlanBlueprint?: () => string | undefined`（`use-agent-config.ts:26`）
     在全仓**唯一**的生产调用处是
     `chat-panel.tsx:1095`：`useAgentConfig(agentSystemPrompt, `**`undefined`**`, getSelectedSkillsPrompt)`
     ——**显式传 `undefined`**。
     实测：`git grep "getPlanBlueprint"` 在生产源码里**只有** `use-agent-config.ts` 的
     形参/转交与 `chat-panel.tsx:1095` 的 `undefined`，**没有任何产出者**。
     ⇒ **教训：不要因为「签名里有这个可选回调」就推断它已接通。**
     丁-2 新增自己的通道时，必须**两头都接上并各写一条测试**
     （产出点写入了什么 / 消费点读到了什么），
     只加形参而没有产出者会得到一个**静默失效**的通道——
     正是设计 §1.9 已经点过一次的同类缺陷。
   - ⇒ 因此上面那条「跨批整合」的裁决（**优先用参数**）是**必须**的：
     章节区那条链路根本没有 `chat-panel` 的 ref，也拿不到 `useAgentConfig` 的闭包。

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
1.5. 🔴 **转换器产出的 `StoryFramework.id` 必须是「由来源决定的确定值」，
   不能是新造的随机/时间戳 id**（实施前必读，否则整条路线会静默半失效）。

   已实读的因果链：
   - 消费端 `storyFrameworkBindingDataSource`（`context-data-sources.ts:516-527`）：
     ```ts
     const binding = await loadBinding(context.projectPath)
     if (!binding) return ""
     const frameworks = await loadFrameworks(context.projectPath)
     const framework = frameworks.find((f) => f.id === binding.frameworkId)
     if (!framework) return ""          // ← id 对不上就静默返回空串，没有报错
     return buildBindingContext(binding, framework)
     ```
     即：**必须 `framework.id === binding.frameworkId` 才生效**，对不上就是**空串**（静默失效，
     不会抛错、不会提示）。
   - `saveBinding`（`framework-binding.ts:70-82`）写入的是 `frameworkId: framework.id`（`:77`）
     —— 也就是说绑定记的是**用户点绑定时那个对象**的 id。
   - `saveFramework`（`framework-store.ts:289-296`）落盘路径是
     `frameworkFilePath(projectPath, framework.id)` = `.qmai/simulations/frameworks/<id>.md`
     —— **id 即文件名**。

   ⇒ **要求：`StoryFramework.id` 由 `PlotFramework.id` 确定性地派生**
   （`plot-framework.ts:45` 明写它是「**稳定唯一 ID**（同项目内不可重复）」，
   所以有可靠的来源可用）。建议加前缀避免与原生创建的框架撞名
   （如 `` `plot:${pf.id}` ``），并写进转换器单测。

   **为什么不能随手造 id**（三个具体后果）：
   1. **重复堆积**：两个发布方（`workbench-publish.ts:245` 与
      `story-analysis-adapter.ts:265-292`）都要桥。同一个来源经两条路发布、
      或同一框架被重复发布时，随机 id 会**每次多一个文件**，
      `loadFrameworks()` 列表无限膨胀；确定 id 则被 `writeFileAtomic` **覆盖**，发布是幂等的。
   2. **绑定错版本**：列表里出现同一内容的多份副本，用户绑到的是**旧副本**；
      之后发布的新版本永远不被读到（因为 `binding.frameworkId` 指向旧 id）。
   3. **测试会骗你**：如果测试写成「publish 拿到返回对象 → 用同一个对象 bind」，
      随机 id 也**必然通过**；只有「独立构造一次转换 / 重复发布两次」才暴露。
      ⇒ 单测必须包含**发布两次只得到一个文件**，以及**绑定后数据源真能取到非空文本**。

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
