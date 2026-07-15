import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "preview-panel.tsx"), "utf8")

describe("preview-panel final chapter save state", () => {
  it("scopes saved state by projectPath and filePath", () => {
    expect(source).toContain("finalChapterSave.projectPath === project?.path")
    expect(source).toContain("finalChapterSave.filePath === selectedFile")
  })

  it("writes final chapter save progress through the shared store", () => {
    expect(source).toContain("setFinalChapterSave")
    expect(source).toContain("projectPath,")
    expect(source).toContain("filePath:")
  })

  it("uses phase codes instead of translated labels for final save progress", () => {
    expect(source).toContain("phase: FinalChapterSavePhase")
    expect(source).toContain("phaseLabelMap")
  })

  it("flushes chapter filenames before leaving a chapter", () => {
    expect(source).toContain("flushChapterBeforeLeave")
    expect(source).toContain("previousFile !== selectedFile")
    expect(source).toContain("syncChapterToCanonicalPath")
  })

  it("supports selected-text transform previews", () => {
    expect(source).toContain("TextTransformPreviewDialog")
    expect(source).toContain("handleSelectionAction")
    expect(source).toContain("replaceChapterBodySelection")
  })

  it("shows the actual skill used by de-AI actions", () => {
    expect(source).toContain("chapterDeAiSkillName")
    expect(source).toContain("selectionTransformSkillName")
    expect(source).toContain("当前去AI味 Skill")
    expect(source).toContain("本次使用 Skill")
  })

  it("keeps the chapter de-AI toolbar button label short while preserving the skill picker state", () => {
    expect(source).toContain("chapterDeAiOptions.effectiveName")
    expect(source).toContain('const chapterDeAiButtonLabel = currentChapterDeAiProcessing ? "处理中" : "去AI味"')
    expect(source).not.toContain("`去AI味：${chapterDeAiSkillName}`")
    expect(source).toContain("currentSkillId={chapterDeAiOptions.currentSkillId}")
    expect(source).toContain("defaultSkillId={chapterDeAiOptions.defaultSkillId}")
  })

  it("does not expose the cognition panel from the chapter toolbar", () => {
    expect(source).not.toContain("setShowCognition(true)")
    expect(source).not.toContain('t("preview.cognitionTitle")')
  })

  it("persists the last picked chapter de-AI skill in the project skill config", () => {
    expect(source).toContain("setLastChapterDeAiSkill")
    expect(source).toContain("saveDeAiSkillConfig(project.path")
  })

  it("uses the shared de-AI skill option loader for chapter skill state", () => {
    expect(source).toContain("useDeAiSkillOptions")
    expect(source).toContain("useLastChapterSkill: true")
  })

  it("keeps chapter de-AI processing clear when remembering the picked skill fails", () => {
    expect(source).toContain("未能记住本次去AI味 Skill 选择，本次处理仍会继续")
    expect(source).not.toContain("setSaveStatus(\"保存章节去AI味 Skill 选择失败\")")
  })

  it("resets the remembered chapter de-AI skill when switching projects", () => {
    expect(source).toContain("setChapterDeAiSkillId(undefined)")
    expect(source).toContain("}, [project?.path])")
  })

  it("reports remember-skill failures without replacing de-AI processing state", () => {
    expect(source).toContain('toast.error("未能记住本次去AI味 Skill 选择，本次处理仍会继续")')
    expect(source).not.toContain("deAiSkillMemoryWarning")
    expect(source).not.toContain("setDeAiSkillMemoryWarning")
  })

  it("closes the chapter de-AI skill picker when clicking outside it", () => {
    expect(source).toContain("deAiSkillPickerRef")
    expect(source).toContain("handleDeAiSkillPickerMouseDown")
    expect(source).toContain('document.addEventListener("mousedown", handleDeAiSkillPickerMouseDown)')
    expect(source).toContain('document.removeEventListener("mousedown", handleDeAiSkillPickerMouseDown)')
  })

  it("anchors the chapter de-AI skill picker near the clicked toolbar button", () => {
    expect(source).toContain("deAiSkillPickerPosition")
    expect(source).toContain("getDeAiSkillPickerPosition")
    expect(source).toContain("openDeAiSkillPicker(null, e.currentTarget)")
    expect(source).not.toContain('className="fixed right-6 top-20')
  })

  it("uses a local draft for chapter title editing", () => {
    expect(source).toContain("chapterTitleDraft")
    expect(source).toContain("chapterTitleEditing")
    expect(source).toContain("commitChapterTitleDraft")
    expect(source).toContain("e.currentTarget.blur()")
    expect(source).toContain("e.stopPropagation()")
  })

  it("measures chapter title width for header metadata layout", () => {
    expect(source).toContain("titleMeasureRef")
    expect(source).toContain("chapterTitleWidthPx")
    expect(source).toContain("chapterStatusMeta")
    expect(source).toContain("chapterWordCountMeta")
    expect(source).toContain('chapterHeader.status === "final"')
  })

  it("lets the chapter toolbar span the preview header so actions stay right aligned", () => {
    expect(source).toContain('ref={chapterToolbarRef} className="flex min-w-0 flex-1 items-center gap-2"')
    expect(source).toContain('className="relative ml-auto flex shrink-0 items-center justify-end gap-1"')
  })

  it("keeps the draft badge lightweight in the chapter header", () => {
    expect(source).toContain('chapterHeader.status === "draft"')
    expect(source).toContain("rounded-full border border-border/70 bg-muted/60")
  })

  it("falls back to the filename when the chapter heading is missing", () => {
    expect(source).toContain("chapterDisplayTitle")
    expect(source).toContain("getChapterTitleFromPath")
  })

  it("does not render total chapter word count in the header", () => {
    expect(source).not.toContain("chapterTotalWordCountMeta")
    expect(source).not.toContain("buildChapterTotalWordCountLabel")
    expect(source).not.toContain("totalChapterWords")
  })

  it("does not render the archived-draft action anymore", () => {
    expect(source).not.toContain("canArchiveDraft")
    expect(source).not.toContain("handleArchiveDraft")
    expect(source).not.toContain('t("novel.chapter.archiveDraft")')
  })

  it("does not apply a saved draft tree after the active project changes", () => {
    expect(source).toContain("const draftProjectId = project.id")
    expect(source).toContain("useWikiStore.getState().project?.id === draftProjectId")
  })

  it("does not mount a newly selected markdown file before it loads", () => {
    expect(source).toContain("loadedFilePath")
    expect(source).toContain("loadedFilePath !== selectedFile")
    expect(source).toContain("setLoadedFilePath(selectedFile)")
  })

  it("skips redundant chapter flushes when markdown is unchanged", () => {
    expect(source).toContain("shouldSyncChapterOnLeave")
    expect(source).toContain("if (!shouldSyncChapterOnLeave(path, markdown, lastLoadedForPath)) return")
  })

  it("persists outline ingest progress through the shared outline task flow", () => {
    expect(source).toContain("startOutlineIngestTask")
    expect(source).toContain("currentOutlineTask")
    expect(source).toContain('task.status === "ingesting" || task.status === "done" || task.status === "error"')
  })

  it("strips frontmatter from trash markdown previews", () => {
    expect(source).toContain('const trashPreviewBody = category === "markdown"')
    expect(source).toContain("? parseFrontmatter(fileContent).body")
    expect(source).toContain("<WikiReader body={trashPreviewBody} />")
  })
})
