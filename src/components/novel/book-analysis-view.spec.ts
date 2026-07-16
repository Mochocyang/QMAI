// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const candidates = [
    { sourcePath: "C:/小说/长夜.txt", fileName: "长夜.txt", fileSize: 1024 },
    { sourcePath: "D:/小说/归途.txt", fileName: "归途.txt", fileSize: 2048 },
  ]
  const libraryState = {
    books: [{
      id: "book-1",
      path: "E:/项目甲/book-analysis/book-1",
      metadata: {
        title: "长夜",
        totalChapters: 2,
        totalWords: 3200,
        sourceType: "file" as const,
        createdAt: 1,
        updatedAt: 2,
      },
      recognizedCharacters: [],
      characters: [],
      skills: [],
      styleStatus: "missing" as const,
      boundAurasCount: 0,
      addedAuraCharacterIds: [],
    }, {
      id: "book-2", path: "E:/项目甲/book-analysis/book-2",
      metadata: { title: "归途", totalChapters: 3, totalWords: 4800, sourceType: "file" as const, createdAt: 3, updatedAt: 4 },
      recognizedCharacters: [], characters: [], skills: [], styleStatus: "missing" as const,
      boundAurasCount: 0, addedAuraCharacterIds: [],
    }],
    enabledStyle: null,
    bindings: [],
  }

  const initializeProject = vi.fn()
  const createBatch = vi.fn()
  const continueTask = vi.fn()
  const regenerateTask = vi.fn()
  const cancelImportTask = vi.fn()
  const cancelAllQueued = vi.fn()
  const deleteFailedTask = vi.fn()
  const renameCompletedTask = vi.fn()
  const dispose = vi.fn()
  const setPanelCollapsed = vi.fn()
  const triggerSidebarRefresh = vi.fn()
  const setSelectedLibraryBookId = vi.fn()
  const setCurrentResult = vi.fn()
  const setShowResultViewer = vi.fn()
  const clearRecognition = vi.fn()
  const reloadLibraryState = vi.fn()
  const handleLibraryExtractStyle = vi.fn()
  const handleLibraryReextractCharacters = vi.fn()
  const loadBookStoryFrameworkChapters = vi.fn()

  return {
    candidates,
    libraryState,
    wikiState: {
      project: { id: "project-a", name: "项目甲", path: "E:/项目甲" } as { id: string; name: string; path: string } | null,
      llmConfig: {},
      novelConfig: { defaultLlmModel: "" },
      aiChatModel: "",
      providerConfigs: [],
    },
    oldState: {
      selectedLibraryBookId: null as string | null,
      sidebarRefreshCounter: 0,
      pendingRecognitionTaskId: null as string | null,
      startTask: vi.fn(),
      cancelTask: vi.fn(),
      tasks: [],
      currentResult: null,
      showResultViewer: false,
      setShowResultViewer,
      recognitionStatus: "idle",
      recognizedCharacters: [],
      selectedCharacterIds: [],
      setRecognitionStatus: vi.fn(),
      setRecognizedCharacters: vi.fn(),
      setSelectedCharacterIds: vi.fn(),
      clearRecognition,
      recognitionError: undefined,
      setRecognitionError: vi.fn(),
      consumeReopenRequest: vi.fn(),
      triggerSidebarRefresh,
      setSelectedLibraryBookId,
      setCurrentResult,
    },
    importState: {
      projectPath: "E:/项目甲" as string | null,
      batches: [],
      tasks: [],
      panelCollapsed: false,
      revision: 0,
      initializeProject,
      createBatch,
      continueTask,
      regenerateTask,
      cancelTask: cancelImportTask,
      cancelAllQueued,
      deleteFailedTask,
      renameCompletedTask,
      setPanelCollapsed,
      dispose,
    },
    initializeProject,
    createBatch,
    continueTask,
    regenerateTask,
    cancelImportTask,
    cancelAllQueued,
    deleteFailedTask,
    renameCompletedTask,
    dispose,
    setPanelCollapsed,
    triggerSidebarRefresh,
    setSelectedLibraryBookId,
    setCurrentResult,
    setShowResultViewer,
    clearRecognition,
    reloadLibraryState,
    handleLibraryExtractStyle,
    handleLibraryReextractCharacters,
    loadBookStoryFrameworkChapters,
    libraryParams: null as any,
    inputDialogProps: null as any,
    taskPanelProps: null as any,
    layoutProps: null as any,
    chapterPanelProps: null as any,
  }
})

vi.mock("@/stores/wiki-store", () => {
  const useWikiStore = Object.assign(
    (selector: (state: typeof mocks.wikiState) => unknown) => selector(mocks.wikiState),
    { getState: () => mocks.wikiState },
  )
  return { useWikiStore }
})

vi.mock("@/stores/book-analysis-store", () => {
  const useBookAnalysisStore = Object.assign(
    (selector: (state: typeof mocks.oldState) => unknown) => selector(mocks.oldState),
    { getState: () => mocks.oldState },
  )
  return { useBookAnalysisStore }
})

vi.mock("@/stores/book-analysis-import-store", () => {
  const useBookAnalysisImportStore = Object.assign(
    (selector: (state: typeof mocks.importState) => unknown) => selector(mocks.importState),
    { getState: () => mocks.importState },
  )
  return { useBookAnalysisImportStore }
})

vi.mock("./hooks/use-library-operations", () => ({
  useLibraryOperations: (params: any) => {
    mocks.libraryParams = params
    return {
      styleExtracting: false,
      addingToSoul: false,
      reloadLibraryState: mocks.reloadLibraryState,
      handleLibraryExtractStyle: mocks.handleLibraryExtractStyle,
      handleLibraryToggleStyle: vi.fn(),
      handleLibraryAddSkillsToSoul: vi.fn(),
      handleLibraryDeleteBook: vi.fn(),
      handleLibraryReextractCharacters: mocks.handleLibraryReextractCharacters,
    }
  },
}))

vi.mock("./hooks/use-character-recognition", () => ({
  useCharacterRecognition: () => ({
    handleChapterSelectionConfirm: vi.fn(),
    handleToggleCharacter: vi.fn(),
    handleSelectAllMain: vi.fn(),
    handleClearSelection: vi.fn(),
  }),
}))

vi.mock("./hooks/use-character-extraction", () => ({
  useCharacterExtraction: () => ({
    handleDeepExtract: vi.fn(),
    handleSimpleExtract: vi.fn(),
    handleResumeFailedExtraction: vi.fn(),
  }),
}))

vi.mock("./book-analysis-input-dialog", async () => {
  const React = await import("react")
  return {
    BookAnalysisInputDialog: (props: any) => {
      mocks.inputDialogProps = props
      return React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "提交批量导入",
          onClick: () => void props.onSubmit(mocks.candidates),
        },
        "提交批量导入",
      )
    },
  }
})

vi.mock("./book-analysis-import-task-panel", async () => {
  const React = await import("react")
  return {
    BookAnalysisImportTaskPanel: (props: any) => {
      mocks.taskPanelProps = props
      return React.createElement("div", { "data-testid": "批量任务面板" },
        React.createElement("button", { type: "button", onClick: () => props.onCollapsedChange(true) }, "收起任务"),
        React.createElement("button", { type: "button", onClick: () => props.onContinue("task-continue") }, "继续任务"),
        React.createElement("button", { type: "button", onClick: () => props.onRegenerate("task-regenerate") }, "重新生成任务"),
        React.createElement("button", { type: "button", onClick: () => props.onCancel("task-cancel") }, "取消任务"),
        React.createElement("button", { type: "button", onClick: () => props.onCancelAllQueued("batch-1") }, "取消批次等待"),
        React.createElement("button", { type: "button", onClick: () => props.onDeleteFailed("task-failed") }, "删除失败任务"),
        React.createElement("button", { type: "button", onClick: () => props.onRenameCompleted("task-completed", "新名字") }, "重命名完成任务"),
        React.createElement("button", { type: "button", onClick: () => props.onOpenBook("book-1") }, "打开导入作品"),
      )
    },
  }
})

vi.mock("./book-analysis-library-layout", async () => {
  const React = await import("react")
  return {
    BookAnalysisLibraryLayout: (props: any) => {
      mocks.layoutProps = props
      return React.createElement("section", { "data-testid": "拆书库布局" },
        props.importTaskPanel,
        React.createElement("button", { type: "button", onClick: props.onImportNovel }, "打开导入弹窗"),
        React.createElement("button", { type: "button", onClick: () => props.onSelectCharacter("character-1") }, "选择角色"),
        React.createElement("button", { type: "button", onClick: () => props.onSelectBook("book-2") }, "选择普通作品B"),
        React.createElement("button", { type: "button", onClick: props.onReextractCharacters }, "旧角色入口"),
        React.createElement("button", { type: "button", onClick: props.onExtractStyle }, "旧文风入口"),
        React.createElement("button", { type: "button", onClick: props.onExtractStoryFramework }, "旧框架入口"),
      )
    },
  }
})

vi.mock("./chapter-selection-panel", async () => {
  const React = await import("react")
  return {
    ChapterSelectionPanel: (props: any) => {
      mocks.chapterPanelProps = props
      return React.createElement("div", { "data-testid": "章节选择面板" }, "章节选择面板")
    },
  }
})

vi.mock("./book-analysis-result-viewer", async () => {
  const React = await import("react")
  return {
    BookAnalysisResultViewer: (props: any) => React.createElement("div", { "data-testid": "历史结果查看器" },
      "历史结果查看器",
      React.createElement("button", { type: "button", onClick: props.onClose }, "关闭历史结果"),
    ),
  }
})

vi.mock("./outline-editor", () => ({ OutlineCreatorDialog: () => null }))

vi.mock("@/lib/novel/model-resolver", () => ({ resolveDefaultModel: () => ({}) }))

vi.mock("@/lib/novel/book-analysis/story-framework-extraction", () => ({
  loadBookStoryFrameworkChapters: mocks.loadBookStoryFrameworkChapters,
  buildBookStoryFrameworkPrompt: vi.fn(),
  buildPlotFrameworkDraftFromBookStoryOutput: vi.fn(),
}))

vi.mock("@/lib/novel/plot-framework-library", () => ({
  loadPlotFrameworkLibrary: vi.fn().mockResolvedValue({ frameworks: [] }),
  upsertPlotFramework: vi.fn(),
}))

vi.mock("@/lib/llm-client", () => ({ streamChat: vi.fn() }))
vi.mock("@/lib/has-usable-llm", () => ({ hasUsableLlm: () => true }))
vi.mock("@/lib/toast", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

import { BookAnalysisView } from "./book-analysis-view"

type ActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const actGlobal = globalThis as ActGlobal
const originalActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT
function restoreActEnvironment() {
  if (originalActEnvironment === undefined) delete actGlobal.IS_REACT_ACT_ENVIRONMENT
  else actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
}

let host: HTMLDivElement
let root: Root
let mounted = false

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function renderView() {
  await act(async () => {
    root.render(createElement(BookAnalysisView))
    await Promise.resolve()
  })
  mounted = true
  await flushEffects()
}

async function rerenderView() {
  await act(async () => {
    root.render(createElement(BookAnalysisView))
    await Promise.resolve()
  })
  await flushEffects()
}

async function clickButton(label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)
  if (!button) throw new Error(`未找到按钮：${label}`)
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })
  await flushEffects()
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = false

  mocks.wikiState.project = { id: "project-a", name: "项目甲", path: "E:/项目甲" }
  mocks.oldState.selectedLibraryBookId = null
  mocks.oldState.sidebarRefreshCounter = 0
  mocks.oldState.pendingRecognitionTaskId = null
  mocks.oldState.tasks = []
  mocks.oldState.currentResult = null
  mocks.oldState.showResultViewer = false
  mocks.importState.projectPath = "E:/项目甲"
  mocks.importState.batches = []
  mocks.importState.tasks = []
  mocks.importState.panelCollapsed = false
  mocks.importState.revision = 0
  mocks.libraryParams = null
  mocks.inputDialogProps = null
  mocks.taskPanelProps = null
  mocks.layoutProps = null
  mocks.chapterPanelProps = null

  mocks.initializeProject.mockReset().mockResolvedValue(undefined)
  mocks.createBatch.mockReset().mockResolvedValue(undefined)
  mocks.continueTask.mockReset().mockResolvedValue(undefined)
  mocks.regenerateTask.mockReset().mockResolvedValue(undefined)
  mocks.cancelImportTask.mockReset().mockResolvedValue(undefined)
  mocks.cancelAllQueued.mockReset().mockResolvedValue(undefined)
  mocks.deleteFailedTask.mockReset().mockResolvedValue(undefined)
  mocks.renameCompletedTask.mockReset().mockResolvedValue(undefined)
  mocks.dispose.mockReset().mockResolvedValue(undefined)
  mocks.setPanelCollapsed.mockReset()
  mocks.triggerSidebarRefresh.mockReset().mockImplementation(() => { mocks.oldState.sidebarRefreshCounter += 1 })
  mocks.setSelectedLibraryBookId.mockReset().mockImplementation((id: string | null) => { mocks.oldState.selectedLibraryBookId = id })
  mocks.setCurrentResult.mockReset()
  mocks.setShowResultViewer.mockReset()
  mocks.clearRecognition.mockReset()
  mocks.handleLibraryExtractStyle.mockReset()
  mocks.handleLibraryReextractCharacters.mockReset()
  mocks.loadBookStoryFrameworkChapters.mockReset().mockResolvedValue([
    { id: "chapter-1", title: "第一章", order: 1, content: "正文" },
  ])
  mocks.reloadLibraryState.mockReset().mockImplementation(async () => {
    mocks.libraryParams.setLibraryState(mocks.libraryState)
    mocks.libraryParams.setSelectedBookId((current: string | null) => current && mocks.libraryState.books.some((book) => book.id === current) ? current : "book-1")
  })
})

afterEach(async () => {
  if (mounted) {
    await act(async () => {
      root.unmount()
      await Promise.resolve()
    })
  }
  host.remove()
  vi.clearAllMocks()
})

afterAll(() => restoreActEnvironment())

describe("BookAnalysisView 批量导入运行时接线", () => {
  it("挂载和项目切换时初始化对应项目，并在切换和卸载时异步释放", async () => {
    await renderView()
    expect(mocks.initializeProject).toHaveBeenCalledWith("E:/项目甲")

    mocks.wikiState.project = { id: "project-b", name: "项目乙", path: "F:/项目乙" }
    await rerenderView()

    expect(mocks.dispose).toHaveBeenCalledTimes(1)
    expect(mocks.initializeProject).toHaveBeenLastCalledWith("F:/项目乙")

    await act(async () => {
      root.unmount()
      await Promise.resolve()
    })
    mounted = false
    expect(mocks.dispose).toHaveBeenCalledTimes(2)
  })

  it("弹窗通过同名批量入口原样提交完整候选列表，并在成功后关闭", async () => {
    await renderView()
    await clickButton("打开导入弹窗")
    expect(mocks.inputDialogProps.open).toBe(true)
    expect(mocks.inputDialogProps.onSubmit.name).toBe("handleStartAnalysis")

    await clickButton("提交批量导入")

    expect(mocks.createBatch).toHaveBeenCalledTimes(1)
    expect(mocks.createBatch.mock.calls[0][0]).toBe(mocks.candidates)
    expect(mocks.inputDialogProps.open).toBe(false)
  })

  it("A 旧初始化在 A→B→A 后完成时不能清除新 A 初始化身份", async () => {
    let finishOldA!: () => void
    let finishNewA!: () => void
    mocks.initializeProject
      .mockReset()
      .mockImplementationOnce((path: string) => { mocks.importState.projectPath = path; return new Promise<void>((resolve) => { finishOldA = resolve }) })
      .mockImplementationOnce((path: string) => { mocks.importState.projectPath = path; return Promise.resolve() })
      .mockImplementationOnce((path: string) => { mocks.importState.projectPath = path; return new Promise<void>((resolve) => { finishNewA = resolve }) })

    await renderView()
    mocks.wikiState.project = { id: "project-b", name: "项目乙", path: "F:/项目乙" }
    await rerenderView()
    mocks.wikiState.project = { id: "project-a-2", name: "项目甲新会话", path: "E:/项目甲" }
    await rerenderView()
    mocks.triggerSidebarRefresh.mockClear()

    finishOldA()
    await flushEffects()
    mocks.importState.revision = 1
    await rerenderView()
    expect(mocks.triggerSidebarRefresh).not.toHaveBeenCalled()

    finishNewA()
    await flushEffects()
    mocks.importState.revision = 2
    await rerenderView()
    expect(mocks.triggerSidebarRefresh).toHaveBeenCalledTimes(1)
  })
  it("revision 按项目建基线且同项目只通过侧栏链 reload 一次", async () => {
    await renderView(); mocks.reloadLibraryState.mockClear(); mocks.triggerSidebarRefresh.mockClear()
    mocks.wikiState.project = { id: "project-b", name: "项目乙", path: "F:/项目乙" }
    mocks.importState.revision = 5
    await rerenderView()
    expect(mocks.triggerSidebarRefresh).not.toHaveBeenCalled()
    mocks.reloadLibraryState.mockClear()
    mocks.importState.revision = 6
    await rerenderView()
    expect(mocks.triggerSidebarRefresh).toHaveBeenCalledTimes(1)
    await rerenderView()
    expect(mocks.reloadLibraryState).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-testid="章节选择面板"]')).toBeNull()
  })

  it("createBatch 失败时弹窗保持打开", async () => {
    mocks.createBatch.mockRejectedValue(new Error("磁盘不可用")); await renderView(); await clickButton("打开导入弹窗")
    try { await mocks.inputDialogProps.onSubmit(mocks.candidates) } catch {}
    expect(mocks.inputDialogProps.open).toBe(true)
  })

  it("任务面板把每个动作的任务或批次 ID 传给批量 Store", async () => {
    await renderView()

    await clickButton("收起任务")
    await clickButton("继续任务")
    await clickButton("重新生成任务")
    await clickButton("取消任务")
    await clickButton("取消批次等待")
    await clickButton("删除失败任务")
    await clickButton("重命名完成任务")

    expect(mocks.setPanelCollapsed).toHaveBeenCalledWith(true)
    expect(mocks.continueTask).toHaveBeenCalledWith("task-continue")
    expect(mocks.regenerateTask).toHaveBeenCalledWith("task-regenerate")
    expect(mocks.cancelImportTask).toHaveBeenCalledWith("task-cancel")
    expect(mocks.cancelAllQueued).toHaveBeenCalledWith("batch-1")
    expect(mocks.deleteFailedTask).toHaveBeenCalledWith("task-failed")
    expect(mocks.renameCompletedTask).toHaveBeenCalledWith("task-completed", "新名字")
  })

  it("打开 A 后普通选择 B 不回跳并同步状态", async () => {
    await renderView()
    await clickButton("打开导入作品")
    await clickButton("选择角色")
    await clickButton("选择普通作品B")
    await rerenderView()
    expect(mocks.layoutProps.selectedBookId).toBe("book-2")
    expect(mocks.oldState.selectedLibraryBookId).toBe("book-2")
    expect(mocks.setCurrentResult).toHaveBeenLastCalledWith(expect.objectContaining({ bookId: "book-2" }))
    expect(mocks.layoutProps.selectedCharacterId).toBeNull()
    expect(mocks.clearRecognition).toHaveBeenCalledTimes(2)
  })

  it("旧角色、文风、框架和历史结果入口仍可触发", async () => {
    mocks.oldState.showResultViewer = true
    await renderView()

    await clickButton("旧角色入口")
    await clickButton("旧文风入口")
    await clickButton("旧框架入口")

    expect(mocks.handleLibraryReextractCharacters).toHaveBeenCalledTimes(1)
    expect(mocks.handleLibraryExtractStyle).toHaveBeenCalledTimes(1)
    expect(mocks.loadBookStoryFrameworkChapters).toHaveBeenCalledWith(mocks.libraryState.books[0].path)
    expect(host.querySelector('[data-testid="章节选择面板"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="历史结果查看器"]')).not.toBeNull()

    await clickButton("关闭历史结果")
    expect(mocks.setShowResultViewer).toHaveBeenCalledWith(false)
  })
})
