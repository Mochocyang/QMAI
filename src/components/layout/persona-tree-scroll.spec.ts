import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 侧栏「人物小传」区段的滚动回归。
 *
 * 曾经的错法：把它做成 `flex-shrink: 0` 的固定块，展开「候选角色」后
 * 内容有几十条，它把下面的文件树顶出侧栏之外 —— 滚轮没有可滚的容器，
 * 用户看到的就是「滚不动、下面的内容永远看不到」。
 *
 * 所以这里钉住三条 CSS 事实：区块自己可滚、有高度上限、且不会撑破父级。
 */
describe("人物区段必须能独立滚动", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/components/uitest/ui-test-tools.css"),
    "utf8",
  )

  const block = (() => {
    const start = css.indexOf(".ui-test-root .ui-test-ptree {")
    expect(start, "找不到 .ui-test-ptree 规则").toBeGreaterThan(-1)
    const end = css.indexOf("}", start)
    return css.slice(start, end)
  })()

  it("有 overflow-y 与高度上限", () => {
    expect(block).toContain("overflow-y: auto")
    expect(block).toMatch(/max-height:\s*\d/)
  })

  it("允许在父 flex 列里收缩，不再写死 flex-shrink: 0", () => {
    expect(block).not.toContain("flex-shrink: 0")
    expect(block).toContain("min-height: 0")
  })
})
