import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * 断言「源码里不再出现 X」之前必须先去掉注释。
 * 这个文件在 memory-center-view.tsx 里解释移除原因时，会把这些标识符原样写进注释，
 * 于是"我自己写的说明"会把检查喂饱 —— 改动前它明明还在，检查却是绿的。
 * 这正是本项目刚踩过一次的坑（prove-exe-check-nonvacuous.mjs），别再踩第二次。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
}

const source = stripComments(readFileSync(resolve(__dirname, "memory-center-view.tsx"), "utf8"))
const tabsSource = stripComments(readFileSync(resolve(__dirname, "memory-center-tabs.ts"), "utf8"))

/**
 * 这组断言在单页重构后**改了性质**。
 *
 * 原来钉的是双栏结构本身（`selectedMemoryCenterEntry`、`!selectedMemoryCenterEntry ? (`）
 * —— 换句话说，钉的是缺陷。现在钉的是"那两层双栏确实不在了"，
 * 以及取而代之的单页结构确实在位。前者用 not.toContain（防止退回双栏），
 * 后者用 toContain（防止顺手删干净）。
 */
describe("memory-center-view", () => {
  it("loads memory data from a dedicated loader", () => {
    expect(source).toContain("loadMemoryCenterData")
    expect(source).toContain("useEffect")
  })

  it("renders all six memory sections through the tab config", () => {
    // 6 个分类的文案键现在集中在 memory-center-tabs.ts，视图通过配置渲染。
    for (const key of [
      "novel.memoryCenter.sections.characterStates",
      "novel.memoryCenter.sections.cognition",
      "novel.memoryCenter.sections.foreshadowing",
      "novel.memoryCenter.sections.timeline",
      "novel.memoryCenter.sections.canonFacts",
      "novel.memoryCenter.sections.conflicts",
    ]) {
      expect(tabsSource).toContain(key)
    }
  })

  it("provides open-file actions for memory pages", () => {
    expect(source).toContain("readFile(file.path)")
    expect(source).toContain("MEMORY_TAB_LABEL_KEYS")
  })

  it("opens snapshot and memory details inside the memory center instead of switching to wiki", () => {
    expect(source).toContain("detailView")
    expect(source).not.toContain('setActiveView("wiki")')
  })

  it("strips markdown frontmatter before rendering memory details", () => {
    expect(source).toContain("parseFrontmatter")
    expect(source).toContain("splitRenderableMarkdown")
    expect(source).toContain("content: rendered.body")
  })

  it("restores the previous memory-center position after closing detail view", () => {
    expect(source).toContain("scrollContainerRef")
    expect(source).toContain("restoreScrollTop")
    expect(source).toContain("restoreFocusId")
  })

  /*
   * 单页重构的核心不变量：外层双栏与内层双栏都不在了。
   * 用 not.toContain 而不是"计数为 1"之类的软断言 —— 只要这两个字符串回来，
   * 无论以什么形式回来，都说明有人把双栏结构重新引入了。
   */
  it("不再有双栏结构：既没有全局选中项，也没有中间栏占位提示", () => {
    expect(source).not.toContain("selectedMemoryCenterEntry")
    expect(source).not.toContain("MemoryEntryButton")
    expect(source).not.toContain("novel.memoryCenter.selectPrompt")
    expect(source).not.toContain('data-ui="memory-snapshots"')
    expect(source).not.toContain('data-ui="memory-chapter-filter"')
  })

  it("标签选中是页面内局部 state，不再是全局 store 字段", () => {
    expect(source).toContain("useState<MemoryTabKey>")
    expect(source).toContain("MEMORY_TAB_KEYS")
    // 视图仍会读 wiki-store（project / bumpDataVersion），但标签选中项不再存在那里。
    expect(source).not.toContain("selectedMemoryCenterEntry")
    expect(source).not.toContain("setSelectedMemoryCenterEntry")
  })

  it("标签条单排且不换行（换行会被读成排错了）", () => {
    expect(source).toContain('data-ui="memory-tabs"')
    expect(source).toContain('role="tablist"')
    expect(source).toContain("overflow-x-auto")
    expect(source).toContain("flex-nowrap")
  })

  it("统计条首个 chip 是快照总数（不是章节快照）", () => {
    /*
     * stats.snapshotCount 是章节 + 大纲的总数（实机 11），而「章节快照」标签只有 1 条。
     * 两个同名数字摆在一起读作 11 vs 1，看起来就是 bug，所以统计条必须写「快照总数」。
     */
    expect(source).toContain("novel.memoryCenter.stats.totalSnapshots")
    expect(source).not.toContain("novel.memoryCenter.stats.snapshots")
  })

  it("已移除不可达的剧情框架分支", () => {
    expect(source).not.toContain("plot-framework")
    expect(source).not.toContain("PlotFrameworkSummaryCard")
    expect(source).not.toContain("summarizePlotFrameworkLibrary")
    expect(source).not.toContain("loadPlotFrameworkLibrary")
  })
})
