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
         ✍️ **订正（丁-1 实测）**：上面那行**不能编译** —— `loadWritingStyleStore` 的签名是
         `(projectPath: string)`，**不接受 `undefined`**（另外两个 loader 才接受 `null | undefined`），
         必须先判 `project?.path`。⚠️ 另一条实测事实：`loadWritingStyleStore` 自身 try/catch 吞掉一切，
         **今天不可能 reject** ⇒ 这个 `.catch` 是**结构性防护，不是当前可触发的故障面**
         （丁-1 的 S3 变异：去掉 `.catch` 后断言全绿，只是 vitest 报 `Unhandled Rejection` 且 exit 1）。
         按 (i) 做仍然正确（M7 证明合并进共享 catch 会真的把故障扩散到三库），
         但**不要声称它挡住了今天存在的某个真实故障**。
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

> ✍️ **订正（丁-1 实施后回填）**：本节标题的「7 处」只说对了**一半**。
> 同一个形状在 **`entry.type`** 上还有 **8 处**（含唯一带写盘后果的 `:526`），
> 本节的 (2) 表**一处未提**。详见下面新增的 **(3b)**。
> ⇒ 读本节时请把「7 处」理解成 **7 + 8 = 15 处**。
> 另：本节的 4 个跨文件挂点里，`wiki-store.ts:661` 与「default 白屏」两条**是错的**，
> 已在 (3) 表内逐条订正。

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
| `wiki-store.ts:661` ✍️**订正：实际在 `:690`** | `activeView` 是**字面量联合类型**，新视图**必须**加进去，否则 `setActiveView("writingStyleLibrary")` 直接编译失败 |
| `content-area.tsx:126` (`case "writingSkillLibrary":`) | 视图→内容的 `switch`。新视图不补 `case` 会掉进 default。⚠️ `content-area.search-performance.test.tsx:23` 用源码断言钉着 `case "writingSkillLibrary"` 存在，别把它删了。✍️**订正：后果不是「白屏」** —— `content-area.tsx:182-188` 的 `default:` 渲染的是 `<AIChatTabContainer />`，症状是**「技能库位置出现 AI 会话 tab」**（丁-1 用 M8 实测确认：stub-ai-chat-tab 出现、stub-unified-skill-library 消失）。这比白屏更隐蔽 —— 界面看起来正常，内容却完全不相干 |
| `ui-test-shell.tsx:113` | `fullWindowViews` 白名单：不在里面的视图**不是全窗口渲染**，会挤在错误的容器里 |
| `icon-sidebar.tsx:81` | `isActive = item.view === activeView \|\| (item.view === "skillLibrary" && activeView === "writingSkillLibrary")` —— 侧边栏高亮逻辑，新视图要不要折算到「技能库」图标必须**显式决定**。✍️**订正**：原文把第一个操作数反着写成 `item.view === activeView`（语义等价，但不是逐字引用）。丁-1 已把折算抽成 `SKILL_LIBRARY_TAB_VIEWS: readonly NavView[] = ["writingSkillLibrary", "writingStyleLibrary"]` |

#### (3b) ✍️ **订正：上面 (2) 的表只覆盖了 `activeTab` 键控，漏了同一形状的另一类**
**丁-1 实施时实测发现**：同一个「二元分支 + 新成员静默落 else」的形状，在 `entry.type` 上还有 **8 处**
（原 `:86` / `:363` / `:477` / **`:526`** / `:611` / `:612` / `:622` / `:671`），而本表一处未提。
其中 **`:526` 是唯一带「写盘」后果的一处**：

```ts
if (entry.type === "writing") { 写 writing-skills.json }
else                          { 写 de-ai-skills.json }   // ← 文风条目会掉进这里
```

⇒ 加了 `"style"` 而不改这处，文风条目一旦走到这里就会**把 `enabled` 写进 `de-ai-skills.json`**（还拿 preset id 当 skill id），而 **`tsc` 不报错**。
**要求（照丁-1 的做法）**：`entry.type` 的分派也改成**穷尽 switch / `Record` 表**，
让「加了类型却忘了补分支」变成**编译错误**而不是静默错误。
⚠️ 这条比 (2) 的表更值得警惕：`activeTab` 那 7 处错了顶多**显示错**，这一处错了会**写坏另一个库的文件**。

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
   - `DeepChapterGenerationInput`（`:90`）加一个**独立命名**的可选参数。
     **不要**塞进 `skillsPrompt`。
     ⚠️ 名字以本文件后面的 `:445` 附近（「三态」那一节）给出的
     **`writingStyleIdOverride?: string | null`** 为准 —— 这里原先随手举例写成
     `styleOverridePrompt?: string`，那个名字**表达不了三态**（`string` 型 + 可选
     只有「有/无」两种，装不下「显式不用」这个 `null`）。实施时按 `:445` 那份。
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
     **不要**直接 `store.styles.find(...)` 就把 preset 交给渲染器 —— 理由**不是**
     「会掉进哪个分支」（那由 `workbenchStyle` 决定，见下面的订正），
     而是**跳过字段归一化**：`migrateStyleProfile`
     （`book-analysis/style-profile-schema.ts:127-142`）会补齐
     `layers`（v1 维度 → 分层）、`metrics`（缺失时给默认）、并把
     `integratedDna` / `constitution` / `samples` / `sampledChapterIds`
     规整成确定形状（`asText` / 数组兜底）。
     ⇒ 不迁移就直接渲染，存量 v1 数据上的 `constitution` 可能是 `undefined`，
     而 `:265` 的 `clip(preset.profile.constitution, …)` 内部会 `.trim()` —— **直接抛错**；
     即便不抛，`layers`/`metrics` 的形状也与「启用该预设」时不同，
     造成「启用它」与「本次临时选它」渲染结果不一致。
     ⚠️ 一句话：**迁移是为了归一化字段、避免崩溃与形状漂移，不是为了切换渲染分支。**
     （下面补漏 3 会说明分支由什么决定。）

     > **✍️ 订正（自查）**：本节初稿曾写「跳过迁移 ⇒ `workbenchStyle.styleFingerprint`
     > 不存在 ⇒ 掉进旧画像分支」。**这是错的**：`migrateStyleProfile` 只做
     > `{...input, schemaVersion: 2, layers, metrics, integratedDna, constitution,
     > samples, sampledChapterIds}` —— 它**从不创建也不删除 `workbenchStyle`**
     > （`style-profile-schema.ts:132-141`，靠 `...input` 原样带过）。
     > 所以「走哪条分支」与「是否迁移」**无关**，只取决于盘上
     > `profile.workbenchStyle?.styleFingerprint` 是否存在（`writing-style-store.ts:258`）。
     > 保留迁移要求的**真实**理由见上（归一化 / 防崩 / 形状一致）。
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

   ##### 两条分支**在真实项目里都存在**（不是理论情况）——已查清各自来源
   分支判据是 `writing-style-store.ts:258`：
   `preset.profile.workbenchStyle?.styleFingerprint ? 结构化 : v1 降级`。
   - **结构化分支**：由 **v2 拆书工作台发布**的预设走到 ——
     `book-analysis/workbench-publish.ts:215-231` 的 `skill === "style"` 路径，
     `:219` 找出带 `styleFingerprint` 的条目、`:220-221` 在
     `omitted` 为空时把它作为 `workbenchStyle`、`:227` 写进 profile。
     （⚠️ 注意 `:220` 的三元：若**没有任何** item 带 `styleFingerprint`，
     `item` 为 `undefined` ⇒ `workbenchStyle` 也是 `undefined` ⇒ 这份预设走**降级分支**。）
   - **v1 降级分支**：v1 时代的文风导入 / 任何 `workbenchStyle` 为空的预设。
   ⇒ **两条都是生产可达路径**，不能假设「一定是带前缀的那条」。
   ⚠️ 这也是为什么选择 (i) 时**不能**简单地「加个前缀」了事：
     v1 数据的 `workbenchStyle` 是**真的没有**，凭空造一个 fingerprint 需要
     `compileStyleFingerprint` 所需的输入形状（`WorkbenchItem.styleFingerprint`），
     v1 数据未必能推导出来。**若 (i) 无法低成本实现，就明确改选 (ii) 并承认**，
     不要为了「看起来更安全」而硬造一个假的 fingerprint（那会伪造文风依据）。

   ⇒ 两个后果都不可接受，而**都不能靠改 `context-engine.ts` 解决**：
   `context-engine.ts` 是本批的**守门文件之一**（`git diff a5a2702 --stat` 必须为空）。
   **必须在下面三选一并写明理由（写进实施报告）：**

   - **(i) 覆盖路径统一产出「已启用文风画像」前缀形态。**
     即覆盖渲染时**总是**走上带 `【已启用文风画像】` 的那条分支
     （`writing-style-store.ts:261`）。
     好处：闸门对覆盖**生效** ⇒ 覆盖被挤掉时是**响亮的失败**而不是静默消失。
     代价 1：同一份 **v1 降级数据**的预设，「启用它」与「本次临时选它」产出的文本形状
     **不同**（前者仍是 `风格硬约束：` 形态）。必须在报告里明确写出这个不对称，
     并说明它只影响 `workbenchStyle` 为空的预设。
     代价 2 ⚠️：**实现成本不低，且不能造假。** 结构化分支要求
     `preset.profile.workbenchStyle.styleFingerprint` 存在；v1 数据**真的没有**它。
     要走结构化分支就得用 `compileStyleFingerprint`（`writing-style-store.ts:19` 已导入）
     造一个 —— 那需要 `WorkbenchItem.styleFingerprint` 的输入形状，v1 数据未必能推导。
     ❌ **禁止**为了走通 (i) 而伪造一份 fingerprint 内容：那等于**伪造文风依据**
     （`compileStyleFingerprint` 的产物是给模型看的「已核验语言习惯」）。
     ⇒ **先花几分钟侦察 v1 数据能否推导出真实 fingerprint**：
       能 → 选 (i)；不能 → **明确改选 (ii) 并在报告里写清「(i) 不可行的原因」**。
       不要硬凑。
   - **(ii) 接受静默丢弃（若 (i) 侦察后不可行，这是诚实的默认选择）。**
     覆盖走原分支、不强制前缀 ⇒ `workbenchStyle` 为空的预设，其覆盖可能无声消失。
     若选这条，必须在报告里承认，并说明为什么可接受
     —— 至少要给出「用户如何察觉文风没生效」的答案（例如界面上仍显示所选文风，
     但正文未变，属于**可察觉但无提示**）。
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

- `deep-chapter-generation.spec.ts:1393`（「injects the enabled writing style into
  the stage 3 draft prompt」的 `it(` 在 `:1393`；`:1389-1390` 是**上一条**用例的尾部断言）、
  `:51`（pack 里的 `writingStyle` 夹具）。
- `context-engine.spec.ts:41-47`（fail-closed 文风断言）——**绝不能改**。
- `select-skills-plugin.spec.ts` 全部（含 fast 返回空）。
- `deep-chapter-prompts.cache.spec.ts`（缓存前缀不变式）。

### ⚠️ 已知风险（必须在报告里回答）

设计 §1.3：文风的 fail-closed 守卫**只覆盖 `contextPackToPrompt` 这一条路径**。
⚠️ **不要写「本批的临时覆盖走的就是这条路，所以覆盖是受保护的」** —— 那句话与本文件
§2 自己的订正（「复用同一渲染器」并不保证带上前缀）**直接矛盾**，也曾真的写在这里，
已被 丁-2 的 spec 审查判为文档缺陷（2026-10-11 订正）。正确说法是：
**覆盖的保护级别与「已启用」路径完全相同** ——
`profile.workbenchStyle.styleFingerprint` 存在的**结构化画像**：两者都带
`【已启用文风画像】` 前缀 ⇒ 都命中 `context-engine.ts:1132` 守卫（预算不足则停机）；
`workbenchStyle` 为空的 **v1/旧画像**：两者都**不带**前缀 ⇒ 预算不足时**都静默消失**。
即单看「走了这条路」推不出「受守卫保护」，还要看**这条预设自己是不是结构化画像**。
而项目级文风在 AI 会话的另两条路径
（`trim-context-plugin.ts:47-60`、context-hub `composer.ts:65`）上仍会被静默丢弃——
**那是既有缺陷，不在本批修**，但要在文档里如实写明，不要声称「文风不会被丢了」。

### ✅ 已实测：选择器**不要从零设计**，照抄 `DeAiSkillPicker` 的形状
> 上面第 2 条的 UI（「在生成时提供『文风写作』选择」）有**现成模板**，逐项对上即可。
> 已通读 `src/components/skill-library/de-ai-skill-picker.tsx`（257 行）确认以下五点。

**(1) 三元（`string` / `null` / `undefined`）在既有类型里**已经**是惯例，不是我发明的**
`DeAiSkillPickerProps`（`:7-16`）的签名就是：
```ts
onChange: (skillId: string | null | undefined) => void   // :9
```
- `:223-226` 选具体技能 → `onChange(skill.id)`；
- `:229-239` 「关闭去AI味技能」按钮 → **`onChange(null)`**。
⇒ 这正是 §2 第 2 条要求的 `undefined` = 无覆盖 / `null` = 显式不用。
**新选择器照这个签名写**，并在注释里指向本文件第 2 条，说明 `null` 的语义是「本次不用」。

**(2) 它有配套 hook，新选择器应各写一份对称的**
`useDeAiSkillOptions`（`use-de-ai-skill-options.ts:27`，入参 `{ projectPath, selectedSkillId }`）
返回 `{ loading, skills, effectiveName, currentSkillId, defaultSkillId, loadError }`
（消费点 `de-ai-skill-picker.tsx:157-164`）。
⇒ 文风版应为 `useWritingStyleOptions`，返回同形状的字段
（`currentSkillId`/`defaultSkillId` 分别对应「本次覆盖值」与「项目启用值」）。

**(3) 选项面板是**复用的独立组件**，不要内联**
`DeAiSkillOptionsPanel`（`:47`，已 `export`）负责键盘导航（`:100-107` 的
ArrowUp/Down + Enter）、`role="option"`/`aria-selected`/`aria-current`、
「当前」/「默认」两枚徽章（`:124-133`）、`loading`/`errorMessage`/`emptyMessage`。
⇒ 文风版照它的**可访问性契约**写（键盘 + `role="option"`），
不要只做一个鼠标下拉 —— 否则 `de-ai-skill-picker.spec.tsx` 里那批交互用例没有对应物。

**(4) 「打开完整技能库」跳转的先例已存在，且正是丁-1 那个新视图**
`de-ai-skill-picker.tsx:247` 的 `setActiveView("writingSkillLibrary")`。
⇒ 文风选择器的库内跳转应调 `setActiveView("writingStyleLibrary")`
——**这就是丁-1 必须新增的那个 view**。两条子批在此**必须对齐**：
丁-1 先把 view 接通（含 §1 补漏列的 11 个挂点），丁-3 再依赖它。
⚠️ 若顺序反过来，`setActiveView("writingStyleLibrary")` 会**编译失败**
（`wiki-store.ts:690`（原写 `:661`，已订正）是字面量联合类型）——这是好事，属**编译期**拦截；
但要意识到 `icon-sidebar.tsx:81` 的高亮折算**不会**报错，必须显式决定。

**(5) `iconOnly` / `buttonLabel` / `includeDisableOption` / `showLibraryShortcut`
四个可选 prop 决定按钮形态**（`:144-151`）。先看真实调用点再定默认值，
不要照抄一套用不上的开关。

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
   `DeepChapterGenerationInput`，再决定在哪里转成文风覆盖。
   ⚠️ 那个参数在**丁-2** 里已定型为 **`writingStyleIdOverride?: string | null`**
   （三态，见 §2）；本节原先写的 `styleOverridePrompt` 是早期举例，**已作废**。

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

---

## 7. 丁-1 实施与审查记录（回填，2026-10-10）

### 7.1 提交

| SHA | subject | 文件 | ± |
|---|---|---|---|
| `83d09c0` | `feat(技能库): 新增「文风」tab，以引用方式列出项目文风预设` | 9 | +706 / −103 |
| `b8dcfa1` | `fix(技能库): 修正穷尽性检查分支的类型` | 1 | +6 / −1 |
| `f8d8700` | `docs(丁计划): 订正四处失实引用`（**本文件的修正**） | 1 | +33 / −4 |
| `62e819e` | `fix(技能库): 让「加 tab = 编译错误」这句承诺成为事实` | 10 | +637 / −63 |
| `ac33949` | `docs(技能库): 把「写作轴 ⇒ 列表一致」这条不变式记进 RESIDUAL GAPS` | 1（注释） | +15 / −2 |

基线 733 文件 / 7335 用例 → 终态 **735 文件 / 7360 用例 / 6 todo / 0 失败**。

### 7.2 三轮审查的结论（先 spec、再代码质量、最后复核修复批）

| 轮 | 对象 | 结论 | must-fix |
|---|---|---|---|
| 1 | spec 合规 `83d09c0`+`b8dcfa1` | COMPLIANT WITH CONCERNS | 0 |
| 2 | 代码质量 同上 | REVISE | 0（5 项 nice-to-have） |
| 3 | 复核修复批 `62e819e`+`ac33949` | 见 §7.5 | — |

**第 1、2 轮确认的真正价值**（不是「没发现问题」，而是**证伪了承诺**）：

1. **「加 tab = 编译错误」这句承诺是假的。** 实测：6 张 tab 轴表里只有 **2 张**是
   `Record<SkillLibraryTab,…>`，4 张是 `Record<GalleryTab,…>`，而
   **`TABS_WITH_CATEGORY_CHIPS` 是一张 `Set`**，完全在承诺之外。
   证据：把那张 Set 清空 → `typecheck` **exit 0**、**31/31 全绿**，
   而**写作 Skill 的分类 chips 全部静默消失**；加第 5 个 tab → `TS2741 ×6` + `TS2345 ×1`，
   **那张 Set 贡献 0 个错误**。⚠️ 这正是本分支第 **4** 次「宣称的保证 > 实际的保证」。
2. **两处注释宣称的守卫不存在**：`handleOpenEntry` 的 style 早返回被说成「否则会渲染
   另一个库的编辑器」（实测是**空编辑器死胡同** + 往 store 写一个不属于该库的 id）；
   `icon-sidebar.tsx` 说「两个 spec **都**断言新视图不在侧边栏里」——对
   `writingStyleLibrary` 而言 `sidebar-nav-preferences.spec.ts` **0 命中**。
3. **`fullWindowViews` 全仓库零行为覆盖**，唯一「测试」是把源码里那一行找出来再
   `toContain` 子串（**等价换行即假红**）；`icon-sidebar.test.tsx` 新增的同名用例
   也只守字面量：把使用点破坏掉、字面量留着，**31/31 仍绿**。
4. **一个真实的「修实例而非修类」度量**：往条目轴加第 4 种类型（补好 3 张表）时，
   原文件只报 **4** 个错误（`entrySourceLabel` / `entrySearchValues` /
   `handleToggleEnabled` / `onToggleFavorite`），**唯一「设计出来的」守卫只有那个 switch**；
   而 `entryFavoriteKey`、`entryEnabled`、`handleOpenEntry` **完全静默**。
   ⚠️ 那 4 个「受保护」的点只是**偶然**受保护（它们都碰了 `rawSkill`）——
   一个**带 `rawSkill`** 的新类型会连这 4 个一起穿透。

同时确认了一批**实质改进**（不要因为上面这些就否定这批）：
净删 **2 个 unchecked cast**、源码零 `any`、无新增非空断言；
`SkillLibraryContent` 用提前 return 让 TS 自然收窄出 `GalleryTab`；
**顺手修掉一个 commit message 未提的真 bug** —— 改前 `handleBackToList` 用
「写作 vs 去AI味」二选一取脏标记，于是在**收藏 tab** 点已激活的「收藏」会去查去AI味草稿、
可能误弹「放弃草稿？」并把它清掉（现由 `TAB_DRAFT_KIND` 返回 `"none"` 修掉，
⚠️ **这条无测试**）。

### 7.3 计划里被实测推翻的 4 处（已在 `f8d8700` 逐条订正）

1. `wiki-store.ts:661` → `activeView` 联合类型实际在 **`:690`**（base 也是 690）。
2. 「漏 `content-area` 的 `case` 会掉进 default（**白屏**）」→ 实测
   `content-area.tsx:182-188` 的 `default:` 渲染的是 **`<AIChatTabContainer />`**，
   症状是**「技能库位置出现 AI 会话 tab」**（探针 `innerHTML` 打到
   `<div data-testid="stub-ai-chat-tab">`），比白屏更隐蔽；且该变异下
   `typecheck` **exit 0**。
3. 计划自己写的 `loadWritingStyleStore(project?.path)` **不能编译**
   （签名 `(projectPath: string)`）；且该 loader 自身 try/catch 吞掉一切、
   **今天不可能 reject** ⇒ 单独 `.catch` 是**结构性防护而非当前可触发的故障面**
   （去掉它断言全绿，只是 vitest 报 `Unhandled Rejection` 且 exit 1）。
4. `icon-sidebar.tsx:81` 的引用把第一个操作数反写了（语义等价，非逐字）。

**并且补上了计划最大的漏项**：补漏表只列了 `activeTab` 键控的 7 处，
漏了同一形状的 **8 处 `entry.type` 二元分支**（`:86/:363/:477/`:526`/:611/:612/:622/:671`），
其中 **`:526` 是唯一带写盘后果的一处** —— 文风条目会掉进 `else` 把 `enabled`
写进 **`de-ai-skills.json`**（拿 preset id 当 skill id），而 **`tsc` 不报错**。
复核者用**观测而非读码**证实了落盘目标：`expected [ 'C:/project/de-ai-skills.json' ]`；
且 `normalizeDeAiSkillConfig` **不裁剪** `disabledSkillIds`，所以 `preset:cool`
会**持久化**进去，还会顺带写 `de-ai-skills.backup.json`。

### 7.4 修复批（`62e819e`）做了什么

- **把承诺变成事实**：`TABS_WITH_CATEGORY_CHIPS: Set` → `TAB_CATEGORY_AXIS: Record<GalleryTab,…>`，
  并让**同一张表**同时决定「显示 chips」与「按分类过滤」（原先过滤侧硬编码在 `:702`，
  两处编码同一事实、会漂移且都无测试）。文件头注释重写成**精确列名清单**，
  并明确写「这是**列名**承诺，不是『本文件所有分派都受保护』」，指向新增的 `RESIDUAL GAPS`。
  变异：删表键 → `TS2741`（chips 丢失现在是编译错误，原 Set **连表达这个变异都做不到**）；
  加第 5 个 tab → **10 个错误**（原为 7 个，且 chips 表贡献 0）。
- **三处静默站点改成穷尽 `switch`+`never`**：`entryFavoriteTarget`（新，替代会静默给
  `de-ai:` 前缀的那个三元，并让键与 payload 库名同源）、`entryEnabled`、`handleOpenEntry`。
  同一 `NoteEntry` 变异从 **4 个错误 → 6 个错误**，新增的正是那三处。
- **补上「文件落对没落对」的行为用例**（此前**完全不覆盖**）：勾选写作 Skill 断真实
  `writeFileAtomic` 路径是 `writing-skills.json`、去AI味是 `de-ai-skills.json`、
  点开写作卡片断写进写作库的选中槽。
- **`fullWindowViews` 抽成纯模块** `src/lib/full-window-views.ts` + 6 条行为用例；
  原先那条行形状断言改成**诚实的接线断言**（不再假装是行为证据）。
- **`isNavItemActive` 抽成纯函数**、`SKILL_LIBRARY_TAB_VIEWS` 更名
  `FOLDED_SKILL_LIBRARY_VIEWS` 并移进 `sidebar-nav-preferences.ts`；
  新增用例**钉住**「`skillFavorites` 不点亮技能库图标」这条**既有**例外（**没有**顺手改它）。
- **`isWritingSkillEntry` 删除**：其真值在组件层**不可观测**（写作轴的列表按构造就是写作条目），
  说谎版全绿 ⇒ 改由 `writingSkillToEntry` 的**返回类型**承载。
- **`resolveActiveTab` 硬化**：`?? "skillLibrary"` 兜底 → 谓词 + **显式抛错**，
  并消掉 `as Partial<Record<…>>` 断言。
- **读取失败不再谎报空库**：新增 `styleLoadFailed`，失败文案从
  「文风库还是空的：…」改成「文风库读取失败：暂时列不出这个项目里的文风预设。」
  ⚠️ **这是一条「故意改断言」**，理由写进用例；真·空库仍由另一条用例覆盖。

### 7.5 复核修复批时**如实留下**的东西（不要读成「已全绿」）

- **S1 / S6 存活**：把新增的穷尽 `switch` 改回二元 `if/else`，
  对**今天这 3 种类型**是**外延相等**的（20/20 全绿）。
  即**等价形状的变异不可杀** —— 它守的从来不是今天，而是**第 4 种类型**，
  而那一类由「加类型」变异实测为编译错误。
  ⚠️ 但要注意其中的**循环性**：把 switch 退回 if/else **就等于拆掉了 `never` 守卫**，
  所以「拆守卫」这个动作本身**不被任何东西拦**。残留风险 **LOW**（后果是写错库，
  且需同时满足多处条件），但**如实记下**，不要声称该类已被完全封闭。
- **`ENTRY_TOGGLE_LABELS.style` 不可达**（`toggleable:false` 时渲染的是「点击选中/已选中」），
  为 `Record` 穷尽性保留。
- **`filteredEntries` 里「写作轴 ⇒ `entriesByTab[activeTab] === writingEntries`」这条不变式
  无编译保护**（删谓词带来的行为差异：若将来某 tab 轴为 `"writing"` 而列表指向别库，
  旧代码显示空列表、新代码「不筛时显示那库、一按 chips 跳到写作条目」）——
  两者都只是**显示错乱、不写文件**，已写进 `RESIDUAL GAPS`。
- **`RESIDUAL GAPS` 仍未覆盖的点**（实现者明确列出、故意不守）：
  `entryExtraBadge`、`entrySourceLabel` / `entrySearchValues`
  （仅因碰了 `rawSkill` 而**偶然**受保护）、卡片 `selected`/`onSelect`/「当前启用」徽章。
- **实现者未捕获到名字的一次中间态全量失败（6 failed / 4 files）**，
  归因为负载（4 个 flake 文件隔离复跑全绿、字节相同内容两次全量 0 失败）。
  **如实记录：这 6 条的名字没有拿到。**
- ⚠️ **方法学坑**：Windows PowerShell 5.1 把无 BOM 的 `.ps1` 当 ANSI 读，
  **11 条变异里有 5 条因中文模式串被打乱而没生效**。脚本必须
  `throw "PATTERN NOT FOUND"` 而不是默认「存活」——否则会**假报 SURVIVED**。
- **未跑 `npm run build:portable`**（留到全批收尾）；**未做真机 Tauri 验证**（只有 jsdom + mock）。

### 7.6 复核修复批时发现的 **must-fix**（第 3 轮审查，已实测复现）

⚠️ **再次印证本分支最贵的教训：修复批本身会引入新缺陷。**
这一条恰好又落在**同一个缺陷类**上 —— **代码无法产生的行为，被注释与 commit message 当成事实宣称**。

**MUST-FIX 1（C5 那条「读取失败不再谎报空库」的改动是假的）**

- `src/lib/novel/writing-style-store.ts:65-77` 的 `loadWritingStyleStore` 整体包在
  `try { … } catch { return { version: 1, enabledStyleId: null, styles: [] } }` 里
  ⇒ **它的 promise 永远不会 reject**。
- 因此 `unified-skill-library-view.tsx:762-767` 那个
  `.catch(() => { setStyleLoadFailed(true); … })` **不可能触发**，
  `styleLoadFailed` **在生产里恒为 false**，新文案
  「文风库读取失败：暂时列不出这个项目里的文风预设。」**不可达**。
- 复核者的复现方式（值得学）：让 spec 用**真 loader**
  （`mockImplementation((p) => Actual.loadWritingStyleStore(p))`）+ 让 `readFile` 抛错
  ——即一次**真实的读取故障**——用户**看到的仍是旧文案**：
  `AssertionError: expected '文风库还是空的：…' to contain '文风库读取失败'`。
- ⇒ 三处失实：commit message「改为如实显示读取失败」**错**；`:753-757` 的注释
  宣称了一个未实现的区分；新用例之所以绿，是因为它把 loader mock 成了
  **真 loader 不可能产生的状态**。并且这一批**新增了一个不可达分支**。

**我的裁决（记录在此，供 丁-2 与本文件后续参考）：选 (b) 删掉死分支，不去「让它可达」。**
理由：要让它可达就得改 `writing-style-store.ts`，而 丁-1 刻意让它**零改动**、
且 **丁-2 紧接着要重构这个文件**（要给 `buildWritingStyleContext` 加 `styleIdOverride`）。
更根本的是：**「读取故障与空库不可区分」是 loader 的缺陷，属既有问题、不在 丁-1 范围内** ——
⇒ 删掉不可达分支、把注释改成**如实承认这个限制**、并把那条「故意改的断言」**改回**
断言生产的真实行为；该缺陷**记在这里**，交给 丁-2（它本来就要动那个文件）。

**其余 3 项（LOW）**：
1. `:971 activeTab === "writingStyleLibrary" && styleLoadFailed` 是**承诺清单 7 张之外的
   一个 tab 轴分支**，也不在 `RESIDUAL GAPS`（后者只写了 `entry.type`）。
   缓解：它的兜底 `EMPTY_COPY[activeTab]` 是清单内的 Record，所以加第 5 个 tab 仍会编译失败
   ⇒ **不是**原缺陷的重演。（MUST-FIX 1 会把它整个删掉。）
2. `SKILL_EDITORS` 注释 `:139-142` 描述的是**改前**「只拆一道守卫」的后果；
   在**已交付**的 switch 里删 `case "style"` 是**编译错误**（`TS2322 … never`），
   运行时则会 `throw`。「两道独立对齐的防线」这个说法本身仍然成立。
3. **C4 的「不可杀」是过度声称**。复核者证明了 S1 **可以便宜地杀掉**：
   把 `entryFavoriteTarget`（**本来就是模块级纯函数**，只是没导出）导出，
   加 `expect(() => entryFavoriteTarget({ type: "note", sourceId: "n1" } as never)).toThrow()`
   → **21/21 绿**；再把 switch 换成二元 `if/else` → **1 failed**
   （`expected [Function] to throw an error`）。
   ⇒ 之前那位复核者建议的「抽成纯函数」**确实能杀掉 S1**；
   在 `const unhandled: never = entry` 上做**源码形状断言**同样能杀。
   **正确的残留表述**是「可关、且 `entryFavoriteTarget` 关起来很便宜」，
   **不是**「不可避免」。`entryEnabled` 是闭包（需传 3 个配置），要小重构、不是免费。

**第 3 轮确认通过的项**（不要因此否定整批）：承诺清单**逐条数过、完全正确**
（7 张 tab 轴 Record + `SKILL_LIBRARY_VIEWS` + 3 张条目轴 Record + 4 个穷尽 switch）；
chips 与过滤**同源、不可能漂移**；`TAB_CATEGORY_AXIS = {}` → `TS2739`；
两处「写错库」用例**有真判别力**（`M-togglefile` → `expected [ 'C:/project/de-ai-skills.json' ] to deeply equal [ 'C:/project/writing-skills.json' ]`）；
加第 4 种类型时 **4 个错误 → 6 个错误**（新增的正是那三处）；
`resolveActiveTab` 的 throw **今天确实不可达**（唯一渲染点只路由 4 个技能库视图）；
`fullWindowViews` 抽出的 6 个成员**与改前逐一相同**；`isNavItemActive` 与改前**语义等价**；
**无运行时 import cycle**（`sidebar-nav-preferences.ts:1` 是 `import type`，被擦除）；
`skillFavorites` 的**既有**例外被**钉住**而非改动。
复核者的 10 条自有变异**全部被杀**，**未发现批次引入的新缺陷存活**。

⚠️ **前提订正（给后续复核者）**：`DEFAULT_OUTLINE_FOLDERS` **并不**与 `a5a2702` 逐字节相同
—— 丙-1 的 `d2a7a2b`/`e324d46` 给它加了 `{ id: "event-outline", name: "事件细纲" }`。
那是**既有的分支状态**，不是本批引入；只要求「本批不改它」。

### 7.7 修复批 2（`23be927`）与第 4 轮复核：**同一缺陷类**又出现两次

修复批 2 做了三件事：删掉 §7.6 那个不可达的「文风库读取失败」分支（按裁决 (b)）、
把 `entryFavoriteTarget` 导出并给 `entryEnabled` 提到模块级（让 S1/S6 从**存活**变**被抓住**）、
再加一条源码级兜底盖住两个**闭包** switch。
第 4 轮复核确认：**代码、测试、两个 typecheck、三条守门检查、全部硬约束都是干净的**，
S1/S6 确实被抓住，`entryEnabled` 的提取**行为逐字未变**（3 个分支文本等价、唯一调用点、
无新 import ⇒ 无初始化顺序/循环依赖变化），修复批 1 的成果全部完好，
且**复核者自己的 10 条变异全部被杀、未发现新缺陷存活**。
⇒ 但它判定 **NOT merge-ready**，因为在**声明层面**又出现两条：

- **MF-1**：修复 LOW-2 时新写的注释说删掉 `handleOpenEntry` 的 `case "style"`
  「运行时也会直接 `throw`」—— **到不了**。`ENTRY_CAPABILITIES.style.openable === false`，
  而 `SkillCard.activate` 是 `capabilities.openable ? onOpen() : onSelect()`，
  `handleOpenEntry` 的唯一入口就是 `onOpen`。实测：删掉那个 case →
  `typecheck` **exit 2**、但 **23/23 全绿**。
  ⇒ **修一个「改前形状」的描述，换来了一个新的失实描述** —— 正是同一个类。
- **MF-2**：文件末尾 `RESIDUAL GAPS` 把「文风条目是引用」用例记成
  `handleOpenEntry` 的**行为证据**，而同一段第 5 条又说它「没有行为入口」——
  **两句直接矛盾**，实测支持后者（删掉那个 case 该用例照样绿）。
- **LOW-1/2/3**：注释说那串字面量「恰好 4 处」（其实出现 5 次，照它 grep 会误判）；
  源码级兜底正则**在整份文本上匹配、会被注释影响**（守卫与 throw 之间插一行无害注释
  就少算 1 个，且报错信息与「真删守卫」**逐字节相同**、红得无法诊断）；
  读取故障用例把「另两库一起带崩」记成「能杀」，而它与「并进共享 Promise.all」
  是同一场景、那个变异实测存活。

**我在 `2593189` 逐条订正**（纯注释与测试断言，**无功能改动**）：
MF-1 改成只声称**编译期**防线并写明运行时只有源码级兜底；
MF-2 改成行为用例钉的是 `openable: false` 能力闸门＋引用路径，
`handleOpenEntry` 与 `handleToggleEnabled` 同样只有编译期＋源码级兜底；
LOW-1 改成说清断的是「守卫 + 紧跟 `throw`」这个**构造**；
**LOW-2 加了 `stripComments()`**，一律在**去注释后的副本**上匹配
—— 这正是 §7.6 那类缺陷（丙-4 F4：注释里的 CSS 片段满足了「真实规则存在」的断言）
在本文件里的**第二个实例**，所以按**类**修，不按实例修；
LOW-3 改为如实标注那几条断言只是**粗粒度回归守卫**。

**我实测的变异（全部先备份、逐字节还原）**：

| 变异 | 结果 |
|---|---|
| F1 守卫与 `throw` 之间插一行**无害注释** | 修前**假红**（消息与真删守卫逐字节相同）→ 修后 **23/23 绿** |
| F2c 加一条**形状相同**的行注释 | 修前**假红**（5≠4）→ 修后 **23/23 绿** |
| 删 `handleToggleEnabled` 的 `default`+`never` | **CAUGHT**：`typecheck` **exit 0**（编译干净）而兜底**单独**报红（3≠4）⇒ 这条源码级断言**确实承重** |

⚠️ **本批如实留下的、不可能被测试钉住的东西**（复核者同意这个判断）：
删掉那个结构性 `.catch`（`M-R1`）、把文风链并进共享 `Promise.all`（`M-R6`）、
以及**重新加回那个死分支**（`M-R3`）—— 三者今天**都为 23/23 存活**，
因为不可达分支与「loader 从不 reject」都没有可观察行为。
**所以「删死分支」这件事的验证是 grep + typecheck + 逐行复核，不是测试。**
复核者与我一致**不加**禁止该文案的整行 text assertion：
它会**把一条已知限制钉死**，并且会在 丁-2 真的让 loader 可区分失败、
有人正当地把文案加回来时**误红**。

⚠️ **给后续复核者的方法学提醒**：本文件（以及全仓约 8 个 spec）里仍有
「对整份源码/CSS 文本做正则」的断言。**任何**这类断言都必须匹配
**去注释后的副本**，否则注释可以满足它（本分支已栽三次：丙-4 F4、
修复批 1 的 `TABS_WITH_CATEGORY_CHIPS` 承诺、本节的 LOW-2）。

---

## 8. 丁-2 实施与审查记录（回填，2026-10-11）

### 8.1 提交链

| 提交 | 内容 | 规模 |
|---|---|---|
| `b393c00` | `feat(文风): 生成时可选「文风写作」，只影响这一次生成` | 16 文件，+2064/−20 |
| `ab43f59` | **我的文档订正**（5 处失实引用，见 §8.4） | 2 docs，+49/−18 |
| `2e23f79` | `fix(文风): 补上「不写项目设置」的真实守卫，并让临时选择随项目重置` | 7 文件，+265/−19 |
| `39f27e1` | `docs(文风): 订正注释里的行号引用与 chat 侧不对称的理由` | 5 文件，+43/−7（**纯注释**，非注释改动行 = 0） |

### 8.2 我下达的裁决（实施前就定死的，不是事后解释）

设计 §2.3 因 fail-closed 守卫只认**字面前缀** `【已启用文风画像】` 而给了三个选项，**我裁 (a)**：
- **(a) 接受不对称（实施的就是这条）**：覆盖走**同一个渲染器** ⇒ 形状与「已启用」路径同形，
  结构化画像两者都带前缀（都受守卫）、v1/旧画像两者都不带（都静默）。**覆盖绝不比启用路径更不安全。**
- **(b) 否决**：给旧画像补前缀 = 把今天能静默截断出稿的项目变成**硬停机**，用户可见的行为变更。
- **(c) 否决**：给覆盖另造前缀 = 覆盖比启用路径**更严格**（用户选了文风反而报错）。
- **禁令**：不改 `context-engine.ts` 的判据（守门文件）；**不伪造 fingerprint** 强行走结构化分支。

⚠️ **审查者据此判我的一条前提是错的**：设计 §2.3 原文要求「给 `writingStyle` 加 `includes` 检查…
**务必做**」—— 该要求与裁决 (a) **互斥**，交付代码没有它是对的。
⇒ 正确结论是**订正文档**，不是让实现补断言。已在 `ab43f59` 撤销该要求并写明两条理由。

### 8.3 三轮审查的结论

1. **spec 合规（`b393c00`）：COMPLIANT WITH CONCERNS。** S1–S10 功能要求全满足，
   裁决 (a) 落地正确（前缀生产点**唯一**、未伪造 fingerprint、`context-engine.ts` 未改），
   三态四个 hop 都守住，浅拷贝不原地改**被测住**，`writing-style-store.spec.ts` **零断言改动**。
   审查者逐条复跑实施者的变异：**18 条全部 CAUGHT**。
2. **修复批（`2e23f79`）验证：MERGE-READY，无断言被放宽。**
   它还**多做了三个变异**：依赖断言**双向**可判别（`[]` → 红；**删掉依赖数组** → 行为用例先红）；
   `[project?.path, dataVersion]`（多一个多余依赖）→ 用例单独红在「同项目内重新渲染不得清掉选择」
   ⇒ 该步骤**承重**。并现场验证了新断言**没被注释骗到**：新用例跑在 `stripComments()` 上，
   而**新注释里恰好写着那行字面量**，M-RESET 下仍红。
3. **注释订正批（`39f27e1`）验证：三条成立。**

### 8.4 ⚠️ 本批最有价值的三条发现

**F-1 / MF-1：UI 层「不写项目设置」的守卫是空的 —— 而它守的是用户决定 2（本批最重要的约束）。**
`chat-panel.mount.spec.tsx` 断言的是 **`writeFile`**，而文风库写盘走 **`writeFileAtomic`**
（两个不同的 mock）。审查者的复现是决定性的：**同一变异下旧断言通过、新断言双红** ——
即「选择器每次点选都真的改写 `enabledStyleId`」，在修复前**整个 737 文件的全量测试全绿**。
⇒ **教训**：用例名宣称的保证不等于断言的保证；「断言了某个函数没被调用」必须核对
**这个函数是不是那条路径真正用的那个**。修复后 `writeFileAtomic` + `createDirectory` 双层守住。

**F-2 / MF-2：临时覆盖跨项目存活，静默压掉新项目的启用文风；且有用例禁止修它。**
`chapterWritingStyleId` 缺了**相邻先例**（`setChapterDeAiSkillId(undefined)`）那次重置，
而 `preview-panel.test.tsx` 用 `not.toContain("setChapterWritingStyleId(undefined)")` 把偏离**钉死**。
⚠️ **但验证者端到端查完确认：这条今天不可达，是契约修复，不是活 bug** ——
A→B 必经 `project === null`（`handleSwitchProject` 的 `setProject(null)`），
而 `showShelf` 会把整个工作区子树卸载。验证者还**主动探了我没提的反例**：
`project === null && showGlobalSettings === true` 时工作区**确实挂载**，
但那时书架不渲染 ⇒ 项目切换入口不可达。⇒ 实施者写的**可达性交代必须保留**：
它把「契约」与「今天在踩的 bug」区分开，正是本分支最贵那条教训的正确用法。

**F-3 / C1：LOW-2 的「订正失准引用」在它落地的那个提交里又制造了三处失准引用。**
根因是**可预见的机制**：本批在 `writing-style-store.ts:53` 的注释改动净 **+1 行**，
把其后所有行号下移 1，而三处数字引用按挪动前的编号写（`:95`→实为 `:96`、
`:200`→实为 `:201`、`:94-95` 漏掉 `:96`）。
⇒ **教训（新）**：**注释里不要写行号，写符号名** —— 行号会被自己下一次编辑带偏；
写符号名则不会。已在 `39f27e1` 三处改为符号名。

### 8.5 ⚠️ 一处**由我的错误口径造成的**失实注释（如实记录）

我上一轮要求实施者在 `chat-panel.tsx` 的 21 行注释里写「`projectPath` 已在 `use-agent-config`
的依赖里 ⇒ registry 随项目重建 ⇒ 再加一处是**重复的第二重置点**」。**这条推论是错的**：
registry 重建**不会**清掉那个覆盖值 —— `getWritingStyleIdOverride` 是
`useCallback(() => sessionWritingStyleId, [sessionWritingStyleId])`，身份**只随 state 变、不随项目变**，
所以重建后注册的工具**仍调用同一个旧闭包**、仍返回旧 id。（`use-agent-config.ts:192` 确实列了它，
但那不代表它被重建。）另外「会多一个订阅」也不准：`chat-panel.tsx:928` **已经**订阅了 `project`。
⇒ 正确结论：**今日不做重置的唯一理由是 (i) 不可达**；(ii) 若写成「registry 重建就够了」是错的。
已在 `39f27e1` 改成如实版，并把「(i) 一旦不成立就必须补重置」写成**逻辑必然**而非并列理由。
⚠️ **这也是我自己犯的同类缺陷**（宣称了一个代码做不到的性质），记在此处备查。

### 8.6 ⚠️ 如实留下的东西（不要读成「全绿」）

- 文风的 fail-closed 守卫**只覆盖 `contextPackToPrompt` 一条路径**；项目级文风在
  `trim-context-plugin.ts:47-60` 与 context-hub `composer.ts:65` 仍会被**静默丢弃**。
  **既有缺陷，本批不修** ⇒ **不得声称「文风不会被丢了」**。
- `trimContextPack` 对 `writingStyle`（优先级 19）是**整段丢弃**而非截断 ⇒
  「选了一条很长的文风 → 结构化画像**停机报错** / 旧画像**不生效**」是**可达路径**。
  本批的缓解**只是 UI 提示**（浮层一行 + `title` tooltip），**不是守卫** —— 不看 tooltip 就看不到。
- **缓存泄漏只验证了推理、没有复现症状**：`STATIC_SOURCES` ⇒ `scope = {}` ⇒ 常量 key
  三条前提都在代码上逐一证实，但**没有**构造 context-hub 集成用例实测「第一次选的文风被
  永久缓存并泄漏到之后所有生成」。
- **无真机/真磁盘验证**：全部证据来自 jsdom + mock；`build:portable` 未跑。
  章节区那条路只有**源码文本断言**，没有「选文风 → 生成」的挂载用例。
- `use-writing-style-options.ts` 的 `errorMessage` 分支今天**不可达**（loader 从不 reject），
  实施者有**如实注释**承认 —— 与 丁-1 那个必须删的死分支形状相同，区别是这里由 prop 驱动
  且文档诚实，故判为可接受，**记录备查**。
- 选择器放在**两处**（章节工具栏 + 对话输入栏）超出计划 §2 步骤 4 的字面范围，
  但为满足「两头都接上、不造第二条 `getPlanBlueprint` 死通道」所必需 ⇒ 判为**范围内**。

---

## 9. 丁-3 实施与审查记录（回填，2026-10-11）

### 9.1 提交链

| 提交 | 内容 | 规模 |
|---|---|---|
| `e7cb3cd` | `feat(引用): 输入框 @ 文风引用真正接入本次生成的覆盖通道` | 10 文件，+545/−6 |
| `95b82e0` | `fix(引用): 补 丁-3 审查的三条缺口（优先级具体值 / 伪断言 / 空子 tab）` | 7 文件，+309/−40 |
| `49306c6` | `test(引用): 补空技能库时子 tab 不消失的断言（同批变异逼出来的）` | 1 文件，+33 |
| `5d032993` | `fix(引用): 补 丁-3 复核的承重回退断言 + 把文风缺席钉成行为断言` | 7 文件，+247/−65 |
| `cc3f48f6` | `docs(引用): 订正三处不准确注释（子 tab 守卫的归属 / 行号引用 / fixture 判别力）` | 4 文件，+19/−6 |

**⚠️ 这条子批跑了 4 轮（1 实现 + 3 轮审查/修复），是本分支最贵的一条。** 原因见 9.3。

### 9.2 通道（改前完全不存在）

改前：`SkillSubtype` 只有 `"deai" | "writing"` ⇒ UI 上**产不出**文风 token；
`chat-panel.tsx` 的 `handleSend` 把 token 只交给 select-skills-plugin（取技能 id 列表），
整条 chat 路径上唯一的文风值是工具栏选择器的 `sessionWritingStyleId`。
⇒ **「在输入框里点名文风」在生成链上没有任何消费者**（计划 §3 步骤 4 的原话），是彻底的死通道。

改后（逐跳）：`useWritingStyleOptions` → provider getter 追加文风条目
（`id` = 预设 id，经 `providers.ts` 落在 `ReferenceToken.skillId`）→ 子 tab「文风」→
`collectReferencedStylePresetIds(tokens)`（新模块 `style-reference.ts`）→
`runWritingStyleIdOverrideRef.current`（**每次发送都写**，无引用时写回 `undefined`）→
`getWritingStyleIdOverride` → `useAgentConfig` 第 4 个入参 → `tools/index.ts` →
`run-chapter-workflow.ts` → `deep-chapter-generation.ts` → `resolveWritingStylePreset`。
**全链无第二个覆盖参数，也没有把临时覆盖塞进全局 store。**

**两处裁决（已生效）**：
- **优先级**：`@` 引用 > 工具栏选择器 > 项目启用项，**包括选择器为 `null`（本次不用文风）时引用仍然赢** —— 否则刚敲的引用被静默丢弃。
- **两条不同预设的引用 ⇒ 拒绝发送**（可见提示、芯片与输入保留、不产生消息、不写覆盖值）。
  ⚠️ 这**主动不采用**设计 §3 第 4 条的「后者覆盖前者 + 提示」：覆盖通道结构上只收一条，
  「挑一条赢」等于静默丢掉另一条明确指令，而芯片顺序对用户不可见、提示也可能被忽略。
  **裁决理由已写进代码注释，设计文档也据此订正。**

**大纲/细纲面板有意不注入文风条目**：该面板的三处 `buildAgentConfig` 从不传
`runDeepChapterGeneration` / `getWritingStyleIdOverride`，`tools/index.ts` 的注册守卫要求前者，
⇒ `run_chapter_workflow` 在那里根本不注册，加了就是死条目。

### 9.3 ⚠️ 四轮里发现的三条（都属同一病理：**「看着接上、其实断开」**）

1. **第 1 轮（spec 审查）**：核心需求达成，但发现 **`@` 引用 > 工具栏「具体选中文风」这一半零覆盖**。
   审查者的变异（让具体选中值赢、`null` 不赢）**带着整个 738 文件套件 + typecheck 存活**。
   关键量测：修复后重放该变异 ⇒ `1 failed / 20 passed`，失败的**只是**新补的那条，
   `null` 那半**照样绿** —— 精确证明了覆盖缺口的形状。
2. **第 2 轮**：一条**钉注释的伪断言** —— `outline-chat-panel.spec.tsx` 的
   `toContain("本面板的 agent 配置")`，该短语在源码里**只出现在注释中**，
   把注释措辞改一个字它就红 ⇒ **行为保证为 0，且是假阳性发生器**。
   同时发现 `ReferencePickerDialog` 的子 tab 过滤**零覆盖**（该 spec 的 fixture 根本没有 skill provider），
   以及大纲面板会摆出一个**永远空的「文风」子 tab**（`SKILL_SUBTABS` 是模块级全集、无条件渲染）。
3. **第 4 轮（复核第 3 轮修复）**：`effectiveSkillSubtab` 的**回退零覆盖** ——
   变异去掉回退 ⇒ 9 passed。而该回退**承重**：生产可达路径是
   「禁用全部去AI味技能 + 有 ≥1 文风预设 + 无写作 Skill」⇒ `items` 非空但无 `deai` 条目，
   打开即**空列表且无高亮**。

**⚠️ 本批最有价值的方法学产出：把「继续收紧正则」改成「结构性断言」。**
第 2 轮的正则钉子有两条已实测的逃逸面（`subtype :` 冒号前多空格、`import { X as Y }` 别名导入）。
继续收紧是**军备竞赛**。实施者改为把大纲面板 provider 的条目构造**提取成具名导出函数**
`buildOutlineReferenceSkillEntries(deAiSkillConfig, writingSkills)`，测试**直接断言其产出**。
效果：**两条逃逸面一次性从 SURVIVED 变成 CAUGHT**，而正则那两条**仍然绿** ——
逃逸面真实存在，只是不再承重。正则降为第二层（它独家覆盖「在组件里 wrap」那种形态，实测互补）。
⚠️ **仍有已知合取缺口**：在 builder **之外**注入 + 排版逃逸**同时**发生 ⇒ 两层全绿（实测 138 passed）。
要根治需让 provider 产出本身可断言（接口改动），本批不做 —— **已在测试注释里如实记录该边界，未写成「不会漏」**。

### 9.4 ⚠️ 第 4 轮复核**推翻**了实施者一条自述
实施者声称把 fixture 的 `enabledStyleId` 从 `"style-b"` 换成 `"style-c"` 是「真的加强了判别力」。
复核者的决定性实验：**只把 `enabledStyleId` 改回旧的 `"style-b"`（保留新增预设）⇒ 21 passed 全绿**。
⇒ 当前**没有任何断言能区分新旧 fixture**：`toBe("style-b")` 读的是 getter 的直接返回值，
而 getter 既不读 store、也落不到项目启用项，所以「下游回退到项目启用项」这条通道在该断言处**根本不经过**。
**如实结论：那是一次良性的「去掉 id 撞名」卫生改动，价值是潜在的，不是可演示的判别力增强。**
（注释已按此订正。这是本分支「宣称 > 代码」缺陷类的又一次，由复核者抓住。）

### 9.5 一处**给后续审查者**的方法学修正（来自实施者）

证明「纯注释改动」不能只比 `ts.transpileModule({removeComments:true})` 的 **raw emit 字节** ——
**TS 发射器会保留被删注释所占的换行**，所以多写/少写几行注释会改变 emit 的空白，
把一个纯注释改动**误报**成改动（本批实测误报过一次）。
⇒ 正确口径：**`removeComments` 之后再归一化空白比 token**。raw emit 只能用来排除「代码变了」，
**不能单独证明「代码没变」**。

### 9.6 如实留下的东西（不要读成「已全绿」）

- **这条覆盖通道是组件级、不是 run 级**：值存在 panel 的 ref 里，同一面板内 >1 个会话并发运行时，
  后一次发送会改掉前一次仍在跑的 run 读到的值。它**不比既有的 `getSelectedSkillsPrompt` 更糟**
  （同一形状：发送时写 ref、getter 读、无入参），本批没有改善也没有恶化。
  今天做不了 per-run —— `ToolExecutionContext` 只有 `callId/toolName/onTool*` 五个字段，**没有会话 id**。
- **未跑 `build:portable`**、未接真实 LLM ⇒ 「模型真的用那个文风写出来」无法在单测里断言；
  能断言到的最强证据是「提示词里只有目标文风、项目启用项一个字都不出现」。
- **`outline-chat-panel.spec.tsx` 里 283 条断言仍读原始 `source`**，其中 **3 条只可能被注释满足**
  （`:610`、`:1750`、`:2022`）。**本批 hunk 之外、非本批引入**，但建议该文件 owner 一次性收口；
  其中 `:610` 最该优先 —— 它长得像行为断言却只可能被注释满足，是会**误导读者**的一条。
  最小改法是**删掉那一行断言**（相邻两条是真的行为钉）；改成 `sourceWithoutComments` 会**按构造必然失败**。

---

## 10. 丁-5 实施与审查记录（回填，2026-10-11）

### 10.1 提交链

| 提交 | 内容 | 规模 |
|---|---|---|
| `0027e901` | `feat(故事skill): 拆书发布桥接到 storyFrameworkBinding 真正读的存储` | 13 文件，+1079/−8 |
| `71ac4b3e` | `test(故事skill): 钉住占位句取值、退化判据边界与桥接错误策略` | 5 文件，+193/−17（**纯测试守卫 + 注释**） |

### 10.2 路线 A 与「id 即文件名」

`bridgePlotFrameworkToStoryFramework(projectPath, framework)` = 纯转换 + 已导出的 `saveFramework`，
**零新增注入代码**。消费端因果链：`storyFrameworkBindingDataSource` 做
`frameworks.find(f => f.id === binding.frameworkId)`，**找不到就 `return ""`（静默空串，不抛错）**；
`saveBinding` 存的是 `framework.id`；`saveFramework` 的落盘路径 = `.qmai/simulations/frameworks/<id>.md`
—— **id 即文件名**。⇒ id 必须由来源**确定性派生**。

### 10.3 🔴 计划里被实测推翻的两处（**实施者独立发现，价值很高**）

1. **计划只列了 2 个发布方，实际有 3 个。** §4.2 步骤 2 只点名 `workbench-publish.ts` 与
   `story-analysis-adapter.ts`。实施者用 `upsertPlotFramework` **反查调用方**，发现第三个生产发布方：
   **`book-analysis-view.tsx` 的 `handleStoryFrameworkConfirm`**（侧栏「旧框架入口」）。
   只桥两个会让这条入口复现计划自己警告的「只做一半」。**复核者反查后确认「没有第四个」。**
2. **⚠️ 计划建议的 `plot:${pf.id}` 前缀在 Windows 上不可用 —— 冒号是 NTFS 备用数据流（ADS）语法。**
   实施者实测（node 直接写 `plot:wb-story-book-1.md`）：
   ```
   write error: null
   dir entries: ["plot", "probe.cjs"]     ← 文件真名是 `plot`，没有 .md 后缀
   readFileSync(target) 竟然能读回 hello  ← 所以「发布成功」永远静默
   ```
   `loadFrameworks` 的 `.md` 过滤会**跳过**无后缀的 `plot` ⇒ **发布成功但永远读不回来**。
   复核者用**忠实的 node/libuv 探针**独立复现（并指出 **`.NET File.WriteAllText` 不是忠实探针** ——
   它直接 EINVAL 拒绝 `:`），还复现了 `do_write_file_atomic` 的 tmp→`fs::rename` 流程 ⇒
   **`rename` 报 EINVAL + 残留隐藏 `.plot`**，即原子路径下是 `saveFramework` **未捕获的 Err**。
   两种路径都永远读不回来；`do_write_file_atomic` 的文件名**零净化**（复核者读代码确认）。
   ⇒ 改为 `` `plot-` + 定宽百分号转义 ``（非法字符 → `%` + 6 位大写十六进制）。
   **单射性经复核者暴力验证**：对真实函数用 22 个符号 × 长度 1–3 = **10,670 个串**对拍，
   **0 个非 `trim` 解释的碰撞**（2,949 个碰撞全是首尾空白，而 `normalizePlotFramework` 已 `trim()` id，不可达），
   并有结构性证明（安全集排除 `%`、定宽 6）。**无数据损失。**

### 10.4 三条如实记录

- **`sourceChapters` 语义与原生生成器不一致**：桥接用 `rangeChapterIds.length`（章节 **id** 数），
  原生用 `extraction.chapterContents.length`（**实际读过**的章节数）；只在 `simulation-report-agent`
  当**散文标签**消费。计划**明确认可**由 `rangeChapterIds.length` 推，故合规 ——
  **但「id 已不存在的章节」的高估没测**，实施者补了一条语义钉子使「改成去读真实文件」必须是一次有意识的决定。
- **三个发布方的桥接失败处理刻意不对称**：`workbench-publish.ts` **不 catch**（契约是「要么整批成功、要么什么都没发生」，
  确认由用户发起、**可重试**），`story-analysis-adapter.ts` **catch + console.warn**（故事导图是主产物，
  四段框架是已标注的兼容产物）。两处均已注明「刻意的不对称，不是漏写 try/catch」。
  ⚠️ 实施者**纠正了计划的口径**：「抛错 ⇒ 该次修订**永远**不被确认」不准确 —— 可重试即收敛。
- **`EMPTY_STORY_BEAT` 按值钉住**：复核者发现退化检测的判据可被弱化成「首尾相同」而无人报警
  （`["甲","乙","甲","甲"]` 会回归成**假阳性警告**），且 `EMPTY_STORY_BEAT` 的**值本身未钉**
  —— 正是实施者为 `DEFAULT_SIMULATION_MODE` 已做过、却**漏在这里**的同一种加固。三条已补齐。

### 10.5 ⚠️ 一处**我自己造成**的环境缺陷（已修复，记录备查）

为了并行推进，我把 `qmai-wt-d5` / `qmai-wt-d4` 的 `node_modules` 做成**指向主工作树的 Junction**。
后果：Vite 6+/7 把符号链接**解析成真实路径**再做 `server.fs` 允许列表判定 ⇒
`node_modules/macos-traffic-lights/svg/close/active.svg?url` 落在项目根之外 ⇒
**`src/components/uitest/ui-test-shell.spec.tsx` 收集阶段失败**（≈32 条用例不被计入，`test:mocks` 退出码 1）。
- **只影响这一个文件**（该包的唯一 importer 是 `mac-traffic-lights.tsx`，9 个 svg import）。
- **不掩盖任何回归**：实施者与复核者各自用「只 import 未改动组件的探针」复现同一 `Denied ID`，
  报的是 `Tests no tests`（收集期，非断言期）；在主工作树（`node_modules` 是真实目录）该 spec **32/32 通过**。
- **修复**：`robocopy /E` 到临时目录 → `cmd /c rmdir` 删 Junction → `Move-Item` 就位；`LinkType` 变空、**32/32 通过**。
⇒ **教训：跨工作树共享 `node_modules` 不能用符号链接/Junction，必须 `npm ci` 或真实复制。**
⚠️ 这也解释了本分支一度出现的「基线 7419 与逐文件增量对不上」的困惑：
**无 Junction 的 HEAD = `7435 + 32 = 7467 = 7419 + 48`**，与逐文件声明**精确吻合**。

---

## 11. 合并与最终实测（2026-10-11）

### 11.1 合并方式：三条子批并行于独立工作树，最后合并

由于三批都要跑重型套件、而这个仓库**同一棵工作树同时只能有一个测试进程**（见 §5），
丁-3 之后的剩余工作改为**平行工作树 + 子智能体**推进：

| 工作树 | 分支 | 承担 |
|---|---|---|
| `.worktrees/scratch-20261010` | `work/scratch-20261010` | 丁-3（主树，也是最终合并目标） |
| `C:\QMAI_C\qmai-wt-d4` | `work/scratch-20261010-d4` | 丁-4 |
| `C:\QMAI_C\qmai-wt-d5` | `work/scratch-20261010-d5` | 丁-5 |

**动手前先算了重叠面**（`git diff --name-only e7cb3cd <each>` 求交）：

- 丁-3 ∩ 丁-5 = **0 文件**、丁-4 ∩ 丁-5 = **0 文件** ⇒ 丁-5 **零冲突**并入（`9f53f7e3`）。
- 丁-3 ∩ 丁-4 = **6 文件**（`types.ts`、`ReferencePickerDialog.tsx`、`chat-panel.tsx`、
  `outline-chat-panel.tsx` + 两个 spec）⇒ 预期冲突，实际只有 **2 处**真冲突。

### 11.2 两处冲突的解决（都按「两边改动并存」，没有丢任何一边的契约）

1. **`outline-chat-panel.tsx` 的 skill provider**：丁-3 把条目构造**抽成了具名导出**
   `buildOutlineReferenceSkillEntries(deAiSkillConfig, writingSkills)`，丁-4 在**同一个位置**
   内联注入了灵魂条目。若任选一边，都会丢掉另一边的保证（选丁-3 ⇒ 灵魂条目消失、
   大纲面板引不到灵魂；选丁-4 ⇒ 丢掉「产出里永远没有文风条目」这条**可行为断言**的性质）。
   **解决**：把灵魂投影**并入那个具名函数**（新增第三个入参 `characterSouls`），组件侧只留一行调用。
   ⇒ 两边契约同时成立：丁-3 的行为断言仍直接调该函数看产出；丁-4 的 **AST** 钉子
   （`soulEntries = characterSouls.map(...)`、且被摊进同一数组）仍落在函数体内、按结构匹配得到。
   ⚠️ 丁-4 用 AST 而非源码文本这一点在这里**救了场**：AST 断言走的是全文件结构，
   所以「把这条声明搬进一个具名函数」不需要改断言；若当初是文本正则钉死位置，这个合并会直接假红。
2. **`ReferencePickerDialog.spec.tsx`**：两边在**同一位置**各加了一组「技能库子 tab 过滤」用例，
   且各自补了收尾括号（git 把两侧共用的一行 `})` 当成了公共上下文，所以两侧各自都少一个闭括号）。
   **解决**：两组**都保留**（互补 —— 丁-3 那组钉「过滤 + `effectiveSkillSubtab` 回退」，
   丁-4 那组钉**第四个子 tab「角色灵魂」**的过滤与确认契约）。
   ⚠️ 顺带订正一处**合并引入的**计数变化：丁-4 往 `SKILL_SUBTABS` **全集**加了「角色灵魂」，
   于是「技能库整体为空」时逃出口摆出的是**四条**子 tab 而不是三条。
   那条断言正是「逃出口 = 模块级全集」这条性质的钉子，**必须随全集一起变**
   —— 这是本轮唯一一处「合并让既有断言必须改值」的地方，理由已写进该测试的注释。

**合并后逐文件对账**：`ReferencePickerDialog.spec.tsx` = 12（丁-3 的 10 + 丁-4 的 2）；
`outline-chat-panel.spec.tsx` = 140（基线 132 + 丁-3 的 6 + 丁-4 的 2）。
两处都对得上，没有静默丢用例。

### 11.3 最终实测结果（全部在本树实跑，未跑主检出）

| 项 | 命令 | 实测 |
|---|---|---|
| 全量测试 | `npm run test:mocks` | **743 文件 / 7524 通过 / 6 todo / 0 失败 / exit 0** |
| 类型检查（生产） | `npm run typecheck` | **exit 0** |
| 类型检查（测试） | `npm run typecheck:tests` | **exit 0** |
| 守门 ① 冻结面 | `git diff a5a2702 HEAD --` 四个守卫文件 + `context-hub/**` | **0 文件** |
| 守门 ② `autoSaveable` | 值 | **`[]`**（`:841`），该文件相对 `a5a2702` **未改** |
| 守门 ③ 事件细纲 | `git grep 事件细纲 -- outline-context-index.ts` | **空** |
| App.tsx 内容 | `AppLayout` / `WelcomeScreen` / `IS_UI_TEST_BUILD` | **0 / 0 / 0** |
| `preview.formatWriting` | 计数 | **2**（`:2931` / `:3033`） |
| `openBodyFontPopover` | 计数 | **2**（`:2575` / `:2623`） |
| 默认侧栏顺序 | `DEFAULT_SIDEBAR_NAV_ORDER` 是否含文风视图 | **不含** |
| 便携构建 | `npm run build:portable` | **exit 0**，产出 `release-portable\QMaiWrite.exe` + `version-info.json` |
| EOL 假阳性 | `git diff HEAD --name-only -- tests/fixtures 'docs/*/dump.html'` | **0** |

分支总规模：`a5a2702..HEAD` = **152 文件，+31284 / −733**（含 甲 / 丙 / 丁 三批与全部文档）。

### 11.4 ⚠️ 全量套件里发现的**一个既有、与本分支无关**的 property 测试失败

第一次全量跑出现 **1 条**失败（第二次干净通过），**不是本分支引入**：

```
FAIL src/lib/sweep-reviews.property.test.ts > extractJsonObject — properties > extracts a fenced JSON object
Error: Property failed after 38 tests
{ seed: 719407758, path: "37:1:2:3:34:29:28", endOnFailure: true }
Counterexample: [{"":{"```":null}}]
Caused by: SyntaxError: Unterminated string in JSON at position 6 (line 1 column 7)
```

**判定为本分支无关的三条证据**：
1. 该文件与 `src/lib/sweep-reviews*` 相对 `a5a2702` **零改动**（`git diff --name-only a5a2702 HEAD` 为空）；
2. 单独跑 **3/3 通过**（fast-check 每次换种子 ⇒ 这是**种子相关的** property 失败，不是稳定回归）；
3. 第二次全量跑 **0 失败**。

**但它是一个真实的生产代码边界缺陷**（值得单开一批），机制已定位到确定的代码行：
`src/lib/novel/book-analysis/llm-json.ts:9`
```ts
const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
```
`([\s\S]*?)` 是**非贪婪**的 ⇒ 当 JSON **载荷自身**含 ``` 时，围栏正文会在**第一个内层** ``` 处被截断。
反例 `{"":{"```":null}}` 包成围栏后，捕获到的是 `{"":{"`，于是 `JSON.parse` 报
**「Unterminated string at position 6」** —— 与实测报错**逐字吻合**，机制确认。
`L11` 那条 `^…` / `…$` 锚定的兜底写法是**正确的**，但它只在 `fenced === null` 时才被走到。
⇒ 主路径被非贪婪匹配劫持：LLM 输出的正文里只要出现 ``` （例如引用代码块、或某个字段值就是三个反引号），
抽取就会静默截断。**同一函数被 `judgeBatch` 在生产路径调用。**
（本批**未修** —— 它不在 丁 的范围，且属另一批的职责；此处记录以便单开。）

⚠️ 另需留意该 property 测试自身的**审计线索**（测试文件头部注释已诚实写明）：
它 import 的是 `extractJsonObjectCandidate`（`llm-json.ts`），而非 `sweep-reviews.ts` 内部那份
`extractJsonObject` —— 后者的 `export` 在提交 `01aab5f` 被移除，测试无法再 import，
于是在测试侧加了一层 `null → ""` 归一化适配。两者语义等价但**是两份实现**
⇒ 这条 property 覆盖的是 `llm-json.ts` 那份，**不是** `sweep-reviews.ts` 那份。记录备查。

---

## 12. 丁-4 实施与审查记录（回填，2026-10-11）

### 12.1 提交链

| 提交 | 内容 | 规模 |
|---|---|---|
| `a5ef76b6` | `feat(角色灵魂): 输入框 @ 引用角色灵魂并真绑定到小说人物（丁-4）` | 22 文件，+2304/−37 |
| `5443193e` | `fix(角色灵魂): 按快照完整还原绑定（含 aliases），并把源码钉子改成语法树（丁-4 复核修正）` | 5 文件，+333/−55 |

### 12.2 「引用是**这一条消息**的临时绑定」是这条的难题

灵魂与文风不同：**注入条目 ≠ 已绑定**。用户 `@` 一条灵魂之后，写盘那一步在
`handleSend` 里、**用户确认之后**，而绑定表是 **1:1 按 `characterName`** 的
（`bindCharacterAura` 会**覆盖**既有绑定，`character-aura.ts:513-516`）
⇒ 必须做到「用完还原**用户原本的**绑定」，否则就是**静默改用户数据**。

**实现**：先**快照**既有绑定，再在 `finally` 里按快照还原；
并额外在两处 `SourceCanonOverflowError` 的**提前 `return`** 上显式释放（那两处在生成块之外）。
**复核者做了穷尽枚举验证**（写盘 `chat-panel.tsx:1816` 之后窗口内的每一个出口）：
并发上限 `return`（`:1839`，写盘后）、两处 `SourceCanonOverflowError`（`:2079` / `:2218`）、
catch 内 aborted / session 失效（`:2779`/`:2780`，走 `try:2348` ⇒ `finally:2803`）、正常完成；
`:1908/:1920/:1941/:2003` 在 `markDone` 箭头**内部**（非 handler 出口）、`:1826` 在写盘前。
并逐个验证窗口内**无 throw**（`contextHub.prepare`、`saveSnapshot`、`runNovelPrePluginChain`、
`loadEffectiveDeAiSkillSafely`（全函数 total）、`buildAgentHistoryMessages`（外层 try/catch total））
⇒ **未发现任何可留下临时绑定的路径**。与「删掉 `finally` 释放」变异 ×3 全红互证。

### 12.3 🔴 复核者的 must-fix：`aliases` 在「同一条」分支**静默丢失**（真实数据损失）

实施者的三分支还原里有一条短路：**「快照里就是同一条灵魂 ⇒ 什么都不做」**。
复核者用探针实测证明这个前提**不成立**：
`beginMessageScopedSoulBinding` 递给 `bindCharacterAura` 的只有 `{ characterName, auraId }`，
而后者落盘 `{ ...binding, characterName }` ⇒ **临时写入这一步就已经把原绑定的 `aliases` 抹掉了**。
```
afterBegin  = [{"characterName":"李四","auraId":"custom-a"}]
afterRelease= [{"characterName":"李四","auraId":"custom-a"}]   // 原 aliases ["四哥"] 没了
```
⇒ 短路返回等于**把用户的别名永久删掉**；而 `buildCharacterSoulContext` 正是靠 `aliases` 认人的
（别名命中会让这条灵魂进入上下文）⇒ **后果不只是界面显示，是上下文内容变了**。
**修法**：有原绑定就**一律**按快照完整写回，**不设**「看着没变就跳过」的短路；
并把「多写一次盘」这个**刻意的代价**写进注释（防「比较器漏字段」这类静默丢数据）。
**反向验证**：「另一条」分支的 aliases 还原是真的（改成显式字段 ⇒ CAUGHT ×1）⇒ 缺口只在这一条分支上。
新用例断言因果链**两半**（临时写入后盘上确实只剩 `characterName + auraId` ⇒ 释放后 aliases 回来）；
把短路放回去 ⇒ **只有这 1 条红、其余 13 条全绿**，印证了「现有 13 条用例无一变红」。

### 12.4 ⭐ 源码钉子改用**语法树**，而不是 strip 注释（本批最佳实践）

复核者发现大纲面板的 release 钉子**可被注释满足**：把
`await releaseMessageSoulBinding();` 改成 `// await releaseMessageSoulBinding();`
**+ `void releaseMessageSoulBinding;`**（保持标识符被使用）⇒
`tsc -p tsconfig.app.json --noEmit` **exit 0**，两个 spec **166 passed 全绿**。

我给出的最低要求是「改成对 comment-stripped 副本断言」，实施者**主动升了一档**：
改成用 `ts.createSourceFile(..., ScriptKind.TSX)` 解析后**按结构**断言。**为什么这比 strip 更硬**：
strip 之后**仍然是在匹配文本**（永远要跟格式/引号/换行较劲，且 strip 正则自己还要正确理解字符串里的 `//`）；
而 **AST 里根本没有注释这个节点** ⇒ 被注释掉的调用**不存在**，`void f;` 也变不出一个 `CallExpression`。
钉子断的是**位置关系**：该调用必须落在某个 `try` 的 `finallyBlock` 内，且该 try 的 catch
正是生成失败那一条，同一 finally 里还必须留着原有的运行槽清理。
**两处变异都被抓到**：注释掉（`expected 0 to be greater than 0`）、
挪进 `try` 体内（`expected [] to have a length of 1 but got +0`）—— 后者正是「生成失败就不还原」。
⚠️ 它**主动放宽**了一处：断「**所有**还原调用都落在这个 finally 里」而非「**恰好一处**」，
否则将来有人为提前 `return` 另加释放点时会**误报** —— 而那本来是**正确**的改法。
⇒ **这条经验值得推广**：本分支三个子批**都**栽在「源码文本断言被注释满足」这同一个坑上
（丁-1 一条、丁-3 一条、丁-4 一条、丁-5 一条），AST 是目前最好的解药；
丁-3 那条「提取成具名函数、断言其产出」是另一种（行为断言）。
**两者结合**：行为断言负责「产出对不对」，AST 负责「调用在不在这里」。

### 12.5 另外三条订正

- **注释过度声称**（`unified-skill-library-view.tsx`）：原写「写成 `entry.type !== "style"` 时…
  **在搜索时抛错**（不是编译错误，是运行时崩溃）」。实测还原该谓词并保留 `soul` ⇒
  **1 处 `TS2339: Property 'rawSkill' does not exist`（编译错误）**，事故等级高了一档。
  已改成事实，并补了一句**更重要的**限定：类型系统拦得住是因为这里**恰好**取了
  「只有部分成员才有」的字段；真正危险的是取一个**所有成员都有**的字段（如 `entry.kinds`）
  —— 那种分支**类型系统不会报错**，只能靠人想清楚。
- **`claim 11` 的理由不准**：实施者称「`handleOpenEntry`/`handleToggleEnabled` 运行时不可达
  ⇒ 任何行为用例都杀不掉」，复核者实测**能力标志有行为钉**
  （`ENTRY_CAPABILITIES.soul.openable` / `.toggleable` 改成 `true` 各 CAUGHT ×1）。
  子句成立（那两个 `case` 确实不可达、只能靠源码形状兜底），但「这一整块没人管」是错的。
- **实施者自己引入的 2 条 flaky 是真缺陷**（不是环境噪音）：
  根因是 `waitForRunSettled` 在「运行还没开始」时**立刻返回**
  （`runStates[id]` 是 `undefined`，而 `undefined?.status !== "running"` 为真），
  于是断言跑在确认之后那串异步链之前。它**没有**接受「再跑一次就绿了」，
  而是给存储读取注入 `setTimeout(…, 4)` 做**确定性**复现（旧写法在该延迟下**必然**红，
  且报出与全量套件里**逐字相同**的断言；新写法同一延迟下全绿），并改成**条件等待**。
  ⚠️ 这类「失败的是我自己新写的测试」必须与真回归区分开 —— 它的做法（确定性复现 + 反证
  「失败的两条都不走我改的那条分支」）是正确的处理方式。

### 12.6 如实留下的东西

- **大纲面板的绑定行为**只有源码级/AST 级钉子 —— jsdom 跑不了它的生成链，
  **不是行为保证**。行为面的对照在 `soul-reference.spec.ts`（产出端 ↔ 消费端契约）
  与 `message-scoped-soul-binding.spec.ts`（真绑定的读写与还原）。
- **风险 7 只通过 `describeSoulBlastRadius()` 提示**，且**只在选中之后**显示、**从不阻断**
  （计划只要求「说明如何缓解」⇒ 达标，但缓解是**滞后**的）。
- **`sourceChapters` 语义**与原生生成器不一致（见 §10.4）。
- **junction**：丁-4 实施者选择**不**替换（代价是 robocopy 整套依赖期间无法验证任何东西，
  而归因与数字已算清）⇒ 该树里 `ui-test-shell.spec.tsx` 仍是 fail-to-collect。
  我按「无 junction 口径 = `+1`」记：无 junction 应为 **7468**。



