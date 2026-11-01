# 我的工具插件

一个 Tier 2（要跑代码）的 QMAI 插件：给 AI 加一个它自己会调用的工具。
进程是宿主用 `node index.js` 起的 MCP stdio 子进程，stdout 是协议通道、stderr 是日志。

## 里面有什么

```
plugin.json        清单（宿主的安装契约）
index.js           入口：只写工具实现，协议样板在 qmai-plugin.mjs 里
qmai-plugin.mjs    SDK 运行时助手（生成模板时从 sdk/runtime/ 拷进来的副本）
package.json       只有一行有用的：{"type":"module"}（见下）
README.md
```

**零依赖**：不需要 `npm install`，也不会被 `node_modules` 撑大。宿主本来就不跑任何
构建/安装脚本（`docs/plugins/authoring-guide.md` 第 ⑪ 条），所以推上去的必须是能直接跑的。

`package.json` 里没有依赖、也没有 scripts，它存在的唯一理由是 **`"type": "module"`**：
Node 按最近的 `package.json` 决定 `.js` 的模块格式，缺了它，同一个文件在"你的仓库里"
是 ESM、在"装进 QMAI 后"会被当 CJS，`import` 立刻炸（指南第 ⑬ 条）。

## 三件事要做

1. **改 `plugin.json` 的 `name` / `description`**，`contributes.tools[0].description` 是
   **给模型看的**：写清楚"什么时候该用"，比写"这个工具做什么"重要。
2. **改 `index.js` 的工具实现**：`tools.<名字>.handler(args, ctx)`。
   返回字符串就是结果文本；失败了返回 `{ text, isError: true }`（模型能看到原因并重试）。
3. **让清单与运行期工具对得上**：`plugin.json` 的 `contributes.tools[].parameters` 是
   安装前的参数映射，宿主调用时以运行期 `tools/list` 的 `inputSchema` 为准。

## 本地先验一遍（不需要 QMAI）

```powershell
# 1) 清单与协议自检
node <SDK>/validate.mjs .

# 2) 喂一行 JSON-RPC，看回什么
'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"my_tool","arguments":{"text":"abc"}}}' |
  node index.js
```

预期一行 JSON：`{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"字符数：3"}]}}`。

## 装进 QMAI

设置 → 插件 → 「从本地目录安装」，选这个目录。装好后找个支持 function calling 的模型，
问「你现在有哪些工具」应该能看到它。
