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
    pipeline: { tasks: [], chunks: [], progresses: {}, initializeProject: init },
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
const book = {
  id: "book-1", path: "/project/book-analysis/book-1", metadata: { title: "测试作品", totalChapters: 123, totalWords: 123000 },
  characters: [], skills: [],
}
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); vi.clearAllMocks()
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
    await act(async () => root.render(<BookAnalysisWorkbench legacy={null} />))
    expect(host.querySelector(".wb-model")!.textContent).not.toContain("custom-private-provider")
    expect(host.querySelectorAll(".wb-model button")).toHaveLength(1)
  })
  it("导入终态记录确认后删除，不删除作品；运行中的记录不可删除", async () => {
    mocks.imports.tasks = [
      { id: "cancelled-1", originalFileName: "重复作品.txt", status: "cancelled", completed: 0, total: 0, createdAt: 1 },
      { id: "running-1", originalFileName: "新作品.txt", status: "splitting", completed: 0, total: 0, createdAt: 1 },
    ] as BatchImportTask[]
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    await act(async () => root.render(<BookAnalysisWorkbench legacy={null} />))
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
    await act(async () => root.render(<BookAnalysisWorkbench legacy={null} />))
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
    await act(async () => root.render(<BookAnalysisWorkbench legacy={null} />))
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
    await act(async () => root.render(<BookAnalysisWorkbench legacy={null} />))
    await act(async () => ([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === "文风 Skill")!).click())
    expect(mocks.setStyle).not.toHaveBeenCalled()
    const enable = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("启用此文风"))
    expect(enable).toBeTruthy()
    await act(async () => enable!.click())
    expect(mocks.setStyle).toHaveBeenCalledWith("/project", "style-1")
  })
  it("取消侧栏和重复标题，显示页内设置并初始化后台服务", async () => {
    await act(async () => root.render(<BookAnalysisWorkbench legacy={<div>旧版结果</div>} />))
    expect(host.querySelectorAll("h1")).toHaveLength(1)
    expect(host.querySelector("aside")).toBeNull()
    expect(host.textContent).toContain("123章")
    expect(host.textContent).toContain("分析设置")
    expect(host.textContent).not.toContain("旧版结果")
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
    await act(async () => root.render(<BookAnalysisWorkbench legacy={null} />))
    expect(host.textContent).toContain("暂无作品")
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "导入作品")!
    await act(async () => button.click())
    expect(host.querySelector('[role="dialog"]')?.textContent).toBe("单页导入")
    expect(mocks.imports.createBatch).not.toHaveBeenCalled()
  })
})
