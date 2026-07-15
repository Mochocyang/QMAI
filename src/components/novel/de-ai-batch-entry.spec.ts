import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const appLayout = readFileSync("src/components/layout/app-layout.tsx", "utf8")
const previewPanel = readFileSync("src/components/layout/preview-panel.tsx", "utf8")
const batchWorkspace = readFileSync("src/components/novel/de-ai-batch-workspace.tsx", "utf8")
const wikiStore = readFileSync("src/stores/wiki-store.ts", "utf8")
const novelSection = readFileSync("src/components/settings/sections/novel-section.tsx", "utf8")

describe("de-ai batch entry and settings", () => {
  it("uses the chapter task queue without restoring the retired floating batch workspace", () => {
    expect(appLayout).not.toContain("<DeAiBatchWorkspace")
    expect(previewPanel).toContain("<DeAiBatchReviewDialog")
    expect(previewPanel).toContain("runWholeChapterDeAi")
    expect(previewPanel).toContain("registerEditorExternalUpdateHandler")
    expect(previewPanel).toContain("createDeAiBatchChapterApplier")
    expect(previewPanel).toContain("await applyDeAiBatchChapter(task.chapterPath, task.candidateContent)")
    expect(previewPanel).toContain("saveDeAiDraftWithoutOverwrite")
    expect(previewPanel).toContain("writeFileIfAbsent")
    expect(previewPanel).toContain("deAiDraftSaving")
    expect(previewPanel).toContain("chapterExternalUpdateCoordinator.flushBeforeLeave(path")
    expect(batchWorkspace).toContain("resolveDeAiBatchModelKey")
    expect(batchWorkspace).not.toContain("`${llmConfig.provider}/${llmConfig.model}`")
    expect(batchWorkspace).toContain("}, [novelConfig.deAiBatchConcurrency])") // CONCURRENCY_EFFECT_MARKER
    expect(batchWorkspace).toContain("startingRef.current")
    expect(batchWorkspace).toContain("runWorkspaceAction")
    expect(batchWorkspace).toContain("createLatestValueSaveQueue")
    expect(batchWorkspace).not.toContain('runWorkspaceAction("config:concurrency"')
    expect(batchWorkspace).toContain("pendingTaskIds.has(reviewTaskId)")
    expect(batchWorkspace).toContain("操作失败")
    expect(batchWorkspace).not.toMatch(/void useDeAiBatchStore\.getState\(\)\.(?:continueTask|cancelTask|confirmChapter|regenerateChapter|cancelChapter)/)
  })

  it("keeps review tasks project-scoped and reuses the selected skill when regenerating", () => {
    expect(previewPanel).toContain("selectProjectDeAiTasks(deAiTasks, project?.path)")
    expect(previewPanel).toContain("skillContent,")
    expect(previewPanel).toContain("buildDeAiRewriteMessages(task.sourceContent, task.skillContent)")
  })

  it("小说设置包含默认 3、范围 1–5 的批量并发设置", () => {
    expect(wikiStore).toContain("deAiBatchConcurrency: 3")
    expect(novelSection).toContain('min={1}')
    expect(novelSection).toContain('max={5}')
    expect(novelSection).toContain("deAiBatchConcurrency")
  })
})


