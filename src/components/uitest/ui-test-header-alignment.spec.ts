import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import postcss from "postcss"
import { describe, expect, it } from "vitest"
const css = (name: string) => readFileSync(resolve(__dirname, name), "utf8")
function declaration(file: string, selector: string, property: string) {
  let value: string | undefined
  postcss.parse(css(file)).walkRules(rule => {
    if (rule.parent?.type === "root" && rule.selectors.includes(selector)) rule.walkDecls(property, decl => { value = decl.value })
  })
  return value
}
describe("工作区顶部标题对齐", () => {
  it("目录保留22px顶部留白，统一1.75rem（原28px）标题行", () => {
    expect(css("ui-test.css")).toContain("--ui-heading-top: 22px")
    expect(css("ui-test.css")).toContain("--ui-heading-line: 1.75rem")
    expect(declaration("ui-test.css", ".ui-test-directory-head", "padding")).toBe("var(--ui-heading-top) 20px 10px")
    expect(declaration("ui-test.css", ".ui-test-directory-head h2", "line-height")).toBe("var(--ui-heading-line)")
  })
  it("章节大纲标题为1.25rem/1.75rem（原20px/28px），输入态和显示态同高度", () => {
    expect(declaration("ui-test-editor.css", ".ui-test-root .ui-test-editor-title", "font")).toBe("500 1.25rem/1.75rem var(--serif)")
    expect(declaration("ui-test-editor.css", ".ui-test-root .ui-test-editor-title-input", "min-height")).toBe("var(--ui-heading-line)")
    expect(declaration("ui-test-editor.css", ".ui-test-root .ui-test-editor-header", "padding-top")).toBe("var(--ui-heading-top)")
    expect(declaration("ui-test-editor.css", ".ui-test-root .ui-test-editor-title-row", "min-height")).toBe("var(--ui-heading-line)")
  })
  it("AI第一行和目录对齐，不改输入区水平间距", () => {
    expect(declaration("ui-test-ai.css", "[data-ui-ai-panel]", "padding")).toBe("var(--ui-heading-top) 18px 6px")
    expect(declaration("ui-test-ai.css", "[data-ui-ai-header]", "min-height")).toBe("var(--ui-heading-line)")
    expect(declaration("ui-test-ai.css", "[data-ui-ai-header] button", "height")).toBe("var(--ui-heading-line)")
    expect(declaration("ui-test-ai.css", '[data-ui-ai-panel="outline"] > [data-ui-ai-input-area]', "padding-inline")).toBe("0")
  })
  it("工具页只缩小顶部主标题，面包屑和说明保留在标题之后", () => {
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="tool-heading"]', "padding")).toBe("var(--ui-heading-top) clamp(20px, 3vw, 38px) 22px")
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="tool-heading"] .ui-test-page-title', "order")).toBe("-1")
    expect(declaration("ui-test-tools.css", ".ui-test-root .ui-test-page-title", "line-height")).toBe("var(--ui-heading-line)")
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="settings-section"] h2', "font-size")).toBeUndefined()
  })
  it("灵魂标题和页签紧凑排列，减少留白且不改变详情标题", () => {
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="soul-tabs"]', "padding")).toBe("10px 24px")
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="soul-content"]', "padding")).toBe("16px 24px 0")
    expect(declaration("ui-test-tools.css", ".ui-test-root .ui-test-soul-tab-row", "margin")).toBe("0")
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="soul-project-editor"] > div', "padding")).toBe("0")
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="soul-role-content"] .mb-4 > h2', "font")).toBe("500 1.25rem/1.75rem var(--serif)")
  })
  it("灵魂表单保持有边框输入区、双列基础字段和独立滚动区", () => {
    const field = '.ui-test-root [data-ui-page="soul"] [data-ui="soul-custom-form"] :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea):not([aria-invalid="true"])'
    expect(declaration("ui-test-tools.css", field, "border")).toBe("1px solid color-mix(in srgb, var(--ui-muted) 65%, var(--ui-paper))")
    expect(declaration("ui-test-tools.css", field, "background")).toBe("var(--ui-paper)")
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="soul-form-basics"]', "grid-template-columns")).toBe("repeat(2, minmax(0, 1fr))")
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="soul-form-body"]', "overflow-y")).toBe("auto")
  })
  it("技能页签和设置首行对齐，不恢复已隐藏的重复标题", () => {
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="skills-tabs"]', "padding")).toBe("var(--ui-heading-top) clamp(20px, 3vw, 38px) 18px")
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="settings-scroll"]', "padding")).toBe("var(--ui-heading-top) clamp(20px, 3.4vw, 48px) 30px")
    expect(declaration("ui-test-tools.css", '.ui-test-root [data-ui="settings-section"] :is(h1, h2)', "display")).toBe("none")
    expect(css("ui-test.css")).not.toContain("ui-test-brand-copy")
  })
  it("其他目录首行使用显式标记，不批量修改内容区", () => {
    for (const file of ["../layout/sidebar-panel.tsx", "../layout/graph-sidebar-panel.tsx", "../layout/review-center-sidebar-panel.tsx", "../layout/book-analysis-sidebar-panel.tsx"]) {
      expect(readFileSync(resolve(__dirname, file), "utf8")).toContain('data-ui-panel-heading')
    }
    expect(declaration("ui-test.css", ".ui-test-root [data-ui-panel-heading] button", "height")).toBe("var(--ui-heading-line)")
    expect(declaration("ui-test.css", ".ui-test-root [data-ui-panel-heading]", "padding")).toBe("var(--ui-heading-top) 20px 10px")
  })
})
