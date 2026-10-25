import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 使用统计上报的「接线」回归测试。
 *
 * 事故背景（与 app-updater-wiring.test.ts 同源）：
 *
 * 2026-09-25 的提交 26f80ee（"fix(ui): 调整对话输入框与界面资源"）从 App.tsx
 * 删掉了两行 —— `import { initAnalytics }` 与 `void initAnalytics()`，同时也删了
 * 更新检查那一对。更新检查后来在 471a0dcf 单独修复，**统计上报被漏掉了**：
 * `initAnalytics` 在整仓只剩自己的定义，没有任何调用者，`analytics.ts` 被
 * bundler 整体 tree-shake 掉，那段代码根本没进安装包。
 *
 * 后果：数据从 2026-09-25 起停止增长（后台库里 3417 个用户、1589 个独立 IP
 * 全是此前的历史数据），用户在设置里看到的统计看板一直显示陈旧数字。
 *
 * analytics.ts 单测无法发现这个故障 —— 只要函数本身逻辑没改、导出还在，
 * 单测全绿。只有「有没有人调用它」这一层断言能守住。
 */

const SRC = resolve(__dirname, "..")
const DEFINITION_MODULE = "lib/analytics.ts"
const MODULE_SPECIFIER = "@/lib/analytics"

/** 本仓库约定：.test.* / .spec.* 是测试文件。 */
function isTestFile(rel: string): boolean {
  return /\.(test|spec)\.[tj]sx?$/.test(rel)
}

/** 剥掉注释，避免说明性文字触发断言（历史教训见 app-updater-wiring.test.ts）。 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function collectSourceFiles(root: string, dir: string = root, out: Array<{ full: string; rel: string }> = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === "node_modules") continue
      collectSourceFiles(root, full, out)
      continue
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      // rel 始终相对 src 根，递归深度不影响路径形状。
      out.push({ full, rel: full.slice(root.length + 1).replace(/\\/g, "/") })
    }
  }
  return out
}

const sourceFiles = collectSourceFiles(SRC)

describe("使用统计上报的接线", () => {
  it("analytics.ts 仍然导出 initAnalytics", () => {
    const definition = sourceFiles.find((f) => f.rel === DEFINITION_MODULE)
    expect(definition, "找不到 src/lib/analytics.ts").toBeDefined()

    const text = readFileSync(definition!.full, "utf8")
    expect(text).toMatch(/export\s+async\s+function\s+initAnalytics\s*\(/)
  })

  it("有非测试代码真正调用 initAnalytics（否则整个模块会被 tree-shake）", () => {
    const callers = sourceFiles
      .filter((f) => !isTestFile(f.rel))
      .filter((f) => f.rel !== DEFINITION_MODULE)
      .filter((f) => stripComments(readFileSync(f.full, "utf8")).includes("initAnalytics"))

    expect(
      callers.map((f) => f.rel),
      "initAnalytics 没有任何调用者 —— 模块会被 tree-shake，"
        + "统计上报不会进入安装包，后台数据停止增长。"
        + "请确认 App.tsx 里保留了 import 与 void initAnalytics()。",
    ).not.toHaveLength(0)
  })

  it("调用点在 App.tsx 的启动流程里，import 与实际调用缺一不可", () => {
    const app = sourceFiles.find((f) => f.rel === "App.tsx")
    expect(app, "找不到 src/App.tsx").toBeDefined()

    const text = readFileSync(app!.full, "utf8")
    const code = stripComments(text)

    expect(code, `App.tsx 缺少对 ${MODULE_SPECIFIER} 的 import`).toContain(
      `import { initAnalytics } from "${MODULE_SPECIFIER}"`,
    )
    expect(code, "App.tsx 引入了 initAnalytics 但没有调用").toMatch(
      /void\s+initAnalytics\s*\(\s*\)/,
    )
  })

  it("统计上报不依赖恒假的编译期开关", () => {
    // 与更新检查同样的坑：IS_UI_TEST_BUILD 在 src/lib/ui-test.ts 里硬编码为 true，
    // vite.config.ts 也没有对应 define。若把调用套在 `if (!IS_UI_TEST_BUILD)` 里，
    // 等于没写，而 tsc 与单测都不会报错。
    const app = sourceFiles.find((f) => f.rel === "App.tsx")
    expect(app).toBeDefined()

    const uiTestText = readFileSync(join(SRC, "lib/ui-test.ts"), "utf8")
    const hardcodedTrue = /export const IS_UI_TEST_BUILD = true/.test(uiTestText)
    if (!hardcodedTrue) return

    const code = stripComments(readFileSync(app!.full, "utf8"))
    const callIndex = code.search(/void\s+initAnalytics\s*\(\s*\)/)
    expect(callIndex, "App.tsx 没有调用 initAnalytics").toBeGreaterThan(-1)

    // 调用点所在行不能同时出现那个恒真开关。
    const line = code.slice(0, callIndex).split("\n").pop() ?? ""
    const after = code.slice(callIndex, callIndex + 120)
    expect(
      line.includes("IS_UI_TEST_BUILD") || after.includes("IS_UI_TEST_BUILD"),
      "initAnalytics 被套在恒假的 IS_UI_TEST_BUILD 守卫里，实际不会执行。",
    ).toBe(false)
  })
})
