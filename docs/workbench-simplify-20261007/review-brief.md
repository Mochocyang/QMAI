# 独立对抗性审查简报（拆书库结果面板简化）

你是一个**独立的对抗性审查者**。你的任务不是确认「代码能跑」，而是**尽力找出它错在哪**。
如果找不到问题，你必须证明你认真找过（列出你检查了什么、怎么检查的、为什么通过）。

## 背景（只读，别改代码）

- 仓库：`C:\QMAI_C\QMAI-main`，分支 `main`
- 设计文档：`docs/workbench-simplify-20261007/design.html`
- 实施计划：`docs/workbench-simplify-20261007/plan.html`
- 用户诉求（原话）：
  > 「拆出库当中像"结构版本搜索框"、"用户已确认本次需求"以及"仅待确认已加入使用库"这些内容…觉得没什么用，导出结果也没有必要，所以这些都可以删除了。」
  > 「为什么非要显示"加入使用库"呢？所有生成的内容（包括生成的角色）直接显示在最下面不就好了吗？」
- 用户决策：①分析完**自动入库**，不再要整版确认按钮；②每个对象旁**新增删除按钮**，点击**弹窗确认**；③删除是**连灵魂库一起真删**；④**所有版本全部平铺，旧版本在前、新版本在后**；⑤每个对象名后**显示生成日期**。

## 改动范围（本次提交涉及的文件）

- `src/components/novel/book-analysis-workbench.tsx`
- `src/components/novel/book-analysis-workbench.spec.tsx`
- `src/components/novel/book-analysis-workbench.css`（可能）
- `src/lib/novel/book-analysis/workbench-core.ts`（新增 `removedSubjects`）
- `src/lib/novel/book-analysis/workbench-storage.ts`（读时清洗该字段）
- `src/lib/novel/book-analysis/workbench-publish.ts`（导出 `workbenchAuraId`）
- `src/lib/novel/book-analysis/workbench-remove.ts`（新文件：删除分派）
- `src/lib/novel/writing-style-store.ts`（新增两个 remove 函数）
- 上述文件对应的 `*.spec.ts`

用 `git status --porcelain` 与 `git diff` 看清全部改动（**只读，不要 git add/commit/checkout/restore/stash**）。

## 你必须逐条独立验证的高风险点

对每一条：**自己动手验证**（读代码 + 写临时脚本/临时测试跑一遍），不要只读实现者的说明就采信。
每条给出结论：**确认 / 部分确认 / 推翻**，并附你的证据（命令、输出、行号）。

### C1. 六个元素真的不再渲染
结果版本下拉、搜索框、仅待确认、状态行、「确认并加入/已加入使用库」按钮、导出结果按钮。
**并且**：对应的 state / 函数 / import 是否都清理干净（`tsconfig` 开了 `noUnusedLocals`，但被删的 state 若还有人用会编译失败 —— 反过来说，若某处还在用它，可能意味着有行为被悄悄改掉了）。注意 `wb-search` 这个 class 还被 `workbench-chapter-selector.tsx` 用着，**章节搜索框必须保留**。

### C2. 自动入库的正确性（最高风险）
- 只对 `!confirmedAt && origin !== "legacy"` 触发
- **legacy 版本绝不能自动发布** —— 请自己论证为什么（设计 §4.1 有理由），并确认代码与测试都钉住了
- 幂等：重复渲染/重复 resolve 不会重复发布
- 失败时：不写 `confirmedAt`、只报错一次、**不无限重试**
- 一次刷新有多个未发布版本时，是否会互相干扰（例如 `pending` map、`publishWorkbenchRef`）

### C3. 「自动入库会不会把不该发的也发了」
`confirmWorkbenchRevision` 内部有道门槛（`:138`）：非 legacy 且没有任何规则 → 抛「没有有依据的规则可加入」。
请确认自动入库路径撞上这道门槛时：**只是报错、不会把版本标成已入库**，也不会进入无限重试。
另请检查：`inspectWorkbenchPublication` 抛错、`materializeLegacyCharacterRevision` 抛错的分支是否都被正确处理。

### C4. 删除是「真删」且不会静默失败（最高风险）
- 实现者最初的设计前提**是错的**：他们以为 aura id 是 `wb-${sha256(subject)}` 确定性推导。
  实际 `createCustomCharacterAuraFromGeneratedSkill`（`character-aura.ts:432`）用的是
  `custom-${now}-${Math.random()}`。**请独立核实这一点**，并确认最终实现是否绕过了这个坑。
- `deleteCustomCharacterAura` 按 `aura.id` 精确过滤，**查不到会静默返回、不抛错**。
  请确认：删除不存在的目标时，返回给用户的信号是什么？会不会出现「卡片消失了但灵魂还在库里」？
- 实现者被要求「删掉**所有**匹配项，而不是只删第一条」。请构造一个 store 里有**两条**同 (书名, 角色名)
  aura 的场景，独立验证删除后两条都没了。**如果只删了一条，请判 C4 失败。**
- 文风 / 故事页：整版只有一个库条目，删除任一对象 = 删整版。请确认 `removedSubjects` 是否把
  该版**全部** subject 都标记了（否则会出现「预设已删、同版另一个对象还显示着」的不一致）。
  另：删掉的若正是**当前启用中的文风**，`enabledStyleId` 是否被置空？（悬空启用 id 会怎样？）

### C5. 全版本平铺与生成日期
- 渲染顺序真的是「旧在前、新在后」（按 `createdAt` 升序）吗？
- **`loadWorkbenchRevisions` 的数组顺序有没有被改动**？组件里有一条注释明确警告「追加在末尾，不要放开头：
  下面的 selectedRevisions[0] 会让前置的旧版条目盖住用户最新生成的结果」。请确认这条不变量仍在。
- 每个对象的日期取自**所属版本**的 `createdAt`（对象本身没有时间戳）。请确认「同一角色在不同版本里显示不同日期」
  是正确行为，且格式是短的 `M/D HH:mm`（不是一长串 `toLocaleString`）。
- 从分析活动页跳转过来时的定位逻辑（原来是 `setSelectedRevision`）改成什么了？还工作吗？有没有留下死引用？

### C6. 删除弹窗
- 用的是仓库现成的 base-ui `Dialog`（与同文件 `BindingTargetDialog` 同一套），不是自己搭的遮罩吗？
- 文案按三技能页分支是否正确？
- **取消 → 什么都不能发生**（不许「先删了再问」）。请构造这个场景独立验证。
- 确认删除后：卡片消失、重新 `loadWorkbenchRevisions` 后仍不出现（`removedSubjects` 真落盘了）。

### C7. 测试网质量（重点：找假测试）
- 是否存在**永远会通过**的断言？（例如 `expect(x).toBeDefined()` 而 x 无论如何都存在；或 `.toContain()` 断言的字符串在无关位置也出现）
- 是否有**该测却没测**的关键行为？请列出缺口。
- 有没有测试**断言了错误的东西**（比如断言了 mock 的调用而没断言最终 store 状态）？
- 是否还有**只断言「某文案不存在」**这类脆弱写法，却在实现里靠改文案就能骗过？

### C8. 回归与既有行为
- 现有 spec 被改了 6 处断言（计划 §2.1 有清单）。请逐个确认：**改后的断言是否仍然守住了原本要守的行为**，
  还是把原本能抓到 bug 的测试**弱化**了？尤其 `:467` 那条「先落盘 legacy 再确认」的顺序不变量。
- 结果面板的**其它**功能有没有被顺手改坏：视图切换（卡片/列表）、角色卡上「加入自定义灵魂库 / 绑定…」、
  补充修订、证据索引、与上一版本的变化、本次需求、原作结构观察导图。

### C9. 数据兼容
- `removedSubjects` 缺字段的**旧数据**能否正常读出（不能因此抛错）？
- ⚠️ 同时确认：`loadWorkbenchRevisions` 原有的校验（`workbenchVersion !== 2 || !Array.isArray(items) || !Array.isArray(evidence)` → 抛错）
  **没有被放松**。请构造损坏数据验证仍会抛错。

## 你可以使用的命令

```
npx vitest run <spec路径> --exclude "**/.codex-temp/**" --exclude "**/.claude/**" --exclude "**/.worktrees/**"
npx tsc -p tsconfig.app.json --noEmit
```

⚠️ **vitest 遇到不存在的路径会静默少跑文件** —— 每次都要核对输出里的 `Test Files` 与 `Tests` 数量，别只看退出码。
⚠️ 你若要写临时验证脚本，写到 `%TEMP%` 或仓库里以 `.verify-` 开头的文件，**用完删掉**。
⚠️ 路径含中文时 PowerShell 控制台会显示乱码，但文件本身正常 —— 别据此判断文件坏了。

## 输出格式

```
## 结论汇总
| 编号 | 结论 | 一句话理由 |
| C1 | 确认/部分确认/推翻 | … |

## 逐条证据
### C1 …
  - 我做了什么（命令/读了哪几行）
  - 我看到了什么（贴关键输出）
  - 结论与理由

## 我发现的缺陷（按严重度排序）
### [CRITICAL/IMPORTANT/MINOR] 标题
  - 位置：文件:行号
  - 现象：
  - 我如何验证的（可复现的最小步骤）：
  - 为什么这是问题：
  - 建议修法：

## 我检查过但没发现问题的部分
（列出你检查了什么、怎么检查的 —— 用来证明你的覆盖范围，不是空话）

## 测试网缺口
（列出你认为该测但没测的行为）
```

**重要**：不许说「看起来没问题」就完事。每条结论都要有你自己的验证动作与证据。
如果你没时间/没能力验证某条，就**如实说没验证**，不要假装验证过。
