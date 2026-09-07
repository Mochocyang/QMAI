import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "content-area.tsx"), "utf8")

describe("content-area search performance", () => {
  it("renders search in the main content area without reviving the old overlay state", () => {
    expect(source).not.toContain("searchPanelOpen")
    expect(source).toContain('const showWritingWorkspace = activeView === "wiki" || activeView === "trash"')
    expect(source).toContain("<WritingWorkspace />")
    expect(source).toContain('case "search"')
    expect(source).toContain("<SearchView />")
  })

  it("renders skill library detail in the main content area", () => {
    expect(source).toContain('const showWritingWorkspace = activeView === "wiki" || activeView === "trash"')
    expect(source).toContain('case "skillLibrary"')
    expect(source).toContain("<UnifiedSkillLibraryView")
  })

  it("keeps the writing skill route as a compatibility tab inside the unified skill library", () => {
    expect(source).toContain('case "writingSkillLibrary"')
    expect(source).toContain("<UnifiedSkillLibraryView")
  })
})
