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
    expect(legacyBook.characters.length).toBeGreaterThan(0)
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

  it("角色条目都带「加入自定义灵魂库」与「绑定」两个按钮", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const buttons = Array.from(host.querySelectorAll("button"))
    const labels = buttons.map((b) => b.textContent?.trim())
    expect(labels).toContain("加入自定义灵魂库")
    expect(labels.some((l) => l?.startsWith("绑定"))).toBe(true)
    // 情况 Z 仍有可发布数据，按钮必须可用（绝不能按 rules.length 判断）
    expect(buttons.find((b) => b.textContent?.includes("加入自定义灵魂库"))!.disabled).toBe(false)
    // 「确认并加入」也不能因为没有规则就被禁掉
    expect(buttons.find((b) => b.textContent?.includes("确认并加入"))!.disabled).toBe(false)
  })

  it("旧版迁移条目排在磁盘版本之后，不顶掉用户最新生成的结果", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    mocks.revisions.mockResolvedValue([{
      workbenchVersion: 2, id: "rev-characters-new", skill: "characters", bookTitle: "测试作品",
      selectedChapterIds: ["c1"], createdAt: 9, requirements: "", coverage: [], evidence: [],
      items: [{
        subject: "许七安", summary: "新的判断倾向", limitations: "不迁移身份",
        rules: [{ id: "R1", dimension: "judgment", condition: "信息不足时", action: "先核对再判断",
          boundary: "不附带职业知识", observation: "先检查材料", evidenceIds: [] }],
      }],
    }])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // result 取的是 selectedRevisions[0]（见 :285）：迁移条目一旦被前置就会盖住刚生成的版本，
    // 用户会以为自己最新的分析结果丢了。这条就是用顺序把那个回归钉死。
    expect(host.querySelector(".wb-skill-card")!.textContent).toContain("许七安")
    expect(host.textContent).not.toContain("林烬")
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

describe("旧版条目落盘时机与绑定对话框", () => {
  /** 卡片上的两个按钮；绑定那个的文案以「绑定」开头，须限定在灵魂操作区内取。 */
  const cardButton = (subject: string, label: string) => {
    const actions = host.querySelector(`[data-testid="wb-soul-actions-${subject}"]`)
    return [...(actions?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((b) => b.textContent?.includes(label))!
  }
  /** 「确认并加入」在汇总行里，不在角色卡片内。 */
  const publishButton = () => [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((b) => b.textContent?.includes("确认并加入"))!
  /** 对话框走 portal 渲染到 document.body，不在 host 里。 */
  const dialog = () => document.body.querySelector('[role="dialog"]')
  const dialogButton = (label: string) =>
    [...(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent?.includes(label))!

  beforeEach(() => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
  })

  it("确认并加入时先落盘旧版条目，再按 id 确认发布（顺序不能反）", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => publishButton().click())
    // materializeLegacyCharacterRevision 只写版本 json，confirmWorkbenchRevision 是    // 按住 id 从磁盘重读的：先确认后落盘会读不到条目，这一条钉的就是顺序。
    expect(mocks.materialize).toHaveBeenCalledWith(legacyBook.path, legacyBook)
    expect(mocks.materialize.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.confirmRevision.mock.invocationCallOrder[0])
    expect(mocks.confirmRevision).toHaveBeenCalledWith("/project", legacyBook.path, expect.any(String), "fp-1", legacyBook)
    confirm.mockRestore()
  })

  it("用户在最后一步取消确认时不落盘（懒落盘契约）", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => publishButton().click())
    // 取消 = 没有确认过 = 磁盘上不该留下任何痕迹。
    expect(mocks.materialize).not.toHaveBeenCalled()
    expect(mocks.confirmRevision).not.toHaveBeenCalled()
    confirm.mockRestore()
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

  it("角色页签的新版条目与旧版条目都仍渲染两个按钮", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    mocks.revisions.mockResolvedValue([{
      workbenchVersion: 2, id: "rev-characters-new", skill: "characters", bookTitle: "测试作品",
      selectedChapterIds: ["c1"], createdAt: 9, requirements: "", coverage: [], evidence: [],
      items: [{
        subject: "许七安", summary: "新的判断倾向", limitations: "不迁移身份",
        rules: [{ id: "R1", dimension: "judgment", condition: "信息不足时", action: "先核对再判断",
          boundary: "不附带职业知识", observation: "先检查材料", evidenceIds: [] }],
      }],
    }])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // 默认结果是排在磁盘版本之后才追加的旧版迁移条目之前那一条（新版）。
    expect(soulActions("许七安")!.textContent).toContain("加入自定义灵魂库")
    expect(soulActions("许七安")!.textContent).toContain("绑定…")
    // 切到「旧版导入」那条，收口不能把迁移条目一起误伤。
    const select = host.querySelector<HTMLSelectElement>('[aria-label="结果版本"]')!
    const legacyOption = [...select.options].find((o) => o.textContent?.includes("旧版导入"))!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, legacyOption.value)
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
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
