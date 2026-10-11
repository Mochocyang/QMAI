import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(__dirname, "../../..")

/*
 * 断言「源码里不再出现 X」之前必须先去掉注释 —— 解释移除原因的注释里
 * 会原样写上那些标识符，不去掉的话"自己的说明"会把检查喂饱。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
}

const read = (path: string) => stripComments(readFileSync(resolve(root, path), "utf8"))

const tabsSource = read("src/components/novel/memory-center-tabs.ts")
const viewSource = read("src/components/novel/memory-center-view.tsx")
const shellSource = read("src/components/uitest/ui-test-shell.tsx")

/**
 * 「拆文记忆库」不得出现在记忆中心。这条产品约束没变，**但证明方式换了**。
 *
 * 改造前有两个分支在管这件事：中间栏用 filter 把 dismantling-library 剔除，
 * 内容区再兜底把它的选中项清空 —— 也就是"列表里混进去、再滤掉"。
 * 那两个分支随双栏一起删除了。
 *
 * 现在标签清单是源码里的常量，防线从"运行时过滤"前移成"清单本身不含"。
 * 这一条必须仍然成立：拆文库有自己的页面入口，混进记忆中心会让用户
 * 在两处看到同一份数据。
 */
describe("记忆中心不出现拆文库", () => {
  it("标签清单常量里没有 dismantling-library", () => {
    expect(tabsSource).toContain("MEMORY_TAB_KEYS")
    expect(tabsSource).not.toContain("dismantling-library")
  })

  it("标签条只遍历标签清单，不会额外渲染清单之外的项目", () => {
    // 渲染源必须是 MEMORY_TAB_KEYS.map，不能是别的来源（否则清单就不再是唯一真相）
    expect(viewSource).toContain("MEMORY_TAB_KEYS.map(")
    expect(viewSource).not.toContain("dismantling-library")
    // 也确认没有留下"先混进去再滤掉"的老写法
    expect(viewSource).not.toContain("filter((key) => key !==")
  })

  it("侧栏里也不再出现 dismantling-library", () => {
    const sidebarSource = read("src/components/layout/sidebar-panel.tsx")
    expect(sidebarSource).not.toContain("dismantling-library")
  })

  it("记忆中心在小说模式下是整窗视图，目录栏不再占位", () => {
    expect(shellSource).toContain('const memoryCenterFullWindow = activeView === "lint" && novelMode')
    expect(shellSource).toContain("!fullWindowViews && !memoryCenterFullWindow")
  })

  /*
   * lint 视图由两个页面共用，只看 activeView 会把 LintView 的章节树一起藏掉。
   * 这条断言钉住那个条件里的 novelMode。
   */
  it("整窗判定带 novelMode，不会误伤 LintView", () => {
    const line = shellSource.split("\n").find((item) => item.includes("memoryCenterFullWindow ="))
    expect(line).toBeDefined()
    expect(line).toContain('activeView === "lint"')
    expect(line).toContain("novelMode")
  })

  /*
   * 技能库内部 tab 的新视图（文风库）必须与技能库一样是整窗视图：
   * 漏掉它不会报错，只会把它挤进「目录栏 + 内容区」的双栏容器里。
   *
   * ⚠️ 这条原来是这样找的：从源码里挑出 `const fullWindowViews =` 那一行，
   * 再 `toContain` 两个子串。把该行**行为不变**地换一种写法（或换行）就会红，
   * 报错信息还指着「文风库不是整窗视图」——而 `fullWindowViews` 本身
   * 当时**全仓库零行为覆盖**。
   * 清单与判定已抽成 `@/lib/full-window-views`，行为由
   * `src/lib/full-window-views.spec.ts` 逐项断言。这里只保留一条**接线**
   * 断言（壳层确实用那个纯函数、且传的是 activeView），不再假装它是行为证据。
   */
  it("整窗判定接到了纯函数 isFullWindowView（行为见 full-window-views.spec.ts）", () => {
    expect(shellSource).toContain("isFullWindowView(activeView)")
    expect(shellSource).toContain("!fullWindowViews && !memoryCenterFullWindow")
  })
})
