# 单元 A：拆书库删除功能的数据层（TDD）

## 你的任务范围（只许改这些文件）

**拥有（可改/可建）：**
- `src/lib/novel/book-analysis/workbench-core.ts`
- `src/lib/novel/book-analysis/workbench-storage.ts`
- `src/lib/novel/book-analysis/workbench-publish.ts`
- `src/lib/novel/book-analysis/workbench-remove.ts`（**已由我建好骨架，签名已冻结，你实现它**）
- `src/lib/novel/writing-style-store.ts`
- 上述文件对应的 `*.spec.ts` / `*.test.ts`（可新建）

**严禁触碰：**
- `src/components/**`（另一个单元正在并行改，尤其 `book-analysis-workbench.tsx`）
- 任何其它 lib 文件（除下面明确要调用的现存接口，只读不改）

**严禁执行**：`git add` / `git commit` / `git checkout` / `git restore` / `git stash`。提交由我来做。

## 环境事实（已确认，别重新摸索）
- 仓库：`C:\QMAI_C\QMAI-main`，分支 `main`
- 测试必须带排除项，否则会跑到临时目录里的副本：
  `npx vitest run <你的spec路径> --exclude "**/.codex-temp/**" --exclude "**/.claude/**" --exclude "**/.worktrees/**"`
- **vitest 遇到不存在的路径会静默少跑文件**：每次都要核对输出里的 `Test Files` 与 `Tests` 数量，别只看退出码。
- 全局 `environment: "node"`（这些是纯 lib 测试，不需要 jsdom）
- 备份文件到 `%TEMP%`，恢复后用 SHA-256 校验（不要用 git 恢复）
- 路径含中文时 PowerShell 控制台会显示乱码，但文件本身正常 —— 别据此判断文件坏了

## 必读的现有实现（先读再写）
- `src/lib/novel/book-analysis/workbench-publish.ts` —— `publishWorkbenchCharacter`（`:103`）里现在这样算 id：
  `id: \`wb-${(await sha256Text(item.subject)).slice(0, 16)}\``
  以及 `confirmWorkbenchRevision`（`:129`）末尾 `saveWorkbenchRevision`
- `src/lib/novel/book-analysis/workbench-storage.ts` —— `loadWorkbenchRevisions`（`:29`）的清洗与排序
- `src/lib/novel/character-aura.ts:495` —— `deleteCustomCharacterAura(projectPath, auraId)`（**已会连带解除绑定**）
- `src/lib/novel/plot-framework-library.ts:146` —— `removePlotFramework(projectPath, frameworkId)`
- `src/lib/novel/writing-style-store.ts` —— `loadWritingStyleStore` / `saveWritingStyleStore` / `enabledStyleId` / `upsertWritingStylePreset`（按 `sourceBook` 找已有项，说明一本书最多 1 个文风预设）
- `src/lib/context-hub/fingerprint.ts` —— `sha256Text`
- **模仿现有 spec 的 mock 手法**：读 `src/lib/novel/book-analysis/workbench-publish.spec.ts` 的顶部，照它的方式 mock `@/commands/fs` 等

## 冻结的接口（一个字都不许改）
```ts
// workbench-core.ts
export function sanitizeRemovedSubjects(value: unknown): string[]

// workbench-publish.ts
export async function workbenchAuraId(subject: string): Promise<string>
//   = `wb-${(await sha256Text(subject)).slice(0, 16)}`
//   publishWorkbenchCharacter 内部必须改用它（保证发布 id 与删除 id 同源，不各写一遍 sha256）

// writing-style-store.ts（WritingStyleStore 未导出，返回值类型写 Promise<WritingStyleStore> 即可）
export async function removeWritingStylePreset(projectPath: string, styleId: string): Promise<WritingStyleStore>
export async function removeWritingStylePresetBySourceBook(projectPath: string, sourceBook: string): Promise<WritingStyleStore>

// workbench-remove.ts（骨架已存在）
export function workbenchStoryFrameworkId(bookId: string): string   // `wb-story-${bookId}`
export async function removeWorkbenchRevisionItem(input: {
  projectPath: string; bookPath: string; revision: WorkbenchRevision; subject: string
}): Promise<WorkbenchRevision>
```

## 流程要求：先红后绿
**每个行为都要先写出会失败的测试，跑一次确认它确实失败（把失败信息记下来），再写实现。**
不许先写实现再补测试 —— 本次任务里已经有两次「先实现后补测」导致假修复的教训。

## 具体行为清单

### 1. `sanitizeRemovedSubjects`
- 非数组 / `undefined` / `null` → `[]`
- 数组里的非字符串、空串、纯空白 → 丢弃
- 去重（保序）
- 合法输入原样返回

### 2. `loadWorkbenchRevisions` 清洗
- 读出的每个版本套 `sanitizeRemovedSubjects`
- **缺这个字段的旧数据必须能正常读出来**（向后兼容），不许因此抛错
- ⚠️ **既有行为不能松**：`workbenchVersion !== 2 || !Array.isArray(items) || !Array.isArray(evidence)` 仍然要抛错。写一条测试钉住它。

### 3. `workbenchAuraId`
- 形如 `wb-` + 16 位十六进制
- **关键测试**：跑一次 `confirmWorkbenchRevision`（characters 技能），把产出的 `publishedIds` 与
  `await workbenchAuraId(subject)` **逐个比对相等**。这是防止将来有人只改一边的守卫。

### 4. `removeWritingStylePreset` / `...BySourceBook`
- 按 id / 按 sourceBook 删掉对应预设
- **若 `enabledStyleId` 指向被删的那个 → 必须置 `null`**（否则会留下指向不存在预设的悬空启用项）
- 删不存在的目标 → 不抛错、store 不变
- 按 sourceBook 删：若没有匹配项 → 不抛错

### 5. `removeWorkbenchRevisionItem`
把结果落盘（用 `saveWorkbenchRevision(bookPath, next)`）并返回 next。
`removedSubjects` 追加时**幂等**（已存在不要重复追加）。

- **characters**：`await workbenchAuraId(subject)` → `deleteCustomCharacterAura(projectPath, id)`；`removedSubjects += subject`
- **style**：`removeWritingStylePresetBySourceBook(projectPath, revision.bookTitle)`；
  `removedSubjects += 该版本全部 subject`（因为整版只有一个预设，删一个即删整版 —— 否则会出现
  「预设已删但同版另一个对象还显示着」的不一致状态）
- **story**：`removePlotFramework(projectPath, workbenchStoryFrameworkId(revision.bookId))`；
  `removedSubjects += 该版本全部 subject`（同上理由）
- 未知 skill → 抛错（不要静默什么都不做）
- **测试要证明真的落盘**：调用后再 `loadWorkbenchRevisions(bookPath)` 读出来，`removedSubjects` 仍在

## 完成标准
1. 你负责的每个 spec 都全绿，并在报告里给出**具体的文件数与用例数**
2. 跑 `npx tsc -p tsconfig.app.json --noEmit` —— 若只报 `book-analysis-workbench.tsx`（组件单元正在并行改）相关的错，忽略它；**其余错误必须为零**，并在报告里如实说明哪些错你忽略了、为什么
3. 报告里列出：你新增/修改的文件、每条行为的测试名、以及你为了确认「测试真的会失败」而跑出的失败信息摘录
4. 如实报告任何你没能做到或不确定的地方，不要粉饰
