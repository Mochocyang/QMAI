import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "sidebar-panel.tsx"), "utf8")

describe("sidebar-panel memory center", () => {
  it("renders a memory-center list in the middle column for novel lint view", () => {
    expect(source).toContain('const novelMode = useWikiStore((s) => s.novelMode)')
    expect(source).toContain('activeView === "lint" && novelMode')
    expect(source).toContain("loadMemoryCenterData")
    expect(source).toContain("setSelectedMemoryCenterEntry")
    expect(source).toContain("novel.memoryCenter.title")
  })

  it("does not keep the chapter tree active while memory center is open", () => {
    expect(source).toContain("MemoryCenterListButton")
    expect(source).not.toContain('activeView === "lint" ? "chapter" : "outline"')
  })
})
