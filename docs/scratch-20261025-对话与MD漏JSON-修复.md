# 对话气泡与 MD 里的 JSON：两个 bug 叠加

日期：2026-10-25 13:10~13:40
涉及：`src/lib/outline-save.ts`

---

## 结论先说

**渲染层是无辜的。** 那份「带 `**` 的 JSON」是我们的清洗函数自己造出来的，
而且**保存出来的 MD 和对话气泡走的是同一条清洗链路**，所以两边一起坏。

---

## 两个 bug 叠加

### bug 1：剥完为空时回退了原文

```ts
const bodyContent = extractBodyContent(stripped)   // 剥掉 ```json 围栏
const cleaned = cleanNextStepArtifacts(bodyContent || stripped)  // ← 这里
```

卷纲 / 章纲 / 设定这几类分项现在**只输出结构化数据**（契约要求 `content=""`），
所以整轮回复就是「一句交代 + 一个 ```json 围栏」。

`extractBodyContent` 正确地剥掉了围栏 → 剩下空字符串 → `|| stripped` 把
**未剥离的原文**又捡了回来。等于剥了个寂寞。

### bug 2：属性行改写把 JSON 当成了中文属性

```ts
const attrMatch = trimmed.match(/^([^：:]{1,12})[：:]\s*(.*)$/)
if (attrMatch) return `- **${attrName}：** ${attrValue}`
```

这本来是为「卷定位：用杨妙萍之死…」这种中文属性行准备的。
但 `"title": "第二卷 归墟寄魂",` 也符合这个模式：

- `[^：:]{1,12}` 命中 `"title"`
- `[：:]` 命中 `:`
- `(.*)` 命中 ` "第二卷 归墟寄魂",`

于是被改写成 `- **"title"：** "第二卷 归墟寄魂",` —— **一模一样就是截图里那行**。

两个 bug 合起来：JSON 没被剥掉，还被"美化"成了带加粗的伪 markdown，
既不像 JSON 也不像 MD，气泡和保存的 MD 都是这坨东西。

---

## 修复

```ts
// 1. 去掉回退：剥空 = 这一轮没有可读正文，交给 describeStructuredOnlyAnswer 出摘要
const cleaned = cleanNextStepArtifacts(bodyContent)

// 2. JSON 行绝不参与属性改写
if (/^"[^"]*"\s*:/.test(trimmed)) return line
if (/^["{}[\],]+$/.test(trimmed)) return line
```

中文属性行的转换功能完整保留（有测试钉住）。

---

## 用真实数据验证

拿 `.qmai/outline-chats.json` 里 6 条含 `volumeOutlineData` 的回复跑 `prepareOutlineSaveSourceContent`：

| 原文长度 | 改前输出 | 改后输出 | 说明 |
|---:|---:|---:|---|
| 28,865 | **26,071（含 JSON）** | **0** | 纯结构化数据 → 交给摘要 |
| 56,260 | 16,583 | 16,583 | 本来就是「MD 正文 + 围栏」，保留正常 MD |
| 70,217 | 20,652 | 20,652 | 同上 |
| 1,471 / 1,432 / 526 | 0 | 0 | 本来正常 |

改前那条 26,071 的输出头部就是：

```
```json
{
  "volumeOutlineData": {
- **"title"：** "第二卷 归墟寄魂",
```

改后归零。另外两条保留的是 `# 第一卷 无我绝响 · 卷纲 / ## 卷级定位 / - **卷定位：** …`，是**正常卷纲 MD**。

---

## 副作用与兜底

去掉回退后，**纯结构化数据的回复**在气泡里会变空。这个路径本来就有兜底：

```ts
// outline-chat-panel.tsx 的 renderedMarkdownContent
if (prepared.trim() && !looksLikeOutlineDeliveryNote(prepared)) return prepared;
return describeStructuredOnlyAnswer(rawContent) || prepared;
```

即「没有正文 → 用 `describeStructuredOnlyAnswer` 生成『已生成…』的摘要」。
所以气泡不会空，右侧预览卡片照常渲染。

---

## 回归

`outline-save.spec.ts` 新增 4 条：

1. 整轮只有结构化数据 → 正文为空，但围栏外的交代语保留、JSON 一个字符不剩
2. 正文 + 围栏 → 只保留正文
3. JSON 属性行不得被加粗化（`- **"title"` 不许出现）
4. 中文属性行仍要转成列表项（防止把功能改没了）

tsc 干净；全量 **8764 通过**（1 个既有环境失败：`flex-wrap:wrap` 那条文档夹具）。

---

## 我判断错了三次，记一下

1. 第一次说"`**` 是渲染层加的高亮"——错。
2. 第二次说"落盘原文没有 `**`"——那条 28,865 的确实没有，但**另有两条有**（56,260 / 70,217，
   模型的 JSON 字符串值里塞了带 `**` 的 MD 正文）。
3. 直到直接拿清洗函数跑真实数据，才看到 26,071 这个异常长度。

**教训：遇到"显示不对"，先用真实数据跑一遍清洗函数，别盯着渲染层猜。**
