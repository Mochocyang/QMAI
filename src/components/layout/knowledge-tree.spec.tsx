import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "knowledge-tree.tsx"), "utf8")
const previewSource = readFileSync(resolve(__dirname, "preview-panel.tsx"), "utf8")

describe("KnowledgeTree chapter memory extraction menu", () => {
  it("positions the chapter directory once its async file tree is rendered", () => {
    expect(source).toContain("scrollChapterDirectory(container, selectedChapterPath)")
    expect(source).toContain('filterType !== "chapter" || !project || sectionNodes.length === 0')
    expect(source).toContain("isChapterPathInProject(selectedFile, projectPath)")
    expect(source).toContain("previousScroll.selectedChapterPath !== null || selectedChapterPath === null")
  })

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

  it("dispatches deleted chapter memory cleanup without awaiting it", () => {
    expect(source).toContain("enqueueDeletedChapterSourceMemoryCleanup")
    expect(source).toContain('void import("@/lib/novel/delete-source-memory")')
    expect(source).not.toContain("await cleanupDeletedSourceMemory")
    expect(source).toContain("await cleanupDeletedOutlineSourceMemory")
  })

  it("removes deleted chapter rows optimistically without showing chapter loading", () => {
    expect(source).toContain("setPages((previous) => previous.filter((page) => page.path !== pagePath))")
    expect(source).toContain('const showDeleteLoading = filterType === "outline" && isDeleting')
    expect(source).toContain("mapWithConcurrency(files, PAGE_METADATA_CONCURRENCY")
    expect(source).toContain('listDirectory(`${projectPath}/wiki/chapters`)')
    expect(source).toContain('listDirectory(`${projectPath}/wiki/outlines`)')
  })
})
