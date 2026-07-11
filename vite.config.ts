import path from "path"
import { readFileSync } from "fs"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const host = process.env.TAURI_DEV_HOST

// Read version from package.json at config-load time so the Settings
// UI can show the running app version without duplicating the string.
const pkgJson = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"))

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
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
            if (id.includes("@react-sigma") || id.includes("sigma")) {
              return "sigma-vendor"
            }
            if (id.includes("graphology")) {
              return "graphology-vendor"
            }
          }
          // Split large book-analysis modules into their own chunk
          if (id.includes("/src/lib/novel/book-analysis/")) {
            return "book-analysis-vendor"
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
    ],
  },
}))
