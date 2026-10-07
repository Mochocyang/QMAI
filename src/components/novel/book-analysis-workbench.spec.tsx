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
/** 一个文风版本。默认 createdAt=1，与 mocks.loadStyles 里 style-1 的 generatedAt 对齐。 */
const styleRevisionFixture = (overrides: Record<string, unknown> = {}): any => revisionFixture({
  skill: "style", id: "rev-style", taskId: "t-style",
  items: [{ subject: "文风", summary: "短段落", limitations: "局限", rules: [{ ...ruleFixture }] }],
  ...overrides,
})
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
  /*
   * 文风 store 的桩同样要复位：新增的「未入库 / 已被替换」用例会改它，
   * 而 clearAllMocks 只清调用记录、不还原实现 —— 漏复位会让后面的启用用例
   * 拿到别的预设（实测过：端到端那条会因此比对一个不存在的 style-new）。
   */
  mocks.loadStyles.mockReset()
  mocks.loadStyles.mockResolvedValue({ enabledStyleId: null, styles: [{ id: "style-1", sourceBook: "测试作品", profile: { generatedAt: 1 } }] })
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
describe("文风启用入口", () => {
  it("文风入库不自动启用，提供显式启用入口", async () => {
    mocks.revisions.mockResolvedValue([styleRevisionFixture({ confirmedAt: 2, publishedIds: ["style-1"] })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => ([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === "文风 Skill")!).click())
    expect(mocks.setStyle).not.toHaveBeenCalled()
    const enable = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("启用此文风"))
    expect(enable).toBeTruthy()
    await act(async () => enable!.click())
    expect(mocks.setStyle).toHaveBeenCalledWith("/project", "style-1")
  })

  /**
   * 这是本次修复的主诉：「文风生成完之后需要点启用，但界面上没有这个按钮」。
   * 旧实现因为 `!revision.confirmedAt` 提前返回，停在未入库的版本连工具栏都不渲染。
   */
  it("未入库的文风版本也必须有「启用此文风」，点一下先入库再启用", async () => {
    // 无结构化规则 → 自动入库会跳过它（canPublishRevision 为假），稳定复现「未入库」。
    const pending = styleRevisionFixture({
      id: "rev-style-pending", taskId: "t-style-pending",
      items: [{ subject: "文风", summary: "短段落", limitations: "局限", rules: [] }],
    })
    mocks.revisions.mockResolvedValue([pending])
    // 挂载时还没入库（没有预设）；入库之后同样的读取必须能看到新预设。
    mocks.loadStyles
      .mockResolvedValueOnce({ enabledStyleId: null, styles: [] })
      .mockResolvedValue({ enabledStyleId: null, styles: [{ id: "style-new", sourceBook: "测试作品", profile: { generatedAt: 1 } }] })
    mocks.confirmRevision.mockResolvedValueOnce({ ...pending, confirmedAt: 5, publishedIds: ["style-new"] })
    mocks.confirmRevision.mockClear()

    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => ([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === "文风 Skill")!).click())

    const enable = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("启用此文风"))
    expect(enable, "未入库的文风版本没有渲染启用按钮").toBeTruthy()
    // 未入库的版本不该被说成「已被替换」——那是另一种状态，会把人引向错误操作。
    expect(host.textContent).not.toContain("此历史版本已被替换")

    await act(async () => enable!.click())

    // 先入库：用的是与自动入库同一条路径（inspect → confirm）。
    expect(mocks.inspect).toHaveBeenCalled()
    expect(mocks.confirmRevision).toHaveBeenCalledTimes(1)
    expect(mocks.confirmRevision.mock.calls[0][2]).toBe("rev-style-pending")
    // 再启用：拿到入库后的 publishedIds 直接启用，不需要用户点第二次。
    expect(mocks.setStyle).toHaveBeenCalledWith("/project", "style-new")
  })

  it("已被替换的历史文风版本不提供启用按钮，避免用旧内容覆盖新预设", async () => {
    // 有了已入库的版本，但盘上的预设内容属于更新的另一版（generatedAt 不匹配）。
    mocks.revisions.mockResolvedValue([styleRevisionFixture({ confirmedAt: 2, publishedIds: ["style-1"] })])
    mocks.loadStyles.mockResolvedValue({ enabledStyleId: null, styles: [{ id: "style-1", sourceBook: "测试作品", profile: { generatedAt: 999 } }] })
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => ([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === "文风 Skill")!).click())

    expect(host.textContent).toContain("此历史版本已被替换")
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].some((b) => b.textContent?.includes("启用此文风"))).toBe(false)
  })
})
describe("拆书库卡片精简", () => {
  it("卡片上不再有「待确认／已入库」状态徽标，也不再区分新旧版来源", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    mocks.revisions.mockResolvedValue([revisionFixture({ id: "rev-characters-new", createdAt: 9, confirmedAt: 10 })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // 正向控制：这一屏确实渲染了卡片，否则下面「找不到徽标」可以被一个空页面满足。
    expect(host.querySelectorAll(".wb-skill-card").length).toBeGreaterThan(0)
    expect(host.querySelector(".wb-card-status")).toBeNull()
    expect(host.querySelector(".wb-origin-tag")).toBeNull()
    expect(host.textContent).not.toContain("待确认")
    expect(host.textContent).not.toContain("已入库")
  })

  it("证据索引下沉进卡片、只列该成果引用的原文，版本级那一块不再存在", async () => {
    const evidence = [
      { id: "e1", chapterId: "c1", order: 1, start: 10, end: 20, text: "他先核对了账册。", sourceHash: "h1" },
      { id: "e2", chapterId: "c2", order: 2, start: 30, end: 40, text: "这一笔对不上。", sourceHash: "h2" },
    ]
    mocks.revisions.mockResolvedValue([revisionFixture({
      id: "rev-evidence", confirmedAt: 3,
      items: [{ subject: "许七安", summary: "判断倾向", limitations: "", rules: [{ ...ruleFixture, evidenceIds: ["e1"] }] }],
      evidence,
    })])
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [book] })
    await act(async () => root.render(<BookAnalysisWorkbench />))

    const card = host.querySelector('[data-revision-id="rev-evidence"] .wb-skill-card')!
    const index = card.querySelector(".wb-card-evidence")!
    expect(index, "卡片里没有证据索引").not.toBeNull()
    // 标签只有「证据索引」四个字，不再带「与实际覆盖」。
    expect(index.querySelector("summary")!.textContent).toBe("证据索引")
    // 只列这张卡引用的 e1；e2 属于同一版本但没被这个对象引用，不能出现。
    expect(index.textContent).toContain("他先核对了账册。")
    expect(index.textContent).not.toContain("这一笔对不上。")
    // 正向控制：证据索引确实在卡片里，且紧跟「N条规则 · M条依据」那一行。
    const small = card.querySelector(".wb-card-main > small")!
    expect(small.textContent).toContain("1条规则 · 1条依据")
    expect(small.compareDocumentPosition(index) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 版本级整块已删除（连带整版 metrics 与覆盖分段）。
    expect(host.textContent).not.toContain("证据索引与实际覆盖")
    expect(host.textContent).not.toContain("自动核验仍需人工复核")
  })
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

  it("旧版角色以条目形式合并进角色页签，且不再显示旧版来源标签", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.textContent).toContain("林烬")
    // 需求：来源标签整段删除，连「旧版导入」四个字也不再出现（新旧版来源在卡片上不再可区分）。
    expect(host.querySelector(".wb-origin-tag")).toBeNull()
    expect(host.textContent).not.toContain("旧版资料导入")
    expect(host.textContent).not.toContain("无结构化规则")
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

  it("无论新旧版，卡片上都不再出现「待确认」或「已入库」徽标", async () => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
    // 一份已入库的新版角色结果同时在场：旧实现会给它渲染「已入库」，
    // 给旧版条目渲染「待确认」——两个文案现在都必须消失。
    mocks.revisions.mockResolvedValue([revisionFixture({ id: "rev-characters-new", createdAt: 9, confirmedAt: 10 })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    // 正向控制：确实渲染了卡片，否则「找不到徽标」可以被一个空页面满足。
    expect(host.querySelectorAll(".wb-skill-card").length).toBeGreaterThan(0)
    expect(host.querySelector('[data-revision-id="rev-characters-new"]')).not.toBeNull()
    expect(host.querySelector(".wb-card-status")).toBeNull()
    expect(host.textContent).not.toContain("待确认")
    expect(host.textContent).not.toContain("已入库")
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
    // 正向控制：这一版确实在页面上，否则「没发布」可能只是因为它压根没渲染。
    expect(host.querySelector('[data-revision-id="rev-empty"]')).not.toBeNull()
    /*
     * 这里原来还断言卡片徽标写着「待确认」作为用户可见的等价信号。
     * 需求已把该徽标整段删除，工作台里不再有任何承载「尚未入库」的界面元素，
     * 所以这条只剩数据层的断言（不能让一个恒真的界面断言留下来充数）。
     */
  })

  it("自动发布成功后重新读取版本列表（拿回落盘的 confirmedAt）", async () => {
    mocks.revisions.mockResolvedValue([revisionFixture()])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(mocks.confirmRevision).toHaveBeenCalledTimes(1)
    expect(mocks.revisions.mock.calls.length).toBeGreaterThan(1)
  })

  it("端到端：自动发布成功后重读回来的版本成为可直接启用的「当前版本」", async () => {
    /*
     * 这是「分析完自动入库」在界面上的用户可见结果。
     *
     * 原来它断言的是「待确认 → 已入库」徽标切换，而该徽标已按需求删除，
     * 所以改钉在**文风启用**上：未入库的版本点启用会先入库（多一次 confirm），
     * 已入库的版本点启用应当直接启用、不再入库。这个区别正是重读 confirmedAt 的效果。
     */
    const pending = styleRevisionFixture({ id: "rev-style-auto", taskId: "t-style-auto" })
    const stored = styleRevisionFixture({ id: "rev-style-auto", taskId: "t-style-auto", confirmedAt: 99, publishedIds: ["style-1"] })
    let loads = 0
    mocks.revisions.mockImplementation(async () => { loads += 1; return [loads === 1 ? pending : stored] })

    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => ([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === "文风 Skill")!).click())
    await act(async () => {})

    // 重读确实发生过（否则下面的「不再入库」只是「本来就没入库过」）。
    expect(loads).toBeGreaterThan(1)
    const confirmCallsAfterPublish = mocks.confirmRevision.mock.calls.length

    const enable = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("启用此文风"))
    expect(enable).toBeTruthy()
    await act(async () => enable!.click())

    expect(mocks.setStyle).toHaveBeenCalledWith("/project", "style-1")
    // 关键：这一版已经入库过，启用不该再入库一次。
    expect(mocks.confirmRevision.mock.calls.length).toBe(confirmCallsAfterPublish)
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

  it("版本标题行与「本次需求」都不再渲染", async () => {
    mocks.revisions.mockResolvedValue([revisionFixture({ id: "rev-meta", confirmedAt: 2 })])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.querySelector(".wb-revision-heading")).toBeNull()
    expect(host.querySelector(".wb-revision-meta")).toBeNull()
    expect(host.textContent).not.toContain("本次需求")
  })

  it("每个版本的「补充修订」行带一个带年份的日期标签，用来区分各版本级内容归属", async () => {
    const oldAt = new Date(2026, 9, 6, 22, 17).getTime()
    const newAt = new Date(2026, 9, 7, 9, 3).getTime()
    mocks.revisions.mockResolvedValue([
      revisionFixture({ id: "rev-new", createdAt: newAt, confirmedAt: newAt + 1 }),
      revisionFixture({ id: "rev-old", createdAt: oldAt, confirmedAt: oldAt + 1 }),
    ])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const date = (id: string) => host.querySelector(`[data-revision-extras="${id}"] .wb-revision-date`)
    // 带年份：与卡片上的短格式（10/6 22:17）区分开，只有它能唯一标识一个版本。
    expect(date("rev-old")!.textContent).toBe("2026/10/6 22:17")
    expect(date("rev-new")!.textContent).toBe("2026/10/7 09:03")
  })
})

describe("合并版本列表与卡片操作", () => {
  /** 一个版本级内容块（导图/规则详情/证据索引/补充修订都挂在它下面）。 */
  const extras = (id: string) => host.querySelector(`[data-revision-extras="${id}"]`)
  const inBlock = (id: string, selector: string) => host.querySelector(`[data-revision-id="${id}"] ${selector}`)

  const twoVersionsWithSameCharacter = () => {
    const oldAt = new Date(2026, 9, 6, 22, 17).getTime()
    const newAt = new Date(2026, 9, 7, 9, 3).getTime()
    // 两版里都有「许七安」：这是「状态必须按版本隔离」的关键条件。
    return [
      revisionFixture({ id: "rev-new", createdAt: newAt, confirmedAt: newAt + 1, items: [itemFixture("许七安"), itemFixture("林烬")] }),
      revisionFixture({ id: "rev-old", createdAt: oldAt, confirmedAt: oldAt + 1, items: [itemFixture("许七安")] }),
    ]
  }

  it("所有版本的对象卡排进同一个合并列表，顺序是「版本从旧到新、版本内原顺序」", async () => {
    mocks.revisions.mockResolvedValue(twoVersionsWithSameCharacter())
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const list = host.querySelector(".wb-card-list")!
    expect(list).not.toBeNull()
    // 三张卡全在合并容器里：不是「看起来挨着、其实还是分块」。
    expect(list.querySelectorAll(".wb-skill-card")).toHaveLength(3)
    expect(host.querySelectorAll(".wb-skill-card")).toHaveLength(3)
    // 顺序：旧版本（许七安）在前，新版本（许七安、林烬）在后。
    const names = [...list.querySelectorAll(".wb-card-heading h3")].map((h) => h.textContent)
    expect(names[0]).toContain("许七安 · 10/6 22:17")
    expect(names[1]).toContain("许七安 · 10/7 09:03")
    expect(names[2]).toContain("林烬 · 10/7 09:03")
  })

  it("合并后每个版本仍恰好一个跳转锚点（活动跳转不能失效）", async () => {
    mocks.revisions.mockResolvedValue(twoVersionsWithSameCharacter())
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const ids = [...host.querySelectorAll("[data-revision-id]")].map((el) => el.getAttribute("data-revision-id"))
    expect(ids).toEqual(["rev-old", "rev-new"])
    /*
     * 光有 id 不够：跳转靠 scrollIntoView，锚点必须是**真实占据布局**的容器。
     * jsdom 没有排版，量不到几何，所以这里退一步钉住结构：
     * 锚点必须就是那个包住本版卡片网格的 <section>，而不是 0 高度的空占位元素
     * （空占位在真实浏览器里滚动位置会是错的；CSS 侧的绝对定位/零高度另由
     * check-panel.mjs 对源 CSS 做反向断言）。
     */
    for (const id of ["rev-old", "rev-new"]) {
      const anchor = host.querySelector(`[data-revision-id="${id}"]`)!
      expect(anchor.tagName).toBe("SECTION")
      expect(anchor.classList.contains("wb-revision-block")).toBe(true)
      expect(anchor.querySelector(".wb-skill-grid")).not.toBeNull()
      expect(anchor.querySelectorAll(".wb-skill-card").length).toBeGreaterThan(0)
    }
  })

  it("版本级内容排在合并列表之后，且不在合并列表内部", async () => {
    mocks.revisions.mockResolvedValue(twoVersionsWithSameCharacter())
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(host.querySelectorAll(".wb-card-list [data-revision-extras]")).toHaveLength(0)
    const extrasIds = [...host.querySelectorAll("[data-revision-extras]")].map((el) => el.getAttribute("data-revision-extras"))
    expect(extrasIds).toEqual(["rev-old", "rev-new"])
  })

  it("两个版本都有「许七安」时，点其中一张卡的「查看规则」只展开它自己那一版", async () => {
    mocks.revisions.mockResolvedValue(twoVersionsWithSameCharacter())
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const ruleBtn = (id: string) => inBlock(id, '[aria-label="查看许七安规则"]') as HTMLButtonElement
    // 先断言两张卡初始都没展开：否则「只有 A 展开」可能只是「谁都没展开」。
    expect(ruleBtn("rev-old").getAttribute("aria-expanded")).toBe("false")
    expect(ruleBtn("rev-new").getAttribute("aria-expanded")).toBe("false")
    await act(async () => ruleBtn("rev-old").click())
    expect(extras("rev-old")!.querySelector(".wb-rule-detail")).not.toBeNull()
    // 关键：新版本里同名角色的规则详情**不能**跟着一起出现。
    expect(extras("rev-new")!.querySelector(".wb-rule-detail")).toBeNull()
    /*
     * 还必须断言**卡片自身**的展开态。只查 .wb-rule-detail 是不够的：
     * 那一处用的是 extras 的 expandedSubject 判定（另一条路径），
     * 把卡片的 expanded 判定退化成「只看对象名」时它照样通过，
     * 而界面上 B 版会错误地显示「收起规则」——这正是复合键要消灭的状态串。
     */
    expect(ruleBtn("rev-old").getAttribute("aria-expanded")).toBe("true")
    expect(ruleBtn("rev-old").textContent).toContain("收起规则")
    expect(ruleBtn("rev-new").getAttribute("aria-expanded")).toBe("false")
    expect(ruleBtn("rev-new").textContent).toContain("查看规则")
  })

  it("删除按钮作用于被点那一版：点第二版（不是列表第一版）也必须删它", async () => {
    mocks.revisions.mockResolvedValue(twoVersionsWithSameCharacter())
    await act(async () => root.render(<BookAnalysisWorkbench />))
    /*
     * 故意点 rev-new——它是合并列表里的**第二**版。曾经这里点的是 rev-old，
     * 而 rev-old 恰好就是 orderedRevisions[0]，于是「永远删第一版」这种实现也能通过，
     * 用例对它的命名是空洞的（不可撤销的删除必须真的钉住版本）。
     */
    await act(async () => (inBlock("rev-new", '[aria-label="删除许七安"]') as HTMLButtonElement).click())
    const del = [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((b) => b.textContent?.trim() === "删除")!
    await act(async () => del.click())
    expect(mocks.removeRevisionItem).toHaveBeenCalledTimes(1)
    expect(mocks.removeRevisionItem.mock.calls[0][0].revision.id).toBe("rev-new")
  })

  it("两个版本的补充修订草稿互不覆盖（点另一版的笔不会清空已输入内容）", async () => {
    mocks.revisions.mockResolvedValue(twoVersionsWithSameCharacter())
    await act(async () => root.render(<BookAnalysisWorkbench />))
    const pencil = (id: string) => inBlock(id, '[aria-label="补充许七安修订要求"]') as HTMLButtonElement
    const textarea = (id: string) =>
      extras(id)!.querySelector<HTMLTextAreaElement>('textarea[aria-label="补充修订要求"]')
    await act(async () => pencil("rev-new").click())
    expect(textarea("rev-new")).not.toBeNull()
    await act(async () => {
      const el = textarea("rev-new")!
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
      setter.call(el, "给新版本的要求")
      el.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(textarea("rev-new")!.value).toBe("给新版本的要求")
    /*
     * 同一时刻只开一个编辑器（切到另一版会收起这一版），但草稿必须留在状态里：
     * 走开再回来还得是原来那段字。所以断言「回来之后仍在」，而不是「同时可见」。
     */
    await act(async () => pencil("rev-old").click())
    expect(textarea("rev-old")).not.toBeNull()
    expect(textarea("rev-old")!.value).toBe("")
    expect(textarea("rev-new")).toBeNull()
    await act(async () => pencil("rev-new").click())
    expect(textarea("rev-new")!.value).toBe("给新版本的要求")
    expect(textarea("rev-old")).toBeNull()
  })

  it("点卡片上的笔会把版本级编辑器打开并聚焦（否则在长列表里毫无反馈）", async () => {
    mocks.revisions.mockResolvedValue(twoVersionsWithSameCharacter())
    await act(async () => root.render(<BookAnalysisWorkbench />))
    expect(extras("rev-new")!.querySelector('textarea[aria-label="补充修订要求"]')).toBeNull()
    await act(async () => (inBlock("rev-new", '[aria-label="补充许七安修订要求"]') as HTMLButtonElement).click())
    const textarea = extras("rev-new")!.querySelector<HTMLTextAreaElement>('textarea[aria-label="补充修订要求"]')!
    expect(textarea).not.toBeNull()
    // 聚焦走 requestAnimationFrame，得让它先跑一拍。
    await act(async () => { await new Promise((done) => requestAnimationFrame(() => done(null))) })
    // 聚焦是承重的：编辑器位于所有卡片之后，不聚焦就没有任何可见反馈。
    expect(document.activeElement).toBe(textarea)
  })

  it("展开概述的状态同样按版本隔离", async () => {
    const long = "很长的概述".repeat(40)
    mocks.revisions.mockResolvedValue([
      revisionFixture({ id: "rev-new", createdAt: 20, confirmedAt: 21, items: [{ ...itemFixture("许七安"), summary: long }] }),
      revisionFixture({ id: "rev-old", createdAt: 10, confirmedAt: 11, items: [{ ...itemFixture("许七安"), summary: long }] }),
    ])
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => (inBlock("rev-old", '[aria-label="展开许七安概述"]') as HTMLButtonElement).click())
    const expanded = (id: string) =>
      inBlock(id, ".wb-card-description")!.getAttribute("data-expanded")
    expect(expanded("rev-old")).toBe("true")
    expect(expanded("rev-new")).toBe("false")
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
    // 「N个对象」原本在版本标题行里；标题行已删，改成直接数渲染出来的卡片。
    // （不再是断言某个字符串存在，而是断言 DOM 里真的只有一张卡 —— 更贴近用户看到的。）
    expect(block("rev-characters").querySelectorAll(".wb-skill-card")).toHaveLength(1)
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
