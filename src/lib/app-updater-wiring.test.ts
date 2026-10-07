import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 启动更新检查的"接线"回归测试。
 *
 * 为什么需要它 —— 这是本次事故的核心教训：
 *
 * 2026-09-25 的提交 26f80ee（"fix(ui): 调整对话输入框与界面资源"）从 App.tsx
 * 删掉了那两行（import + `void checkForAppUpdate()`）。此后 checkForAppUpdate
 * 在整个仓库里只剩自己的定义，没有任何调用者，于是 app-updater.ts 被 bundler
 * 整体 tree-shake 掉 —— 从 v4.0.0 到 v4.1.1 共 6 个版本，用户打开旧版本
 * 再也不会收到更新提示，只能手动进设置里点「检查更新」。
 *
 * 这个事故之所以能潜伏这么久，是因为 app-updater.test.ts 里的 4 个用例
 * 只测 runAppUpdateFlow 的内部逻辑：只要那个函数还在、逻辑没改，它们就过。
 * 而"功能是否被接上"根本不在任何断言的射程内。事实上这 4 个用例当时正因为
 * 01aab5f 删掉了 export 而全红，但一个吵闹的失败套件里没人会注意到
 * "有个功能整体消失了"。
 *
 * 所以这里断言的是**接线本身**：必须有非测试代码真正调用它。
 * 源码级断言看着不优雅，但它精确对应故障模式 —— 单元测试无法察觉
 * "没有任何人调用被测试的函数"，而这一条可以。
 */

const SRC = resolve(__dirname, "..")
const DEFINITION_MODULE = "lib/app-updater.ts"

/** 判断是否测试文件：本仓库的约定是 .test.* / .spec.*。 */
function isTestFile(rel: string): boolean {
  return /\.(test|spec)\.[tj]sx?$/.test(rel)
}

/**
 * 剥掉注释后再做"是否用到某个常量"的判断。
 *
 * 必须这么做：App.tsx 的修复处有一大段解释性注释，里面**写到了**
 * IS_UI_TEST_BUILD 这个名字（说明为什么不套那个守卫）。不剥注释的话，
 * 断言会被自己的说明文字触发 —— 我第一版就栽在这里，报"App.tsx 用了
 * IS_UI_TEST_BUILD"，而实际代码里并没有用。
 * 行注释用 [^:] 前缀排除，避免把 https:// 里的 // 当成注释起始。
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
      // node_modules 不该出现在 src 下，但跳过更安全
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

describe("启动更新检查的接线", () => {
  it("有非测试代码真正调用 checkForAppUpdate（而不是只剩一个无人调用的导出）", () => {
    const callers = sourceFiles
      .filter((f) => !isTestFile(f.rel))
      .filter((f) => f.rel !== DEFINITION_MODULE)
      .filter((f) => readFileSync(f.full, "utf8").includes("checkForAppUpdate"))

    expect(
      callers.map((f) => f.rel),
      "checkForAppUpdate 没有任何调用者 —— 它会再次被 tree-shake，"
        + "用户将收不到更新提示。请确认启动流程里仍然调用它。",
    ).not.toHaveLength(0)
  })

  it("调用点是应用启动入口 App.tsx（而不是某个永远走不到的分支）", () => {
    const app = sourceFiles.find((f) => f.rel === "App.tsx")
    expect(app, "找不到 src/App.tsx").toBeDefined()

    const text = readFileSync(app!.full, "utf8")
    // 既要有 import，也要有实际调用，缺一不可
    expect(text, "App.tsx 未导入 checkForAppUpdate").toContain(
      'import { checkForAppUpdate } from "@/lib/app-updater"',
    )
    expect(text, "App.tsx 导入了但没有调用 checkForAppUpdate").toMatch(
      /void\s+checkForAppUpdate\s*\(\s*\)/,
    )
  })

  it("调用没有被恒假的编译期常量挡住（IS_UI_TEST_BUILD 现为常量 true）", () => {
    const app = sourceFiles.find((f) => f.rel === "App.tsx")
    const code = stripComments(readFileSync(app!.full, "utf8"))

    // 背景：这个调用原先是 `if (!IS_UI_TEST_BUILD) { ... }`。
    // 但 src/lib/ui-test.ts 里 IS_UI_TEST_BUILD 已被硬编码为 true
    // （注释："已统一为只保留新版界面"），vite.config.ts 也没有对应的 define
    // 去做构建期替换。若原样恢复那个守卫，条件是恒假的 —— 调用写了也等于没写，
    // 而且 tsc 和测试都不会报错。这是本次修复最容易踩空的地方。
    const uiTestModule = join(SRC, "lib/ui-test.ts")
    const uiTestText = readFileSync(uiTestModule, "utf8")
    const hardcodedTrue = /export const IS_UI_TEST_BUILD = true/.test(uiTestText)

    if (hardcodedTrue && code.includes("IS_UI_TEST_BUILD")) {
      throw new Error(
        "App.tsx 用了 IS_UI_TEST_BUILD 做守卫，但该常量硬编码为 true、"
          + "且没有构建期替换，守卫恒为假，更新检查永远不会执行。",
      )
    }
  })
})
