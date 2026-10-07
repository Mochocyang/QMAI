// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BookAnalysisWorkbench } from "./book-analysis-workbench"
import type { BatchImportTask } from "@/lib/novel/book-analysis/batch-import-types"
const mocks = vi.hoisted(() => {
  const init = vi.fn(async () => {})
  // 「现在处理」的两个 action 必须真的联动：consumeReopenRequest 要清掉 requestReopenChapterSelection
  // 写下的任务号，否则测试断言不了「请求被消费」。hoisted 阶段还没有 mocks 这个标识符，先用局部对象承载。
  const old: any = {
    selectedLibraryBookId: null, setSelectedLibraryBookId: vi.fn(),
    sidebarRefreshCounter: 0, pendingRecognitionTaskId: null,
  }
  old.requestReopenChapterSelection = vi.fn((taskId: string) => { old.pendingRecognitionTaskId = taskId })
  old.consumeReopenRequest = vi.fn(() => {
    const id = old.pendingRecognitionTaskId
    old.pendingRecognitionTaskId = null
    return id
  })
  return {
    init, old, load: vi.fn(), revisions: vi.fn(async (): Promise<any[]> => []),
    loadStyles: vi.fn(async () => ({ enabledStyleId: null as string | null, styles: [{ id: "style-1", sourceBook: "测试作品", profile: { generatedAt: 1 } }] })),
    setStyle: vi.fn(async () => {}),
    // 工作台现在会读「在不在自定义灵魂库／绑给了谁」并支持两个按钮：
    // 不打桩就会走到真实的 loadCharacterAuraStore（读盘）与 listBindableNovelCharacters。
    loadSoulStatus: vi.fn(async () => "none" as const),
    addToSoul: vi.fn(async () => ({ auraId: "aura-1", auraName: "林烬" })),
    bindCharacters: vi.fn(async () => ({ succeeded: 1, alreadyBound: [] as string[], failed: [] as string[] })),
    listBindable: vi.fn(async () => ["沈微", "裴探"]),
    refreshProject: vi.fn(async () => {}),
    // inspectWorkbenchPublication 会读 aura/文风/框架三个 store（真实 IO），
    // confirmWorkbenchRevision 会按 id 从盘上重读版本：两个都必须打桩。
    inspect: vi.fn(async () => ({ targets: [], impacts: [], fingerprint: "fp-1" })),
    confirmRevision: vi.fn(async () => ({})),
    materialize: vi.fn(async () => ({})),
    // 删除接口由并行的数据层单元实现，组件这边只消费签名：不打桩会走到真实落盘。
    removeRevisionItem: vi.fn(async () => ({})),
    // 自动入库失败要「只报一次错」，所以断言的是 toast 而不是界面文本。
    toastError: vi.fn(), toastSuccess: vi.fn(), toastInfo: vi.fn(),
    // 侧边栏「从分析活动跳过来」的目标。默认为空：绝大多数用例不该被跳转影响。
    // consumeNavigation 照生产语义实现（清空 navigation），否则测不出「跳转只消费一次」。
    activity: {
      navigation: null as null | { bookId: string; projectPath: string; skill: string; taskId: string },
      consumeNavigation: () => { mocks.activity.navigation = null },
    },
    wiki: { project: { id: "p", name: "测试项目", path: "/project" }, providerConfigs: {} },
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
vi.mock("@/lib/novel/book-analysis/workbench-soul-actions", () => ({
  loadCharacterSoulStatus: mocks.loadSoulStatus, addCharacterToSoulLibrary: mocks.addToSoul,
  bindCharacterToNovelCharacters: mocks.bindCharacters,
}))
vi.mock("@/lib/novel/character-aura", () => ({ listBindableNovelCharacters: mocks.listBindable }))
vi.mock("@/lib/project-refresh", () => ({ refreshProjectState: mocks.refreshProject }))
vi.mock("@/lib/novel/book-analysis/workbench-publish", () => ({
  inspectWorkbenchPublication: mocks.inspect, confirmWorkbenchRevision: mocks.confirmRevision,
}))
// 删除走并行的数据层单元（签名已冻结）：组件只负责「确认后调用它 + 刷新列表」。
vi.mock("@/lib/novel/book-analysis/workbench-remove", () => ({
  removeWorkbenchRevisionItem: mocks.removeRevisionItem,
  workbenchStoryFrameworkId: (bookId: string) => `wb-story-${bookId}`,
}))
// toast 是自动入库失败的唯一出口：不换成桩就只能断言界面文本，测不出「只报一次」。
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError, info: mocks.toastInfo } }))
vi.mock("@/stores/book-analysis-activity-store", () => ({
  useBookAnalysisActivityStore: Object.assign((s: any) => s(mocks.activity), { getState: () => mocks.activity }),
}))
// 只替换落盘那一个函数：buildLegacyCharacterRevision 必须是真的，
// 「旧版条目并入」这组用例全部依赖它的真实字段映射。
vi.mock("@/lib/novel/book-analysis/legacy-character-revision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/novel/book-analysis/legacy-character-revision")>()),
  materializeLegacyCharacterRevision: mocks.materialize,
}))
const book = {
  id: "book-1", path: "/project/book-analysis/book-1", metadata: { title: "测试作品", totalChapters: 123, totalWords: 123000 },
  characters: [], skills: [],
}
/**
 * 带旧版资料的作品。旧版区块现在只在真的有资料时才渲染，
 * 所以「旧版结果并进页签」那组正例必须给它数据，否则量到的是一个空壳。
 * 字段要按 BookAnalysisLibraryBook 给全：角色面板会无条件读 addedAuraCharacterIds
 * （book-analysis-character-panel.tsx:61），缺了它会直接抛 undefined.includes。
 */
const legacyBook = {
  ...book,
  // 真实的 metadata 一定带 updatedAt（旧版迁移版本的 createdAt 就取它）；
  // 显式给一个更早的值，让「旧版本在前」的顺序断言不依赖缺字段的偶然行为。
  metadata: { ...book.metadata, updatedAt: 5 },
  recognizedCharacters: [],
  characters: [{
    id: "char-1", name: "林烬", aliases: [], importance: 9, category: "protagonist" as const,
    firstAppearance: 1, lastAppearance: 3, appearanceCount: 3, description: "旧城巡夜人。",
    personality: "克制。", speechStyle: "短句。", relationships: [], keyEvents: [], corpus: "",
  }],
  skills: [],
  styleStatus: "disabled" as const,
  boundAurasCount: 0,
  addedAuraCharacterIds: [],
  evidence: [],
}
/** 角色识别失败时，任务会留在 awaiting-character-selection 并把原因写进 error。 */
function stuckTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "t-1", bookId: "book-1", bookTitle: "测试作品", bookPath: book.path, projectPath: "/project",
    status: "awaiting-character-selection", selectedSkills: ["characters"], workbenchVersion: 2,
    recognizedCharacters: [] as unknown[], error: "HTTP 429: Too Many Requests", createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}
/**
 * 一条带结构化规则的分析结果版本。默认是「尚未入库的新版角色版本」——
 * 正是自动入库要处理的那一类；各用例只覆盖自己关心的字段。
 */
const ruleFixture = {
  id: "R1", dimension: "judgment", condition: "信息不足时", action: "先核对再判断",
  boundary: "不附带职业知识", observation: "先检查材料", evidenceIds: [] as string[],
}
const itemFixture = (subject: string) => ({
  subject, summary: `${subject}的判断倾向`, limitations: "不迁移身份", rules: [{ ...ruleFixture }],
})
const revisionFixture = (overrides: Record<string, unknown> = {}): any => ({
  workbenchVersion: 2, id: "rev-characters", taskId: "t-characters", bookId: "book-1", bookTitle: "测试作品",
  skill: "characters", requirements: "", selectedChapterIds: ["c1"], createdAt: 1, coverage: [], evidence: [],
  items: [itemFixture("许七安")],
  ...overrides,
})
/** 结果区页签，故事导图只在「故事 Skill」页签下渲染。 */
const skillTab = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  .find((t) => t.textContent?.includes(label))!
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); vi.clearAllMocks()
  // clearAllMocks 不还原实现，导图列表要显式复位，否则上个用例的桩会漏进下一个。
  // 复位后必须给一个空数组而不是留 undefined：StoryMapContent 会 for…of 遍历返回值，
  // 返回 undefined 会抛错、被它自己的 catch 吞掉，于是「忘了打桩」会伪装成正常的空状态而不是失败。
  listStoryMapHistory.mockReset()
  listStoryMapHistory.mockResolvedValue([])
  mocks.old.sidebarRefreshCounter = 0
  // 选中作品也要复位：打桩的作品库固定返回一本，所以漏复位不会立刻暴露，
  // 但下一个用例若断言"当前选中"就会变成顺序依赖。
  mocks.old.selectedLibraryBookId = null
  // 未消费的「现在处理」请求也要复位：留着会让下一个用例在挂载时就滚动/消费。
  mocks.old.pendingRecognitionTaskId = null
  mocks.imports.tasks = []
  mocks.revisions.mockResolvedValue([])
  mocks.load.mockResolvedValue({ books: [book] })
  // 绑定候选列表会被单个用例改成空数组，复位免得漏进下一个用例。
  mocks.listBindable.mockResolvedValue(["沈微", "裴探"])
  // 会抛错的桩（自动入库失败、删除失败）用 mockRejectedValueOnce，漏消费就会污染下一个用例。
  mocks.confirmRevision.mockReset()
  mocks.confirmRevision.mockResolvedValue({})
  mocks.removeRevisionItem.mockReset()
  mocks.removeRevisionItem.mockResolvedValue({})
  // 活动跳转默认没有请求：留着会让下一个用例在挂载时切页签并滚动。
  mocks.activity.navigation = null
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
  it("01方案展示真实对象卡片，可切换列表并展开完整依据", async () => {
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
    // 搜索框已随「结果面板简化」删除：两个对象必须都在，且再也没有搜索入口。
    expect(host.querySelector('[aria-label="搜索成果"]')).toBeNull()
    expect(host.querySelectorAll(".wb-skill-card")).toHaveLength(2)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="列表视图"]')!.click())
    expect(host.querySelector(".wb-skill-grid")!.getAttribute("data-view")).toBe("list")
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="查看魏渊规则"]')!.click())
    expect(host.querySelector(".wb-rule-detail")!.textContent).toContain("他先核对了账册。")
    // 整版「确认并加入」入口已删除（改为打开页面自动入库）。
    expect(host.textContent).not.toContain("确认并加入")
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
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    // 角色页签已不再渲染旧版结果区（旧版角色由工作台并入新版条目），
    // 所以这条改在**仍会渲染**旧版结果区的故事页签上验证。
    // legacyBook 上没有 styleProfile，文风页签同样是空的，只有故事页签挂上导图才有东西可量。
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
    await act(async () => skillTab("故事 Skill").click())
    const results = host.querySelector(".wb-results-section")!
    const legacy = host.querySelector('[data-testid="legacy-skill-results"]')!
    expect(legacy).not.toBeNull()
    // 必须在结果区内部
    expect(results.contains(legacy)).toBe(true)
  })

  it("默认停留在角色页签时不再渲染旧版结果区（角色已并入新版条目）", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // 旧版角色数据已由工作台合并进新版条目（含旧版迁移条目）。
    // LegacySkillResults 若在这里再渲染一遍旧版角色面板，同一个页签里就会出现第三份角色列表，
    // 所以 characters 这一支整块返回 null——即使 legacyBook 上确实有旧版角色。
    // 注意：`legacyBook.characters.length > 0` 断的是 fixture 自己，没有信息量，故不再断言；
    // 「文风页签下 null 来自确实没有 styleProfile」那条才是真有信息量的（见下一个用例）。
    expect(host.querySelector('[data-testid="legacy-skill-results"]')).toBeNull()
  })

  it("作品没有旧版资料时，旧版区块整块不渲染", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    // 默认 fixture 的 characters/skills 都是空的，也没有文风画像
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // 角色页签这条现在是「无条件成立」的（characters 直接返回 null），信息量有限，保留做回归。
    expect(host.querySelector('[data-testid="legacy-skill-results"]')).toBeNull()
    // 真正有信息量的是文风页签：那里的 null 来自「确实没有 styleProfile」，不是 characters 的短路。
    await act(async () => (skillTab("文风 Skill") as HTMLButtonElement).click())
    expect(host.querySelector('[data-testid="legacy-skill-results"]')).toBeNull()
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

  it("旧版角色以「旧版资料导入」条目合并进角色页签", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.textContent).toContain("林烬")
    // legacyBook.skills 为空、但角色有 personality 散文 → 无结构化规则
    expect(host.textContent).toContain("旧版资料导入 · 无结构化规则")
  })

  it("角色条目都带「加入自定义灵魂库」与「绑定」两个按钮，整版「确认并加入」入口已删除", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const buttons = Array.from(host.querySelectorAll("button"))
    const labels = buttons.map((b) => b.textContent?.trim())
    expect(labels).toContain("加入自定义灵魂库")
    expect(labels.some((l) => l?.startsWith("绑定"))).toBe(true)
    // 情况 Z 仍有可发布数据，按钮必须可用（绝不能按 rules.length 判断）
    expect(buttons.find((b) => b.textContent?.includes("加入自定义灵魂库"))!.disabled).toBe(false)
    // 这条没有结构化规则的旧版条目：整版入口删掉之后，也不能被自动入库顺带扫进来。
    expect(host.textContent).not.toContain("确认并加入")
    expect(mocks.confirmRevision).not.toHaveBeenCalled()
  })

  it("旧版迁移条目与新分析版本同时平铺，互不顶掉（旧版在前、新结果在后）", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    mocks.revisions.mockResolvedValue([revisionFixture({ id: "rev-characters-new", createdAt: 9, confirmedAt: 10 })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // 以前只渲染 selectedRevisions[0]：迁移条目一旦被前置，用户刚生成的结果就整块消失。
    // 平铺后两版都在，谁也不会顶掉谁。
    expect(host.textContent).toContain("许七安")
    expect(host.textContent).toContain("林烬")
    expect(host.querySelectorAll(".wb-skill-card")).toHaveLength(2)
    // 渲染顺序按 createdAt 升序：旧版迁移（updatedAt=5）在前，新分析（9）在后。
    const ids = [...host.querySelectorAll("[data-revision-id]")].map((el) => el.getAttribute("data-revision-id"))
    expect(ids).toHaveLength(2)
    expect(ids[0]).toMatch(/^legacy-chars-/)
    expect(ids[1]).toBe("rev-characters-new")
  })

  it("既无人格块也无散文字段的角色显示「无可用资料」而不是「未加入灵魂库」", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    // 徽标与按钮必须用同一个 publishable 判定：按钮已经点不动了，
    // 还写「未加入灵魂库」等于叫用户去点一个永远点不动的按钮。
    const bare = {
      ...legacyBook,
      characters: [{ ...legacyBook.characters[0], name: "无名氏", description: "", personality: "", speechStyle: "" }],
    }
    mocks.load.mockResolvedValue({ books: [bare] })
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const badge = host.querySelector('[data-testid="wb-soul-actions-无名氏"] .wb-soul-status')!
    expect(badge.textContent).toBe("无可用资料")
    expect(host.textContent).not.toContain("未加入灵魂库")
    // 徽标说没资料，两个按钮就必须都不可点——文案与可点性不能互相矛盾。
    const actions = host.querySelector('[data-testid="wb-soul-actions-无名氏"]')!
    expect([...actions.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.disabled)).toEqual([true, true])
  })
})

describe("角色绑定对话框", () => {
  /** 卡片上的两个按钮；绑定那个的文案以「绑定」开头，须限定在灵魂操作区内取。 */
  const cardButton = (subject: string, label: string) => {
    const actions = host.querySelector(`[data-testid="wb-soul-actions-${subject}"]`)
    return [...(actions?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((b) => b.textContent?.includes(label))!
  }
  /** 对话框走 portal 渲染到 document.body，不在 host 里。 */
  const dialog = () => document.body.querySelector('[role="dialog"]')
  const dialogButton = (label: string) =>
    [...(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent?.includes(label))!

  beforeEach(() => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
  })

  it("点「绑定…」读取可绑定小说人物并打开对话框", async () => {
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => cardButton("林烬", "绑定…").click())
    expect(mocks.listBindable).toHaveBeenCalledWith("/project")
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain("绑定「林烬」")
    expect(dialog()!.textContent).toContain("沈微")
    expect(dialog()!.textContent).toContain("裴探")
    // 没勾任何人时不能提交。
    expect(dialogButton("绑定所选").disabled).toBe(true)
  })

  it("勾选小说人物后确认，用所选名单调用绑定", async () => {
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => cardButton("林烬", "绑定…").click())
    const box = [...dialog()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.closest("label")!.textContent?.includes("沈微"))!
    await act(async () => box.click())
    await act(async () => dialogButton("绑定所选").click())
    // 只带上勾中的那一个，没勾的裴探不能混进去。
    expect(mocks.bindCharacters).toHaveBeenCalledWith("/project", legacyBook, expect.anything(), "林烬", ["沈微"])
  })

  it("没有可绑定的小说人物时给出提示，且无法提交", async () => {
    mocks.listBindable.mockResolvedValue([])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => cardButton("林烬", "绑定…").click())
    expect(dialog()!.textContent).toContain("请先在大纲中添加人物小传或人物设定，再绑定角色灵魂")
    expect(dialogButton("绑定所选").disabled).toBe(true)
    expect(mocks.bindCharacters).not.toHaveBeenCalled()
  })
})

/**
 * 缺陷 2 的回归网：`.wb-soul-actions` 曾无条件渲染，而卡片组件被三个页签共用。
 * 文风条目必然带规则（style-fingerprint.ts:105 要求至少一条），所以
 * hasPublishableData 会算出 true，点「加入自定义灵魂库」就会把一篇文风建成拆书角色灵魂。
 */
describe("灵魂操作区只属于角色页签", () => {
  const soulActions = (subject: string) => host.querySelector(`[data-testid="wb-soul-actions-${subject}"]`)

  it("文风卡片即使带规则也不渲染灵魂按钮（两个按钮都不出现）", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    mocks.revisions.mockResolvedValue([{
      workbenchVersion: 2, id: "rev-style", skill: "style", bookTitle: "测试作品",
      selectedChapterIds: ["c1"], createdAt: 1, requirements: "", coverage: [], evidence: [],
      items: [{
        subject: "文风", summary: "短段落，少形容词。", limitations: "只覆盖本章",
        rules: [{ id: "S1", dimension: "sentence", condition: "写景时", action: "用短句", boundary: "对话不适用", observation: "原文多为短句", evidenceIds: [] }],
      }],
    }])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => skillTab("文风 Skill").click())
    // 先证明卡片真的渲染了、而且带着规则：否则「没有灵魂按钮」可能只是因为整页是空的。
    expect(host.querySelector(".wb-skill-card")!.textContent).toContain("1条规则")
    expect(host.querySelector(".wb-soul-actions")).toBeNull()
    expect(soulActions("文风")).toBeNull()
    expect(host.textContent).not.toContain("加入自定义灵魂库")
    expect(host.textContent).not.toContain("绑定…")
  })

  it("故事卡片即使带规则也不渲染灵魂按钮（两个按钮都不出现）", async () => {
    // 两个非角色页签都要各自钉住：只钉文风时，把守卫放宽成「非文风即可」
    // 会让故事页签重新露出灵魂按钮而测试依旧全绿（审查者实测 6 文件 101 条全过）。
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    mocks.revisions.mockResolvedValue([{
      workbenchVersion: 2, id: "rev-story", skill: "story", bookTitle: "测试作品",
      selectedChapterIds: ["c1"], createdAt: 1, requirements: "", coverage: [], evidence: [],
      items: [{
        subject: "故事机制", summary: "先压后放。", limitations: "只覆盖本章",
        rules: [{ id: "T1", dimension: "conflict", condition: "冲突升级时", action: "先压后放", boundary: "不适用于支线", observation: "原文先抑后扬", evidenceIds: [] }],
      }],
    }])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => (skillTab("故事 Skill") as HTMLButtonElement).click())
    // 先证明卡片真的渲染了、而且带着规则：否则「没有灵魂按钮」可能只是因为整页是空的。
    expect(host.querySelector(".wb-skill-card")!.textContent).toContain("1条规则")
    expect(host.querySelector(".wb-soul-actions")).toBeNull()
    expect(soulActions("故事机制")).toBeNull()
    expect(host.textContent).not.toContain("加入自定义灵魂库")
    expect(host.textContent).not.toContain("绑定…")
  })

  it("角色页签的新版条目与旧版条目同时平铺，都仍渲染两个按钮", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    mocks.revisions.mockResolvedValue([revisionFixture({ id: "rev-characters-new", createdAt: 9 })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(soulActions("许七安")!.textContent).toContain("加入自定义灵魂库")
    expect(soulActions("许七安")!.textContent).toContain("绑定…")
    // 平铺后旧版迁移条目同时在场（不再需要下拉切换），收口不能把迁移条目一起误伤。
    expect(soulActions("林烬")).not.toBeNull()
    expect(soulActions("林烬")!.textContent).toContain("加入自定义灵魂库")
    expect(soulActions("林烬")!.textContent).toContain("绑定…")
  })
})

describe("选角色列表的角色行", () => {
  it("没有别名的角色不会留下悬空的间隔号", async () => {
    mocks.pipeline.tasks = [stuckTask({
      error: null,
      recognizedCharacters: [
        { id: "c1", name: "许七安", category: "主角", aliases: ["宁宴"], chapterIndices: [0], importanceScore: 90, appearances: 5 },
        { id: "c2", name: "许玲月", category: "配角", aliases: [], chapterIndices: [0], importanceScore: 40, appearances: 2 },
      ],
    })]
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // 只取行里那半个 span（分类 · 别名）。整行 textContent 会把姓名和它粘在一起，
    // 断言起来看不出到底是哪里多了字符。
    const metas = [...host.querySelectorAll(".wb-character-pick label > span")].map((s) => s.textContent)
    // 「配角」后面那个「 · 」没有任何内容跟着，是别名 join 出来的悬空分隔符。
    expect(metas).toEqual(["主角 · 宁宴", "配角"])
  })
})

describe("识别角色失败后不被锁死", () => {
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

describe("旧版刷新副作用由工作台接管", () => {
  beforeEach(() => {
    mocks.old.selectedLibraryBookId = "book-1"
    // 上一组用例会留下任务与识别进度，这里必须自己复位：任务列表直接决定刷新键。
    mocks.pipeline.tasks = []
    mocks.pipeline.progresses = {}
    listStoryMapHistory.mockResolvedValue([{
      dirName: "story-map-100",
      map: {
        schemaVersion: 1, bookId: "book-1", bookTitle: "测试作品", mainLineLabel: "主线A", mainSummary: "", createdAt: 100,
        chapters: [{ id: "ch-1", order: 1, title: "第1章", summary: "摘要", mainEvents: [], branches: [] }],
      },
      jsonPath: "/project/book-analysis/book-1/story-maps/story-map-100/story-map.json",
      htmlPath: "/project/book-analysis/book-1/story-maps/story-map-100/story-map.html",
    }])
  })

  it("侧边栏刷新会重新读取作品库（旧版卸载后这个副作用需要由工作台承担）", async () => {
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const before = mocks.load.mock.calls.length
    // mock 的 store 不会自己通知订阅者，所以改完计数器要再渲染一次，才能观察到依赖变化
    mocks.old.sidebarRefreshCounter = 1
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(mocks.load.mock.calls.length).toBeGreaterThan(before)
  })

  it("故事任务完成后重新读取历史导图（旧版刷新键的副作用迁移到工作台）", async () => {
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => skillTab("故事 Skill").click())
    const before = listStoryMapHistory.mock.calls.length
    // 防止用例假绿：先证明故事页签确实在读历史导图。
    expect(before).toBeGreaterThan(0)
    mocks.pipeline.tasks = [stuckTask({ status: "completed", selectedSkills: ["story"] })]
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(listStoryMapHistory.mock.calls.length).toBeGreaterThan(before)
  })

  it("任务不变时反复渲染不再重复读取历史导图（每个任务只刷新一次）", async () => {
    const storyDone = stuckTask({ id: "s-1", status: "completed", selectedSkills: ["story"] })
    const otherRunning = stuckTask({ id: "c-1", status: "running", selectedSkills: ["characters"] })
    mocks.pipeline.tasks = [storyDone, otherRunning]
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => skillTab("故事 Skill").click())
    const before = listStoryMapHistory.mock.calls.length
    expect(before).toBeGreaterThan(0)
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(listStoryMapHistory.mock.calls.length).toBe(before)
    // 关键一步：让「另一个」任务的状态变化把 signature 改掉，effect 因此会重跑。
    // 已完成的故事任务此时不能再刷新一次——去掉去重守卫这段就会失败，这正是守卫存在的意义。
    mocks.pipeline.tasks = [storyDone, stuckTask({ id: "c-1", status: "completed", selectedSkills: ["characters"] })]
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(listStoryMapHistory.mock.calls.length).toBe(before)
  })
})

describe("侧边栏「现在处理」定位新版选角色区", () => {
  let scrollIntoView: ReturnType<typeof vi.fn>
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined

  beforeEach(() => {
    mocks.old.selectedLibraryBookId = "book-1"
    // 上一组用例会留下任务与识别进度，这里自己复位，避免顺序依赖。
    mocks.pipeline.tasks = []
    mocks.pipeline.progresses = {}
    // jsdom 没实现 scrollIntoView，不打桩的话组件调用时会直接抛 TypeError。
    originalScrollIntoView = Element.prototype.scrollIntoView
    scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView
  })
  afterEach(() => {
    // 不能把桩留给后面的用例：jsdom 原本没有这个方法，就还原成「不存在」。
    if (originalScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it("侧边栏「现在处理」会把新版选角色区滚进视野并消费请求", async () => {
    mocks.pipeline.tasks = [stuckTask({ error: null })]
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => { mocks.old.requestReopenChapterSelection("t-1") })
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.querySelector("#wb-character-picker")).not.toBeNull()
    expect(scrollIntoView).toHaveBeenCalled()
    // 不只是「有人调用过 scrollIntoView」：确认滚的就是选角色区，别的锚点被滚过不算数。
    expect(scrollIntoView.mock.contexts).toContain(host.querySelector("#wb-character-picker"))
    expect(mocks.old.consumeReopenRequest).toHaveBeenCalled()
  })

  it("「现在处理」请求指向还不存在的任务时不吃掉请求（留给任务到达后的那次渲染）", async () => {
    mocks.pipeline.tasks = [stuckTask({ error: null })]
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => { mocks.old.requestReopenChapterSelection("t-missing") })
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // 证明「先判断任务存在、再消费」：顺序反了请求会被吞掉，任务稍后到达也再没人滚动。
    expect(mocks.old.consumeReopenRequest).not.toHaveBeenCalled()
    expect(mocks.old.pendingRecognitionTaskId).toBe("t-missing")
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

describe("结果面板简化：退场的六个元素", () => {
  it("结果版本下拉、搜索成果、仅待确认、汇总行、确认并加入、导出结果都不再渲染", async () => {
    mocks.revisions.mockResolvedValue([revisionFixture({ confirmedAt: 2 })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // 先证明结果区真的渲染了：否则「六个元素都不在」可能只是因为整页是空的。
    expect(host.querySelectorAll(".wb-skill-card")).toHaveLength(1)
    expect(host.querySelector('[aria-label="结果版本"]')).toBeNull()
    expect(host.querySelector("select")).toBeNull()
    expect(host.querySelector('[aria-label="搜索成果"]')).toBeNull()
    expect(host.querySelector(".wb-summary")).toBeNull()
    expect(host.querySelector('[aria-label="导出结果"]')).toBeNull()
    expect(host.textContent).not.toContain("仅待确认")
    expect(host.textContent).not.toContain("确认并加入")
    expect(host.textContent).not.toContain("已加入使用库")
    // 视图切换是保留下来的：不是把整条工具栏都删了。
    expect(host.querySelector('[aria-label="卡片视图"]')).not.toBeNull()
  })

  it("视图切换全结果区只有一份，且统管所有版本块（平铺后不再每块一个开关）", async () => {
    /*
     * 全版本平铺后，若每个版本块各自渲染一份卡片/列表开关，就会变成 N 个互不相干的
     * 开关：在第 5 版点「列表」而第 3 版纹丝不动，看起来像坏了。这里钉住只有一份，
     * 且它切换的是**所有**版本块的网格。
     */
    mocks.revisions.mockResolvedValue([
      revisionFixture({ id: "rev-old", taskId: "t-old", createdAt: 10, confirmedAt: 11 }),
      revisionFixture({ id: "rev-new", taskId: "t-new", createdAt: 20, confirmedAt: 21 }),
    ])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.querySelectorAll('[aria-label="列表视图"]')).toHaveLength(1)
    expect(host.querySelectorAll('[aria-label="卡片视图"]')).toHaveLength(1)
    // 两个版本块都在场，且各自的网格默认是卡片视图。
    expect(host.querySelectorAll(".wb-revision-block")).toHaveLength(2)
    expect(Array.from(host.querySelectorAll(".wb-skill-grid")).map((g) => g.getAttribute("data-view"))).toEqual(["grid", "grid"])

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="列表视图"]')!.click())
    // 一次点击必须同时作用于两个版本块。
    expect(Array.from(host.querySelectorAll(".wb-skill-grid")).map((g) => g.getAttribute("data-view"))).toEqual(["list", "list"])
  })
})

describe("分析结果自动入库", () => {
  it("打开结果页自动把尚未入库的新版版本发布一次", async () => {
    const revision = revisionFixture()
    mocks.revisions.mockResolvedValue([revision])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(mocks.inspect).toHaveBeenCalledWith("/project", revision)
    expect(mocks.confirmRevision).toHaveBeenCalledWith("/project", book.path, "rev-characters", "fp-1", book)
  })

  it("已入库的版本不再自动发布", async () => {
    mocks.revisions.mockResolvedValue([revisionFixture({ confirmedAt: 2 })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(mocks.confirmRevision).not.toHaveBeenCalled()
  })

  it("origin 为 legacy 的版本绝不自动发布（会造成重复角色灵魂）", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // 迁移条目确实在场：否则「没有发布」可能只是因为没有版本可发。
    expect(host.textContent).toContain("林烬")
    // legacy 是懒落盘的，且它会批量导入作品库里的全部旧版角色：
    // 自动发布等于「仅仅打开页面就往磁盘写文件、并批量建灵魂」。
    // （注意：不要用「两套 id 体系会造重复灵魂」当理由 —— 经复验不成立。）
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(mocks.confirmRevision).not.toHaveBeenCalled()
  })

  it("没有结构化规则的版本没有可入库内容，不自动发布", async () => {
    mocks.revisions.mockResolvedValue([revisionFixture({
      id: "rev-empty", items: [{ subject: "许七安", summary: "只有概述", limitations: "", rules: [] }],
    })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(mocks.confirmRevision).not.toHaveBeenCalled()
    expect(host.querySelector('[data-revision-id="rev-empty"]')!.textContent).toContain("尚未入库")
  })

  it("自动发布成功后重新读取版本列表（拿回落盘的 confirmedAt）", async () => {
    mocks.revisions.mockResolvedValue([revisionFixture()])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(mocks.confirmRevision).toHaveBeenCalledTimes(1)
    expect(mocks.revisions.mock.calls.length).toBeGreaterThan(1)
  })

  it("端到端：自动发布成功后，重读回来的 confirmedAt 让徽标从「尚未入库」变成「已入库」", async () => {
    /*
     * 这是整个「分析完自动入库」功能的用户可见结果，必须端到端钉住：
     * 只是断言「revisions 被重读过」或「存在某个徽标」都不够 —— 前者不保证界面跟着变，
     * 后者不保证变的是对的那一版。这里让 mock 第一次返回未入库版本、之后返回已入库版本，
     * 模拟真实落盘→重读的往返。
     */
    const pending = revisionFixture({ id: "rev-auto", taskId: "t-auto" })
    const stored = revisionFixture({ id: "rev-auto", taskId: "t-auto", confirmedAt: 99 })
    let loads = 0
    mocks.revisions.mockImplementation(async () => { loads += 1; return [loads === 1 ? pending : stored] })

    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => {})

    const block = host.querySelector('[data-revision-id="rev-auto"]')!
    // 重读确实发生过（否则下面的绿只是「本来就没渲染过待确认」）。
    expect(loads).toBeGreaterThan(1)
    const badges = Array.from(block.querySelectorAll(".wb-card-status")).map((b) => b.textContent)
    expect(badges.length).toBeGreaterThan(0)
    expect(badges.every((t) => t === "已入库")).toBe(true)
    expect(block.textContent).not.toContain("尚未入库")
  })

  it("自动发布失败只报错一次、不重试、不写确认标记", async () => {
    // 盘上的版本必须每次都以新数组回来（去重只靠 id，不靠引用相等），
    // 并且发布成功后才带上 confirmedAt —— 否则重读不会真的改变 revisions，effect 也就不会重跑，
    // 这条用例会「靠巧合」通过，根本测不到重入守卫。
    const revision = revisionFixture()
    mocks.confirmRevision.mockRejectedValueOnce(new Error("磁盘写入失败"))
    mocks.confirmRevision.mockImplementation(async () => { revision.confirmedAt = 2; return {} })
    mocks.revisions.mockImplementation(async () => [revision])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(mocks.toastError).toHaveBeenCalledWith("磁盘写入失败")
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.confirmRevision).toHaveBeenCalledTimes(1)
    expect(revision.confirmedAt).toBeUndefined()
    // 任务状态变化会重读版本列表（revisions 换成新数组 → effect 重跑）：
    // 少了「每个 id 每次挂载只尝试一次」的守卫，这里会再发一次，并无限刷屏。
    mocks.pipeline.tasks = [stuckTask({ status: "running" })]
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(mocks.revisions.mock.calls.length).toBeGreaterThan(1)
    expect(mocks.confirmRevision).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })
})

describe("全版本平铺", () => {
  const block = (id: string) => host.querySelector(`[data-revision-id="${id}"]`)!

  it("同一技能的全部版本都平铺渲染，旧版本在前、新版本在后", async () => {
    const older = revisionFixture({ id: "rev-old", createdAt: 10, confirmedAt: 11, items: [itemFixture("魏渊")] })
    const newer = revisionFixture({
      id: "rev-new", createdAt: 20, confirmedAt: 21, selectedChapterIds: ["c1", "c2"],
      items: [itemFixture("许七安"), itemFixture("林烬")],
    })
    // 磁盘返回的是降序（最新在前）：渲染顺序必须自己按 createdAt 升序排。
    mocks.revisions.mockResolvedValue([newer, older])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect([...host.querySelectorAll("[data-revision-id]")].map((el) => el.getAttribute("data-revision-id")))
      .toEqual(["rev-old", "rev-new"])
    expect(host.querySelectorAll(".wb-skill-card")).toHaveLength(3)
    // 两个版本同屏，不再需要下拉切换。
    expect(host.querySelector('[aria-label="结果版本"]')).toBeNull()
  })

  it("版本标题行给出时间、章数与对象数，未采纳项追加在标题里", async () => {
    const createdAt = new Date(2026, 9, 6, 22, 17).getTime()
    mocks.revisions.mockResolvedValue([revisionFixture({
      id: "rev-meta", createdAt, confirmedAt: createdAt + 1, selectedChapterIds: ["c1", "c2", "c3"],
      items: [{ ...itemFixture("许七安"), styleFingerprint: {
        // 画像字段必须给全：styleItemEvidenceIds 会直接读 lexicon/scenes，缺了会抛错（不是渲染问题）。
        version: 1, positioning: "", coverage: [], lexicon: [], scenes: [],
        omitted: [
          { kind: "rule", label: "R1 · judgment", reason: "依据不足" },
          { kind: "rule", label: "R2 · judgment", reason: "依据不足" },
        ],
      } }],
    })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(block("rev-meta").textContent).toContain("2026/10/6 22:17 · 3章 · 1个对象 · 2项未采纳")
  })

  it("legacy 版本标「旧版导入」，未入库的新版标「尚未入库」", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    mocks.revisions.mockResolvedValue([revisionFixture({
      id: "rev-pending", createdAt: 9, items: [{ subject: "许七安", summary: "", limitations: "", rules: [] }],
    })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(block("rev-pending").querySelector(".wb-revision-heading")!.textContent)
      .toContain("1章 · 1个对象 · 尚未入库")
    const legacyHeading = host.querySelector('[data-revision-id^="legacy-chars-"] .wb-revision-heading')!
    expect(legacyHeading.textContent).toContain("旧版导入")
    // legacy 照旧平铺显示，但它不是「尚未入库的新版结果」。
    expect(legacyHeading.textContent).not.toContain("尚未入库")
  })
})

describe("对象名后的生成日期", () => {
  it("对象名后显示所属版本的生成日期（M/D HH:mm）", async () => {
    const createdAt = new Date(2026, 9, 7, 9, 3).getTime()
    mocks.revisions.mockResolvedValue([revisionFixture({ createdAt, confirmedAt: createdAt + 1 })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.querySelector(".wb-skill-card h3")!.textContent).toBe("许七安 · 10/7 09:03")
  })

  it("同一个对象在不同版本里各显示自己版本的生成日期", async () => {
    const oldAt = new Date(2026, 9, 6, 22, 17).getTime()
    const newAt = new Date(2026, 9, 7, 9, 3).getTime()
    mocks.revisions.mockResolvedValue([
      revisionFixture({ id: "rev-new", createdAt: newAt, confirmedAt: newAt + 1 }),
      revisionFixture({ id: "rev-old", createdAt: oldAt, confirmedAt: oldAt + 1 }),
    ])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect([...host.querySelectorAll(".wb-skill-card h3")].map((h) => h.textContent))
      .toEqual(["许七安 · 10/6 22:17", "许七安 · 10/7 09:03"])
  })
})

describe("结果条目的删除", () => {
  const block = (id: string) => host.querySelector(`[data-revision-id="${id}"]`)!
  const removeButton = (subject: string) => host.querySelector<HTMLButtonElement>(`[aria-label="删除${subject}"]`)!
  /** 确认框走 portal 渲染到 document.body。 */
  const dialog = () => document.body.querySelector('[role="dialog"]')
  const dialogButton = (label: string) =>
    [...(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent?.trim() === label)!

  it("角色卡片上的删除按钮弹出确认框，写明删的是这个角色的灵魂", async () => {
    mocks.revisions.mockResolvedValue([revisionFixture({ confirmedAt: 2 })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => removeButton("许七安").click())
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain("从角色灵魂库删除「许七安」？")
    expect(dialog()!.textContent).toContain("将删除该角色的灵魂及其规则，并解除它已绑定的小说人物。此操作不可撤销。")
    // 只是打开确认框：不许已经删了才问。
    expect(mocks.removeRevisionItem).not.toHaveBeenCalled()
  })

  it("在确认框里点「取消」：什么都不发生", async () => {
    mocks.revisions.mockResolvedValue([revisionFixture({ confirmedAt: 2 })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => removeButton("许七安").click())
    await act(async () => dialogButton("取消").click())
    expect(mocks.removeRevisionItem).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
    expect(host.querySelectorAll(".wb-skill-card")).toHaveLength(1)
  })

  it("确认删除后调用删除接口，并重新读取版本列表", async () => {
    const revision = revisionFixture({ confirmedAt: 2 })
    mocks.revisions.mockResolvedValue([revision])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const loads = mocks.revisions.mock.calls.length
    await act(async () => removeButton("许七安").click())
    await act(async () => dialogButton("删除").click())
    expect(mocks.removeRevisionItem).toHaveBeenCalledTimes(1)
    const input = mocks.removeRevisionItem.mock.calls[0][0]
    expect(input).toEqual({ projectPath: "/project", bookPath: book.path, revision, subject: "许七安" })
    expect(input.revision).toBe(revision)
    expect(mocks.revisions.mock.calls.length).toBeGreaterThan(loads)
  })

  it("文风页的确认框写明删的是整版文风预设", async () => {
    mocks.revisions.mockResolvedValue([revisionFixture({
      id: "rev-style", skill: "style", confirmedAt: 2,
      items: [{ subject: "文风", summary: "短段落", limitations: "", rules: [{ ...ruleFixture }] }],
    })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => (skillTab("文风 Skill") as HTMLButtonElement).click())
    await act(async () => removeButton("文风").click())
    expect(dialog()!.textContent).toContain("删除文风预设「测试作品 · 文风」？")
    expect(dialog()!.textContent).toContain("将删除该文风预设。此操作不可撤销。")
  })

  it("故事页的确认框写明删的是整版故事框架", async () => {
    mocks.revisions.mockResolvedValue([revisionFixture({
      id: "rev-story", skill: "story", confirmedAt: 2,
      items: [{ subject: "故事机制", summary: "先压后放", limitations: "", rules: [{ ...ruleFixture }] }],
    })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => (skillTab("故事 Skill") as HTMLButtonElement).click())
    await act(async () => removeButton("故事机制").click())
    expect(dialog()!.textContent).toContain("删除故事框架「测试作品 · 故事机制」？")
    expect(dialog()!.textContent).toContain("将删除该故事框架。此操作不可撤销。")
  })

  it("删除失败时报告错误，卡片保留", async () => {
    mocks.removeRevisionItem.mockRejectedValueOnce(new Error("删除失败"))
    mocks.revisions.mockResolvedValue([revisionFixture({ confirmedAt: 2 })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => removeButton("许七安").click())
    await act(async () => dialogButton("删除").click())
    expect(mocks.toastError).toHaveBeenCalledWith("删除失败")
    expect(host.querySelectorAll(".wb-skill-card")).toHaveLength(1)
  })

  it("已删除的对象不再渲染（removedSubjects 过滤）", async () => {
    mocks.revisions.mockResolvedValue([revisionFixture({
      confirmedAt: 2, removedSubjects: ["魏渊"], items: [itemFixture("许七安"), itemFixture("魏渊")],
    })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.querySelectorAll(".wb-skill-card")).toHaveLength(1)
    expect(host.querySelector(".wb-skill-card")!.textContent).toContain("许七安")
    expect(host.textContent).not.toContain("魏渊")
    // 标题行的对象数按实际渲染出来的条目算，删掉的不能再算进去。
    expect(block("rev-characters").textContent).toContain("1个对象")
  })
})

describe("从分析活动跳转定位版本", () => {
  let scrollIntoView: ReturnType<typeof vi.fn>
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined

  beforeEach(() => {
    mocks.old.selectedLibraryBookId = "book-1"
    originalScrollIntoView = Element.prototype.scrollIntoView
    scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView
  })
  afterEach(() => {
    if (originalScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it("跳转时切到对应页签，并把该版本滚进视野（不再有「选中版本」）", async () => {
    mocks.revisions.mockResolvedValue([
      revisionFixture({ id: "rev-new", taskId: "t-new", createdAt: 20, confirmedAt: 21 }),
      revisionFixture({ id: "rev-activity", taskId: "t-activity", createdAt: 10, confirmedAt: 11 }),
    ])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => (skillTab("文风 Skill") as HTMLButtonElement).click())
    // 先证明切换真的生效：目标版本此刻不在 DOM 里。
    expect(host.querySelector('[data-revision-id="rev-activity"]')).toBeNull()
    mocks.activity.navigation = { bookId: "book-1", projectPath: "/project", skill: "characters", taskId: "t-activity" }
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const target = host.querySelector('[data-revision-id="rev-activity"]')
    expect(target).not.toBeNull()
    // 不只是「有人调用过 scrollIntoView」：滚的必须正是那个版本容器。
    expect(scrollIntoView.mock.contexts).toContain(target)
  })

  it("跳转只消费一次：之后版本列表重载不会把视口再拉回那个旧版本", async () => {
    /*
     * 症状（独立审查发现）：nav effect 依赖 revisions，而 navigation 从不被消费，
     * 于是每次 revisions 变化（自动入库后 reload、点一次删除…）都会重新 setScrollTargetId，
     * 把用户正看着的视口硬拉回那个旧版本。跳转必须是一次性事件。
     */
    const initial = [
      revisionFixture({ id: "rev-new", taskId: "t-new", createdAt: 20, confirmedAt: 21 }),
      revisionFixture({ id: "rev-activity", taskId: "t-activity", createdAt: 10, confirmedAt: 11 }),
    ]
    mocks.revisions.mockResolvedValue(initial)
    await act(async () => root.render(<BookAnalysisWorkbench />))
    mocks.activity.navigation = { bookId: "book-1", projectPath: "/project", skill: "characters", taskId: "t-activity" }
    await act(async () => root.render(<BookAnalysisWorkbench />))

    const afterFirstJump = scrollIntoView.mock.calls.length
    expect(afterFirstJump).toBeGreaterThan(0)

    /*
     * 让删除流程触发一次真实的 reloadRevisions（这是用户最常走到的路径：
     * 跳转过来 → 删掉一个对象 → 列表重载）。旧实现会在这次重载后再把视口拉回去。
     */
    mocks.revisions.mockResolvedValue([
      ...initial,
      revisionFixture({ id: "rev-added", taskId: "t-added", createdAt: 30, confirmedAt: 31 }),
    ])
    const removeButton = host.querySelector<HTMLButtonElement>('[aria-label="删除许七安"]')!
      ?? host.querySelector<HTMLButtonElement>(".wb-card-remove")!
    await act(async () => removeButton.click())
    const confirmDelete = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((b) => b.textContent?.trim() === "删除")
    await act(async () => confirmDelete?.click())
    await act(async () => {})

    // 不能因为列表重载就再滚一次。
    expect(scrollIntoView.mock.calls.length).toBe(afterFirstJump)
  })

  it("结果列表是异步读出来的：第一轮为空时不能提前消费掉跳转，否则跳转永久丢失", async () => {
    /*
     * 生产里 revisions 是 useEffect 里异步 loadWorkbenchRevisions 读出来的，
     * 第一轮渲染必然是空数组。若在「还没找到目标版本」时就 consumeNavigation()，
     * 跳转请求会被吃掉，等数据到了也没人再滚 —— 用户从侧边栏点「查看结果」什么都不会发生。
     */
    mocks.revisions.mockResolvedValue([
      revisionFixture({ id: "rev-activity", taskId: "t-activity", createdAt: 10, confirmedAt: 11 }),
    ])
    // 关键：跳转请求在**首帧之前**就已存在，此时组件手里还没有 revisions。
    mocks.activity.navigation = { bookId: "book-1", projectPath: "/project", skill: "characters", taskId: "t-activity" }
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => {})

    const target = host.querySelector('[data-revision-id="rev-activity"]')
    expect(target).not.toBeNull()
    // 数据到达后必须仍然完成那次跳转。
    expect(scrollIntoView.mock.contexts).toContain(target)
  })
})
