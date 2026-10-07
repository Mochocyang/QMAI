import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(resolve(__dirname, "ui-test-tools.css"), "utf8")

/**
 * 按**规则块**取声明，而不是在整份 CSS 里搜子串。
 *
 * 两个理由：
 *   1) 子串搜索会被相邻规则喂饱 —— `X{flex-wrap:nowrap}` 出现在别的规则里也会命中；
 *   2) 构建产物会被 lightningcss 重排属性，任何"选择器后面紧跟某条声明"的假设都不可靠。
 * 本项目在便携版校验里已经因为第 2 点误报过一次，这里从一开始就避开。
 *
 * 选择器要按**列表**处理：`[data-ui="memory-snapshot"], [data-ui="memory-detail"] {` 这种
 * 合并规则里，单个选择器后面跟的是逗号而不是 `{`。只认 `${selector} {` 会漏掉它们，
 * 于是"规则在、却查不到" —— 断言变成永远为假。
 * 先去掉注释，避免注释里的选择器文本被当成规则。
 */
function cssRules(source: string): Array<{ selectors: string[]; decls: string }> {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "")
  const rules: Array<{ selectors: string[]; decls: string }> = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(stripped)) !== null) {
    rules.push({
      selectors: match[1].split(",").map((item) => item.trim()).filter(Boolean),
      decls: match[2].replace(/\s+/g, " ").trim(),
    })
  }
  return rules
}

const RULES = cssRules(css)

/** 取声明时按**完全相等**的选择器匹配，media query 里那种带前缀的伪选择器不会误命中。 */
function ruleDecls(selector: string): string {
  return RULES
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.decls)
    .join(" ")
}

const has = (selector: string, declaration: string) => ruleDecls(selector).includes(declaration)

const MEMORY_TABS = '.ui-test-root [data-ui="memory-tabs"]'
const MEMORY_STATS = '.ui-test-root [data-ui="memory-stats"]'
const MEMORY_COLLECTION = '.ui-test-root [data-ui="memory-snapshot-collection"]'

describe("记忆中心单页样式", () => {
  it("标签条单排横向滚动：nowrap + overflow-x:auto 必须成对出现", () => {
    /*
     * 只给 overflow-x 而不锁 nowrap，窄屏下 flex 仍会折成两排 ——
     * 而两排会被读成"排错了"。这两条必须一起在。
     */
    expect(has(MEMORY_TABS, "flex-wrap: nowrap")).toBe(true)
    expect(has(MEMORY_TABS, "overflow-x: auto")).toBe(true)
    expect(has(MEMORY_TABS, "flex-wrap: wrap")).toBe(false)
  })

  it("统计条同样单排不折行", () => {
    expect(has(MEMORY_STATS, "flex-wrap: nowrap")).toBe(true)
    expect(has(MEMORY_STATS, "overflow-x: auto")).toBe(true)
  })

  it("单个标签不被压缩（flex: 0 0 auto）", () => {
    expect(has('.ui-test-root [data-ui="memory-tab"]', "flex: 0 0 auto")).toBe(true)
  })

  it("快照集合是纵向堆叠，不再是左右分栏", () => {
    expect(has(MEMORY_COLLECTION, "flex-direction: column")).toBe(true)
    expect(has(MEMORY_COLLECTION, "width: 100%")).toBe(true)
    // row 会让它退回双栏
    expect(has(MEMORY_COLLECTION, "flex-direction: row")).toBe(false)
  })

  /*
   * 内层双栏（左章节列表 + 右快照详情）的两个选择器已经不存在于源码。
   * 留着它们的样式规则会让下一个改样式的人以为还有两条竖栏。
   */
  it("内层双栏的旧选择器已彻底清除", () => {
    expect(css).not.toContain('data-ui="memory-snapshots"')
    expect(css).not.toContain('data-ui="memory-chapter-filter"')
  })

  it("快照卡片与详情面板保留原有视觉（无边框、面板底色）", () => {
    for (const selector of [
      '.ui-test-root [data-ui="memory-snapshot"]',
      '.ui-test-root [data-ui="memory-detail"]',
    ]) {
      expect(has(selector, "border: 0"), selector).toBe(true)
      expect(has(selector, "background: var(--ui-panel)"), selector).toBe(true)
    }
  })
})
