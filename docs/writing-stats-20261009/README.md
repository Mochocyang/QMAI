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

### 3.3 带外改动：吸收成 `unknown`，不当成用户的字

编辑器有一条磁盘同步通路（`applyDiskSyncIfSafe`）：文件被**应用之外**的东西改了
（另一个编辑器、外部同步、去重改写交叉引用…）时会把新内容同步进编辑器。

那一刻会记一笔 `recordChapter(path, diskContent, "unknown")`：

- 差额既不进手写也不进 AI —— 那些字不是用户敲的；
- 但**账本文本跟上了磁盘**，所以用户接下来敲的每一个字仍然归属正确。

不做这一步的后果很隐蔽：带外改动会一直累积在账本与磁盘之间，
等用户下次敲一个字时被整笔算成「他的手写」。

### 3.5 章内移动文字：识别成「纯换序」，不记账

把一段文字拖到别处、或剪切粘贴到另一个位置时，字符**多重集完全相同**，
但 `diffChars` 只会报「删了一整段、又加了一整段」。照单全收的话，用户一个键
都没敲，手写却 +500，原本那段 AI 的归属还被削掉 500。

所以差分前先比一次多重集（只对变更段跑，打字/退格的快路径根本不经过）：
相同就判定为纯换序，**保留原归属、只改顺序**，各栏合计分毫不差。

逐字符的归属在块内可能被重排（块的归属集合不变），且「删掉 AI 的一段落、
再手打一遍一模一样的字」会被算成 0 增 0 删。这两点都是刻意换来的：
**宁可少算，也不凭空造出「今天写的字」。**

### 3.6 已知边界：手工粘贴

用户在编辑器里**手工粘贴**外部（含 AI 产出的）文本时，记的是 `human`。

应用无从判断剪贴板里的字是谁写的 —— 那是用户的动作，不是本软件的产出。
要区分它只能靠猜测，而**猜错会把真正手写的字算进 AI，比少算更糟**。
所以这条边界是刻意接受并写进代码注释的，不是遗漏。

### 3.7 已知边界：超大替换退化成整段口径

`diffChars` 超限（`maxEditLength` 或 `timeout`）时，整个变更段按「全删 + 全加」算。
对最主流的用法（整章去 AI 味、整章被 AI 重写）这**恰好是正确**的口径。
真正的误差场景是「变更段很大、但真实改动很小」——那时会高估新增量。
不改成「一律记 unknown」是因为那会让整章去 AI 味全部记成 0 字，
把一个核心功能的统计直接打没；两害相权取其轻。

### 3.8 已知边界：`timeout` 是同步预算

`diffChars({ timeout: 120 })` 是**同步**时间预算，所以大段替换时主线程在这一次
击键上最多阻塞 120ms；是否退化成整段口径也取决于机器快慢，归因因此有轻微的
机器相关性。改成 worker 是更彻底的解法，但会引入异步记账，与「每次击键立刻
反映到状态栏」冲突，收益不抵复杂度。

---

## 4. AI 写入的接线清单

「AI 生成」这一栏要准，取决于**每一个 AI 写正文的入口都标了 `"ai"`，并且在覆盖
已有正文时把旧正文一并交给记账层**（`recordChapter(path, next, "ai", previous)`）：

| # | 入口 | 位置 | 旧正文 |
|---|---|---|---|
| 1 | AI 工具直接写章节 | `src/lib/agent/tools/write-chapter.ts` | 覆盖前先读，文件不存在则为 `undefined`（判为新章） |
| 2 | 聊天里生成并保存的章节 | `src/components/chat/chat-panel.tsx` | 同上（目标路径可能撞上已存在的同号文件） |
| 3 | AI 的 search/replace 改文件 | `src/lib/novel/agent-tools.ts` | 手上就有 `originalContent` |
| 4 | 选区润色 / 去 AI 味 | `src/components/layout/preview-panel.tsx` | 编辑器账本本来就在内存里 |
| 5 | 整章去 AI 味（单章 + 批量） | `src/lib/novel/de-ai-batch/chapter-apply.ts` | 两条分支都传（批量分支刚 `readFile` 过） |

### 4.1 为什么「旧正文」是必须的参数（一类严重虚报的根因）

记账层在内存里没有账本时，只能靠落盘摘要恢复；而摘要要求**长度 + 哈希都对得上**。
AI 改写必然改内容 → 校验不过 → 此时若不知道旧正文，唯一能做的就是
「整份算成今天 AI 新写的」。

后果在批量去 AI 味上极其夸张：**30 章 × 3000 字 → 「今日 AI 生成」直接 +90,000**
（目标 3000 → 完成率 3000%），而模型可能总共只改了几千字；对结果不满意再跑一遍
就再 +90,000。更糟的是不对称：**恰好开着的那一章**走编辑器差分只加真实改动量，
于是同一次批量任务，数字取决于哪一章被打开。

传了旧正文就没有这个问题：旧正文按 `unknown` 打基线（来路本来就不可知），
只有模型真正换掉的那些字才算今天产出。实测「原样覆盖 30 章」的增量精确为 0。

**已知边界**：`source === "ai"` 且**没有**旧正文时仍会整份记 AI（新章必须如此，
否则 AI 生成的字数永远是 0）。每一个会覆盖已有正文的调用方都有义务传
`previousMarkdown`；新增这类入口时必须一起补上。

### 4.2 刻意不接的入口

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

**切换小说前会先把上一本落盘**（`initializeProject` 里「清定时器 → 用旧 state
落盘 → 再换书」）。少了这一步，2.5s 内切书会让上一本最后那几秒凭空消失 ——
因为 `flush()` 读的是「当前」state，定时器一触发写的已经是新书的数据了。

### 5.3 内存账本的上限

内存里最多保留 8 章的逐字符账本（`MAX_CACHED_PROVENANCE_CHAPTERS`）。
一本 300 万字的书若把这次会话翻过的每一章都常驻内存，长会话下来就是几十 MB
的无用数组。

**淘汰是安全的**：`chapters` 摘要与内存账本永远同步更新，被丢掉的章再打开时
由 `restoreProvenance` 按长度 + 哈希校验原样恢复（有测试钉住这条往返）。

### 5.4 跨天

按**本地时区**算 `YYYY-MM-DD`（不能用 UTC：UTC+8 的凌晨会落到前一天）。
`recordChapter()` 发现日期变了 → 把昨天归档进 `days`、今日两栏归零。

### 5.5 恢复时的校验

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

全书字数收在 store 里（`refreshTotalChars()`）。改造前是**两份独立实现**
（`App.tsx` 窗口标题一处、`knowledge-tree.tsx` 目录字数一处），再加底部状态栏
就是第三处；口径一旦漂移，三处会显示三个不同的总字数。
现在 `App.tsx` 与状态栏读 store 的同一个 `totalChars`。

**`knowledge-tree.tsx` 仍是自己 `reduce` 每页的 `countChapterBodyWords` 求和**
（`refreshTotalChars()` 面向整本书、目录只算子集，两者的统计范围本来就不同）。
两处数值一致靠的是它们都走 `chapter-word-count.ts` 这一层薄封装，
而不是靠共享同一个已算好的数字 —— 改口径时要注意这两条路。

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

6. **别断言带具体缩进的源码字面量。**
   第一版守卫断言过 `"</div>\n        {/* …"`：排版一动就红，而对真正要防的事
   （状态栏被塞进主区）并不更灵敏。要么断言结构关系（`indexOf` 先后），
   要么**真实渲染**后断言 DOM。渲染层面的挂载位置现在由
   `ui-test-shell.spec.tsx` 用真 `createRoot` 钉住。

7. **守卫测试必须是「删掉实现就红」的。**
   本功能有两处测试曾经是自证式的：
   - 「AI 生成的那部分不因为手写而变成手写」用了**另一章**记 AI，两章账本键
     不相交，对「同章内 AI/手写混排」零覆盖；
   - 「带外改动」直接调 store 的 `recordChapter(..., "unknown")`，断言的是
     store API（单测早已覆盖），把 `applyDiskSyncIfSafe` 里那三行删掉它照样绿。
   两处都已改成走真机通路。**改完的实现，要临时改坏一次、确认测试真的红。**

8. **编辑器有未保存改动时，磁盘同步会被（正确地）拒绝。**
   `shouldApplyDiskToEditor` 见 `hasUnsavedLocalEdits` 为真就返回 false，
   否则会用磁盘内容盖掉用户刚敲的字。写「外部改动被同步进来」的测试时，
   必须先把章节保存的 1s 防抖推过去（`vi.useFakeTimers()` +
   `advanceTimersByTimeAsync(1200)`），否则同步根本不会发生，
   而 `expect(editor).toContain(外部内容)` 会直接失败得让人摸不着头脑。

---

## 8. 验证

| 命令 | 结果 |
|---|---|
| `npm run test:mocks` | **708 文件 / 6811 通过**，6 todo，0 失败 |
| `npm run typecheck` | 通过 |
| `npm run typecheck:tests` | 通过 |

本次新增 5 个测试文件 / 103 个用例（另在既有的 `ui-test-shell.spec.tsx` 里加 3 个）：

- `src/lib/writing-stats.spec.ts`（31）—— 差分引擎：逐字输入、退格扣减、
  删 AI 内容只扣 AI、替换保留未动字符、**纯换序不产生任何增减**、
  游程往返、长度错位重打基线、日计数夹 0。
- `src/lib/writing-stats-persistence.spec.ts`（15）—— 坏 JSON/坏字段容错、
  历史裁剪、本地时区日期、全书字数口径。
- `src/stores/writing-stats-store.spec.ts`（26）—— 跨天归档、AI 新章记账、
  **AI 覆盖旧稿只算换掉的字**、**切书前先落盘**、**账本淘汰后可恢复**、
  恢复往返、节流不每击键落盘。
- `src/components/uitest/ui-test-statusbar.spec.tsx`（13）—— 四项常显、
  圆环几何（`dashoffset` = 周长一半 @ 50%）、就地改目标、Esc 放弃、越界夹取。
- `src/components/uitest/ui-test-statusbar-integration.spec.tsx`（18）——
  **真实编辑器的端到端通路**：敲字加、退格减、删到 0 不为负、
  同章内 AI 与手写互不污染（含删 AI 只扣 AI）、
  带外改动经**真实的 `focus` → `applyDiskSyncIfSafe`** 吸收成 `unknown`、
  落盘摘要内容、重启后恢复、磁盘对不上时重打基线，以及三条接线守卫。
- `src/components/uitest/ui-test-shell.spec.tsx`（既有文件，+3）——
  状态栏真的挂上了、是 `.ui-test-app` 的**最后一个直接子节点**（贴底且横跨整窗）、
  且**不是** `.ui-test-workspace` 的子节点；书架页（无书）不渲染它。

### 8.1 对抗式审查（本功能完成后所做）

对本功能跑了一轮独立的对抗式审查，发现并修掉了两处会导致**数字撒谎**的缺陷：

| 缺陷 | 症状 | 修法 |
|---|---|---|
| AI 覆盖已有正文时整份记 AI | 批量去 AI 味 30 章 → 「今日 AI 生成」+90,000，重跑再 +90,000；且开着的那一章数字还不一样 | `recordChapter` 新增 `previousMarkdown`，五个 AI 写入方全部传旧正文（§4.1） |
| 磁盘同步贴入的正文不更新账本 | 外部追加 2000 字后用户敲一个「，」，手写 +2001 | 同步时记一笔 `unknown`（§3.3） |

两处都补了「删掉实现就红」的回归测试（其中一处实测过：去掉修复后断言 246 ≠ 6）。
审查同时确认了几件**没有**问题的事：没有任何路径让用户打字进 AI 栏、
`sources.length === text.length` 恒等式成立、`diffChars` 超限返回 `undefined`
而不抛异常、状态栏无 render 期 setState、布局不会被顶出视口
（`.ui-test-workspace` 是 `flex:1; min-height:0`，状态栏 `flex-shrink:0`）。

审查还指出三类生命周期问题，均已处理：切书丢最后几秒（§5.2）、
内存账本无上限（§5.3）、以及 `trash.ts` 还原到改名路径时没搬账本（§4）。

`diffChars({ timeout: 120 })` 是同步预算这一点**保留**为已知边界（§3.8）：
改成 worker 会引入异步记账，与「每次击键立刻反映到状态栏」直接冲突。
