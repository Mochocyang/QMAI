# 单元 B：拆书库结果面板组件改造（TDD）

## 你的任务范围（只许改这两个文件）

**拥有（可改）：**
- `src/components/novel/book-analysis-workbench.tsx`（799 行）
- `src/components/novel/book-analysis-workbench.spec.tsx`（764 行，41 条用例）
- `src/components/novel/book-analysis-workbench.css`（**仅在你确实需要新 class 时才动**）

**严禁触碰：**
- `src/lib/**`（另一个单元正在并行实现删除相关的数据层接口）
- 其它任何组件

**严禁执行**：`git add` / `git commit` / `git checkout` / `git restore` / `git stash`。提交由我来做。

## 环境事实（已确认，别重新摸索）
- 仓库：`C:\QMAI_C\QMAI-main`，分支 `main`
- 测试必须带排除项：
  `npx vitest run src/components/novel/book-analysis-workbench.spec.tsx --exclude "**/.codex-temp/**" --exclude "**/.claude/**" --exclude "**/.worktrees/**"`
- **vitest 遇到不存在的路径会静默少跑文件**：每次都要核对 `Test Files` 与 `Tests` 数量
- 全局 `environment: "node"`；这个 spec 用**仓库自带的 jsdom harness**（`createRoot` + `act`）—— 照抄现有 spec 顶部的写法，别自己发明
- `tsconfig.app.json` 开了 **`noUnusedLocals: true`**：删掉按钮后，只被它用到的 import 必须一起删，否则编译失败
- 备份文件到 `%TEMP%`；恢复时用 SHA-256 校验（**不要**用 git 恢复）

## 你要消费的接口（由并行的单元 A 实现，签名已冻结）

```ts
import { removeWorkbenchRevisionItem, workbenchStoryFrameworkId } from "@/lib/novel/book-analysis/workbench-remove"
// removeWorkbenchRevisionItem({ projectPath, bookPath, revision, subject }) → Promise<WorkbenchRevision>
//   characters: 删该角色灵魂（并自动解绑）；style/story: 删整版预设/框架，并把该版全部 subject 记入 removedSubjects
// 返回落盘后的新版本（含最新的 removedSubjects）

// workbench-core.ts 上新增的可选字段
interface WorkbenchRevision { … removedSubjects?: string[] }
```

**你必须在自己的 spec 里 mock 掉 `@/lib/novel/book-analysis/workbench-remove`**（现有 spec 已经这样 mock `workbench-publish`，照那个模式写），这样你不依赖单元 A 是否已落地。

## 改造目标（依据 docs/workbench-simplify-20261007/design.html）

### 1. 删除这 6 个 UI 元素 + 它们带出的 state
| 元素 | 位置 |
|---|---|
| 结果版本下拉框 | `:500` |
| 搜索框（`aria-label="搜索成果"`） | `:611` |
| 仅待确认 checkbox | `:612` |
| 状态行 `wb-row wb-summary`（「用户已确认 · 9章 · 1个对象」） | `:618` |
| 确认并加入 / 已加入使用库 按钮 | `:619` |
| 导出结果按钮 | `:620` |

连带清理：
- `selectedRevision` / `query` / `pendingOnly` 三个 state 全删
- `confirm()`（`:574-592`）与 `exportResult()`（`:602-608`）删除
- `Check` / `Download` 从 `:2` 的 import 里删掉（`noUnusedLocals`，留着必编译失败）
- `canPublishRevision`（`:59`）若变成没人用，也要删

**活动跳转要改写**：原本 `useEffect`（`:332-336`）靠 `setSelectedRevision` 实现「从分析活动跳过来」。
全版本平铺后改为：切到对应 `activeSkill`，并 `scrollIntoView` 定位到 `data-revision-id={活动对应的版本id}`。
（用 `useRef` 或 `querySelector`，别引入新的全局依赖。）

### 2. 自动入库（核心行为）
在 `reloadRevisions` 之后加 effect，自动发布**尚未入库**的版本：

- **只处理 `!revision.confirmedAt && revision.origin !== "legacy"`**
  ⚠️ **legacy 绝不能自动发布**。理由（已核实）：`buildLegacyCharacterRevision` 在
  `book.characters.length > 0` 时就返回版本（**任何拆过角色的书都有**），而 legacy 走
  `importBookAnalysisSkillsAsAuras`，与新版 `wb-<sha256>` 是**两套 id 体系**；
  对已被新版发布过的书跑 legacy 发布会**产生重复角色灵魂**，而且 legacy 原本是「懒落盘」
  （只在你点确认时才写文件），自动发布会变成「仅仅打开页面就往磁盘写文件、并批量导入角色」。
  这是一条**必须写测试钉死**的规则。
- 每个 revision id **每次挂载只尝试一次**（`useRef<Set<string>>`）：成功后 `reloadRevisions()`；
  失败 `toast.error(...)` 报一次并**不重试**（不许无限重试刷屏），也**不写 `confirmedAt`**
- 落盘顺序保持既有不变量：legacy 先 `materializeLegacyCharacterRevision` 再按 id 确认 ——
  虽然 legacy 不再自动发布，但**别把这个顺序写反**，若你保留该分支请保留顺序
- 需要复用的现有调用：`inspectWorkbenchPublication(projectPath, revision)` 拿 `fingerprint`，
  再 `confirmWorkbenchRevision(projectPath, book.path, revision.id, inspect.fingerprint, book)`

### 3. 全版本平铺（旧在前、新在后）
- 现在只渲染 `result` 一个版本；改为把 `selectedRevisions`（= 当前 skill 的全部版本）**全部渲染**
- 渲染顺序按 `createdAt` **升序**（旧版本在前、新版本在后）
- ⚠️ **不要改 `loadWorkbenchRevisions` 的数组顺序**（它按 `createdAt` 降序返回），
  组件 `:288-292` 有一条注释明确警告「追加在末尾，不要放开头」—— 那条不变量必须保留。
  你只改**渲染顺序**。
- 每个版本一个标题行：`时间 · N章 · M个对象`，有未采纳项时追加 `· K项未采纳`；
  `origin === "legacy"` 追加「旧版导入」；非 legacy 且 `!confirmedAt` 追加「尚未入库」
- 每个版本容器上加 `data-revision-id={revision.id}`

### 4. 对象名后显示生成日期
- 取**所属版本**的 `createdAt`（对象本身没有时间戳），格式 `M/D HH:mm`
- 位置：角色卡片标题（`<h3>{item.subject}</h3>` 附近），形如 `许七安 · 10/7 09:03`
- 别用 `toLocaleString` 拼一长串；短格式，别把卡片挤坏（这条有浏览器几何验证，宽度别溢出）

### 5. 删除按钮 + 确认弹窗
- 位置：卡片底部按钮组，**在「查看规则」和「补充本修订要求」旁边**加第三个按钮
- 用 `lucide-react` 的 `Trash2`（**已在 `:2` 的 import 里**），`aria-label` 形如 `删除${item.subject}`
- 点击弹出确认框，用仓库现成的 base-ui `Dialog`（`:30` 已 import，与同文件里的
  `BindingTargetDialog` 同一套用法，**照抄它的结构**，不要自己搭遮罩）
- 文案按技能页三分支：
  - characters：`从角色灵魂库删除「<subject>」？` / 说明 `将删除该角色的灵魂及其规则，并解除它已绑定的小说人物。此操作不可撤销。`
  - style：`删除文风预设「<书名> · 文风」？` / 说明 `将删除该文风预设。此操作不可撤销。`
  - story：`删除故事框架「<书名> · 故事机制」？` / 说明 `将删除该故事框架。此操作不可撤销。`
  - 弹窗按钮：`取消` / `删除`
- 确认后调 `removeWorkbenchRevisionItem({ projectPath, bookPath: book.path, revision, subject })`，
  成功后 `reloadRevisions()`；失败 `reportError(error)`
- **取消 → 什么都不发生**（不许已经删了才问）

### 6. 过滤已删除
渲染某个版本的 items 时：`items.filter(i => !revision.removedSubjects?.includes(i.subject))`

## 流程要求：先红后绿
**每条行为先写会失败的测试，跑一次确认失败（记下失败信息），再改实现。**
本次任务已有两次「先实现后补测」导致假修复的教训，这条不打折。

## 必须重写的既有断言（已实测定位，别漏）
| 行号 | 原断言 | 改成 |
|---|---|---|
| `:198-204` | 用搜索框过滤只剩 1 张卡 | 删掉该段 |
| `:209` | `toContain("确认并加入")` | 断言该文案**不存在** |
| `:405-406` | 「确认并加入」不因无规则被禁 | 断言无规则的版本**不会**触发自动发布 |
| `:454-456` | 按钮在汇总行、点击触发发布 | 断言**打开即自动发布一次** |
| `:467` | 「先落盘 legacy 再确认」顺序 | 该用例是 `origin:"legacy"`，按新规则改为断言 **legacy 不自动发布** |
| `:591` | `[aria-label="结果版本"]` | 删掉该用例 |

## 完成标准
1. `book-analysis-workbench.spec.tsx` 全绿，报告里给出**具体的 Test Files / Tests 数量**
2. 报告里列出每条新行为的测试名 + 你为确认「测试真的会失败」跑出的失败信息摘录
3. 跑 `npx tsc -p tsconfig.app.json --noEmit`：**你这两个文件的错误必须为零**。
   若报 `workbench-remove.ts` 相关错误（并行单元尚未完成），如实说明即可，别去改它。
4. 如实报告任何你不确定或没做到的地方，不要粉饰
