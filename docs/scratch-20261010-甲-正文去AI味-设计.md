# work/scratch-20261010 第三批（甲）设计：正文去 AI 味

> 本文是本批的**设计与依据**。实施步骤见《`docs/scratch-20261010-甲-正文去AI味-实施计划.md`》。
> 依据来自对当前 HEAD 的**逐条实读**（不是记忆、也不是上一批的侦察报告——
> 上一批对这几个文件的描述有两处已确认不准确，见 §1.4）。

---

## 0. 范围

用户原话：

> 「目前直接通过章节去生成内容时，生成的内容根本没法看，AI 味儿太重了。」
> 「没有文风的时候就已经很难看了」——即根因**不在**缺文风。

**本批做**：让「生成正文」这条链路的提示词**本身**带上反 AI 腔的硬约束，并把它覆盖到
所有会产出正文的阶段；顺带修掉事件细纲扩写时用户要求被丢掉的问题。

**本批不做**（留丙/丁）：
- 事件细纲入口搬家、停止存进大纲列表、卡片「重新修改」（**丙**）。
- 文风 skill 化与「文风写作」选择（**丁**）。
- `FIELD_PRIORITY` 里文风排位（19、超预算首先被裁）的调整——那是「文风进不了上下文」的问题，
  与「正文本身写得像 AI」是两件事。

### 0.1 目标三项诉求的对应关系（验收用）

| 目标里的诉求 | 本批怎么落实 | 证据位置 |
|---|---|---|
| ① 正文 prompt 补反 AI 腔硬规则 | 新增 `DE_AI_GENERATION_RULES`，注入 draft / expansion / revision / event-outline 四个正文阶段（`brief` 与 `finalPolish` 有意不加） | §2.2、§2.4、测试 §3-4/5/6/8 |
| ② 接上零引用的禁用词清单 | `novel-de-ai-rules.md`（zero `src/` refs）与已删的 `de-ai-rules.ts` 里的禁用词/机械句式/cliché 清单**被翻译成生成期约束**并真正编译进提示词 | §1.4、§1.7、§2.1、§2.2 |
| ③ 改善「只有 strict 模式才审稿返修」 | **用「预防覆盖全模式」替代「给 standard 加一轮审稿」**——规则块是**无条件**常量，不依赖 `resolveChapterWorkflowProfile` 的档位，因此 fast/standard 用户在**没有**审稿的情况下也拿到约束 | §1.5、§2.4、§2.6 |

**关于 ③ 的说明（这是本批最重要的一个取舍）**：诉求的实质是「默认档没有质量关口」。
两条路——(a) 给 standard 加一轮 LLM 审稿，(b) 把约束前移到生成时。
选 (b)，理由：standard/fast 在 `deep-chapter-generation.ts:1125-1167` 直接返回初稿，
**返修/润色根本不会执行**，所以即使加了审稿也只是「发现问题却无人修」；
而生成期约束对所有模式生效、零额外调用、且不改变流程结构。
(a) 被明确记为**不做**，理由见 §2.6——若日后要做，应单独一批并带开关。

---

## 1. 根因（已实读确认）

### 1.1 写正文的提示词里没有任何反 AI 腔规则

`src/lib/novel/de-chapter-prompts.ts:151-188` 的 `buildDeepChapterDraftPrompt`
有 **11 条编号「输出要求」**（`:169-179`）。逐条读过：全部是**结构与流程**要求
（只输出正文、标题要求、承接上一章、结尾留钩子、字数区间、禁止复读、对话要有攻防…）。

其中第 8（禁止复读/循环输出）、第 9（不要写成说明文：不解释设计、不替角色总结动机、
不用旁白概括冲突）、第 10（开头给问题、结尾完成阶段结果）**与「AI 味」方向相邻**，
但它们是**叙事层**要求。**词法/句式层一条都没有**：没有禁用词、没有
`不是 A 而是 B` 二分对照、没有冒号当结构提示器、没有路标词配额、没有 cliché 清单
（「目光交汇的瞬间」「空气仿佛凝固」「心中五味杂陈」）。

> 所以上一批记录里「ZERO anti-AI-flavor rules」这个说法**略强**，应表述为：
> 有 3 条方向相邻的叙事层要求，但**零条词法/句式层反 AI 腔规则**。

### 1.2 反 AI 腔的规则**确实存在**，而且写得很好，但进不了正文生成

- `skills/de-ai-writing/SKILL.md:51-66` 有 **12 条「核心硬门槛」**——但它的自我定位是
  **改写/补丁工具**（`:26`「这是一个去 AI 味补丁工具，不规定新文风」），
  规则形式是「清理 / 删减 / 替换」，面向的是**已有文本**，不是**生成时**的约束。
- `skills/de-ai-writing/references/novel-de-ai-rules.md`（**177 行**）是**专门为中文小说写的**，
  质量很高：禁用词汇分类（总结腔/解释腔/模板句首/空洞形容/转折滥用/AI 特征词）、
  机械句式（含「目光交汇的瞬间」「空气仿佛凝固」「心中五味杂陈」）、叙事缺陷、
  6 条核心方法（删减/具体化/断句/破坏工整/对话真实化/信息密度减法）、
  执行流程、保留内容，甚至有一条**小说适配注意**（`:144-148`：
  「不要按非虚构文章规则硬删副词」「似乎/仿佛/缓缓在特定语境下是风格，不是 AI 味」）
  和一条收尾原则（`:162`「读起来不像 AI，也不刻意反 AI」）。这份文件正是本批需要的东西。

### 1.3 那它们为什么进不了正文生成？——三条链路各自独立

实读确认（这次逐条 grep，并已修正一处我最初写错的判断）：

| 链路 | `skills/de-ai-writing/**` 的规则是否进入 | 证据 |
|---|---|---|
| **交互对话**（chat） | **进入**，作为最外层 system prompt | `chat-panel.tsx:1906` `buildQmQuaiSystemPrompt()`、`:1992`、`:2028`；落点是第一条 system 消息（`:2048`） |
| **改写/润色**（编辑器那一路） | **进入** | `preview-panel.tsx:29` `buildDeAiRewriteMessages` |
| **生成正文**（deep chapter） | **不进入** | 见下 |

**关键证据**：正文初稿那一次调用是

```ts
collectModelText(
  writingConfig,
  [{ role: "user", content: buildDeepChapterDraftPrompt(...) }],  // 只有一个 user 消息
  ...
)
```
——`deep-chapter-generation.ts:1013-1029`。该文件 **2686 行里 `role: "system"` 出现 0 次**
（已 grep 确认），`collectModelText`（`:2055`）原样透传 messages。
所以 chat 那套「最外层 system prompt」的注入方式对正文生成**完全无效**。

### 1.3.1 但正文生成**并非完全没有**反 AI 腔规则（修正我先前的判断）

我最初以为正文拿到的 `skillsPrompt` 只是「用户手动选的技能」。**这是错的**：
`skillsPrompt` 由 `select-skills-plugin` 的自动选技能产生，而它**会按名字自动注入**
一个内置去 AI 味技能。完整链路（已逐条验证）：

1. `chat-panel.tsx:1867-1868`：`sessionSkillsPrompt = buildSelectedSkillsPrompt(sessionSelectedSkills)` → 存入 `selectedSkillsPromptRef`。
2. `sessionSelectedSkills` 来自 select-skills 插件（`chat-panel.tsx:1864`）。
3. `select-skills-plugin.ts:170-173`：standard 模式下 `supportNames = FAST_WRITING_SKILL_NAMES`
   = `["正文输出协议", "基础去AI味"]`（`:47`），并把它们放进 preferred 名单。
4. `基础去AI味` 确实存在，且 `modes: ["fast","standard","strict"]`：
   `skill-seed.ts:1778-1787`，`kind: ["style","rewrite"]`。
5. 它被 `buildSelectedSkillsPrompt`（`select-skills-plugin.ts:242-259`）以
   `skill.content` **原样**渲染成 `## 本次启用 Skill` 段。
6. 该段经 `deep-chapter-generation.ts:90/1026` 的 `skillsPrompt` 参数，
   进 `buildDeepChapterDraftPrompt` 第 8 参 → `deep-chapter-prompts.ts:164`
   `skillsConstraintSection`（= `skillsPrompt?.trim() ?? ""`）。

**所以 accurate 的结论是**：正文生成拿到的是
`基础去AI味` 那 **6 条**规则（`skill-seed.ts:1785`），**不是**
`skills/de-ai-writing/` 的 12 条硬门槛，也不是 `novel-de-ai-rules.md` 的
禁用词表 / 机械句式 / cliché 清单 / 信息密度减法。

那 6 条是：删「这说明/这意味着/由此可见」类总结句、减少段尾升华与机械排比、
对话不替作者解释、压缩同义反复与无效热闹（细节过不了三问就删）、
保留剧情人设视角不编新进展、只输出正文。

### 1.3.2 这层自动技能有三个真实缺口，才是甲要补的

| 缺口 | 证据 | 后果 |
|---|---|---|
| **fast 模式一条都没有** | `select-skills-plugin.ts:99` `if (mode === "fast") return []`；且 `chat-panel.tsx:1630` `shouldRunNovelPrePluginChain = novelMode && (sessionWorkflowMode !== "fast" \|\| planExecuteActive)` → fast 下插件不跑，`sessionSelectedSkills` 只剩 `explicitSkills`（`:1864-1866`） | fast 用户完全没有反 AI 腔约束 |
| **内容偏泛、缺最具体的清单** | `skill-seed.ts:1785` 共 6 条，无禁用词表、无「目光交汇的瞬间」「空气仿佛凝固」这类 cliché、无二分对照/冒号提示器/路标词配额、无「单手法循环」、无小说适配边界 | 正是用户说的「AI 味儿太重」的那些具体形态没被点名 |
| **可被用户改坏或关掉** | 它是技能库里的 `UserSkill`（`user-skill-store`，可编辑、有 `disabledSkillIds`，`user-skill-store.ts:306-309`） | 提示词层的约束应当是**地板**，不该依赖用户配置 |

**结论（本批的依据）**：在提示词里加一段**无条件**的规则块，
使约束在所有模式（含 fast）都成立、且不依赖技能库状态；
内容聚焦上面第 2 行的**具体清单**，**不重复**那 6 条泛规则（避免双重注入与冗余 token）。

### 1.4 顺带确认的两处「上一批记录不准确」

1. **`skills/de-ai-writing/SKILL.md` 并不是死文件**。它被 `src/lib/novel/de-ai-adapter.ts:4`
   以 `skills/de-ai-writing/SKILL.md?raw` **编译期内联**引用，并且
   `skills/**/*` 还是 Tauri 打包资源（`src-tauri/tauri.conf.json:40`：
   `"../skills/**/*": "skills/"`），运行时也能经 `resourceDir()` 读到。
   真正零引用的是 `references/` 下的 **4 个**文件（不止 `novel-de-ai-rules.md`）：
   `novel-de-ai-rules.md` / `ai-trace-index.md` / `ai-trace-detector.md` /
   `translation-guardrails.md` ——`git grep` 在 `src/` 里**零命中**（只出现在 docs 里）。
2. **`loadSmartDeAiSkill()`（`de-ai-adapter.ts:138-165`）是一个零消费者的死导出**。
   它已经写好了「按场景选 skill → 从打包资源目录读 → 读不到返回 null」的完整逻辑
   （含 `detectContentGenre` 题材判定、`tryLoadSkillFromBundle` 走
   `resourceDir()`+`readFile`），但**全仓没有任何地方调用它**。
   说明「按题材把正确的那份规则送进生成」这件事**本来打算做、没做完**。

### 1.5 审稿返修救不了它：多数人根本走不到审稿，且审的也不是这个维度

`resolveChapterWorkflowProfile`（`deep-chapter-generation.ts:232-270`）三档：

| 模式 | `runAiReview` | 其他 |
|---|---|---|
| `fast` | **false** | 不做执行契约、不做审稿、不做终稿修复、不做计划校验 |
| `standard` | **false** | 同上全 false |
| `strict` | true | 全开 |

**关键更正（比上一批记录的更严重）**：函数内 `mode ?? "strict"`（`:235`）看似默认 strict，
但**实际默认是 `standard`**：

- `DEFAULT_AI_WORKFLOW_MODE = "standard"`（`src/lib/agent/workflow-mode.ts:8`）
- 该常量直接进 store 初值：`wiki-store.ts:1023` `aiWorkflowMode: DEFAULT_AI_WORKFLOW_MODE`
- 有测试钉住它是 `"standard"`：`workflow-mode.spec.ts:14`

所以 `resolveChapterWorkflowProfile` 的 `"strict"` 兜底只在 `mode` 为 `undefined`
时才生效，而 store 永远给得出值 → **绝大多数用户跑的是 standard**。

更关键的是流程上的**硬短路**：`deep-chapter-generation.ts:1125-1167`，
`if (!workflowProfile.runPostDraftPlanAudits)` 直接把初稿当最终正文返回
（`finalContent = draftContent`，`reviewResults: []`）。`fast` 与 `standard` **都在这里返回**，
所以**返修（revision）与终稿润色（polish）这两步在 standard 下根本不会执行**。

**推论（决定了本批的优先级）**：对多数用户而言，**唯一的质量关口就是初稿那一次调用**
（外加「初稿太短」时的扩写）。因此 §2.4 里 draft 与 expansion 的价值远高于
revision/polish——后者只服务 strict 用户。

至于 strict 的审稿维度，**全是「一致性/剧情」**：`review-adapter.ts:59-78` 的
`REVIEW_DIMENSIONS` 共 18 条（是否违背总大纲/分卷大纲/章节目标、人设崩坏、动机不一致、
脱离记忆库、时间线、地点、能力体系、伏笔、泄露秘密、认知越界、新增未登记设定、
是否剧情水文、是否缺少钩子…），加上 `BLUEPRINT_DEVIATION_DIMENSION`（`:81`）。
**没有任何一条是文风/句式/词法维度**。「是否剧情水文」（`:76`）是内容注水，不是 AI 腔；
JSON 的 type 枚举里虽然有 `"style"`（`:194`），但**没有任何维度会产出它**。
审稿阶段（`:157-164`）也全是「审查任务识别 / 上下文检索 / 目标对齐 /
事实核对 / 逐维度审查 / 阻断判定 / 二次复核」。

> 准确的结论：**不是「只有 strict 才审」这么简单**——默认就不是 strict；
> 而且**连 strict 都不审 AI 腔**。这正是本批选「改提示词（预防）」而非
> 「加一轮审稿（检测）」的理由：提示词约束对**所有模式**都生效、且零额外调用。

### 1.6 事件细纲扩写这条路更薄

`event-outline.ts:352-372` 的 `eventOutlineToProsePrompt` 只有 **2 条**写作要求
（`:368-369`），且确认了一个真实缺陷：向导里用户填的 `requirement`
定义在 `EventOutlineRequest`（`:50-55`）上，只用于**生成细纲**那一步（`:317`），
而扩写函数签名收的是 `EventOutlineData`（`:37`）——**`requirement` 到扩写这一步就丢了**。

### 1.7 这段规则**曾经做出来过**，被有意撤掉了一半，然后当僵尸代码删了（重要）

git 历史实读（不是推测）：

1. 曾经存在 `src/lib/novel/de-ai-rules.ts`（**177 行**），导出
   `CHINESE_NOVEL_DE_AI_RULES = \`# 中文小说去 AI 味补充规则 ...\``。
   内容与 `skills/de-ai-writing/references/novel-de-ai-rules.md` **同源同量**
   （都是 177 行、同样的禁用词/机械句式/叙事缺陷三节），且含一句
   「不要按非虚构文章规则硬删副词」——即本设计要保留的那条边界。
2. 它**当时是被编译进来的**：`42727a9^:src/lib/novel/deep-chapter-prompts.ts:3`
   `import { CHINESE_NOVEL_DE_AI_RULES } from "./de-ai-rules"`，
   用在 **`buildDeepChapterFinalPolishPrompt`** 里（当时的阶段 6 叫
   「最终去AI味」，见 `42727a9^:deep-chapter-generation.ts` 的
   `runFinalPolish` / `describeSkippedFinalPolish` / `title: "简单审查与去AI味"`）。
3. **`42727a9 feat(writing): 严格模式阶段6改为按需局部修改`** 把它**有意撤掉**了，
   提交信息写明理由：

   > 审稿干净不再全文去 AI 味；仅在有剩余问题时按清单改问题部分。

   同一提交把断言从 `toContain("中文小说去 AI 味补充规则")` 改成
   `not.toContain(...)`（现仍生效：`deep-chapter-generation.spec.ts:454`、`:2152`）。
4. 此后该模块成为零引用，在 **`58bceeb chore: 删除未编译和零调用的僵尸代码`**
   （2026-09-28）中被删除。
5. `skills/de-ai-writing/references/novel-de-ai-rules.md` 是同一份内容的 markdown 版，
   一直留在仓库里、零引用（§1.4）。

**这条历史对本批有三个直接约束**：

- **(a) 不要回退 `42727a9`**。那次的诉求是「不要再做一次**全文**去 AI 味改写」，
  理由充分（审稿干净时不该重写用户已认可的正文、还多花一次调用）。
  本设计与之相容：规则加在**生成时**（约束怎么写），**不是**在阶段 6 加一次全文改写。
- **(b) 恰好证明了「预防式」是对的**。当年唯一的落点是**最后**一阶段，
  属于事后补救，才会撞上 (a) 的两难。放到初稿/扩写/返修，就不存在这个矛盾。
- **(c) 阶段 6 只能加「边界式」规则**。所以 §2.4.1 的
  `DE_AI_REVISION_BOUNDARY` 不是可选优化，而是**历史上那条教训的落地**：
   阶段 6 只在不扩大改动范围的前提下避免引入新 AI 腔。

### 1.8 一个当前真实缺陷：那 6 条反 AI 腔规则是**坏的**

`skill-seed.ts` 里 `基础去AI味` 的内容用 `join("\\n")`（**双反斜杠**）拼接——
产出的是**字面量 `\n` 两个字符**，不是换行：

- 坏的三处：`skill-seed.ts:1785`（`基础去AI味`）、`:1795`（`审稿返修`）、
  `:1805`（`返修后复审`）。
- 全文件 `join("\n")`（真换行）**出现 0 次**，`join("\\n")` 出现 3 次。
- 对照：`event-outline.ts` 有 2 处真 `join("\n")`、0 处 `join("\\n")`——说明这是笔误不是约定。
- 后果：经 `buildSelectedSkillsPrompt`（`select-skills-plugin.ts:250-251` 原样渲染
  `skill.content`）进入提示词后，6 条规则被压成**一行**并夹着字面 `\n`，
  可读性/遵守率都会下降。这正是「明明有去 AI 味技能却还是 AI 味重」的一个具体成因。

**纳入本批**（改动极小、收益直接、服务于同一目标）：
把这三处 `join("\\n")` 改成 `join("\n")`。
**风险**：会改变渲染结果 → 需要确认没有 spec 断言字面 `\n`（实施时验证）。

---

## 2. 方案

### 2.1 核心决策：不把那份 177 行的 .md 整篇塞进提示词

考虑过三条路：

| 方案 | 说明 | 判断 |
|---|---|---|
| (a) `?raw` 引入 `novel-de-ai-rules.md` 整篇注入 | 有先例（`de-ai-adapter.ts:4`） | ✗ **类别错误 + 成本高**：该文件是「**改写**操作手册」（必删内容 / 逐句检查 / 修补顺序 / 最终检查 / 参考资源），对生成任务是冗余的；177 行 ≈ 2.5k+ 字符，而它会被加进**每一次**初稿/扩写/返修/润色调用，其中相当一部分内容与「生成时该怎么写」无关 |
| (b) 另写一份**面向生成**的精炼常量 | 新模块 | ✓ 聚焦、可测、无打包风险 |
| (c) (b) + 一条 spec 钉住与 .md 的分类不漂移 | 混合 | ✓✓ **推荐** |

**采纳 (c)**。理由：`.md` 里可执行的生成期约束其实只有一小部分（禁用词表、机械句式、
叙事缺陷、具体化/断句/破坏工整/对话真实化这几条），把它们**翻译成「不要写 X」的
否定式约束**才符合生成任务的形态；`修补顺序`、`逐句检查`、`最终检查清单`、
`参考资源` 这些是**改写流程**，对生成没有意义。

同时**不删除** `novel-de-ai-rules.md`：它是这批规则的中文小说出处与人工可编辑的详版，
在新模块顶部注明来源。

> 补充（§1.7）：曾被删除的 `src/lib/novel/de-ai-rules.ts` 是本模块的**前身**，
> 内容同源。本模块**不**把它原样恢复（那会连带恢复「整篇 177 行塞进提示词」
> 的做法），而是在其基础上**重写为生成期约束**。实施时可 `git show 58bceeb^:src/lib/novel/de-ai-rules.ts`
> 取回原文作为取词依据，避免自己重新编禁用词表。

### 2.2 新增模块 `src/lib/novel/de-ai-generation-rules.ts`

单一导出，纯字符串常量（无 IO、无 i18n 依赖，便于测试与缓存稳定性）：

```ts
/**
 * 正文生成期的反 AI 腔硬约束。
 *
 * 来源：skills/de-ai-writing/references/novel-de-ai-rules.md（中文小说专用详版，
 * 177 行）。这里**不是**它的复制，而是把其中可执行的生成期约束翻译成「不要写 X」，
 * 并把改写流程（修补顺序/逐句检查/最终检查清单）剔除——那些是改写的动作，
 * 对「生成」没有意义。
 *
 * 为什么不直接注入那份 .md：见设计文档 §2.1（类别错误 + 每次调用都要付的 token）。
 * 为什么常量而不是读文件：规则是静态的，且要保证打包后一定存在；
 * 仓库既有 de-ai-adapter.ts:4 用 ?raw 的写法，但那份内容必须整篇用，这里只需要节选。
 */
export const DE_AI_GENERATION_RULES: string
```

内容按 `.md` 的四个高价值分类组织（否定式、可自查）：
词法（禁用/限用词表）、句式（二分对照、冒号提示器、条件句堆叠、路标词配额）、
叙事（解释动机、总结情绪、段尾抽象结论、无效热闹、单手法循环）、
正面替换（抽象→可见动作，长句→断句，对话留毛边）。
**必须保留 `.md:144-148` 的小说适配边界**（副词/「似乎仿佛缓缓」在小说里是风格不是 AI 味；
`:162` 不刻意反 AI），否则会把正文压成非虚构腔——这是那份文件自己写下的教训。

**与 `基础去AI味` 的分工（依据 §1.3.2）**：`skill-seed.ts:1785` 那 6 条
仍会经 `skillsPrompt` 进入 standard/strict 的提示词。本模块**以具体词表与句子级黑名单为主**：
**禁用词分类**（总结腔、解释腔、模板句首、空洞形容、转折配额、AI 特征词）、
**cliché 黑名单**（「目光交汇的瞬间」「空气仿佛凝固」「心中五味杂陈」「眼神变得坚定」）、
**句式**（二分对照壳、冒号当结构提示器、路标词配额）、
**信息密度减法**（同义反复 / 无效热闹 / 单手法循环）、以及**小说适配边界**。

> 职责分层：`基础去AI味`（技能层，模式相关、用户可改）管泛则；
> 本模块（提示词层，无条件）管具体清单与地板。
>
> ⚠️ **订正（复核后，原文写「二者内容不重叠」是 overclaim）**：实测有**两处**泛则确实重叠——
> 「段尾不补抽象结论、不为每段升华」（本模块）≈「减少段尾升华」（`skill-seed.ts:1785` 第 2 条）；
> 「同义反复 / 无效热闹」（本模块）≈ 第 4 条。
> 这是**有意接受的**：本模块的价值在**具体词表与句子级黑名单**，不在泛则；
> 少量泛则重叠换来的是「泛则只说不该做什么、本模块给出可直接照做的替换」这一层互补。
> 但措辞上不应再声称「不重叠」——`基础去AI味` 只覆盖 standard/strict，
> 而本模块**无条件**生效，所以重叠部分在 fast 下**不是**冗余。

### 2.3 注入点：只能在稳定缓存前缀**之后**

**硬约束（有测试钉住，不可违反）**：`deep-chapter-prompts.cache.spec.ts:44-54` 断言
**五个阶段**的提示词都必须以**逐字节相同**的
`outline\n上下文：\ncontextPrompt` 块开头，并计算跨阶段最小公共前缀
`≥ stableBlock.length`。理由（spec 注释 `:11-16` 与 `:56-72`）：这段是最大的可缓存前缀，
DeepSeek/OpenAI 的自动前缀缓存命中后重复前缀约按 1/10 计费。

因此：**任何新规则都不得插到 `buildStableContextPrefix()` 之前**。
落点选在「输出要求」列表之后、新增一节「反 AI 腔硬约束」——与
`skillsConstraintSection` 同属可变区，缓存行为不变。

### 2.4 覆盖哪些 builder

**按覆盖面排序**（依据 §1.5：standard/fast 是默认档，且它们在 `:1125-1167` 直接返回初稿）：

| 优先级 | builder | 覆盖模式 | 理由 |
|---|---|---|---|
| **P0** | `buildDeepChapterDraftPrompt`（`:151`） | **全部** | 正文初稿；对多数用户是**唯一**的质量关口 |
| **P0** | `buildDeepChapterExpansionPrompt`（`:232`） | **全部** | 初稿不足字数时的扩写，**最容易**堆出 AI 腔（注水、排比、空修饰） |
| P1 | `buildDeepChapterRevisionPrompt`（`:190`） | 仅 strict | 返修不得**引入**新 AI 腔；且它本身重写正文 → 加 RULES + BOUNDARY |
| — | `buildDeepChapterFinalPolishPrompt`（`:269`） | — | **不加**，见下（这是对设计初稿的修正） |
| — | `buildDeepChapterBriefPrompt`（`:68`） | — | **不加**：产出的是**任务书**（计划），不是正文 |
| P1 | `eventOutlineToProsePrompt`（`event-outline.ts:352`） | 全部（另一条入口） | 直接产出正文；同时修掉 `requirement` 丢失 |

> 「不加」`brief` 是有意的：那一步要求模型输出计划，不是散文；把反 AI 腔规则放进去
> 会与「输出任务书」的格式要求互相干扰。
>
> **「不加」`polish` 是对设计初稿的修正**（初稿曾把它列为 P1「加」）。依据 §1.7(a)：
> `42727a9` 已明确把阶段 6 收窄为「按需局部修改」，并留下了两条断言
> （`:454`、`:2152`）专门守住「阶段 6 不得有去 AI 味内容」。
> 在阶段 6 塞入规则块，即使换个标题绕过字面断言，也是**违背那次的意图**；
> 而阶段 6 拿到的是**上游已被约束过**的正文，本就不需要再约束一次。
> 因此：**阶段 6 保持逐字节不变**。
>
> P0/P1 的划分**不代表 P1 可以不做**（strict 用户也在意），只是说明
> **如果规则块要削减，先砍的是 P1**，而 P0 必须完整。

### 2.4.1 返修需要「不得扩大改动范围」的边界句（读全四个 builder 后发现）

逐行读完四个 builder 后确认一个**会互相打架**的点：返修与润色都明确要求
**只改被点名的地方**——

- `buildDeepChapterRevisionPrompt:212`：「优先修复审稿指出的问题，**不要无关改写**」
- `buildDeepChapterFinalPolishPrompt:286`：「**只修改清单中指出的有问题部分**」
  `:287`：「保留原有剧情事实…不要另起新剧情」

若不处理，直接塞进「不要写 AI 腔」的规则，会**授权模型大范围重写**，
与这两条明确要求冲突，可能反而破坏用户已认可的内容。

**处理**：规则块拆成两段常量——

- `DE_AI_GENERATION_RULES`：约束本体（draft / expansion / revision / event-outline 共用）。
- `DE_AI_REVISION_BOUNDARY`：一句边界，**仅**返修追加，语义是
  「下列约束只是为了**不引入新的** AI 腔：请在点名的问题范围内顺带满足；
  **不要**为了满足它去改动问题清单之外的段落或剧情。」

初稿/扩写只用前者（那两步本来就是整章生成，不存在范围限制）。

**润色（阶段 6）为什么两者都不加**：见 §2.4 的修正说明——`42727a9` 已把阶段 6
限定为按需局部修改，且有 `:454`/`:2152` 两条断言守着。既然润色的输入
已经是 draft+revision 约束过的正文，这里再加规则既无收益、又违背那次意图，
**保持逐字节不变**。

另确认（省掉签名改动）：`expansion`（`:232`）与 `polish`（`:269`）**都不接收
`skillsPrompt`**——所以本批**不需要改任何 builder 的签名**，
规则常量直接拼进数组即可，调用点不动。

### 2.5 事件细纲：把用户要求接回扩写

`eventOutlineToProsePrompt(data: EventOutlineData)` 拿不到 `requirement`。最小修法：
给 `EventOutlineData` 增加可选字段 `requirement?: string`，在生成细纲、
把数据落库的那一步把它带上（`event-outline.ts:317` 已经读到它，只需一并写入），
扩写时若非空则作为「用户对本章的要求」输出。

**⚠️ 实际落地时的机制与残留限制（复核后订正，务必知悉）**：

实现时发现原文「只需一并写入」这句话**不准确**——`EventOutlineData` 是**从模型输出的
JSON 解析出来的**（`extractEventOutlineData` ← `msg.content`），
并没有一条「生成侧把 request 写进 data」的代码路径。因此实际做了两件事：

1. **把 `requirement` 塞进提示词里的示例 JSON**（`event-outline.ts:320`，
   无值时 `JSON.stringify` 自动丢键）+ 一条 bullet（`:341`）。
   这是**当前唯一真正生效**的通道：模型照抄示例 → 产出的 JSON 自带该字段 →
   `readEventOutline` 回读 → 扩写提示词出现「## 用户对本章的要求」。
2. 给 `extractEventOutlineData` 加**可选第二参数** `requirement?: string` 作为
   **确定性补齐**通道（`withRequirement`，`:290-294`）。

**残留限制（必须记录，不要当成已完成）**：

- 第 2 条通道在生产里**目前不可达**：唯一调用点
  `src/components/sources/outline-chat-panel.tsx:6557` 仍写 `extractEventOutlineData(msg.content)`，
  没传第二个参数，所以 `withRequirement` 现在是**死代码**。
- 甲批的范围**明确不含 `src/components/**`**（§2.6/计划），所以这条接线
  **不在甲完成，已转交丙**（见《`docs/scratch-20261010-事件细纲流程-实施计划.md`》§1 步骤 5）。
- 因此甲批交付的实际保证是：**「用户要求进入生成细纲那一步的提示词」（确定）+「扩写时带上它」
  （依赖模型回抄示例 JSON，未保证）**。这一点在验收时不应被读成「端到端已保证」。

**分工说明**：这一条**属于甲**（它是「正文写得不好」的直接成因之一，且改动就在同一个
扩写函数里），但事件细纲的**入口搬家/不再存大纲**仍归**丙**。丙改这两个文件时不要与
本批冲突。

### 2.6 明确不做的

- **不新加一轮「AI 腔审稿」LLM 调用**（即不把审稿下放给 standard/fast）。理由：
  (1) 预防优于检测——提示词约束对**所有模式**生效且零额外调用；
  (2) 仅加审稿而不加返修是**无效**的：standard/fast 在 `:1125-1167` 直接返回初稿，
  没有返修阶段可用（§0.1 ③）；
  (3) 每章多一次（大章节是 1-3 次并行）全文审稿是实打实的成本与延迟；
  (4) strict 的审稿维度里**没有**任何文风维度（§1.5），加审稿也不会检出新规则要防的东西。
  若日后要加，应单独一批并带开关。
- **不改 `FIELD_PRIORITY` / token 预算**。新规则是**常量字符串**，直接拼进提示词，
  **不经过** `ContextPack` 的裁剪链路（已实读确认：这些 builder 只是
  `[...].filter(Boolean).join("\n")`，没有任何裁剪），所以不会被预算丢掉。
- **不动 `skills/de-ai-writing/SKILL.md` 与 `.md` 详版的内容**（只在代码里引用其出处）。
- **不回退 `42727a9`**（§1.7）：**不**在阶段 6 恢复「全文去 AI 味改写」。
  阶段 6 只接受 §2.4.1 的边界式约束，且既有断言
  `deep-chapter-generation.spec.ts:454`/`:2152` 必须**保持通过**。
- **不删 `loadSmartDeAiSkill`**。它是死导出（§1.4），删它属于清理而非本批目标；
  在计划里列为「可选的独立清理提交」，由实施时决定，不与行为改动混在一起。
- **不改 `select-skills-plugin` 的选技能逻辑**（自动注入 `基础去AI味` 的名单不动）。
  本批只让提示词层有地板，不去重排技能优先级——那属于另一类改动，且会影响 token 预算与既有 spec。

---

## 3. 测试策略

新增 `src/lib/novel/de-ai-generation-rules.spec.ts`：

1. 规则块**非空**且包含四个分类的关键条目（禁用词、二分对照、冒号、路标词、
   段尾抽象结论、小说适配边界）。
2. **不得**出现 `.md` 里的改写流程指令（如「逐句检查」「修补顺序」「参考资源」）——
   钉住「不是整篇复制」这个设计决定。
3. 规则块是**纯常量**（无 i18n/无 IO 依赖）：重复取值逐字节相同（缓存稳定）。

扩展 `src/lib/novel/deep-chapter-prompts.spec.ts`（注意文件名是 **deep-**，不是 `de-`）：

4. 初稿/扩写/返修三个 builder **包含**规则块；`brief` 与 `finalPolish`
   **不包含**（`finalPolish` 的「不包含」同时被既有断言 `:454`/`:2152` 覆盖，
   本批不得改动那两条）。
5. **规则块出现在稳定前缀之后**：`indexOf(rules) > stableBlock.length`
   （与既有 placement 断言 `:70-71` 同形）。

扩展 `src/lib/novel/deep-chapter-prompts.cache.spec.ts`（或新增用例）：

6. 加入规则块后，跨阶段最小公共前缀**仍然** ≥ `stableBlock.length`——
   这是防止将来有人把规则挪到前缀之前的**回归护栏**，也是本批最容易踩坏的东西。

`event-outline.spec.ts`：

7. `eventOutlineToProsePrompt` 在 `requirement` 非空时包含它，为空时**不**出现该小节。
8. 扩写提示词含规则块。

`skill-seed` 的换行缺陷（§1.8）：

9. 断言 `基础去AI味` 的 `content` **包含真换行** `\n` 且**不包含**字面量
   `\\n`（两字符）。同样检查 `:1795`、`:1805` 两个技能。
   若既有 spec 恰好断言了字面 `\n`，那是把 bug 当规范，必须**改断言**而不是放弃修复。

回归保持（必须仍然通过，不得改断言）：

10. `deep-chapter-generation.spec.ts:454` / `:2152`：
    stage-6 / finalPolish 提示词**不**含「中文小说去 AI 味补充规则」。
11. `deep-chapter-generation.spec.ts:438-450`：字数边界断言不受影响。

---

## 4. 风险与取舍

| 风险 | 缓解 |
|---|---|
| 规则把正文压成非虚构腔、硬删「仿佛/缓缓」 | 规则块内**必须**保留 `.md:144-148` 的小说适配边界与「不刻意反 AI」；单测钉住这两条存在 |
| 加规则破坏前缀缓存、input token 变贵 | 规则只加在稳定前缀之后；`cache.spec.ts` 加回归断言 |
| 规则与已有 11 条要求重复、甚至矛盾 | 已逐条比对：#8/#9/#10 是叙事层，新规则是词法/句式层；`brief` 明确不加 |
| 新增常量无人维护、与 .md 漂移 | spec 钉住分类覆盖；模块顶部注明出处；`.md` 不删 |
| 每章每阶段多付规则 token | 规则块控制在**一屏以内**（目标 ≤1.2k 字符 ≈ 300 token），且只在会产出正文的 4+1 个阶段出现 |
| `EventOutlineData` 加字段影响落库/既有数据 | 字段**可选**、向后兼容；读旧数据时为 undefined，行为等同现状 |
| **重蹈 `42727a9` 覆辙**：把规则变成阶段 6 的全文改写授权 | §2.4.1 的边界句 + 保持 `:454`/`:2152` 两条断言通过；阶段 6 只接受边界式约束 |
| **修 `join("\\n")` 改动渲染文本**，可能有 spec 钉住旧形态 | 实施时先 grep 断言；若断言钉的是字面 `\n`，改断言（不是保留 bug） |
| 规则块过长反而稀释注意力、降低遵守率 | 目标 ≤1.2k 字符；只用最狠的条目（词表 + cliché + 二分对照 + 冒号 + 段尾结论 + 适配边界） |

---

## 5. 与丙/丁的边界（避免撞车）

- `src/lib/novel/event-outline.ts`：**甲**只改 `eventOutlineToProsePrompt` 与
  `EventOutlineData`（加可选 `requirement`）；**丙**改入口/保存链路
  （`FILE_TYPE_ALIASES["细纲"]`、`outline-plan-protocol.ts:385/:394` 的诱导、
  卡片「重新修改」）。两边都要动这个文件，实施顺序上甲先合。
- `src/components/`：甲**不碰**任何组件（正文生成在 lib 层）。
  那三项新 UI（灵感弹窗/设置开关/引导教程）也**不在甲**。
- 丁要动文风预设与生成时的「文风写作」选择；甲只改提示词文字，
  两者在 `deep-chapter-prompts.ts` 可能相邻，但甲不改优先级与选择逻辑。

---

## 6. 未验证 / 需在实施时确认

1. **没有真实 LLM 效果验证**。规则文本能否真的降低 AI 味，只能靠人工读稿验收
   （见计划的「人工验收」）。本批能自动验证的是「规则被正确、无条件、
   位置正确地注入了所有正文阶段」，**不是**「文字变好了」。
2. ~~**`novel-de-ai-rules.md` 的 177 行 vs 早前记录的 142 行**~~ **已查明（2026-10-10 实施时）**：
   177 是**总行数**（`Get-Content .Count` = 177，与实读工具一致），142 是
   `Get-Content | Measure-Object -Line` 的**非空行数**——`-Line` 不计空行，
   而该文件恰好有 **35 个空行**（177 − 35 = 142）。不是编码或换行差异，两个数字都对。
   被删的 `de-ai-rules.ts`（git 报 177 行改动）同理。
3. ~~扩写/润色未逐行读~~ **已解决**：`buildDeepChapterExpansionPrompt`（`:232-267`）7 条、
   `buildDeepChapterFinalPolishPrompt`（`:269-305`）5 条，已逐行读并与新规则比对
   （见 §2.4.1）。剩一个待确认项：**扩写/润色是否确实不需要 `skillsPrompt`**——
   当前签名没有该参数，本批**不改签名**；但注意这同时意味着
   **`基础去AI味` 在扩写与阶段 6 根本不生效**（调用点未传）。
   这正好加强了对 P0 的判断：扩写必须靠本模块的常量兜底。
4. 规则块的**实际字符数**：实施后经复核修订，**最终实测 = 904 字符**
   （`DE_AI_GENERATION_RULES.length`，首版 823，复核阶段补入 `通俗点讲`、
   给路标词配额加「段落结构词」限定、给适配边界加烂句例外，共 +81）。
   仍在 ≤1.2k 目标内（约 226 token，chars/4 口径）。
   `DE_AI_REVISION_BOUNDARY` = 63 字符。两条都由 `de-ai-generation-rules.spec.ts`
   钉住上限（≤1200），将来加条目会先在测试里报警。
5. **`filter(Boolean)` 会吞掉空行占位符（复核阶段发现并已修）**：
   `deep-chapter-prompts.ts` 的三个 builder 都走 `[...].filter(Boolean).join("\n")`，
   所以靠相邻的 `""` 造空行是**无效**的——首版三处注入都写了 `""`，
   实际效果是规则块紧贴上一行、返修的边界句还成了规则列表最后一条 bullet 的
   **markdown 续行**（而它本是用来限制规则适用范围的，读错就失去意义）。
   现改用私有辅助函数 `asOwnParagraph()`（把空行并进字符串本身），
   实测返修提示词里规则块前与边界句前**都是空行**，两者各自成段。
6. **`baseSystemPrompt` 之外是否还有 input 侧末级截断**未确认
   （`deep-chapter-generation.ts:730-731` 提到「llm-client 末级截断」，但
   `src/lib/llm-client.ts` 里未找到）。若存在，过长的规则块理论上仍可能被截。
   因此更要把规则块压在 1.2k 字符内——这既是成本考虑，也是截断风险的对冲。
7. **fast 模式的正文由谁写**未完全确认：有报告称 fast 下由**外层会话模型自己写正文**
   （故 `skills/de-ai-writing/SKILL.md` 的 12 条在 fast 下反而生效），
   standard/strict 才走 `run_chapter_workflow` 工具。若属实，本模块在 fast 下
   仍是**净增益**（多一层地板），但「fast 完全没有反 AI 腔约束」的说法在
   §1.3.2 里**偏强**，实施时不必据它做设计决策。该点不影响本批的改动内容。
8. **`join("\\n")` 的修复对「已经存过技能配置的旧项目」不生效**（实施后复核发现，
   已知限制，本批**不修**）：
   - `saveUserSkillConfig`（`user-skill-store.ts:422-425`）会把**完整 skills 数组
     （含内置技能的内容）**写进 `<项目>/writing-skills.json`；
   - 而 `ensureBuiltinSkills`（`:430-447`）只按 **id** 补**缺失**的内置技能
     （`:433-438` 用 `existingBuiltinIds` 差集），**已存在的同名内置技能不会被刷新内容**；
   - 于是旧项目盘上那份 `基础去AI味` 仍带着字面量 `\n`，本批的修复**只对新建项目
     或从未落盘过内置技能的项目生效**。
   - **为什么不顺手修**：安全的修法只能是「当内置技能内容与当前种子逐字节相同时才覆盖」，
     否则会**清掉用户对内置技能的编辑**；那是另一套迁移机制，
     不属于「正文去 AI 味」的范围，且需要单独设计（何时刷新、如何区分「用户改过」与「没改过」）。
     故本批只**记录**此限制，不动 `ensureBuiltinSkills` 的语义。
   - 影响面有限：`基础去AI味` 只是 standard 模式下 2 个技能的其中之一，
     且本批新增的 `DE_AI_GENERATION_RULES` 是**无条件**注入的提示词层地板，
     不依赖该技能是否被修好。

---

## 7. ✅ 三项原始诉求的独立复核（收尾时重做一遍，以 `git grep` 为准）

本批的**诉求原文**见 `docs/scratch-20261010-文风与拆书库-设计.md` §6，共三条。
逐条给出**可复核的证据**（不是复述实现者的报告）：

### 7.1 「正文 prompt 补反 AI 腔硬规则」——✅ 成立
```
git grep -n "DE_AI_GENERATION_RULES" -- src
  src/lib/novel/de-ai-generation-rules.ts:33    ← 定义
  src/lib/novel/deep-chapter-prompts.ts:195     ← 初稿
  src/lib/novel/deep-chapter-prompts.ts:233     ← 返修（并带 DE_AI_REVISION_BOUNDARY）
  src/lib/novel/deep-chapter-prompts.ts:274     ← 扩写
  src/lib/novel/event-outline.ts:404           ← 事件细纲扩写
```
- 三处正文阶段全部覆盖；**阶段 6「最终润色」刻意不含**，并有反向断言钉住
  （`deep-chapter-generation.spec.ts:457`、`:2158` 的 `not.toContain("## 反 AI 腔硬约束")`）。
- 注入位置不变式由 `deep-chapter-prompts.cache.spec.ts:76-83` 钉住
  （规则块整体排在稳定缓存前缀**之后**）。

### 7.2 「接上零引用的禁用词清单」——✅ 成立（落地形态是**节选重写**，理由见 §2.1）
- 那份清单 = `skills/de-ai-writing/references/novel-de-ai-rules.md`（**177 行**）。
  §1.2 已实读确认它质量高，但定位是**改写手册**，从未进过正文生成。
- 本批**没有整篇注入**（§2.1 的「类别错误」论证 + 每次调用都付 2.5k 字符的成本），
  而是按它的**分类**重写成 `DE_AI_GENERATION_RULES` 的「词法」小节。
  **逐类核对**（`.md` 的六类 → 实现）：
  | `.md` 分类 | 实现行 |
  |---|---|
  | 总结腔 | `de-ai-generation-rules.ts:36` |
  | 解释腔 | `:37` |
  | 模板句首 | `:38` |
  | 空洞形容 | `:39` |
  | 转折滥用 | `:40` |
  | AI 特征词 | `:41` |
  另有套话/cliché 清单（`:42`「禁烂句」）。**六类无缺**由
  `de-ai-generation-rules.spec.ts:22-23` 断言（用例名即「词法组点名了每一类禁用词与 cliché 清单」）。
- ⚠️ **口径必须说清**：诉求说的「接上」，在本批的落地形态是**重写节选**，
  不是引用同一个文件。详版 `.md` **未删**，仍是人工可编辑的出处
  （模块头注释 `:15` 明写）。将来若想改成「整篇引用」，需重开设计，
  不要把这个选择当成偶然产物。

### 7.3 「改善只有 strict 模式才审稿返修的问题」——✅ 成立，但**是改换解法**
- §1.5 已实测证明**字面修法没有意义**：
  - 默认模式是 `standard`，不是 strict（`workflow-mode.ts:8` + `wiki-store.ts:1023`
    + `workflow-mode.spec.ts:14` 三处互证）；
  - `deep-chapter-generation.ts:1125-1167` 在 `standard` 下**硬短路**掉返修与润色
    （`finalContent = draftContent`）；
  - **而且连 strict 的 18 条审稿维度里，没有一条是文风/句式/词法**
    （`review-adapter.ts:59-78`）——JSON 里那个 `"style"` 枚举没有任何维度会产出它。
- ⇒ 本批的解法是**把质量关口前移到「所有模式都必然执行的那一次调用」**
  （初稿 + 扩写），用提示词约束**预防**，而不是加一轮只有 strict 才走的审稿。
  零额外 LLM 调用，对 `fast`/`standard`/`strict` 一律生效。
- ⚠️ **这不算「把审稿维度补齐」**。若用户原意是「让 standard 也做审稿返修」，
  那要改 `resolveChapterWorkflowProfile` 的档位语义（成本翻倍），**不在本批范围**。
  此处如实记录，以免被误读为已做。
- 本条的**人工验收仍未执行**（§6 第 1 条）：自动测试只能证明
  「规则被无条件、位置正确地注入」，**不能**证明「文字变好了」。
  需要人在 `npm run tauri dev` 里真读一段散文。
