// wrangler 启动器（同进程）。
// 1) 先把 argv 摆正：DSH 会把入口路径塞进 argv，wrangler 会把它当成未知参数。
// 2) 再把 process.exit 改成只设 exitCode：wrangler 结束时直接 exit 会把
//    重定向到管道/文件的 stdout 截断（表现为"命令成功但没有任何输出"）。
const path = require("path");
const fs = require("fs");

const args = (process.env.WR_ARGS || "").split(/\s+/).filter(Boolean);
process.argv = [process.argv[0], "wrangler", ...args];

process.exit = ((code) => {
  process.exitCode = typeof code === "number" ? code : 0;
});

const candidates = [
  path.resolve(__dirname, "../node_modules/wrangler/wrangler-dist/cli.js"),
  "C:/Users/Administrator/AppData/Roaming/npm/node_modules/wrangler/wrangler-dist/cli.js",
];
const cli = candidates.find((p) => fs.existsSync(p));
if (!cli) {
  console.error("找不到 wrangler CLI：\n" + candidates.join("\n"));
  process.exit(1);
}
require(cli);