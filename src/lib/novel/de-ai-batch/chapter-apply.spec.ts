import { describe, expect, it, vi } from "vitest"
import {
  applyOpenChapterBodyUpdate,
  createDeAiBatchChapterApplier,
} from "./chapter-apply"
import { createChapterExternalUpdateCoordinator } from "@/lib/chapter-external-update-coordinator"

const CURRENT_MARKDOWN = [
  "---",
  "type: chapter",
  "chapter_number: 1",
  "status: draft",
  "custom: keep-me",
  "---",
  "# 第一章 原标题",
  "",
  "编辑器中的旧正文",
].join("\n")

const CANDIDATE = [
  "---",
  "status: malicious",
  "---",
  "# 不应替换原标题",
  "",
  "批量去 AI 味候选正文",
].join("\n")

describe("de-ai batch chapter apply", () => {
  it("未打开章节时保留磁盘 frontmatter 和原标题，只替换正文", async () => {
    const writeFileAtomic = vi.fn<(path: string, content: string) => Promise<void>>(async () => undefined)
    const applier = createDeAiBatchChapterApplier({
      requestOpenUpdate: vi.fn(async () => false),
      readFile: vi.fn(async () => CURRENT_MARKDOWN),
      writeFileAtomic,
    })

    await applier("C:/project/wiki/chapters/第1章.md", CANDIDATE)

    expect(writeFileAtomic).toHaveBeenCalledTimes(1)
    const written = writeFileAtomic.mock.calls[0][1]
    expect(written).toContain("custom: keep-me")
    expect(written).toContain("# 第一章 原标题")
    expect(written).toContain("　　批量去 AI 味候选正文")
    expect(written).not.toContain("status: malicious")
    expect(written).not.toContain("# 不应替换原标题")
  })

  it("当前章节打开时先使旧自动保存失效，再写盘并同步编辑器，旧保存不能覆盖确认结果", async () => {
    let saveGeneration = 7
    const oldSaveGeneration = saveGeneration
    let diskContent = CURRENT_MARKDOWN
    let editorContent = CURRENT_MARKDOWN
    let dataVersion = 0
    const oldAutoSave = () => {
      if (oldSaveGeneration === saveGeneration) diskContent = CURRENT_MARKDOWN
    }

    const applied = await applyOpenChapterBodyUpdate({
      path: "C:/project/wiki/chapters/第1章.md",
      candidateContent: CANDIDATE,
      currentOpenPath: () => "C:/project/wiki/chapters/第1章.md",
      currentMarkdown: () => editorContent,
      invalidatePendingSave: () => { saveGeneration += 1 },
      runExternalUpdate: async (_path, write) => { await write(); return 1 },
      markEditorSession: vi.fn(),
      writeFileAtomic: async (_path, content) => { diskContent = content },
      commitEditor: (content) => { editorContent = content },
      bumpDataVersion: () => { dataVersion += 1 },
    })
    oldAutoSave()

    expect(applied).toBe(true)
    expect(saveGeneration).toBe(8)
    expect(editorContent).toBe(diskContent)
    expect(diskContent).toContain("custom: keep-me")
    expect(diskContent).toContain("# 第一章 原标题")
    expect(diskContent).toContain("　　批量去 AI 味候选正文")
    expect(diskContent).not.toContain("编辑器中的旧正文")
    expect(dataVersion).toBe(1)
  })

  it("目标不是当前打开章节时不改变编辑器", async () => {
    const writeFileAtomic = vi.fn()
    const commitEditor = vi.fn()

    await expect(applyOpenChapterBodyUpdate({
      path: "C:/project/wiki/chapters/第2章.md",
      candidateContent: CANDIDATE,
      currentOpenPath: () => "C:/project/wiki/chapters/第1章.md",
      currentMarkdown: () => CURRENT_MARKDOWN,
      invalidatePendingSave: vi.fn(),
      runExternalUpdate: async (_path, write) => { await write(); return 1 },
      markEditorSession: vi.fn(),
      writeFileAtomic,
      commitEditor,
      bumpDataVersion: vi.fn(),
    })).resolves.toBe(false)

    expect(writeFileAtomic).not.toHaveBeenCalled()
    expect(commitEditor).not.toHaveBeenCalled()
  })
  it("写 A 期间切换到 B 时只完成 A 磁盘写入，不提交到 B 编辑器", async () => {
    let openPath = "C:/project/wiki/chapters/第1章.md"
    let saveGeneration = 11
    const oldSaveGeneration = saveGeneration
    let diskA = CURRENT_MARKDOWN
    let diskB = "B 编辑器正文"
    let releaseWrite!: () => void
    let markWriteStarted!: () => void
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve })
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const commitEditor = vi.fn((content: string) => { diskB = content })
    const bumpDataVersion = vi.fn()
    const oldAutoSaveA = () => {
      if (oldSaveGeneration === saveGeneration) diskA = CURRENT_MARKDOWN
    }

    const applying = applyOpenChapterBodyUpdate({
      path: "C:/project/wiki/chapters/第1章.md",
      candidateContent: CANDIDATE,
      currentOpenPath: () => openPath,
      currentMarkdown: () => CURRENT_MARKDOWN,
      invalidatePendingSave: () => { saveGeneration += 1 },
      runExternalUpdate: async (_path, write) => { await write(); return 1 },
      markEditorSession: vi.fn(),
      writeFileAtomic: async (_path, content) => {
        markWriteStarted()
        await writeGate
        diskA = content
      },
      commitEditor,
      bumpDataVersion,
    })

    await writeStarted
    openPath = "C:/project/wiki/chapters/第2章.md"
    releaseWrite()
    await expect(applying).resolves.toBe(true)
    oldAutoSaveA()

    expect(diskA).toContain("　　批量去 AI 味候选正文")
    expect(diskB).toBe("B 编辑器正文")
    expect(commitEditor).not.toHaveBeenCalled()
    expect(bumpDataVersion).toHaveBeenCalledTimes(1)
    expect(saveGeneration).toBe(12)
  })

  it("确认 A 写盘等待期间切 B 并触发 flush-before-leave 时，旧 A flush 不得覆盖候选", async () => {
    const pathA = "C:/project/wiki/chapters/第1章.md"
    const pathB = "C:/project/wiki/chapters/第2章.md"
    const coordinator = createChapterExternalUpdateCoordinator()
    coordinator.markEditorSession(pathA)
    let openPath = pathA
    let diskA = CURRENT_MARKDOWN
    let editorB = "B 编辑器正文"
    let releaseExternalWrite!: () => void
    let markExternalWriteStarted!: () => void
    const externalWriteStarted = new Promise<void>((resolve) => { markExternalWriteStarted = resolve })
    const externalWriteGate = new Promise<void>((resolve) => { releaseExternalWrite = resolve })
    const flushWrite = vi.fn(async () => { diskA = CURRENT_MARKDOWN })
    const commitEditor = vi.fn((content: string) => { editorB = content })

    const applying = applyOpenChapterBodyUpdate({
      path: pathA,
      candidateContent: CANDIDATE,
      currentOpenPath: () => openPath,
      currentMarkdown: () => CURRENT_MARKDOWN,
      invalidatePendingSave: vi.fn(),
      runExternalUpdate: coordinator.runExternalUpdate,
      writeFileAtomic: async (_path, content) => {
        markExternalWriteStarted()
        await externalWriteGate
        diskA = content
      },
      markEditorSession: coordinator.markEditorSession,
      commitEditor,
      bumpDataVersion: vi.fn(),
    })

    await externalWriteStarted
    openPath = pathB
    const flushing = coordinator.flushBeforeLeave(pathA, flushWrite)
    releaseExternalWrite()
    await Promise.all([applying, flushing])

    expect(diskA).toContain("　　批量去 AI 味候选正文")
    expect(flushWrite).not.toHaveBeenCalled()
    expect(editorB).toBe("B 编辑器正文")
    expect(commitEditor).not.toHaveBeenCalled()
  })

  it("没有外部更新时正常未保存编辑仍会执行 flush-before-leave", async () => {
    const pathA = "C:/project/wiki/chapters/第1章.md"
    const coordinator = createChapterExternalUpdateCoordinator()
    coordinator.markEditorSession(pathA)
    const flushWrite = vi.fn(async () => undefined)

    await expect(coordinator.flushBeforeLeave(pathA, flushWrite)).resolves.toBe(true)

    expect(flushWrite).toHaveBeenCalledTimes(1)
  })
})
