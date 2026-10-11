# character-skill 分支说明

## 分支用途

本分支为「**人物 Skill**（技能库·随章节持续学习）」功能分支。

需求原文：*「关于当前小说中的人物，我们也将其定义为『技能库』。在技能库中还需要增加一个功能，我们将其称为『角色 skill』。这个『角色 skill』是会不断学习、不断提升的。」*

即：

1. **初始生成** —— 第一章出现的人物，AI 分析其风格、说话方式、性格，自动生成一份 skill 进技能库。
2. **持续完善** —— 该人物后续每次出场，AI 继续完善这份 skill，让形象逐渐饱满。
3. **人为编辑** —— 用户可以自己编辑 skill 内容。

## 命名：为什么叫「人物 Skill」而不是「角色 skill」

仓库里原本**已有三套**东西都叫「角色 skill」，互不相干：

| 代号 | 名称 | 落盘位置 | 绑定本作人物 | 可持续完善 | 已注入写作上下文 |
|---|---|---|---|---|---|
| A | 拆书库角色 Skill | `book-analysis/<bookId>/skills/` | ❌ 是**别的作品**里的角色 | ⚠️ 可重新生成 | 仅通过 C 间接进入 |
| B | 写作 Skill 库的「角色」分类 | `<project>/writing-skills.json` 内 `categoryId="skill-category:character"` | ❌ 全局通用技能 | ❌ | ✅ 走 skill-route |
| C | 角色灵魂 CharacterAura | `.qmai/character-aura.json` + `.qmai/character-auras/<slug>-perspective/SKILL.md` | ✅ 按 characterName 绑定 | ✅ | ✅ |

本功能是**第四套**。为避免歧义：

- **界面上**叫「**人物 Skill**」；
- **内部标识**一律 `persona-skill-*`（文件名、`.qmai/persona-skills/`、`activeView = "personaSkillLibrary"`、函数名 `learnPersonaSkillsFromChapter` / `buildPersonaSkillContext` 等）。

**A / B / C 三套一个字都没有改动。** 本功能与它们完全隔离，只是同样接在 `ingestChapter()` 这条摄取链上。

## 设计要点（详见 `docs/superpowers/specs/2026-10-10-persona-skill-design.html`）

- **D1 分级建档**：角色定位读自 `wiki/characters/角色-<定位>-<名>.md` 的**文件名**（不读正文）。主角/男主/女主/反派/导师 → 首次出场即建档，之后每次出场都完善；配角/男配/女配/盟友 → 第 2 次出场建档、第 3 次起完善；**未标注定位** → 出场 ≥3 次才按 minor 处理（自动滤掉一笔带过的路人）；纯龙套永不建档。
  - **兜底判据（2026-10-11 线上修复）**：定位目录**只有跑过「人物」多智能体生成才存在**，真实项目里往往没有。此时若该人物在 `wiki/entities/` 下有 `tags` 含 `character` 的实体页（与既有 `character-aura.ts` 同款判据），即视为**已确认是本作真实人物**，建档门槛降回 **1**。档位仍是 minor（注入只给 2 段）。这条判据天然斩断路人——一笔带过的「老太太/老头/小男孩」不会建实体页。
- **D3 一章一次调用**：整章所有待处理人物**合并为一次** LLM 请求，与出场人数无关，每章 ≤1 次。挂在「提取记忆」上、后台 `void` 异步，不拖慢按钮。
- **D4 三态生命周期**：`active` → `dormant`（连续 10 章未出场）→ `archived`（30 章）。**永不自动硬删**文件。绿勾人物豁免。
- **D5 分级注入**：主要人物注入 5 个「演技」字段 + 压缩后的 SKILL.md；次要人物只注入「怎么说话」「怎么判断」；休眠/归档不注入。排序 pinned → major → minor，同档按出场次数降序，最多 12 人，总量封顶 4000 字。
  - **「注入」不等于「学习」（2026-10-11 澄清）**：D5 只管**写正文时注入几段**；**建档与落盘一律写全 5 个字段**（`PERSONA_STORED_FIELDS = PERSONA_MAJOR_FIELDS`）。minor 的 `SKILL.md` 在文件里是完整的 5 段，只是注入时被裁到 2 段。理由：① 用户要「第一章角色一出现 skill 就成型」，提示词只问 2 个字段的话模型连另外 3 个都不产，卡片永远缺 3 格；② 学习成本与字段数无关（整章合并成一次请求），稀缺的是注入预算。两处字段来源刻意分开（`PERSONA_STORED_FIELDS` / `PERSONA_MINOR_FIELDS`），别把其中一处改成引用另一处。

  字段表刻意**只答「这一场该怎么演他」**：`怎么说话 · 怎么想 · 怎么判断 · 什么不做 · 知道局限`。设计原文还列了「分类 · 摘要」，实现时确认删掉（人物名/定位/档位由区块标题行给出，SKILL.md 摘要又单独注入，重复占预算）；也刻意不装「关系网 / 成长轨迹 / 底线与逆鳞 / 在意什么」——那些归研究文件，只给绿勾人物（D6）。判定标准：*这个字段答的是「这一场该怎么演他」，还是「他这个人是怎么长成的」？只有前者进字段表。*
- **D6 绿勾（pinned）**：用户手动标记的重要人物。一票否决：永不归档、最高档位注入、每次出场都重点分析，**并且是唯一会生成「研究文件」的角色**。
- **D7 落盘**：`.qmai/persona-skills/index.json`（元数据）+ `sightings.json`（未建档人物的候选池）+ `<id>/SKILL.md` + `<id>/references/research/`（仅绿勾）。
- **用户手改优先**：用户编辑过 SKILL.md 后（`editedByUser = true`），AI 后续只在文末追加 `## 补充（第 N 章）`，**逐字保留**用户既有段落，不再整份覆盖。

## 不可违背的约束

1. **保存正式章节不自动摄取。** 人物 Skill 学习只挂在 `ingestChapter()`（用户点「提取记忆」）里，绝不挂在「保存章节」上。
2. **`ingestChapter` 的签名不可改。** `chapter-ingest.spec.ts` 用源码字符串断言 `export async function ingestChapter`。
3. **打包体积边界。** `context-engine.ts` / `review-adapter.ts` 对 `character-aura` 只能动态 `await import()`（`bundle-boundaries.spec.ts` 强制）。
4. **新增 LLM 调用**一律走 `resolveNovelModel(llmConfig, novelConfig, "extract")`。
5. **草稿隔离**：草稿若不保存，不得进入摄取链。

## 实现清单

**新增（11 个文件）**

| 文件 | 职责 |
|---|---|
| `src/lib/novel/persona-skill-types.ts` | 档位、阈值、字段表、生命周期常量、`planPersonaSkillRound`、名字归一化 |
| `src/lib/novel/persona-skill-store.ts` | 独立存储层：索引/候选池/正文/研究文件读写、按路径串行的互斥锁、严格读 |
| `src/lib/novel/persona-skill-prompt.ts` | 单次多人物提示词；章节正文与既有档案都做截断 |
| `src/lib/novel/persona-skill-learning.ts` | 章节学习编排：候选池计数、建档门槛、一次调用、落盘、生命周期刷新、研究文件重新整理 |
| `src/lib/novel/persona-skill-context.ts` | 分级注入：选人、排序、裁剪、渲染 `## 人物 Skill` 段 |
| `src/components/skill-library/persona-skill-view.tsx` | 「人物 Skill」页：列表、搜索、状态筛选、绿勾、编辑档案、查看/重新整理研究文件 |
| 6 个 `*.spec.ts(x)` | 共 152 条用例（含路由连线与统一技能库视图） |

**修改（6 个文件）**

| 文件 | 改动 |
|---|---|
| `src/lib/novel/chapter-ingest.ts` | `ingestChapter` 内后台 `void` 挂钩（**不判 `isReingest`**，见下） |
| `src/lib/novel/context-engine.ts` | 静态 import `buildPersonaSkillContext`，新增 `personaSkills` 字段（优先级 10.5） |
| `src/components/skill-library/unified-skill-library-view.tsx` | 第 3 个 tab「人物 Skill」、草稿守卫、头部按钮条件 |
| `src/components/layout/content-area.tsx` | `case "personaSkillLibrary"` 复用统一技能库 |
| `src/components/layout/icon-sidebar.tsx` | `isActive` 认得新 tab |
| `src/stores/wiki-store.ts` | `activeView` 联合类型 + `personaSkillLibraryDraftDirty` 三件套 |

## 测试

- 全量：`731 文件 / 7141 用例通过、6 todo、0 失败`（约 47 秒）。
- 分支基线（`dcf8b38`）：`720 文件 / 6957 用例通过`。
- 人物 Skill 自己的 10 个 spec 合计 **162 条**：types 28 / store 33 / prompt 12 / learning 38 / context 17 / context-engine-persona 5 / chapter-ingest-persona-hook 8 / persona-skill-view 8 / routing 3 / unified-view 10。

### 已知的环境抖动（不是失败）

整套跑时偶发 `[vitest-pool]: Failed to start forks worker for test files <某文件>`，该文件被记为 `1 failed`。这是 vitest 进程启动失败、不是断言失败。判定：单独重跑该文件，通过即为抖动。

`test:mocks` 跑完 `git status` 会冒出约 170 个「已修改」，**100% 是 EOL 假阳性**（`tests/fixtures/**` 与两个 `docs/*/dump.html`，`core.autocrlf=true` 所致）。判定：`git diff HEAD --name-only | Measure-Object` 应为 0。**禁止** `git checkout -- .` / `git restore .`。

## 更新记录

- 2026-10-10：创建分支与设计规格（`docs/superpowers/specs/2026-10-10-persona-skill-design.html`）。
- 2026-10-10：定名为「人物 Skill」，内部标识统一为 `persona-skill-*`。
- 2026-10-10：写实施计划（`docs/superpowers/plans/2026-10-10-persona-skill.html`，Task 1–11）。
- 2026-10-10：实现 Task 1–10 全部功能，并修正计划中 12 处自查发现的缺陷（含：不存在的 spec 路径、用例总数漏算、`fileExists` 未 mock、角色定位键未归一化、两处与设计冲突的表述）。
- 2026-10-10：**独立代码审查**发现并修复 4 个真实缺陷（Task 11）：
  1. `applyPersonaSkillDrafts` 用整轮 LLM 调用**之前**的索引快照判定 `editedByUser` —— 用户在模型运行期间（数秒到数十秒）保存的手改正文会被**整份覆盖**，护栏也一起丢。设计点名「这是必须守住的一条」。改为全程在同一把锁内读新鲜索引。
  2. 已建档人物的**出场记账只活在内存**：模型漏掉某人或字段全空时，`lastChapter` 停在旧值，紧接着的生命周期刷新按旧值算 gap，把**正在场上的人**判成 `archived` → 按 D5 不再注入，等于人物从写作上下文里凭空消失。改为在**零 LLM 的确定性阶段**落盘。
  3. **回填旧章**会按旧章号重算生命周期（负数 gap 直接落回 `active`），把已归档人物静默复活。
  4. `existingSkill` **未截断**进提示词，而手改档案每章追加一段「补充」→ 文档随出场章数线性增长，最终超上下文、每轮抛错被 `catch` 吞成 warn，该人物学习永久静默失效。设计 §7 明文要求截断。
  另修：用户保存档案的「写正文」与「置 `editedByUser`」原来分两次取锁，中间存在交错窗口（正文已换、标志还是 false）—— 已合进同一把锁；非绿勾人物仍能重新整理研究文件（D6 要求只有绿标角色有）—— 已在函数内加守卫。
- 2026-10-10：**字段表按设计规格对齐**。原实现的主要人物七字段里有 5 个（在意什么 / 底线与逆鳞 / 关系网 / 语言标记 / 成长轨迹）从未出现在设计规格中，是写实施计划时自创的，且与研究文件内容重复。经确认改为设计批准的 5 个「演技」字段：`怎么说话 · 怎么想 · 怎么判断 · 什么不做 · 知道局限`（设计里的「分类 · 摘要」因与区块标题、SKILL.md 摘要重复而删去）。字段表是数据驱动的，只动 1 个常量 + 8 处测试断言；另加 3 条不变量用例（与设计逐字一致 / minor 是 major 真子集 / 不含研究文件专有材料）。
  验证：4 条新用例在未修复时全部为红（已逐一验证），修复后全量 `729 文件 / 7101 用例通过`。
- 2026-10-11：**修复线上报障「提取了记忆但技能库里没有任何人物 Skill」**。根因经实盘取证确认（非推测）：

  用户在真实项目上复现。取证结果：
  - 项目 `C:\QM-BOOK\黑雨之下` 的 `wiki/characters` **不存在** → `loadCharacterRoleTypes` 返回空表 → 所有人物 `roleType` 为空。
  - 空定位落到「未标注」→ 门槛 3 次出场。而 `.qmai/persona-skills/sightings.json` 显示候选池里最高出场数只有 **2**（7 个人物，其中 5 个只出场 1 次）。
  - 于是 `planPersonaSkillRound` 返回 **0 条计划**，`learnPersonaSkillsFromChapter` 在第 `plans.length === 0` 处**静默 return**：不调模型、不写 index.json、不打日志。用户侧表现就是「技能库空的、也没报错」。
  - 旁证：该项目的 `persona-skills/` 目录里**只有 `sightings.json`、没有 `index.json`** —— 记账阶段跑了，建档阶段从没跑过。

  另有一条独立缺陷：`chapter-ingest.ts` 用 `if (!isReingest)` 把整个学习短路掉。第 1 章早已成功摄取过，用户重新提取时 `isReingest` 为真 → **学习整段不执行**。这条短路把「用户唯一的补救动作」变成了「被跳过的动作」，等于永久放弃修复。

  修复三项：① `resolveKnownCharacters()` 从 `wiki/entities/` 的 `tags: [character]` 实体页认人（`character-aura.ts` 同款判据），认出则门槛降回 1；② 零命中改为打 `[Persona Skill] 第 N 章无人物达标：名字(定位 已出场/门槛)`，不再静默；③ 删掉 `isReingest` 短路（幂等性由 `lastLearnedChapter` 守卫与候选池 `chapters[]` 去重承担）。
  另按用户决定：**学习阶段一律抽全 5 个字段**（`PERSONA_STORED_FIELDS`），注入仍按档位裁剪——`PERSONA_MINOR_FIELDS` 现在只剩注入路径一个引用点。

  验证（全部实盘、非推测）：用真实磁盘文件跑 `resolveKnownCharacters`，杨寒/杨妙萍/林小满/小晚被认出（门槛 3→1，**4 人全部转为会建档**），而老太太/老头/小男孩/灰白制服守卫/白褂女人/地下铁门守卫/抱保温杯守卫/另一个守卫 8 个路人未被认出（门槛维持 3，仍被挡住）。新增 10 条用例，其中 2 条已验证在未修复时为红。全量 `729 文件 / 7111 用例通过、6 todo、0 失败`；`typecheck` 与 `typecheck:tests` 均 0 错误。
- 2026-10-11：**修复用户报障「一键提取功能无法使用」（章节与大纲两条入口都要修），并把运行中的图标改成动态的**。这条与人物 Skill 无关，是本分支携带的界面缺陷。

  根因经实盘取证确认（不是推测）：把组件真的渲染出来点了一遍 —— 点下确认后**整段提取期间界面一字不显示**（提取进行中 `section.textContent` 实测就是空字符串 `""`），没有 spinner、没有进度、没有「提取中」、没有取消，图标也始终是静态的 `<Sparkles />`。用户看到的就是「点了没反应」。同一轮取证还查出三处独立缺陷：

  - **两套互不一致的实现。** 章节走 `chapter-bulk-ingest.ts` 里那段降级循环，**完全不创建进度任务**，所以树里的进度条、取消按钮、章节行「提取中」灰点全部没反应；大纲那边却早已有 `OutlineActionToolbar` 的完整实现（转圈、范围选择、模型未就绪可跳设置）。
  - **两条入口都只做「仅未提取」。** 一旦全书都提取过就只回一句「都已提取过」，看上去同样像坏了，而且没有任何「全部重提取」的出口 —— 而重提取恰恰是用户唯一的补救动作。
  - **模型没配好时静默失败。** `OutlineIngestNotReadyError` 被吞成一句面板文字，用户不知道要到哪里去配。

  修复（按用户选择「两个都复用已有完整实现 + 运行中图标旋转」）：

  1. `chapter-bulk-ingest.ts` 升级为**章节批量提取的唯一实现**：新增 `mode`（`all` / `pending`，默认 `pending`）与显式 `chapters` 列表；创建 `kind: "chapter"` 进度任务、逐章点亮 `activeChapterPaths`、把 `AbortController.signal` 传给 `ingestChapter`；取消时结算为 `cancelled`，且**已被 `cancelTask` 结算过的任务不被 `finishTask` 覆盖**（否则用户刚看到的「已取消」会跳回 done/error）。
  2. `knowledge-tree.tsx` 的「一键提取所有章节」改为调用这份共享实现（`mode: "all"`，保持右键菜单「重新提取全部」的既有语义），删掉自己抄的那 100 行循环。守卫改为断言**委托**，并反向断言源码里不再出现私有进度循环。
  3. `UiTestDirectoryHeader` 在那枚图标上直接订阅进度任务：提取期间换成 `Loader2` 旋转并置 `aria-busy`。因为读的是全局任务而不是父组件传的 prop，**走章节右键菜单发起的提取同样会让图标转起来**。
  4. `UiTestOutlineTools` 重写：确认框改为「取消 / 仅未提取 / 提取全部」；运行中显示 `Loader2` 旋转 + `正在提取大纲记忆 0/4` + 取消按钮；`OutlineIngestNotReadyError` 改为 `toast.error(..., { onClick: openDefaultModelSettings })`。新增 `.ui-test-outline-running` 与 `.pending` 样式。
  5. **没有新造契约**：`activeChapterPaths`、`finishTask` 结束时自清空、按 `kind` 区分任务，全部沿用原有约定。

  验证：新增 2 个 spec 文件共 **29 条**（`chapter-bulk-ingest.spec.ts` 18 条、`ui-test-extract-progress.spec.tsx` 11 条），另在 `knowledge-tree.spec.tsx` 新增 1 条委托守卫。
  - `chapter-bulk-ingest.spec.ts` 在实现前 **17 条里 9 条为红**（缺进度任务 / 缺 abort signal / 缺 `mode`、`chapters` / 取消不生效 / `formatBulkChapterIngestResult` 不认 `cancelled`）。
  - `ui-test-extract-progress.spec.tsx` 在**旧组件**上 **9 条为红、2 条负向控制照常通过**（负向控制是「不该乱转」）。其中一条把用户看到的现象逐字钉住：*提取已经在跑了，面板却一片空白* —— 旧代码下红、修复后绿。
  - 全量 `731 文件 / 7141 用例通过、6 todo、0 失败`；`typecheck` 与 `typecheck:tests` 均 0 错误。

  另注：`npx vitest run`（不带 `--exclude`）会连带跑 `test:llm` 的 `scripts/refine-acceptance.real-llm.test.ts`，它 import 的 `hasOutlineForRefinement` 在 `src/` 里**已无任何导出**，**在 HEAD 就是红的**，与本次改动无关（`test:mocks` 已排除它）。判读全量结果请用 `npm run test:mocks`。

## 提交状态

- 尚未合并进 `main`。**合并前必须删除本分支专属的 `AGENTS.md`**（见该文件 §8）。
- 另有一条 `dd72f84 fix(备份): 删掉多余的 mock 窄化断言，修好 typecheck:tests 基线`，修的是**分支基点上就存在**的 `import.spec.ts` 类型错误，属仓库卫生、与人物 Skill 功能无关。
