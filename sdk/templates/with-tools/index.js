// 我的工具插件 —— 只写工具实现，协议样板交给 SDK。
//
// 这个 `index.js` 之所以能被 Node 当 ESM 加载，是因为同目录的 `package.json` 写了
// `{"type": "module"}`。这是 docs/plugins/authoring-guide.md 第 ⑬ 条的坑：Node 会**沿目录
// 向上**找最近的 package.json 来决定 .js 是 CJS 还是 ESM。你仓库根如果有
// `"type": "module"`，本地跑是 ESM；装上后插件目录里没有 package.json，就会退回 CJS，
// 一句 `import` 直接 SyntaxError —— 本地跑得好、装上就炸。显式声明一次，两边一致。

import { definePlugin } from "./qmai-plugin.mjs";

definePlugin({
  // id 建议与 plugin.json 的 id 一致，日志里才对得上（宿主也会用 QMAI_PLUGIN_ID 覆盖它）。
  info: { id: "my-plugin", name: "我的工具插件", version: "1.0.0" },

  // 键名就是工具名：宿主加 `<插件id>__` 前缀后注入 ToolRegistry。
  // 这里的 inputSchema 是**真源**（清单里的 parameters 只是安装前的参数映射）。
  tools: {
    my_tool: {
      description: "给模型看的说明：什么时候该用它、传什么进来",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "要处理的文本" },
        },
        required: ["text"],
      },
      async handler(args, ctx) {
        // 参数不对就用 isError 回一句"人能看懂、模型能改正"的话，不要 throw。
        if (typeof args.text !== "string") {
          return { text: "缺少 text 参数：请把要处理的文本作为字符串放进 text。", isError: true };
        }
        // ctx.log 走 stderr。stdout 是协议通道，混进一句 console.log 就会让宿主解析失败。
        ctx.log(`收到 ${args.text.length} 个字符`);
        return `字符数：${Array.from(args.text).length}`;
      },
    },
  },
});
