import path from "path"
import { readFileSync } from "fs"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { sentryVitePlugin } from "@sentry/vite-plugin"

const host = process.env.TAURI_DEV_HOST

// Read version from package.json at config-load time so the Settings
// UI can show the running app version without duplicating the string.
const pkgJson = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf-8"))
const sentryRelease = `qmai@${pkgJson.version}`
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const uploadSentrySourcemaps = Boolean(sentryAuthToken)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Last plugin. No token → no maps, no upload (local / CI check).
    sentryVitePlugin({
      disable: !uploadSentrySourcemaps,
      org: process.env.SENTRY_ORG || "qmai-c5",
      project: process.env.SENTRY_PROJECT || "qmai",
      authToken: sentryAuthToken,
      telemetry: false,
      release: { name: sentryRelease },
      sourcemaps: {
        filesToDeleteAfterUpload: ["./dist/**/*.map"],
      },
    }),
  ],

  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },

  define: {
    __APP_VERSION__: JSON.stringify(pkgJson.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  build: {
    // Hidden maps only when uploading; never ship *.map in the Tauri bundle.
    sourcemap: uploadSentrySourcemaps ? "hidden" : false,
    chunkSizeWarningLimit: 700,
    modulePreload: {
      resolveDependencies(_filename: string, deps: string[]) {
        return deps.filter((dep) => !dep.includes("graphology-vendor"))
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            if (id.includes("opencc-js")) {
              return "opencc-vendor"
            }
            if (id.includes("pinyin-pro")) {
              return "pinyin-vendor"
            }
            if (id.includes("js-yaml")) {
              return "yaml-vendor"
            }
            if (id.includes("@react-sigma") || id.includes("sigma")) {
              return "sigma-vendor"
            }
            if (id.includes("graphology")) {
              return "graphology-vendor"
            }
            if (id.includes("react") || id.includes("scheduler")) {
              return "react-vendor"
            }
            if (id.includes("@milkdown")) {
              return "milkdown-vendor"
            }
            if (id.includes("katex") || id.includes("remark-math") || id.includes("rehype-katex")) {
              return "katex-vendor"
            }
            if (id.includes("cytoscape")) {
              return "cytoscape-vendor"
            }
          }
          return undefined
        },
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/.vite/**",
        "**/.novel/**",
        "**/chapters/**",
        "**/wiki/**",
        "**/target/**",
        "**/*.snapshot.*",
        "**/*.json",
        "**/*.store",
      ],
    },
  },

  test: {
    environment: "node",
    // Loads .env.test.local into process.env for real-LLM tests.
    // The loader itself is a no-op if the file is absent, so this is
    // safe to keep on for every test run.
    setupFiles: ["./src/test-helpers/load-test-env.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      "**/.worktrees/**",
      // .claude/worktrees/ 下会有 agent 遗留的 worktree 副本（停在旧提交，
      // 但 spec 里的 @/ 别名解析到主工程的新代码），一起跑会产生成百个与主工程
      // 无关的错配失败：实测 638 个重复文件、255 个失败，把 test:mocks 从
      // 689 文件 / 196 失败顶到 1317 文件 / 451 失败。
      // 只写 .worktrees 那条匹配不到 .claude/worktrees/，因为路径段必须恰好
      // 叫 .worktrees 的那一级。
      "**/.claude/**",
      // 同一个病症的第二个实例：.codex-temp/ 下是 agent 留下的快照副本
      // （每个子目录里各有一份 src/**），它们的路径段叫 .codex-temp，
      // 既不等于 .temp、也不等于 .worktrees，所以上面两条都拦不住。
      // 实测 `npx vitest run src/lib/font-settings.spec.ts` 在不加排除项时会
      // 带出 10 份 .codex-temp 里的同名 spec（11 文件 / 59 用例，真正的文件
      // 只占 1 文件 / 29 用例）；跑 ui-test-tools.spec.tsx 时更会带出 109 条
      // 无关失败，真实文件却是 ✓ —— 这类噪音只能靠人眼过滤才能确认结论，
      // 是可信度的净损耗。故与 .claude 同法显式排除。
      "**/.codex-temp/**",
    ],
  },
})
