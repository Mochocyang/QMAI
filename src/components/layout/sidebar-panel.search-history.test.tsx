import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "sidebar-panel.tsx"), "utf8")

describe("sidebar-panel search history", () => {
  it("shows search history in the second column when search view is active", () => {
    expect(source).toContain('activeView === "search"')
    expect(source).toContain("searchHistory")
    expect(source).toContain("setSearchTrigger")
  })

  it("shows the skill list in the second column when skill library view is active", () => {
    expect(source).toContain('activeView === "skillLibrary"')
    expect(source).toContain("<UnifiedSkillLibrarySidebarPanel")
    expect(source).not.toContain("<SkillLibraryView />")
  })

  it("shows writing skills through the unified skill library second column", () => {
    expect(source).toContain('activeView === "writingSkillLibrary"')
    expect(source).toContain("<UnifiedSkillLibrarySidebarPanel")
    expect(source).not.toContain("<WritingSkillLibraryView />")
  })
})
