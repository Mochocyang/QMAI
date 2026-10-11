import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  resolve(__dirname, "sidebar-bottom-actions.tsx"),
  "utf8",
)

describe("sidebar-bottom-actions", () => {
  it("renders 外观 and 设置 as labelled buttons", () => {
    expect(source).toContain('t("sidebarActions.appearance")')
    expect(source).toContain('t("sidebarActions.settings")')
    expect(source).toContain('data-ui="sidebar-bottom-actions"')
  })

  it("keeps the three theme options wired to store + persistence", () => {
    expect(source).toContain("light")
    expect(source).toContain("dark")
    expect(source).toContain("system")
    expect(source).toContain("setTheme")
    expect(source).toContain("saveTheme")
    expect(source).toContain("applyTheme")
  })

  it("opens the theme menu in a portal above the trigger", () => {
    expect(source).toContain("createPortal")
    expect(source).toContain("document.body")
    // 底栏优先向上弹出
    expect(source).toContain("rect.top - menuHeight - 6")
  })

  it("switches to the settings view with search panel closed", () => {
    expect(source).toContain('setActiveView("settings")')
    expect(source).toContain("setSearchPanelOpen(false)")
  })
})
