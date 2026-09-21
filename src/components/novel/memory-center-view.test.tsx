import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "memory-center-view.tsx"), "utf8")

describe("memory-center-view", () => {
  it("loads memory data from a dedicated loader", () => {
    expect(source).toContain("loadMemoryCenterData")
    expect(source).toContain("useEffect")
  })

  it("renders snapshot and memory sections for novel recall", () => {
    expect(source).toContain("memoryCenter.snapshots.title")
    expect(source).toContain("memoryCenter.sections.characterStates")
    expect(source).toContain("memoryCenter.sections.foreshadowing")
    expect(source).toContain("memoryCenter.sections.timeline")
    expect(source).toContain("memoryCenter.sections.cognition")
    expect(source).toContain("memoryCenter.sections.canonFacts")
    expect(source).toContain("memoryCenter.sections.conflicts")
  })

  it("provides open-file actions for memory pages", () => {
    expect(source).toContain("readFile(file.path)")
    expect(source).toContain("memoryCenter.openFile")
  })

  it("opens snapshot and memory details inside the memory center instead of switching to wiki", () => {
    expect(source).toContain("detailView")
    expect(source).toContain("memoryCenter.closeDetail")
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

  it("reads the selected memory entry from the shared store instead of rendering the overview grid itself", () => {
    expect(source).toContain("selectedMemoryCenterEntry")
    expect(source).not.toContain("MemoryEntryButton")
  })

  it("shows a placeholder until the middle memory list chooses an entry", () => {
    expect(source).toContain("novel.memoryCenter.selectPrompt")
    expect(source).toContain("!selectedMemoryCenterEntry ? (")
  })
})
