import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(__dirname, "../../..")
const visualStyleSource = readFileSync(resolve(root, "src/lib/visual-style-settings.ts"), "utf8")
const interfaceSectionSource = readFileSync(resolve(__dirname, "sections/interface-section.tsx"), "utf8")
const settingsViewSource = readFileSync(resolve(__dirname, "settings-view.tsx"), "utf8")
const appLayoutSource = readFileSync(resolve(root, "src/components/layout/app-layout.tsx"), "utf8")
const indexCssSource = readFileSync(resolve(root, "src/index.css"), "utf8")
const classicDarkBlock = indexCssSource.match(/\.dark \{[\s\S]*?\n\}/)?.[0] ?? ""

describe("settings visual refresh style", () => {
  it("registers the compact square visual style and exposes a selectable appearance skin picker", () => {
    expect(visualStyleSource).toContain('| "fangzheng"')
    expect(visualStyleSource).toContain('fangzheng: "visual-fangzheng"')
    expect(visualStyleSource).toContain("VISUAL_STYLE_STORAGE_VERSION")
    expect(visualStyleSource).toContain("resolveStoredVisualStyle")
    expect(visualStyleSource).toContain('"fangzheng"')
    expect(interfaceSectionSource).toContain('data-ui="interface-skins"')
    expect(interfaceSectionSource).toContain("UI_TEST_SKINS")
    expect(interfaceSectionSource).toContain("data-ui-skin-choice")
  })

  it("defines light and dark tokens with no rounded corners for the compact style", () => {
    expect(indexCssSource).toContain(":root.visual-fangzheng")
    expect(indexCssSource).toContain(".visual-fangzheng.dark")
    expect(indexCssSource).toContain("--radius: 0px")
    expect(indexCssSource).toContain(".visual-fangzheng *")
    expect(indexCssSource).toContain("--primary:")
    expect(indexCssSource).toContain("--sidebar-accent:")
    expect(indexCssSource).toContain("--sidebar-primary:")
    expect(indexCssSource).toContain("--popover:")
    expect(indexCssSource).toContain('.visual-fangzheng [role="listbox"]')
    expect(indexCssSource).toContain('.visual-fangzheng [role="option"][aria-selected="true"]')
    expect(indexCssSource).not.toContain(":root.visual-fangzheng {\n    --radius: 0px;\n    --background: #dde5f0")
    expect(indexCssSource).not.toContain(".visual-fangzheng.dark {\n    --radius: 0px;\n    --background: #1a1f35")
  })

  it("keeps settings navigation bound to the active visual style tokens", () => {
    expect(settingsViewSource).toContain("bg-sidebar")
    expect(settingsViewSource).toContain("text-sidebar-foreground")
    expect(settingsViewSource).toContain("border-sidebar-border")
    expect(settingsViewSource).toContain("bg-sidebar-accent")
    expect(settingsViewSource).not.toContain("bg-brand-50/60")
    expect(settingsViewSource).not.toContain("ring-1 ring-border/70")
  })

  it("uses softer tokenized selection and divider styling instead of hard fixed outlines", () => {
    expect(indexCssSource).not.toContain("rgba(62, 107, 88")
    expect(indexCssSource).not.toContain("border-left: 2px solid #c8a96e")
    expect(indexCssSource).not.toContain("border-left: 2px solid #d9c69a")
    expect(indexCssSource).not.toContain("box-shadow: inset 0 0 0 1px var(--primary)")
    expect(indexCssSource).toContain("background: color-mix(in oklch, var(--sidebar-accent)")
    expect(appLayoutSource).toContain("w-1 shrink-0 cursor-col-resize bg-border/20")
    expect(appLayoutSource).not.toContain("w-2 shrink-0 cursor-col-resize bg-border/40")
  })

  it("makes the appearance skin selection state obvious across low-contrast themes", () => {
    expect(interfaceSectionSource).toContain("aria-pressed={skin === option.id}")
    expect(interfaceSectionSource).toContain("data-ui-skin-choice")
    expect(interfaceSectionSource).toContain("已选择")
    expect(interfaceSectionSource).toContain("ui-test-skin-dot-")
    expect(interfaceSectionSource).not.toContain("border-border hover:bg-accent/50")
  })

  it("uses stronger tokenized hover contrast for menus and lists", () => {
    expect(indexCssSource).toContain("var(--sidebar-accent) 68%, transparent")
    expect(indexCssSource).toContain("var(--sidebar-accent) 84%, var(--background)")
    expect(indexCssSource).toContain("var(--sidebar-accent) 66%, transparent")
  })

  it("refreshes yuebai dailan with a clearer moon-white and indigo palette", () => {
    expect(visualStyleSource).toContain('| "yuebai"')
    expect(visualStyleSource).toContain('yuebai: "visual-yuebai"')
    expect(indexCssSource).toContain(":root.visual-yuebai")
    expect(indexCssSource).toContain("--background: #f4f7fc")
    expect(indexCssSource).toContain("--primary: #304a8a")
    expect(indexCssSource).toContain("--accent: #d6e2f7")
    expect(indexCssSource).toContain("--chart-4: #d6a35c")
    expect(indexCssSource).toContain(".visual-yuebai.dark")
    expect(indexCssSource).toContain("--background: #111827")
    expect(indexCssSource).toContain("--primary: #9fb8f2")
    expect(indexCssSource).not.toContain("--background: #dde5f0")
    expect(indexCssSource).not.toContain("--card: #ede5d8")
  })

  it("redesigns classic dark mode as a deep green tool palette without beige menu blocks", () => {
    expect(visualStyleSource).toContain('| "classic"')
    expect(classicDarkBlock).toContain("--background: #10251d")
    expect(classicDarkBlock).toContain("--card: #173426")
    expect(classicDarkBlock).toContain("--popover: #1d3d2f")
    expect(classicDarkBlock).toContain("--primary: #9ad7b7")
    expect(classicDarkBlock).toContain("--accent: #24533f")
    expect(classicDarkBlock).toContain("--accent-foreground: #e7fff2")
    expect(classicDarkBlock).toContain("--sidebar-accent: #24533f")
    expect(classicDarkBlock).not.toContain("--accent: #d9c69a")
    expect(classicDarkBlock).not.toContain("--chart-4: #d9c69a")
  })
})
