import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "sidebar-panel.tsx"), "utf8")

describe("SidebarPanel skill library routing", () => {
  it("uses the unified sidebar for both skill library views", () => {
    expect(source).toContain("UnifiedSkillLibrarySidebarPanel")
    expect(source).toContain('activeView === "skillLibrary" || activeView === "writingSkillLibrary"')
    expect(source).toContain("<UnifiedSkillLibrarySidebarPanel />")
    expect(source).not.toContain("<SkillLibrarySidebarPanel />")
  })
})
