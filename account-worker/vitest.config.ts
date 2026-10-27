import { defineConfig } from "vitest/config"

// 账号 Worker 的测试独立于仓库根目录的 vitest 配置：
// 只跑本目录 test/ 下的纯函数用例，node 环境，不加载 jsdom / React 插件。
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", ".wrangler/**"],
    globals: false,
  },
})
