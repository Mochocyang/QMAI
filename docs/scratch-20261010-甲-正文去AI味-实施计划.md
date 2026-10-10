# work/scratch-20261010 第三批（甲）实施计划：正文去 AI 味

> 依据：《`docs/scratch-20261010-甲-正文去AI味-设计.md`》（下称「设计」）。
> 工作树：`C:\QMAI_C\QMAI-main\.worktrees\scratch-20261010`，分支 `work/scratch-20261010`。
> 基点 `a5a2702`，本批起点 `50c1d33`。
> **所有命令都在本工作树内执行**；主检出 `C:\QMAI_C\QMAI-main` 只读、绝不写。

---

## 0. 基线（本批起点 `50c1d33`，实测）

| 命令 | 期望 |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run typecheck:tests` | exit 0 |
| `npm run test:mocks` | **723 文件 / 7100 用例 / 6 todo / 0 失败** |

> 注意区分两个数：**切出时**（`a5a2702`）是 718 文件 / 6938 用例；
> **本批起点**（`50c1d33`，乙收尾后）是 **723 文件 / 7100 用例**。
> 只跟后者比。本批新增 1 个 spec（`de-ai-generation-rules.spec.ts`）→ 期望约 724 文件。

> 注意：跑过 `test:mocks` 后 `tests/fixtures/**` 与 `docs/*/dump.html` 会有约 170 个
> EOL 假阳性。用 `git diff HEAD --name-only | Measure-Object` 判定（应为 0）；
> **绝不** `git checkout -- .` / `git restore .`。

---

## 1. 步骤（按序）

### 步骤 1：取回旧规则的原文作为取词依据（只读）

```powershell
git show 58bceeb^:src/lib/novel/de-ai-rules.ts
```
与 `skills/de-ai-writing/references/novel-de-ai-rules.md` 对照。
**只作为词表/句式清单的来源**，不要把 177 行原样搬进代码（设计 §2.1）。

### 步骤 2：新增 `src/lib/novel/de-ai-generation-rules.ts`

两个导出，纯字符串常量，无 IO、无 i18n：

1. `DE_AI_GENERATION_RULES`：反 AI 腔约束本体。四类：
   - **词法**：总结腔 / 解释腔 / 模板句首 / 空洞形容 / 转折滥用 / AI 特征词（限用而非全禁）；
   - **句式**：禁止 `不是 A 而是 B` 二分对照壳；不把 `概念：解释` 当模板；路标词配额；
   - **叙事**：不解释动机、不总结情绪、段尾不补抽象结论、无效热闹、单手法循环；
   - **正面替换**：抽象→可见动作、长句→断句、对话留毛边。
   - **必须包含小说适配边界**：副词与「似乎/仿佛/缓缓」在小说里可以是风格，不硬删；
     不为了反 AI 而刻意别扭。
2. `DE_AI_REVISION_BOUNDARY`：一句边界（设计 §2.4.1），语义＝
   「只为**不引入新的** AI 腔；不要为满足它改动问题清单之外的段落或剧情。」

**硬指标**：`DE_AI_GENERATION_RULES` ≤ **1200 字符**（设计 §4、§6.4）。
超了就砍到最狠的条目，不要靠"再塞一条"。

顶部注释写明来源（`.md` 与已删的 `de-ai-rules.ts`）与**为什么不是整篇复制**。

### 步骤 3：注入 4 个正文 builder + 1 个事件细纲 builder

文件 `src/lib/novel/deep-chapter-prompts.ts`：

| builder | 加什么 | 位置 |
|---|---|---|
| `buildDeepChapterDraftPrompt`（`:151`） | `DE_AI_GENERATION_RULES` | 在「输出要求」1-11 **之后**，`目标章节` 之前 |
| `buildDeepChapterExpansionPrompt`（`:232`） | `DE_AI_GENERATION_RULES` | 在 `硬性要求` 7 条之后 |
| `buildDeepChapterRevisionPrompt`（`:190`） | RULES + `DE_AI_REVISION_BOUNDARY` | 在 7 条硬性要求之后 |
| `buildDeepChapterFinalPolishPrompt`（`:269`） | **什么都不加，保持逐字节不变** | — |
| `buildDeepChapterBriefPrompt`（`:68`） | **不加** | — |

> **`finalPolish` 不加是刻意的**（设计 §2.4 修正）：`42727a9` 已把阶段 6 收窄为
> 「按需局部修改」，`deep-chapter-generation.spec.ts:454`/`:2152` 就是守它的。
> 阶段 6 的输入已由 draft/revision 约束过，不需要也不应该再塞规则。

**不可违反的约束（设计 §2.3）**：所有新增内容都必须在
`buildStableContextPrefix(outline, contextPrompt)` **之后**。
`deep-chapter-prompts.cache.spec.ts:44-54` 会因此失败，如果插错位置。

**不改任何 builder 签名**（设计 §2.4.1 末），调用点不动。

文件 `src/lib/novel/event-outline.ts`：

- `eventOutlineToProsePrompt`（`:352`）在 `## 写作要求` 里加 `DE_AI_GENERATION_RULES`。
- 同一步骤做步骤 4 的 `requirement` 修补。

### 步骤 4：事件细纲 `requirement` 不再丢失（设计 §2.5）

1. `EventOutlineData`（`event-outline.ts:37`）加**可选**字段 `requirement?: string`。
2. `extractEventOutlineData`（`:245-273`）：若 `request.requirement` 有值，写入返回对象。
3. `eventOutlineToProsePrompt`：`requirement` 非空时输出
   `## 用户对本章的要求` 小节；为空时**整节不出现**。
4. `normalizeEventOutlineData`（`:109-120`）与 `readEventOutline`（`:92-103`）
   要能读回该字段（旧数据无此字段 → `undefined`，行为等同现状）。

> 不要改事件细纲的入口/保存链路（那属于丙）。

### 步骤 5：修 `skill-seed.ts` 的换行缺陷（设计 §1.8）

`src/lib/novel/skill-seed.ts` 三处 `join("\\n")` → `join("\n")`：
`:1785`（`基础去AI味`）、`:1795`（`审稿返修`）、`:1805`（`返修后复审`）。

先 grep 有没有 spec 断言了字面 `\n`：
```powershell
git grep -n 'join("\\\\n")' -- src
git grep -n "基础去AI味" -- src
```
若断言钉的是 bug 形态 → **改断言**，不是保留 bug。

### 步骤 6：测试（设计 §3）

新增 `src/lib/novel/de-ai-generation-rules.spec.ts`：非空/含关键分类/含小说适配边界/
不含改写流程指令（「逐句检查」「修补顺序」「参考资源」）/重复取值逐字节相同/≤1200 字符。

扩展 `src/lib/novel/deep-chapter-prompts.spec.ts`（**deep-**，别写成 `de-`）：
初稿/扩写/返修三个 builder 含规则块；`brief` 与 `finalPolish` **不含**；
规则块 `indexOf > stableBlock.length`。

扩展 `src/lib/novel/deep-chapter-prompts.cache.spec.ts`：
加规则后跨阶段最小公共前缀仍 ≥ `stableBlock.length`。

扩展 `event-outline.spec.ts`：`requirement` 有/无两态；扩写提示词含规则块。

`skill-seed` 换行：断言含真 `\n`、不含字面 `\\n`。

**必须保持通过的既有断言（不得改动）**：
`deep-chapter-generation.spec.ts:454`、`:2152`（stage-6/finalPolish 不含
「中文小说去 AI 味补充规则」）、`:438-450`（字数边界）。

### 步骤 7：验证

```powershell
npm run typecheck
npm run typecheck:tests
npm run test:mocks
```
+ 设计 §6 的存疑项逐条确认；+ `git diff HEAD --name-only | Measure-Object` 判 EOL 假阳性。

### 步骤 8：提交（点名文件，中文 conventional commits）

建议拆分：
```
feat(写作): 正文生成提示词加入反 AI 腔硬约束
fix(写作): 扩写提示词丢失用户对本章的要求
fix(技能): 修正内置技能内容里的字面 \n 换行
test(写作): 覆盖反 AI 腔规则注入位置与缓存前缀
docs(设计): 记录正文去 AI 味的历史与取舍
```

---

## 2. 人工验收（合并前必须由人执行，本批**无法**自动验证效果）

在 `npm run tauri dev` 中：

1. 无文风预设，用**标准**模式生成一章，人读：是否仍有明显
   「不是…而是…」「总之/其实/毫无疑问」、段尾升华、「目光交汇的瞬间」类句子。
2. 用**严格**模式生成同一章，确认返修/润色**没有**大范围重写用户已认可段落。
3. **fast** 模式生成一次，确认仍出正文（没被新规则影响格式）。
4. 任一模式查看请求日志，确认提示词里出现新规则块、且位于上下文块之后。
5. 反例检查：确认没有出现「为去 AI 味而故意写坏」的别扭句子（设计 §1.6 边界）。

> 记录实测结论到设计文档；**未执行前不得声称本批已验收**。

### 2.1 三项守门检查（必须保持原状，实测通过）

```powershell
# 1) 上下文引擎与重型模板必须一字未动 —— 空输出 = 通过
git diff a5a2702 --stat -- src/lib/novel/context-engine.ts `
  src/lib/novel/outline-context-index.ts src/lib/context-hub/composer.ts `
  src/lib/novel/chapter-outline-template.ts

# 2) autoSaveable 仍为 []
git grep -n "autoSaveable" -- src/lib/novel/outline-save-request.ts

# 3) 事件细纲仍不在上下文索引里 —— 空 = 隔离未破
git grep -n "事件细纲" -- src/lib/novel/outline-context-index.ts
```

> 甲**不应该**触发其中任何一条。检查 1 尤其重要：本批只改提示词文本与
> `event-outline.ts`（**只**扩写提示词与 `EventOutlineData`），
> 不碰 `context-engine.ts` / `outline-context-index.ts` / `composer.ts` /
> `chapter-outline-template.ts`。

---

## 3. 提交前自检清单

- [ ] 规则块 ≤1200 字符
- [ ] 4 个 builder（draft/expansion/revision/event-outline）的注入位置全在稳定前缀之后（cache spec 通过）
- [ ] `brief` **与** `finalPolish` 都未加规则；阶段 6 逐字节未变
- [ ] `:454`/`:2152` 断言仍通过、未被改弱
- [ ] 没有碰 `src/components/**`（那是丙/丁）
- [ ] 没有改 `FIELD_PRIORITY` / token 预算 / `llm-client.ts`
- [ ] 没有回退 `42727a9`（阶段 6 未恢复全文去 AI 味）
- [ ] `skill-seed.ts` 三处换行已修
- [ ] 两个 typecheck + `test:mocks` 回到基线
