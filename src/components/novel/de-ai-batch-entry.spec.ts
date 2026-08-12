import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const appLayout = readFileSync("src/components/layout/app-layout.tsx", "utf8")
const previewPanel = readFileSync("src/components/layout/preview-panel.tsx", "utf8")
const wikiStore = readFileSync("src/stores/wiki-store.ts", "utf8")
const novelSection = readFileSync("src/components/settings/sections/novel-section.tsx", "utf8")

describe("de-ai batch entry and settings", () => {
  it("uses the chapter task queue without restoring the retired floating batch workspace", () => {
    expect(appLayout).not.toContain("<DeAiBatchWorkspace")
    expect(previewPanel).toContain("<DeAiBatchReviewDialog")
    expect(previewPanel).toContain("runWholeChapterDeAi")
    expect(previewPanel).toContain("registerEditorExternalUpdateHandler")
    expect(previewPanel).toContain("createDeAiBatchChapterApplier")
    expect(previewPanel).toContain("await applyDeAiBatchChapter(task.chapterPath, body)")
    expect(previewPanel).toContain("updateTask(chapterId, { candidateContent: body })")
    expect(previewPanel).toContain("useDeAiTaskStore.getState().closeReview(project.path)")
    expect(previewPanel).toContain("saveDeAiDraftWithoutOverwrite")
    expect(previewPanel).toContain("writeFileIfAbsent")
    expect(previewPanel).toContain("deAiDraftSaving")
    expect(previewPanel).toContain("chapterExternalUpdateCoordinator.flushBeforeLeave(path")
  })

  it("keeps review tasks project-scoped and reuses the selected skill when regenerating", () => {
    expect(previewPanel).toContain("selectProjectDeAiTasks(deAiTasks, project?.path)")
    expect(previewPanel).toContain("skillContent,")
    expect(previewPanel).toContain("extractDeAiChapterText(task.sourceContent)")
    expect(previewPanel).toContain("buildDeAiRewriteMessages(source, task.skillContent)")
  })

  it("小说设置包含默认 3、范围 1–5 的批量并发设置，并接到章节去 AI 味队列", () => {
    expect(wikiStore).toContain("deAiBatchConcurrency: 3")
    expect(novelSection).toContain("min={1}")
    expect(novelSection).toContain("max={5}")
    expect(novelSection).toContain("deAiBatchConcurrency")
    expect(previewPanel).toContain("acquireDeAiChapterSlot")
  })
})
