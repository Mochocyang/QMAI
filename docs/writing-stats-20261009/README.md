# 底部「写作字数」状态栏（2026-10-09）

## 1. 这个功能是什么

在 QMAI 主窗口**最下方**新增一条小字号状态栏，常显四项数据 + 一个完成率圆环：

| 位置 | 数据 | 口径 |
|---|---|---|
| 圆环 | 今日目标完成率 | `(手写 + AI) / 今日目标`，环内显示整数百分比 |
| ① 总字数 | 当前书名下全部章节正文字数 | 逐章 `countChapterBodyWords` 求和，与目录里的「全书章节总字数」同源 |
| ② 今日目标 | 用户设定的每日目标字数 | 默认 3000，**点数字就地改** |
| ③ 今日 AI 生成 | 今天由 AI 写出来的字数 | 见 §3 |
| ④ 手写 | 今天用户自己敲出来的字数 | 见 §3 |

四项都常显在栏上（用户明确否掉了「点击展开」的折叠方案）。

---

## 2. 统计口径：一条铁律

**所有字数都走 `normalizeCountableText()`（`src/lib/writing-stats.ts`）：**

```
去掉 frontmatter → 去掉正文首个「# 标题」行 → 去掉所有空白（含全角空格 U+3000）→ 取 length
```

这条规则是**唯一**的口径来源：

- `countChapterBodyWords()`（`src/lib/chapter-word-count.ts`）现在只是一层薄封装，
  直接 `normalizeCountableText(markdown).length`。
  改造前它内联了同一套逻辑的第二份实现 —— 两份实现一旦漂移，目录里的总字数
  和状态栏的总字数就会显示两个不同的数字，且没有任何测试会发现。
- 归属账本（provenance）也存**归一化后的文本**，不存原始 Markdown。
  因此改标题、动 frontmatter、加空行**永远不会**污染归属。

---

## 3. 归属模型：逐字符追踪来源

### 3.1 三种来源

```ts
type WritingSource = "human" | "ai" | "unknown"
```

- `human`：用户在编辑器里输入的字符（打字、粘贴、剪切、撤销）。
- `ai`：本软件自己生成并写入正文的字符（见 §4 的接线清单）。
- `unknown`：**来源不可知**的字符。它刻意**不计入任何一栏**。

`unknown` 的存在是这个设计诚实的地方：打开一本旧书、外部工具改了文件、
上一次会话留下的没有账本的正文 —— 这些字不是今天写的，也不该被算成手写。
宁可少算，也不能把无法归因的字记到用户头上。

### 3.2 记账方式

`applyWritingChange(previous, nextMarkdown, sourceForInsertions)` 按**字符差分**算增量：

1. 归一化 `nextMarkdown`；与账本文本相同则返回空增量（**幂等**）。
2. 账本长度与文本长度不一致 → 重打基线、返回空增量（**绝不猜着对齐**）。
3. 找公共前缀/后缀：
   - 纯插入或纯删除 → 精确、O(n)，就是打字/退格/粘贴的日常路径。
   - 两端都变了（替换）→ 对变更段跑 `diffChars`，把没动过的字**按原归属保留**。
     `他`→`她` 只算 1 增 1 删，而不是整段删了重加。
4. `diffChars` 带 `maxEditLength: 4000` + `timeout: 120`；超限返回 `undefined` 时
   退化成「整段替换」。**这两个上限是必须的**：没有它们，用户在几千字的章节里
   做一次大范围改写，会在**每一次击键**上跑一次二次方级的 diff，输入框直接卡死。

关键性质（都有测试钉住）：

- `sources.length === text.length` 恒成立。
- 累计净增减恒等于「当前字数 − 起始字数」，可以逐笔对账。
- 重复记账是安全的（差分口径，内容没变就是空增量）。

### 3.3 已知边界：手工粘贴

用户在编辑器里**手工粘贴**外部（含 AI 产出的）文本时，记的是 `human`。

应用无从判断剪贴板里的字是谁写的 —— 那是用户的动作，不是本软件的产出。
要区分它只能靠猜测，而**猜错会把真正手写的字算进 AI，比少算更糟**。
所以这条边界是刻意接受并写进代码注释的，不是遗漏。

---

## 4. AI 写入的接线清单

「AI 生成」这一栏要准，取决于**每一个 AI 写正文的入口都标了 `"ai"`**：

| # | 入口 | 位置 | 说明 |
|---|---|---|---|
| 1 | AI 工具直接写章节 | `src/lib/agent/tools/write-chapter.ts` | 非草稿路径，整份记 AI |
| 2 | 聊天里生成并保存的章节 | `src/components/chat/chat-panel.tsx` | 整份记 AI |
| 3 | AI 的 search/replace 改文件 | `src/lib/novel/agent-tools.ts` | 只记改动部分 |
| 4 | 选区润色 / 去 AI 味 | `src/components/layout/preview-panel.tsx` `handleApplySelectionTransform` | `handleSave(..., { source: "ai" })` |
| 5 | 整章去 AI 味（单章 + 批量） | `src/lib/novel/de-ai-batch/chapter-apply.ts` | 两个分支都记 |

**刻意不接的入口**：

- **草稿区**（`.qm-drafts/`，`src/lib/novel/draft-manager.ts`）。
  只有 `writeDraft`，全仓库**没有任何读取方** —— 写进去的草稿不会被提升到
  `wiki/chapters/`，所以它不是「已经进入小说」的正文，记进 AI 字数会虚高。
  （同类的死路还有 `draft-review-store.ts` 的 `acceptedRevisedDraft`：只写不读。）
- **拆书结果**（`analysis-engine.ts` 写 `bookPath/chapters/`）。
  那不是小说正文，`isChapterPath()` 本来就把它挡在外面。

`recordChapter()` 内部用 `isChapterPath()` 兜底：大纲、设定、笔记写得再多也不进这个账
（用户选定的口径是「只统计章节正文」）。

---

## 5. 落盘与恢复

### 5.1 存哪、为什么

`<project>/.novel/writing-stats.json`（派生数据，与 `fanfic-canon.md` 同目录）。

- **不放进 `NovelConfig`**：今日计数会随每一次击键变化，写进 `.qmai/novel-config.json`
  等于每次打字都落一次配置盘。
- **不放进 `app-state.json`**：统计是**按项目**的，放全局会让多本书互相串数。

结构：

```jsonc
{
  "version": 1,
  "dailyTargetChars": 3000,
  "days": { "2026-10-09": { "humanChars": 812, "aiChars": 4200 } },
  "chapters": {
    "wiki/chapters/第1章.md": { "len": 4210, "hash": "683edbd3", "rle": "h812a3398" }
  }
}
```

- `days` 只留最近 62 天，读取时自动裁剪。
- `chapters` 的键是**相对项目根的路径**，整本书挪目录也不丢账。
- 逐字符来源用**游程编码**（`h12a3000u5`）而不是每字符一个元素：
  一本 300 万字的书若存成数组会序列化成几 MB 的无用 JSON。

### 5.2 落盘节流

`recordChapter()` 后 2.5s 防抖写一次盘。打字不会每一下都写盘（有测试钉住）。

写盘失败**静默**：统计是辅助信息，绝不能因为写不了盘而打断写作。
代价是失败时看不到错误 —— 集成测试里踩过一次这个坑（见 §7）。

### 5.3 跨天

按**本地时区**算 `YYYY-MM-DD`（不能用 UTC：UTC+8 的凌晨会落到前一天）。
`recordChapter()` 发现日期变了 → 把昨天归档进 `days`、今日两栏归零。

### 5.4 恢复时的校验

从 `chapters` 摘要恢复归属账本，要求**长度 + 哈希都对得上**，否则返回 `null`
由调用方重打基线。这是「宁可少算，也不造假」的最后一道闸：
带外修改（另一个编辑器、外部同步）本来就无法归因，硬凑对齐只会把别人的字
算到用户头上。

---

## 6. 目录结构

| 文件 | 职责 |
|---|---|
| `src/lib/writing-stats.ts` | 纯函数引擎：归一化、差分、游程编解码、日计数。**无 IO、无 React**。 |
| `src/lib/writing-stats-persistence.ts` | 落盘结构、校验、裁剪、全书字数读取。 |
| `src/stores/writing-stats-store.ts` | Zustand store：今日计数 + 账本 + 节流落盘。记账唯一入口。 |
| `src/components/common/progress-ring.tsx` | 通用完成率圆环（从 `context-usage-ring` 抽出的几何）。 |
| `src/components/uitest/ui-test-statusbar.tsx` | 底部状态栏组件。 |
| `src/components/uitest/ui-test-shell.tsx` | 挂载点（`.ui-test-app` 的最后一个子节点）。 |
| `src/components/uitest/ui-test.css` | `.ui-test-statusbar` 样式，**尺寸一律用 rem**。 |

全书字数收在 store 里（`refreshTotalChars()`）。改造前有**三份独立实现**
（`App.tsx` 窗口标题、`knowledge-tree.tsx` 目录字数、加上状态栏就是第三份），
口径一旦漂移，三处会显示三个不同的总字数。现在它们读同一个数字。

---

## 7. 踩过的坑（写给后来者）

1. **记账必须在「与磁盘一致就 return」之前。**
   `handleSave` 里有一条 `if (persistedMarkdown === lastLoadedForPath) return` 短路。
   若把 `recordChapter` 放在它之后，「打字 → 落盘 → 退格回原样」这一段里
   退格那一下会被短路吞掉，界面上的手写字数**只增不减**。
   差分引擎的单测对此**完全无感**，所以有一条源码顺序守卫测试专门钉这个。

2. **`flush()` 的静默 catch 会吞掉测试里的配置错误。**
   集成测试的 `@/commands/fs` mock 用了 `...await importOriginal()`，
   于是 `createDirectory` 还是真实现，在 jsdom 里调 Tauri 插件抛错，
   被 `flush` 的 catch 吃掉 —— 症状是「一次盘都没写」但**看不到任何错误**。
   写这类测试时 `createDirectory` 必须一起换掉。

3. **`vi.restoreAllMocks()` 不会还原 `vi.mock` 工厂里的 `vi.fn` 覆盖。**
   它只还原 `vi.spyOn` 建的 spy。用 `mockImplementation` 覆盖工厂 mock 会让
   上一个用例的覆盖**漏进下一个用例**，表现为「今日手写莫名其妙翻倍」。
   → 所有「磁盘状态」一律走 `fixture.files`，不要覆盖模块 mock 的读写实现。

4. **假定时器 + React `act` 一起用，`flush` 的 promise 链不落地。**
   节流测试放在 store 单测里（假定时器可靠），集成测试直接 `await flush()`。

5. **比对源码文本前要归一换行。**
   `core.autocrlf=true` 让盘上文件是 CRLF，`readFileSync` 拿到的字符串里
   `\n` 是 `\r\n`，按 `\n` 拼的断言会静默失败。

---

## 8. 验证

| 命令 | 结果 |
|---|---|
| `npm run test:mocks` | **708 文件 / 6796 通过**，6 todo，0 失败 |
| `npm run typecheck` | 通过 |
| `npm run typecheck:tests` | 通过 |

本次新增 5 个测试文件 / 91 个用例：

- `src/lib/writing-stats.spec.ts`（28）—— 差分引擎：逐字输入、退格扣减、
  删 AI 内容只扣 AI、替换保留未动字符、游程往返、长度错位重打基线、日计数夹 0。
- `src/lib/writing-stats-persistence.spec.ts`（15）—— 坏 JSON/坏字段容错、
  历史裁剪、本地时区日期、全书字数口径。
- `src/stores/writing-stats-store.spec.ts`（20）—— 跨天归档、AI 新章记账、
  恢复往返、节流不每击键落盘。
- `src/components/uitest/ui-test-statusbar.spec.tsx`（13）—— 四项常显、
  圆环几何（`dashoffset` = 周长一半 @ 50%）、就地改目标、Esc 放弃、越界夹取。
- `src/components/uitest/ui-test-statusbar-integration.spec.tsx`（15）——
  **真实编辑器的端到端通路**：敲字加、退格减、删到 0 不为负、AI 栏不被手写污染、
  落盘摘要内容、重启后恢复、磁盘对不上时重打基线，以及三条源码/接线的守卫测试。
