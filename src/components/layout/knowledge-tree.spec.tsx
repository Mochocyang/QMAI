import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "knowledge-tree.tsx"), "utf8")
const previewSource = readFileSync(resolve(__dirname, "preview-panel.tsx"), "utf8")

describe("KnowledgeTree chapter memory extraction menu", () => {
  it("places one-click all chapter memory extraction in the chapter right-click menu", () => {
    expect(source).toContain("handleExtractAllChapterMemories")
    expect(source).toContain("一键提取所有章节")
    expect(source).toContain('filterType === "chapter" && pageMenu')
    expect(source).toContain("sortedChapterPages.map((page) => page.path)")
    expect(source).toContain('kind: "chapter"')
    expect(source).toContain("allowDraft: true")
    expect(source).toContain("useImportProgressStore.getState().startTask")
    expect(previewSource).not.toContain("一键提取所有章节")
  })
})
