import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 用户统计上报的"接线"回归测试。
 *
 * 为什么需要它 —— 与 app-updater-wiring.test.ts 是同一场事故：
 *
 * 提交 26f80ee6（"fix(ui): 调整对话输入框与界面资源"）从 App.tsx 删掉了
 * `if (!IS_UI_TEST_BUILD) { checkForAppUpdate(); initAnalytics() }` 整块。
 * 更新检查那次修复已经补了守卫，但 initAnalytics 一直没有归队 ——
 * src/lib/analytics.ts 只剩自己的定义、没有任何调用者，于是被 bundler
 * 整体 tree-shake 掉，后台仪表盘的「下载用户数 / 独立 IP / 当前在线 /
 * 今日新增」四项从此不再更新。
 *
 * 这类故障单元测试抓不到：analytics.ts 内部逻辑完全没变，任何只测
 * sendAnalytics / initAnalytics 内部行为的用例都会一路绿着。
 * 所以这里断言的是**接线本身**。
 */

const SRC = resolve(__dirname, "..")
const DEFINITION_MODULE = "lib/analytics.ts"

function isTestFile(rel: string): boolean {
  return /\.(test|spec)\.[tj]sx?$/.test(rel)
}

/**
 * 剥掉注释再断言。必须这么做：App.tsx 修复处写了大段解释性注释，
 * 里面**写到了** initAnalytics 这个名字，不剥注释会被自己的说明文字触发。
 * 行注释用 [^:] 前缀排除，避免把 https:// 的 // 当成注释起始。
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === "node_modules") continue
      collectSourceFiles(full, out)
      continue
    }
    if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const sourceFiles = collectSourceFiles(SRC).map((full) => ({
  full,
  rel: relative(SRC, full).replace(/\\/g, "/"),
}))

describe("用户统计上报的接线", () => {
  it("有非测试代码真正调用 initAnalytics（而不是只剩一个无人调用的导出）", () => {
    const callers = sourceFiles
      .filter((f) => !isTestFile(f.rel))
      .filter((f) => f.rel !== DEFINITION_MODULE)
      .filter((f) => stripComments(readFileSync(f.full, "utf8")).includes("initAnalytics"))

    expect(
      callers.map((f) => f.rel),
      "initAnalytics 没有任何调用者 —— 它会被再次 tree-shake，"
        + "后台统计（下载数/独立 IP/在线人数/今日新增）将不再更新。"
        + "请确认启动流程里仍然调用它。",
    ).not.toHaveLength(0)
  })

  it("调用点是应用启动入口 App.tsx（而不是某个永远走不到的分支）", () => {
    const app = sourceFiles.find((f) => f.rel === "App.tsx")
    expect(app, "找不到 src/App.tsx").toBeDefined()

    const code = stripComments(readFileSync(app!.full, "utf8"))
    // 既要有 import，也要有实际调用，缺一不可
    expect(code, "App.tsx 未导入 initAnalytics").toContain(
      'import { initAnalytics } from "@/lib/analytics"',
    )
    expect(code, "App.tsx 导入了但没有调用 initAnalytics").toMatch(
      /void\s+initAnalytics\s*\(\s*\)/,
    )
  })

  it("调用没有被恒假的编译期常量挡住（IS_UI_TEST_BUILD 现为常量 true）", () => {
    const app = sourceFiles.find((f) => f.rel === "App.tsx")
    const code = stripComments(readFileSync(app!.full, "utf8"))

    // 原来的写法是 `if (!IS_UI_TEST_BUILD) { ... }`，但该常量已硬编码为 true、
    // vite.config.ts 也没有构建期替换 —— 条件恒假，调用写了也等于没写，
    // 而且 tsc 和测试都不会报错。这是最容易踩空的地方。
    const uiTestModule = join(SRC, "lib/ui-test.ts")
    const hardcodedTrue = /export const IS_UI_TEST_BUILD = true/.test(
      readFileSync(uiTestModule, "utf8"),
    )

    if (hardcodedTrue && code.includes("IS_UI_TEST_BUILD")) {
      throw new Error(
        "App.tsx 用了 IS_UI_TEST_BUILD 做守卫，但该常量硬编码为 true、"
          + "且没有构建期替换，守卫恒为假，统计上报永远不会执行。",
      )
    }
  })
})
