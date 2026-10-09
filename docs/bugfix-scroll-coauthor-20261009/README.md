# 两个线上故障的定位与修复（2026-10-09）

用户报了两个看起来毫不相关的故障，实际都源于**同一类错误：假设被静默破坏，而系统没有兜底**。

| # | 故障现象 | 根因类别 | 提交 |
|---|---|---|---|
| 1 | 章节正文没有滚动条、滚轮滚不动 | CSS 类名撞车，破坏了 `height` 继承链 | `9f3d6d7` |
| 2 | 共创报「模型未返回 outline_discuss 协议块」 | 提示词自相矛盾，且闸门没有恢复路径 | `14a2c56` |

---

## 1. 正文滚不动：类名撞车

### 现象与直觉误区

加了写作字数状态栏后，正文区**没有滚动条、滚轮无反应**（注意是「滚不动」而不是「能滚但看不到」）。

第一直觉会去查 flex 布局，但布局本身没错。真实原因是**两个不相干的容器共用了同一个类名**：

| 元素 | 类名 | 出处 |
|---|---|---|
| 编辑器内部正文容器 | `.ui-test-editor-body` | `ui-test-editor.tsx` |
| 我为状态栏加的正文栏容器 | `.ui-test-editor-body` | `ui-test-workspace.tsx`（`c25b22e` 引入） |

而 `ui-test-editor.css` 里有一条只该作用于编辑器内部的规则：

```css
.ui-test-editor-body > div { height: auto; overflow: visible; }
```

### 为什么后果是「滚不动」

`.ui-test-editor-body > div` 命中了 `PreviewPanel` 的根 div（也就是高度链的起点）：

```tsx
<div className="flex h-full flex-col">   {/* h-full → height:100% */}
```

这条规则把它的 `height:100%` 改写成 `auto`，于是整条高度链塌方：

```
.ui-test-editor-document  height:100%   → 失效（父无确定高度）
.ui-test-editor-scroll    flex:1; overflow-y:auto → 随内容长高，永不溢出
```

滚动区既然从不溢出，就既没有滚动条、滚轮也无事可做；外层容器的 `overflow:hidden`
再把超出部分裁掉——所以表现是彻底滚不动。

### 修法与防线

把工作区容器改名为 `.ui-test-editor-slot`（此前未被占用），并在三处留注释说明**为什么不能叫那个名字**。

同一撞车还顺带修掉两个不那么明显的副作用：工作区容器此前白拿了编辑器的字体/字距规则，
以及大纲视图下 `.ui-test-editor[data-kind="outline"] .ui-test-editor-body { padding-top: 24px }`
带来的重复上边距。

回归测试从三个角度锁死（均已用 `git show HEAD:` 取修复前的文件验证「修复前必然失败」）：

1. **结构**：正文栏的直接子容器不得带 `ui-test-editor-body` 类；
2. **归属**：`ui-test.css` 不得定义 `.ui-test-editor-body`（那是编辑器样式表的所有物）；
3. **钉住肇事规则**：断言 `.ui-test-editor-body > div { height:auto; overflow:visible }`
   仍在编辑器样式表里、`PreviewPanel` 根仍是 `h-full`——这样将来若有人再冒用这个名字，
   测试失败信息会直接指向原因，而不是只报一句「结构不对」。

> 通用教训：**跨文件复用类名等于隐式耦合**。凡是「A 文件的样式只作用于自己的元素」这种
> 假设，都应该由测试钉住，而不能靠命名自觉。

---

## 2. 共创失败：提示词自相矛盾 + 闸门无恢复路径

### 报错链条

模型返回了完整卷纲 + 「写回清单」，**一个 `outline_discuss` 标记都没有** →
`parseOutlineDiscussProtocol` 返回 `kind: "none"` →
`outlineDiscussError = "共创协议格式无效，尚未开始生成：模型未返回 outline_discuss 协议块"`，
整轮作废。

### 根因：不是模型不听话，是提示词在自相矛盾

把 `buildOutlineAgentSystemPrompt({ mode: "discuss", discussModule: "卷纲" })` 实际拼出的
提示词 dump 出来逐行核对，发现它在要求「禁止输出完整大纲正文、必须输出 outline_discuss」
的**同时**，还带着整套生成契约：

| 泄漏的规则 | 说明 |
|---|---|
| `## AI大纲生成工作流`整段 | 其中「**生成章纲后必须列出新增设定写回清单**」正是截图里模型输出的那个「写回清单」 |
| 「生成章纲时必须使用章纲标准结构…」 | 章纲正文契约 |
| 「结构节点必须包含 CBN、CPNs、CEN…」 | 同上 |
| 「需要保存大纲时只输出 outlineSaveRequest…」 | 开头无条件出现，诱导直接交付正文 |
| 「当本轮要交付可保存的大纲正文时：最终回复只输出大纲标题和大纲正文」 | 输出边界里的生成分支 |

其中一条是**明确的改动事故**：排除数组只把 `## Markdown 格式强制要求` 这个**标题**
放了进去，正文却留在数组外面 —— 于是讨论轮提示词里仍然出现
「所有大纲正文必须使用标准 Markdown 格式输出」和整段 `# / ## / ###` 大纲范例。
**一边禁止输出正文，一边给出正文格式规范与范例。**

两套契约同时出现时，模型挑了量更大、更靠前、更具体的生成那套照做。

### 修法一：拆开共用规则，按轮次裁剪

- `sharedAnalysisRules` 拆成：
  - `sharedReadRules`（只读与分析纪律：先 `list_outlines` 再 `read_outline`…）—— **所有模式保留**；
  - `sharedGenerationWorkflowRules`（生成工作流）—— **仅生成/计划/标准模式带上**。
- 讨论轮排除：生成工作流整段、章纲结构硬要求、保存请求提示、
  Markdown 强制要求**整段（标题+正文）**、输出边界里的「交付正文」分支。
- 讨论轮**必须保留**（防止删过头）：`outline_discuss` 协议要求、本轮阶段说明、先读资料的纪律。

### 修法二：缺协议时自动「补协议」，不再把整轮判死

即使提示词修好，模型仍可能偶发只给正文。此时整轮讨论等于白跑，而模型给出的判断往往
有价值 —— 上一版直接把一份完整卷纲判为「格式无效」丢弃。

新增 `src/lib/novel/outline-discuss-repair.ts`，在**首轮**与**重新生成**两条路径上都先修复一次：

- 只让模型**转写**已有判断与分歧，提示词明确禁止「重写、扩写或继续生成大纲正文」；
- 要求**保留原正文再追加协议块**，保证用户看到的内容不会因修复而变少；
- 走 `temperature: 0` + 独立 token 上限（1600）——这是格式转写，不是创作；
- 失败只 `console.warn` 并回落到原有报错路径，**不把失败伪装成空修复**；
- 空回复或一句客套不触发（`hasOutlineDiscussRepairableContent`：长度 < 80 或已含协议块则不修）。

> 这里刻意**不**把模型产出的大纲正文写进任何落盘产物：它仍只是聊天内容，
> 是否采纳由用户在后续正常生成轮决定，不绕过「用户确认后才落盘」的既有约定。

---

## 3. 验证

| 项 | 结果 |
|---|---|
| `npm run test:mocks -- --no-file-parallelism` | **715 文件 / 6887 通过**，6 todo，exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run typecheck:tests` | exit 0 |
| 便携版重建 | `release-portable/QMaiWrite.exe`，213,587,456 字节，哈希与 `src-tauri/target/release/qmai.exe` 一致 |
| bundle 核对 | `ui-test-editor-slot`、`只做一件事`、`不要重写、扩写或继续生成大纲正文` 均已在 `dist/assets/*.js` |

新增/改动的测试：

- `src/lib/novel/outline-discuss-repair.spec.ts`（新增 7 例）：值得修复的判定、
  模板文案、**模板本身能被解析器接受**（避免给出一个合不了法的模板）、
  确定性采样参数、修复结果可解析成 `needs_decision`、上游报错必须抛出。
- `src/components/sources/outline-chat-panel.spec.tsx`：新增回归用例，逐条断言讨论轮
  不得出现 9 条生成契约，同时断言共创契约与只读纪律仍在；并断言生成轮这些契约仍在
  （排除逻辑只作用于讨论轮）。**该用例在修复前必然失败**——已用 dump 出的修复前提示词核对。
- `src/components/uitest/ui-test-workspace.spec.tsx`：新增 describe
  「正文容器不得冒用编辑器内部类名（否则正文滚不动）」（3 例）。

---

## 3.5 后续发现（同一起源的第二面）：讨论气泡把结构化 JSON 漏成源码

用户在使用**修复后**的共创模式时又报了一次：生成一段正常内容之后，
气泡里漏出一段 `volumeOutlineData` 的结构化源码。查下来**不是补协议回退了**，
而是「补协议」只兜住了协议层，**可见内容的去渣在讨论轮漏了一步**。

### 根因

共创有两个轮次，气泡对可见内容用了两套清洗：

| 轮次 | 消息标（`outlineDiscussPhase`） | 气泡清洗 | `volumeOutlineData` 围栏 |
|---|---|---|---|
| 定稿生成（`intentPhase:"generation"`） | 不标 | `prepareOutlineSaveSourceContent`（剥协议标 + `extractBodyContent`） | 被剥掉，不泄漏 |
| 讨论轮（`intentPhase !== "generation"` → `"decision"`） | 标 | 只 `stripStructuredMarkers`（剥协议标，**提前 return**） | 留着 → 漏成源码 |

链路：讨论轮里模型偶发违规、直接吐完整卷纲（卷纲正文 + `volumeOutlineData` +
`outlineSaveRequest`，还没有 `outline_discuss`）——这正是 14a2c56 修的同款事故。
自动补协议「**先原样保留正文再追加协议块**」，于是这些结构化围栏**原样留在可见正文里**；
讨论轮的气泡只剥协议标记、不剥结构化围栏，于是 `volumeOutlineData` 就漏给你看了。

一句话：补协议兜住了「协议层」，但「展示层」没跟着上 `extractBodyContent`，
违规的结构化 JSON 就从气泡里露了出来。

### 修法（显示层兜底，`b958402`）

讨论/计划气泡的可见内容改走 `prepareOutlineSaveSourceContent`
（= 剥协议标记 + `extractBodyContent` 一并剥掉 json/html/保存协议围栏），
与定稿生成轮用同一套清洗。正常判断文字与分歧点卡片不受影响
（`extractBodyContent` 只删 json/html/保存协议围栏，不碰正文）。

### 验证

- 回归用例「共创讨论轮夹带卷纲结构化 JSON 时，气泡不得把它漏成源码」：
  **修复前必然失败**（气泡文本确实含 `volumeOutlineData`），修复后通过。
- 完整门禁：**717 文件 / 6916 通过**，6 todo，exit 0；typecheck exit 0。
- 便携版重打后按铁律重跑真机验收：分层/设置保存/浮层均通过。

---

## 4. 遗留（未在本轮处理）

1. 磁盘上已存在的孤儿 `NNN.search-index.json` / `NNN.vector-index.json` 未做一次性清理
   （代码已不再产出；不影响运行）。
2. 既有问题（与本次两个故障无关）：没有任何 TS 代码删除 `.novel/chapter-ingest-output/`，
   因此删除章节后其 `NNN.output.json` 仍在，`story-extractor` 会继续重建该章角色
   （表现为「已删章节的角色在故事推演里复活」）。修它属于独立一轮。
