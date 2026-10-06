// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BookAnalysisWorkbench } from "./book-analysis-workbench"
import type { BatchImportTask } from "@/lib/novel/book-analysis/batch-import-types"
const mocks = vi.hoisted(() => {
  const init = vi.fn(async () => {})
  return {
    init, load: vi.fn(), revisions: vi.fn(async (): Promise<any[]> => []),
    loadStyles: vi.fn(async () => ({ enabledStyleId: null as string | null, styles: [{ id: "style-1", sourceBook: "测试作品", profile: { generatedAt: 1 } }] })),
    setStyle: vi.fn(async () => {}),
    wiki: { project: { id: "p", name: "测试项目", path: "/project" }, providerConfigs: {} },
    old: { selectedLibraryBookId: null, setSelectedLibraryBookId: vi.fn() },
    imports: { tasks: [] as BatchImportTask[], batches: [], revision: 0, initializeProject: init, createBatch: vi.fn(), deletePublishedBook: vi.fn(), deleteRecord: vi.fn(async () => {}) },
    pipeline: { tasks: [], chunks: [], progresses: {}, initializeProject: init, recognizeWorkbenchCharacters: vi.fn(async () => {}), confirmCharacterSelection: vi.fn(async () => {}), startTask: vi.fn(async () => {}) },
  }
})
vi.mock("@/stores/wiki-store", () => ({ useWikiStore: Object.assign((s: any) => s(mocks.wiki), { getState: () => mocks.wiki }) }))
vi.mock("@/stores/book-analysis-store", () => ({ useBookAnalysisStore: Object.assign((s: any) => s(mocks.old), { getState: () => mocks.old }) }))
vi.mock("@/stores/book-analysis-import-store", () => ({ useBookAnalysisImportStore: Object.assign(() => mocks.imports, { getState: () => mocks.imports }) }))
vi.mock("@/stores/book-analysis-pipeline-store", () => ({ useBookAnalysisPipelineStore: Object.assign(() => mocks.pipeline, { getState: () => mocks.pipeline }) }))
vi.mock("@/lib/novel/book-analysis/library-state", () => ({ loadBookAnalysisLibraryState: mocks.load }))
vi.mock("@/lib/novel/book-analysis/workbench-storage", () => ({ loadWorkbenchRevisions: mocks.revisions }))
vi.mock("@/lib/novel/book-analysis/analysis-engine", () => ({ loadChapterList: async () => Array.from({ length: 123 }, (_, i) => ({ chapterId: `c${i + 1}`, order: i + 1, title: `第${i + 1}章`, wordCount: 1000 })) }))
vi.mock("@/components/chat/chat-model-selector", () => ({ ChatModelSelector: () => <button>默认模型</button> }))
vi.mock("@/lib/novel/book-analysis/analysis-model-resolver", () => ({ resolveTaskLlmConfig: () => ({ model: "测试模型" }) }))
vi.mock("@/lib/novel/writing-style-store", () => ({ loadWritingStyleStore: mocks.loadStyles, setEnabledWritingStyle: mocks.setStyle }))
vi.mock("./book-analysis-input-dialog", () => ({ BookAnalysisInputDialog: ({ open, workbenchMode }: any) => open ? <div role="dialog">{workbenchMode ? "单页导入" : "旧版导入"}</div> : null }))
vi.mock("./book-analysis-usage-summary", () => ({ BookAnalysisUsageSummary: () => null }))
// StoryMapContent 会调用 listStoryMapHistory 读盘，故事页签的用例要看到「故事导图历史列表」就必须打桩。
// 它内部对每张导图的 readFile 有自己的 .catch(() => null)，jsdom 下失败只会让 html 为空，不影响列表渲染。
const listStoryMapHistory = vi.hoisted(() => vi.fn())
vi.mock("@/lib/novel/book-analysis/story-map-history", () => ({ listStoryMapHistory }))
const book = {
  id: "book-1", path: "/project/book-analysis/book-1", metadata: { title: "测试作品", totalChapters: 123, totalWords: 123000 },
  characters: [], skills: [],
}
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); vi.clearAllMocks()
  // clearAllMocks 不还原实现，导图列表要显式复位，否则上个用例的桩会漏进下一个。
  listStoryMapHistory.mockReset()
  mocks.imports.tasks = []
  mocks.revisions.mockResolvedValue([])
  mocks.load.mockResolvedValue({ books: [book] })
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
describe("单页拆书工作台", () => {
  it("模型区只保留下拉选择框，不重复显示内部模型键", async () => {
    localStorage.setItem(`qmai-book-workbench:${book.path}`, JSON.stringify({
      selectedIds: ["c1"], skills: ["characters"], requirements: {}, modelKey: "custom-private-provider/gemini-selected",
    }))
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.querySelector(".wb-model")!.textContent).not.toContain("custom-private-provider")
    expect(host.querySelectorAll(".wb-model button")).toHaveLength(1)
  })
  it("导入终态记录确认后删除，不删除作品；运行中的记录不可删除", async () => {
    mocks.imports.tasks = [
      { id: "cancelled-1", originalFileName: "重复作品.txt", status: "cancelled", completed: 0, total: 0, createdAt: 1 },
      { id: "running-1", originalFileName: "新作品.txt", status: "splitting", completed: 0, total: 0, createdAt: 1 },
    ] as BatchImportTask[]
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const button = host.querySelector<HTMLButtonElement>('[aria-label="删除重复作品.txt导入记录"]')!
    expect(button).not.toBeNull()
    expect(host.querySelector('[aria-label="删除新作品.txt导入记录"]')).toBeNull()
    await act(async () => button.click())
    expect(mocks.imports.deleteRecord).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await act(async () => button.click())
    expect(mocks.imports.deleteRecord).toHaveBeenCalledWith("cancelled-1")
    expect(mocks.imports.deletePublishedBook).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
  it("01方案只显示当前需求编辑区，三类勾选和输入各自保留", async () => {
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const visibleRequests = () => host.querySelectorAll(".wb-demand-editor .wb-request:not([hidden])")
    expect(visibleRequests()).toHaveLength(1)
    const characterInput = host.querySelector<HTMLTextAreaElement>('[aria-label="角色 Skill需求"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(characterInput, "只提炼判断倾向，不继承职业")
      characterInput.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const checks = host.querySelectorAll<HTMLInputElement>(".wb-skill-options input")
    await act(async () => checks[1].click())
    await act(async () => checks[2].click())
    expect(host.querySelectorAll(".wb-skill-options input:checked")).toHaveLength(3)
    expect(visibleRequests()).toHaveLength(1)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑角色 Skill需求"]')!.click())
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="角色 Skill需求"]')!.value).toBe("只提炼判断倾向，不继承职业")
    expect(JSON.parse(localStorage.getItem(`qmai-book-workbench:${book.path}`)!).skills).toHaveLength(3)
  })
  it("01方案展示真实对象卡片，可搜索、切换列表并展开完整依据", async () => {
    const longSummary = "人物会先核对事实，但在压力下也会犹豫。".repeat(15)
    mocks.revisions.mockResolvedValue([{
      workbenchVersion: 2, id: "rev-characters", skill: "characters", bookTitle: "测试作品",
      selectedChapterIds: ["c1"], createdAt: 1, requirements: "只分析处事方式", coverage: [],
      evidence: [{ id: "E1", order: 1, start: 0, end: 8, text: "他先核对了账册。" }],
      items: ["许七安", "魏渊"].map((subject) => ({
        subject, summary: subject === "许七安" ? longSummary : `${subject}的判断倾向`, limitations: "不迁移身份",
        rules: [{ id: "R1", dimension: "judgment", condition: "信息不足时", action: "先核对再判断",
          boundary: "不附带职业知识", observation: "先检查材料", evidenceIds: ["E1"] }],
      })),
    }])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.querySelectorAll(".wb-skill-card")).toHaveLength(2)
    expect(host.querySelector(".wb-rule-detail")).toBeNull()
    expect(host.querySelector(".wb-card-description")!.textContent).toBe(longSummary)
    const overview = host.querySelector<HTMLButtonElement>('[aria-label="展开许七安概述"]')!
    expect(overview).not.toBeNull()
    await act(async () => overview.click())
    expect(host.querySelector(".wb-card-description")!.getAttribute("data-expanded")).toBe("true")
    const search = host.querySelector<HTMLInputElement>('[aria-label="搜索成果"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "魏渊")
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(host.querySelectorAll(".wb-skill-card")).toHaveLength(1)
    expect(host.querySelector(".wb-skill-card")!.textContent).toContain("魏渊")
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="列表视图"]')!.click())
    expect(host.querySelector(".wb-skill-grid")!.getAttribute("data-view")).toBe("list")
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="查看魏渊规则"]')!.click())
    expect(host.querySelector(".wb-rule-detail")!.textContent).toContain("他先核对了账册。")
    expect(host.textContent).toContain("确认并加入")
  })
  it("文风入库不自动启用，提供显式启用入口", async () => {
    mocks.revisions.mockResolvedValue([{
      workbenchVersion: 2, id: "rev-style", skill: "style", bookTitle: "测试作品", selectedChapterIds: ["c1"], createdAt: 1,
      confirmedAt: 2, publishedIds: ["style-1"], items: [{ subject: "文风", summary: "短段落", limitations: "局限", rules: [] }], evidence: [], coverage: [],
    }])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => ([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === "文风 Skill")!).click())
    expect(mocks.setStyle).not.toHaveBeenCalled()
    const enable = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("启用此文风"))
    expect(enable).toBeTruthy()
    await act(async () => enable!.click())
    expect(mocks.setStyle).toHaveBeenCalledWith("/project", "style-1")
  })
  it("取消侧栏和重复标题，显示页内设置并初始化后台服务", async () => {
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.querySelectorAll("h1")).toHaveLength(1)
    expect(host.querySelector("aside")).toBeNull()
    expect(host.textContent).toContain("123章")
    expect(host.textContent).toContain("分析设置")
    expect(host.querySelector('[aria-label="角色 Skill需求"]')).not.toBeNull()
    expect(mocks.init).toHaveBeenCalledWith("/project")
    const checkboxes = host.querySelectorAll<HTMLInputElement>(".wb-skill-options input")
    await act(async () => { checkboxes[1].click() })
    await act(async () => { checkboxes[2].click() })
    expect(host.querySelector('[aria-label="故事 Skill需求"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="文风 Skill需求"]')).not.toBeNull()
  })
  it("空库和导入是同一页，不强制分析", async () => {
    mocks.load.mockResolvedValue({ books: [] })
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.textContent).toContain("暂无作品")
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "导入作品")!
    await act(async () => button.click())
    expect(host.querySelector('[role="dialog"]')?.textContent).toBe("单页导入")
    expect(mocks.imports.createBatch).not.toHaveBeenCalled()
  })
})

describe("拆书库顶部操作区", () => {
  beforeEach(() => {
    mocks.imports.deletePublishedBook = vi.fn(async () => {})
    mocks.old.selectedLibraryBookId = null
  })

  it("刷新作品放在「导入作品」左侧，不再有「更多」菜单和「旧版任务与结果」入口", async () => {
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const refresh = host.querySelector<HTMLButtonElement>('[aria-label="刷新作品"]')
    expect(refresh).not.toBeNull()
    expect(host.querySelector(".wb-management")).toBeNull()
    expect(host.querySelector('[aria-label="旧版任务与结果"]')).toBeNull()
    const importButton = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "导入作品")!
    // 刷新必须排在「导入作品」之前，即占据它左侧那个位置。
    expect(refresh!.compareDocumentPosition(importButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("点击刷新作品会重新读取作品库", async () => {
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const before = mocks.load.mock.calls.length
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新作品"]')!.click())
    expect(mocks.load.mock.calls.length).toBeGreaterThan(before)
  })

  it("作品下拉框每一项都能删除该项作品", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="选择作品"]')!.click())
    const remove = host.querySelector<HTMLButtonElement>('[aria-label="删除作品《测试作品》"]')
    expect(remove).not.toBeNull()
    await act(async () => remove!.click())
    expect(mocks.imports.deletePublishedBook).toHaveBeenCalledWith("book-1")
  })

  it("顶部已选作品处能删除当前作品，取消确认则不删", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="删除当前作品"]')!.click())
    expect(mocks.imports.deletePublishedBook).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="删除当前作品"]')!.click())
    expect(mocks.imports.deletePublishedBook).toHaveBeenCalledWith("book-1")
  })

  it("删除当前选中作品后清空选中态，避免界面仍指向已删除作品", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    mocks.old.selectedLibraryBookId = "book-1"
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="删除当前作品"]')!.click())
    expect(mocks.old.setSelectedLibraryBookId).toHaveBeenCalledWith(null)
  })
})

describe("分析模型贴近开始分析", () => {
  it("不再显示「分析模型」字样，选择框紧邻「开始分析」", async () => {
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const toolbar = host.querySelector(".wb-demand-toolbar")!
    expect(toolbar.textContent).not.toContain("分析模型")
    const model = toolbar.querySelector(".wb-model")!
    expect(model.nextElementSibling).toBe(toolbar.querySelector(".wb-primary"))
  })
})

describe("旧版结果并入页签", () => {
  it("旧版结果出现在结果区内部，不再是页面底部独立区块", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const results = host.querySelector(".wb-results-section")!
    const legacy = host.querySelector('[data-testid="legacy-skill-results"]')!
    expect(legacy).not.toBeNull()
    // 必须在结果区内部
    expect(results.contains(legacy)).toBe(true)
  })

  it("默认停留在角色页签时渲染角色类旧版结果", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.textContent).toContain("旧版资料")
    // 只查整页文案太弱：页面里任意一处「旧版资料」都能满足它。必须把「谁在渲染、渲染了什么」钉死——
    // 「旧版资料」得是并入区域自己的标签，区域里得真的挂着旧版角色面板（本 fixture 没有角色，走它的空状态）。
    const legacy = host.querySelector('[data-testid="legacy-skill-results"]')!
    expect(legacy).not.toBeNull()
    expect(legacy.textContent).toContain("旧版资料")
    expect(legacy.textContent).toContain("暂无角色数据。")
  })

  it("切到故事页签会换成故事类旧版结果", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    listStoryMapHistory.mockResolvedValue([{
      dirName: "story-map-100",
      map: {
        schemaVersion: 1, bookId: "book-1", bookTitle: "测试作品", mainLineLabel: "主线A", mainSummary: "", createdAt: 100,
        chapters: [{ id: "ch-1", order: 1, title: "第1章", summary: "摘要", mainEvents: [], branches: [] }],
      },
      jsonPath: "/project/book-analysis/book-1/story-maps/story-map-100/story-map.json",
      htmlPath: "/project/book-analysis/book-1/story-maps/story-map-100/story-map.html",
    }])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // 角色页签下不该有故事导图列表，先钉住切换前后的差异
    expect(host.querySelector('[aria-label="故事导图历史列表"]')).toBeNull()
    const storyTab = Array.from(host.querySelectorAll('[role="tab"]'))
      .find((t) => t.textContent?.includes("故事 Skill"))!
    await act(async () => (storyTab as HTMLButtonElement).click())
    expect(host.querySelector('[aria-label="故事导图历史列表"]')).not.toBeNull()
  })

  it("不再接受 legacy prop，也不再渲染「旧版结果」区块标题", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.querySelector(".wb-legacy")).toBeNull()
  })
})

describe("识别角色失败后不被锁死", () => {
  /** 角色识别失败时，任务会留在 awaiting-character-selection 并把原因写进 error。 */
  function stuckTask(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "t-1", bookId: "book-1", bookTitle: "测试作品", bookPath: book.path, projectPath: "/project",
      status: "awaiting-character-selection", selectedSkills: ["characters"], workbenchVersion: 2,
      recognizedCharacters: [] as unknown[], error: "HTTP 429: Too Many Requests", createdAt: 1, updatedAt: 1,
      ...overrides,
    }
  }
  const startButton = () => [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((b) => b.textContent?.includes("开始分析"))!

  beforeEach(() => { mocks.pipeline.progresses = {} })

  it("识别失败后「开始分析」重新可点（卡住的任务不能一直锁死按钮）", async () => {
    mocks.pipeline.tasks = [stuckTask()]
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(startButton().disabled).toBe(false)
  })

  it("识别失败时在角色选择处给出「重试」按钮，点击重新识别", async () => {
    mocks.pipeline.tasks = [stuckTask()]
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const retry = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent?.trim() === "重试")
    expect(retry).not.toBeNull()
    await act(async () => retry!.click())
    expect(mocks.pipeline.recognizeWorkbenchCharacters).toHaveBeenCalledWith("t-1")
  })

  it("回归保护：已有待选角色时仍不重复开始分析", async () => {
    mocks.pipeline.tasks = [stuckTask({
      error: null,
      recognizedCharacters: [{ id: "c1", name: "许七安", category: "主角", aliases: [], chapterIndices: [0], importanceScore: 1, appearances: 1 }],
    })]
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(startButton().disabled).toBe(true)
  })

  it("回归保护：正在识别角色时也不重复开始分析", async () => {
    mocks.pipeline.tasks = [stuckTask({ error: null })]
    mocks.pipeline.progresses = { "t-1:characters:recognition": { stageLabel: "识别角色 1/2", percentage: 50 } }
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(startButton().disabled).toBe(true)
  })

  it("回归保护：真正的排队与运行中仍然锁住按钮", async () => {
    mocks.pipeline.tasks = [stuckTask({ status: "running", error: null })]
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(startButton().disabled).toBe(true)
  })
})
