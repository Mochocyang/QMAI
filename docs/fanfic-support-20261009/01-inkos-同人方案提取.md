# InkOS 同人创作方案提取

> 任务 1 + 任务 2 的产出：分析 `https://github.com/Narcooo/inkos`，把「同人小说类型是怎么创作的」这件事从源码里提取成可复用的规则。
>
> - 仓库：`https://github.com/Narcooo/inkos`（InkOS）
> - 分析基线：`master` @ `8fc2ae57080b9821257dee3e37cc677e2b6f389a`（浅克隆到临时目录，不进入本仓库）
> - 分析日期：2026-10-09

---

## 1. 结论摘要

InkOS 把「同人」当成**一等创作类型**（creation kind），而不是一个题材标签。它的同人支持由五块拼成，缺一块就写不出可用的同人：

| 组成 | 载体 | 作用 |
|---|---|---|
| ① 同人模式 | `BookConfig.fanficMode` + `BookRules.fanficMode` | 声明本作与原作的关系（正典延续 / 架空 / 性格重塑 / CP 向 / 自由描述） |
| ② 容许偏离清单 | `BookRules.allowedDeviations: string[]` | 显式列出「我允许自己改原作哪些东西」，其余一律视为不可动 |
| ③ 原作正典导入 | `FanficCanonImporter` → `story/fanfic_canon.md` | 把用户给的原作素材（小说正文 / wiki / 人物文档）编译成**可追溯的正典文档** |
| ④ 正典进上下文 | `composer.ts` 把 `fanfic_canon.md` 当 `protected` 上下文源 → 「正典约束证据」 | 写正文时正典是硬约束，不是参考 |
| ⑤ 同人写作 Skill + 审核维度 | `inkos-fanfic-writing` Skill；审核时「同人按 `fanficMode` 与显式容许偏离来判」 | 把规则固化成提示词与验收标准 |

关键判断：**同人失败的根因几乎总是「正典缺失」而不是「题材标签缺失」**——模型不知道哪些设定是既成事实，就会自己编一套，于是设定崩坏。

---

## 2. 同人模式（fanficMode）

`packages/core/src/models/book.ts:19-20` 把模式定义成**非空自由文本**而不是枚举：

```ts
export const FanficModeSchema = z.string().trim().min(1);
export type FanficMode = z.infer<typeof FanficModeSchema>;
```

`packages/core/src/__tests__/fanfic-models.test.ts:19` 给出的推荐取值是
`["canon", "au", "ooc", "cp", <一段自然语言描述>]` —— 既支持四个标准模式，也支持用户用一句话描述自己的边界（例如「原作结局十年后的低魔日后谈」）。

`packages/core/skills/inkos-fanfic-writing/SKILL.md:8` 定义了四种模式的语义与**必须说清的东西**：

| 模式 | 中文 | 语义 | 该模式必须显式交代 |
|---|---|---|---|
| `canon` | 正典延续 | 填补原作**未展示的时间段或视角** | 填哪一段、从谁的视角 |
| `au` | 架空世界 | 指明一个**分歧点**（divergence），然后严格跟随其后果 | 分歧点是什么、分歧后哪些原作事实仍成立 |
| `ooc` | 性格重塑 | 有意的性格偏离 | 偏离的**成因**与**边界** |
| `cp` | CP 向 | 以**关系变化驱动剧情**，但不把任何一方压扁成纸片人 | 关系起点、关系推进的驱动力 |

`README.md:401` 对四种模式的对外说法：`canon（正典延续）、au（架空世界）、ooc（性格重塑）、cp（CP 向）`，并明确「内置正典导入器、同人专属审计维度和信息边界管控——确保设定不矛盾」。

---

## 3. 同人写作的六条硬规则

`packages/core/skills/inkos-fanfic-writing/SKILL.md` 全文只有 11 行，但每条都是可验收的约束，直接可作为我们的 Skill 与审查项：

1. **正典是权威**：已导入的正典对「既定角色、关系、世界规则、时间线、角色已知信息、标志性限制」具有权威性。
2. **服从所选模式**：canon 填未展示的时段/视角；AU 指明分歧并跟随后果；OOC 明确有意偏离的成因与边界；CP 让关系变化驱动剧情而不压扁任一方。
3. **写新戏，不复读原作**：要建立新的戏剧线，而不是重演原作场景；新增配角与事件必须服务新线，且能与原作正典**区分开**。
4. **保留可辨认的声音**：靠**动机、认知、节奏、行为选择**保留角色辨识度，**不是靠抄原句**。
5. **无证据时留空**：原作没有证据时，保持空白或发问；**不得把猜测变成正典**。
6. （隐含）**压缩资料包是证据，不是臆造缺失正典的许可**（`architect.ts:216-217` 的续写/导入提示词原则）。

---

## 4. 原作正典的导入与编译

### 4.1 输入
`packages/cli/src/commands/fanfic.ts:205-219` 的 `readSourceMaterial()`：`--from` 可以是**单个文件**，也可以是**目录**（目录下所有 `.txt` / `.md` 按文件名排序后用 `\n\n---\n\n` 拼接）。所以原作素材可以是小说正文、wiki 导出、人物设定文档的混合。

### 4.2 编译
`packages/core/src/agents/fanfic-canon-importer.ts` 的 `FanficCanonImporter.importFromText(sourceText, sourceName, fanficMode, language)`：

- 走**结构化结果工具** `submit_fanfic_canon`，schema 只有一个字段 `canonMarkdown`（`fanfic-canon-tool.ts`），保证输出是可持久化的 Markdown 文档而不是聊天文本。
- 系统提示（`:24-25`）要求：按已激活的**导入 Skill + 同人 Skill** 编译；**只保留原作有证据、且对本作有用的内容**；**不强造题材专属体系**。
- **超长素材自动分片编译**（`:62-112`）：按语义输入预算切块，逐块编译成「可追溯 Markdown 资料包」，再汇总成一份带「片段 i/N」编号的语义资料包。这一步是长同人（原作几百万字）能落地的关键。
- 最终拼成固定骨架（`:48-57`）：

```markdown
# 同人正典（<sourceName>）

## 来源
- 素材: <sourceName>
- 同人模式: <fanficMode>

## 正典内容
<canonMarkdown>
```

落盘位置：`story/fanfic_canon.md`（`runner.ts:623` 的重建清单与 `composer.ts:673-678` 的读取路径都指向它）。

### 4.3 刷新
`fanfic refresh`（`fanfic.ts:156-203`）用同样的 importer 重新编译正典，并要求同时激活 `inkos-story-import` + `inkos-fanfic-writing` 两个 Skill。正典是**可迭代资产**，不是一次性的建书参数。

---

## 5. 正典如何进入生成链路

这是整个方案里最值得抄的部分：**正典在「大纲」和「正文」两个阶段都要注入，且注入方式不同。**

### 5.1 建书 / 大纲阶段（architect）
`packages/core/src/agents/architect.ts:231-260` 的 `generateFanficFoundation(book, fanficCanon, fanficMode, ...)`：

```ts
const canonBlock = `\n\n## 同人模式：${fanficMode}\n\n## 原作正典\n${fanficCanon}`;
const systemPrompt = this.buildFoundationProtocol({ book, contextBlock: canonBlock, ... });
// user: 请为标题为"<title>"的 <fanficMode> 模式同人小说生成基础设定。目标 N 章，每章 M 字。
```

要点：
- 模式与正典进的是 **system prompt 的 contextBlock**（权威位），不是 user 消息。
- user 消息把「这是同人、这是模式」再说一遍，避免模型跑偏成原创。
- 配套约束（`:216-217`）：既成事实从资料包推导；未来剧情服从明确指令；**不能仅凭文风或悬念推导必须发生的未来事件**；未指定发展保持开放。

### 5.2 正文阶段（composer）
`packages/core/src/agents/composer.ts:666-679`：

```ts
const canonEntries = await Promise.all([
  maybeContextSource(storyDir, "parent_canon.md",
    "Preserve parent canon constraints for governed continuation or fanfic writing.", "protected"),
  maybeContextSource(storyDir, "fanfic_canon.md",
    "Preserve extracted fanfic canon constraints for governed writing.", "protected"),
]);
```

- 正典以 **`protected` 保护级上下文源**身份进入上下文清单（`:728` 合入 entries），不会被普通裁剪随便丢掉。
- 渲染成证据块：`packages/core/src/utils/governed-context.ts:34-37, 76-81`

```ts
const canonEntries = contextPackage.selectedContext.filter((entry) =>
  entry.source === "story/parent_canon.md" || entry.source === "story/fanfic_canon.md");
...
canonBlock: canonEntries.length > 0
  ? renderEvidenceBlock("正典约束证据", canonEntries) : undefined,
```

即正典在正文提示词里以「**正典约束证据**」为标题出现——定位是**证据/约束**，不是灵感。

### 5.3 任务书重建阶段
`packages/core/src/pipeline/runner.ts:623` 的 `recoverDraftFoundation()` 在重建任务书时，把 `fanfic_canon.md` 和 `brief.md`、`parent_canon.md`、`style_guide.md`、`outline/story_frame.md` 一起读回。**正典参与断点恢复**，不会因为中途重建而丢失。

### 5.4 元数据透传
`runner.ts:308-309, 327-328` 把 `book.fanficMode` 写进 Work manifest 的 `metadata`。`activations.ts:22-27, 37-44` 据此**强制激活**技能：

```ts
const WORK_CREATION_SKILLS = { fanfic: "inkos-fanfic-writing", continuation: ..., spinoff: ..., imitation: ... };
// requiredWorkSkillIds(work) → 按 work.metadata.creationKind 返回必装技能；缺失直接抛错
```

要点：**同人作品缺同人 Skill 会直接报错，而不是静默降级**。

---

## 6. 审核维度

`packages/core/skills/inkos-story-review/SKILL.md:18`：

> For spinoffs, use parent canon as authority; **for fanfic, honor `fanficMode` and explicit allowed deviations.**

即同人的验收标准不是「像不像原作」，而是：
1. 是否符合本作声明的 `fanficMode`；
2. 是否越过了 `allowedDeviations` 之外的原作事实。

---

## 7. 能力注册（工程侧）

`packages/core/src/harness/production-capabilities.ts`：

- `:153` 确认卡绑定：`fanfic_init: { capabilityId: "adaptation", actionId: "fanfic_create", profileId: "workspace-default", risk: "recoverable-write" }`
- `:396-402` 工具注册：`createFanficBookTool(pipeline, projectRoot, { defaultSkills: merge(profileSkills("longform-novel"), skillActivations("inkos-story-import", "inkos-fanfic-writing")) })`
- `:436` 意图名 `fanfic_init` 进入 `proposedActionName()`
- Studio 侧入口：`packages/studio/src/components/Sidebar.tsx:319` 「开始创作 → 同人创作」；`BookDetail.tsx:310-315` / `Dashboard.tsx:272-277` 显示 `fanfic:<mode>` 徽标。

**工程启示**：同人不是「题材下拉里多一项」，而是一条**独立创作入口**：独立意图 → 独立确认卡 → 独立工具 → 独立技能集 → 独立元数据 → 独立徽标。

---

## 8. 可直接移植到 QMAI 的规则清单

| # | 规则 | 依据 |
|---|---|---|
| R1 | 同人模式是**自由文本**而非死枚举，内置 4 个标准模式 + 允许一句话自定义 | `book.ts:19-20`、`fanfic-models.test.ts:19` |
| R2 | 必须有 `allowedDeviations: string[]`，显式列出允许偏离，其余视为不可动 | `book-rules.ts:22` |
| R3 | 原作素材必须编译成**一份可追溯的正典文档**落盘，而不是只留在对话里 | `fanfic-canon-importer.ts:48-57` |
| R4 | 超长原作走**分片编译 + 编号片段**，不截断丢弃 | `fanfic-canon-importer.ts:62-112` |
| R5 | 正典编译时**只保留有证据的内容**，缺证据就留空，不许猜 | `SKILL.md:11`、`architect.ts:216-217` |
| R6 | 正典在大纲阶段进 **system 权威位**，在正文阶段以**受保护的高优先级约束段**注入 | `architect.ts:243-248`、`composer.ts:666-679` |
| R7 | 正典必须是**受保护**上下文，不能被常规 token 裁剪优先丢弃 | `composer.ts` protection: `"protected"` |
| R8 | 正典参与**断点恢复/重建**，不能丢 | `runner.ts:623` |
| R9 | 同人作品**强制激活**同人 Skill，缺失即报错 | `activations.ts:22-44` |
| R10 | 同人写法硬规则：写新线不复读、靠动机/认知/节奏保留声音而非抄句、新增配角须可区分 | `SKILL.md:9-10` |
| R11 | 同人审核按「`fanficMode` + `allowedDeviations`」判，不按「像不像原作」判 | `inkos-story-review/SKILL.md:18` |
| R12 | 缺证据时**发问**是可接受且被鼓励的行为 | `SKILL.md:11` |
