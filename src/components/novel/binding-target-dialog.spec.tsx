// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BindingTargetDialog, BookAnalysisWorkbench } from "./book-analysis-workbench"
import type { BatchImportTask } from "@/lib/novel/book-analysis/batch-import-types"
const mocks = vi.hoisted(() => {
  const init = vi.fn(async () => {})
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
  // 忽略表落盘换成内存文件系统：过滤/读写仍是真代码，磁盘副作用与调用顺序都能断言。
  const files = new Map<string, string>()
  return {
    init, old, files, load: vi.fn(), revisions: vi.fn(async (): Promise<any[]> => []),
    loadStyles: vi.fn(async () => ({ enabledStyleId: null as string | null, styles: [] })),
    setStyle: vi.fn(async () => {}),
    loadSoulStatus: vi.fn(async () => "none" as const),
    addToSoul: vi.fn(async () => ({ auraId: "aura-1", auraName: "林烬" })),
    bindCharacters: vi.fn(async () => ({ succeeded: 1, alreadyBound: [] as string[], failed: [] as string[] })),
    listBindable: vi.fn(async () => ["沈微", "裴探"]),
    // 后台精修：默认立刻返回，用例按需换成受控 promise 验迟到／失败。
    refine: vi.fn(async () => [] as string[]),
    refreshProject: vi.fn(async () => {}),
    inspect: vi.fn(async () => ({ targets: [], impacts: [], fingerprint: "fp-1" })),
    confirmRevision: vi.fn(async () => ({})),
    materialize: vi.fn(async () => ({})),
    wiki: { project: { id: "p", name: "测试项目", path: "/project" }, providerConfigs: {} },
    imports: { tasks: [] as BatchImportTask[], batches: [], revision: 0, initializeProject: init, createBatch: vi.fn(), deletePublishedBook: vi.fn(), deleteRecord: vi.fn(async () => {}) },
    pipeline: { tasks: [], chunks: [], progresses: {}, initializeProject: init, recognizeWorkbenchCharacters: vi.fn(async () => {}), confirmCharacterSelection: vi.fn(async () => {}), startTask: vi.fn(async () => {}) },
  }
})
/** 三个落盘函数的替身：实现体是真实实现，只用来记调用。 */
const filterSpies = vi.hoisted(() => ({ read: vi.fn(), add: vi.fn(), remove: vi.fn() }))
vi.mock("@/stores/wiki-store", () => ({ useWikiStore: Object.assign((s: any) => s(mocks.wiki), { getState: () => mocks.wiki }) }))
vi.mock("@/stores/book-analysis-store", () => ({ useBookAnalysisStore: Object.assign((s: any) => s(mocks.old), { getState: () => mocks.old }) }))
vi.mock("@/stores/book-analysis-import-store", () => ({ useBookAnalysisImportStore: Object.assign(() => mocks.imports, { getState: () => mocks.imports }) }))
vi.mock("@/stores/book-analysis-pipeline-store", () => ({ useBookAnalysisPipelineStore: Object.assign(() => mocks.pipeline, { getState: () => mocks.pipeline }) }))
vi.mock("@/stores/book-analysis-activity-store", () => ({ useBookAnalysisActivityStore: (s: any) => s({ navigation: null }) }))
vi.mock("@/lib/novel/book-analysis/library-state", () => ({ loadBookAnalysisLibraryState: mocks.load }))
vi.mock("@/lib/novel/book-analysis/workbench-storage", () => ({ loadWorkbenchRevisions: mocks.revisions }))
vi.mock("@/lib/novel/book-analysis/analysis-engine", () => ({ loadChapterList: async () => Array.from({ length: 3 }, (_, i) => ({ chapterId: `c${i + 1}`, order: i + 1, title: `第${i + 1}章`, wordCount: 1000 })) }))
vi.mock("@/components/chat/chat-model-selector", () => ({ ChatModelSelector: () => <button>默认模型</button> }))
vi.mock("@/lib/novel/book-analysis/analysis-model-resolver", () => ({ resolveTaskLlmConfig: () => ({ model: "测试模型" }) }))
vi.mock("@/lib/novel/writing-style-store", () => ({ loadWritingStyleStore: mocks.loadStyles, setEnabledWritingStyle: mocks.setStyle }))
vi.mock("./book-analysis-input-dialog", () => ({ BookAnalysisInputDialog: () => null }))
vi.mock("./book-analysis-usage-summary", () => ({ BookAnalysisUsageSummary: () => null }))
vi.mock("@/lib/novel/book-analysis/story-map-history", () => ({ listStoryMapHistory: vi.fn(async () => []) }))
vi.mock("@/lib/novel/book-analysis/workbench-soul-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/novel/book-analysis/workbench-soul-actions")>()),
  loadCharacterSoulStatus: mocks.loadSoulStatus,
  addCharacterToSoulLibrary: mocks.addToSoul,
  bindCharacterToNovelCharacters: mocks.bindCharacters,
}))
// 现有的 book-analysis-workbench.spec 只打桩 listBindableNovelCharacters，
// 所以组件对精修函数必须做存在性守卫：缺了就当没有后台精修。
vi.mock("@/lib/novel/character-aura", () => ({
  listBindableNovelCharacters: mocks.listBindable,
  refineBindableCharactersWithLlm: mocks.refine,
}))
vi.mock("@/lib/project-refresh", () => ({ refreshProjectState: mocks.refreshProject }))
vi.mock("@/lib/novel/book-analysis/workbench-publish", () => ({
  inspectWorkbenchPublication: mocks.inspect, confirmWorkbenchRevision: mocks.confirmRevision,
}))
vi.mock("@/lib/novel/book-analysis/legacy-character-revision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/novel/book-analysis/legacy-character-revision")>()),
  materializeLegacyCharacterRevision: mocks.materialize,
}))
vi.mock("@/commands/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/commands/fs")>()),
  readFile: vi.fn(async (path: string) => {
    const contents = mocks.files.get(path)
    if (contents === undefined) throw new Error(`ENOENT: ${path}`)
    return contents
  }),
  writeFileAtomic: vi.fn(async (path: string, contents: string) => { mocks.files.set(path, contents) }),
  createDirectory: vi.fn(async () => {}),
}))
vi.mock("@/lib/novel/bindable-characters-filter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/novel/bindable-characters-filter")>()
  filterSpies.read.mockImplementation(actual.readBindableIgnoreList)
  filterSpies.add.mockImplementation(actual.addBindableIgnore)
  filterSpies.remove.mockImplementation(actual.removeBindableIgnore)
  return {
    ...actual,
    readBindableIgnoreList: filterSpies.read,
    addBindableIgnore: filterSpies.add,
    removeBindableIgnore: filterSpies.remove,
  }
})
const book = {
  id: "book-1", path: "/project/book-analysis/book-1", metadata: { title: "测试作品", totalChapters: 3, totalWords: 3000 },
  characters: [], skills: [],
}
const legacyBook = {
  ...book,
  recognizedCharacters: [],
  characters: [{
    id: "char-1", name: "林烬", aliases: [], importance: 9, category: "protagonist" as const,
    firstAppearance: 1, lastAppearance: 3, appearanceCount: 3, description: "旧城巡夜人。",
    personality: "克制。", speechStyle: "短句。", relationships: [], keyEvents: [], corpus: "",
  }],
  skills: [], styleStatus: "disabled" as const, boundAurasCount: 0, addedAuraCharacterIds: [], evidence: [],
}
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); vi.clearAllMocks()
  mocks.files.clear()
  mocks.old.sidebarRefreshCounter = 0
  mocks.old.selectedLibraryBookId = null
  mocks.old.pendingRecognitionTaskId = null
  mocks.imports.tasks = []
  mocks.revisions.mockResolvedValue([])
  mocks.load.mockResolvedValue({ books: [book] })
  mocks.listBindable.mockResolvedValue(["沈微", "裴探"])
  // clearAllMocks 不清实现，被单个用例改过的桩必须显式复位。
  mocks.refine.mockReset(); mocks.refine.mockResolvedValue([])
  mocks.loadSoulStatus.mockReset(); mocks.loadSoulStatus.mockResolvedValue("none")
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

/** 对话框走 portal 渲染到 document.body，不在 host 里。 */
const dialogEl = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
const searchBox = () => dialogEl()?.querySelector<HTMLInputElement>('[aria-label="搜索小说人物"]')
const nameGrid = () => dialogEl()?.querySelector<HTMLElement>('[data-testid="bindable-name-grid"]')
const nameList = () => dialogEl()?.querySelector<HTMLElement>('[data-testid="bindable-name-list"]')
const shownNames = () => [...(nameGrid()?.querySelectorAll("label span") ?? [])].map((span) => span.textContent)
const cellFor = (name: string) => [...(nameGrid()?.querySelectorAll("label") ?? [])]
  .find((label) => label.querySelector("span")?.textContent === name)
const checkboxFor = (name: string) => cellFor(name)?.querySelector<HTMLInputElement>('input[type="checkbox"]')
const buttonWith = (label: string) => [...(dialogEl()?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
  .find((button) => button.textContent?.includes(label))
const confirmButton = () => buttonWith("绑定所选")
const click = async (element: Element | undefined | null) => { await act(async () => { (element as HTMLElement).click() }) }
/** 受控 promise：验「后台精修迟到」必须能自己决定什么时候返回。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
type BindingDialogProps = {
  subject?: string | null; names?: string[] | null; projectPath?: string; alwaysKeep?: string[]
  onOpenChange?: (open: boolean) => void; onConfirm?: (names: string[]) => void
}
/** 直接渲染对话框本身：搜索／栅格／忽略都是它的契约，不必绕整页工作台。 */
function mountBindingDialog(props: BindingDialogProps = {}) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  const element = <BindingTargetDialog subject="林烬" names={["甲", "乙"]} projectPath="/project"
    onOpenChange={onOpenChange} onConfirm={onConfirm} {...props} />
  return { onConfirm, onOpenChange, element }
}
async function typeQuery(value: string) {
  const input = searchBox()!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("绑定对话框：搜索、栅格与提交", () => {
  it("搜索框按子串过滤，大小写不敏感且忽略首尾空格", async () => {
    const { element } = mountBindingDialog({ names: ["Alice", "alice-b", "甲", "乙"] })
    await act(async () => root.render(element))
    expect(shownNames()).toEqual(["Alice", "alice-b", "甲", "乙"])
    await typeQuery("  ALICE  ")
    expect(shownNames()).toEqual(["Alice", "alice-b"])
    await typeQuery(" 甲 ")
    expect(shownNames()).toEqual(["甲"])
  })

  it("对话框打开时搜索框自动获得焦点", async () => {
    const { element } = mountBindingDialog({ names: ["甲", "乙"] })
    await act(async () => root.render(element))
    expect(document.activeElement).toBe(searchBox())
  })

  it("已勾选项在过滤后仍然保留，并且确认时会被提交", async () => {
    const { element, onConfirm } = mountBindingDialog({ names: ["甲", "乙"] })
    await act(async () => root.render(element))
    await click(checkboxFor("甲"))
    expect(checkboxFor("甲")!.checked).toBe(true)
    // 过滤掉「甲」之后，勾选必须还在：picked 不能由过滤后的视图推导。
    await typeQuery("乙")
    expect(shownNames()).toEqual(["乙"])
    expect(checkboxFor("甲")).toBeUndefined()
    expect(dialogEl()!.textContent).toContain("已选 1 个 · 匹配 1 / 共 2")
    expect(confirmButton()!.textContent).toContain("绑定所选 1 个人物")
    expect(confirmButton()!.disabled).toBe(false)
    await click(confirmButton())
    expect(onConfirm).toHaveBeenCalledWith(["甲"])
  })

  it("没有匹配时显示提示而不是空白", async () => {
    const { element } = mountBindingDialog({ names: ["甲", "乙"] })
    await act(async () => root.render(element))
    await typeQuery("zzz")
    expect(nameGrid()).toBeNull()
    expect(dialogEl()!.textContent).toContain("没有匹配「zzz」")
  })

  it("人物列表按每行 5 个的栅格渲染", async () => {
    const { element } = mountBindingDialog({ names: ["甲", "乙", "丙", "丁", "戊", "己"] })
    await act(async () => root.render(element))
    const grid = nameGrid()!
    expect(grid.classList.contains("grid")).toBe(true)
    expect(grid.className).toMatch(/(^|\s)(md:)?grid-cols-5(\s|$)/)
    expect(grid.querySelectorAll("label")).toHaveLength(6)
  })

  it("人物名过长时截断并用 title 保留全名", async () => {
    const longName = "这是一个非常非常长的人物名字用来验证单元格不会溢出边界"
    const { element } = mountBindingDialog({ names: [longName] })
    await act(async () => root.render(element))
    const span = nameGrid()!.querySelector("label span")!
    expect(span.className).toContain("truncate")
    expect(span.getAttribute("title")).toBe(longName)
    expect(cellFor(longName)?.querySelector("input")?.closest("label")).not.toBeNull()
  })

  it("内置规则认定的非人物条目不出现在候选里", async () => {
    const polluted = ["甲", "编号派通用手段", "编号体执行群", "成长或崩坏路径", "冲突点", "当前状态"]
    const { element } = mountBindingDialog({ names: polluted })
    await act(async () => root.render(element))
    expect(shownNames()).toEqual(["甲"])
  })

  it("搜索框有内容时按 Esc 只清空搜索，不关闭对话框；空搜索时 Esc 照常关闭", async () => {
    const { element, onOpenChange } = mountBindingDialog({ names: ["甲", "乙"] })
    await act(async () => root.render(element))
    await typeQuery("甲")
    await act(async () => {
      searchBox()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(searchBox()!.value).toBe("")
    expect(dialogEl()).not.toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => {
      searchBox()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
  })

  it("名单加载中时标题、搜索框与底部按钮立刻渲染，只有列表区显示加载提示", async () => {
    const { element } = mountBindingDialog({ names: null })
    await act(async () => root.render(element))
    expect(dialogEl()!.textContent).toContain("绑定「林烬」")
    expect(dialogEl()!.textContent).toContain("正在读取小说人物…")
    expect(searchBox()).not.toBeNull()
    expect(confirmButton()).not.toBeNull()
    const list = nameList()!
    expect(list.textContent).toContain("正在读取小说人物…")
    expect(list.contains(searchBox()!)).toBe(false)
    // 名单到了就换成列表，加载提示消失。
    await act(async () => { root.render(<BindingTargetDialog subject="林烬" names={["甲"]} projectPath="/project" onOpenChange={vi.fn()} onConfirm={vi.fn()} />) })
    expect(dialogEl()!.textContent).not.toContain("正在读取小说人物…")
    expect(shownNames()).toEqual(["甲"])
  })
})

describe("绑定对话框：忽略表", () => {
  it("忽略一项后它从列表消失，且落盘调用了 addBindableIgnore", async () => {
    const { element } = mountBindingDialog({ names: ["甲", "乙"] })
    await act(async () => root.render(element))
    await click(dialogEl()!.querySelector('[aria-label="忽略甲"]'))
    expect(filterSpies.add).toHaveBeenCalledWith("/project", "甲")
    expect(shownNames()).toEqual(["乙"])
    expect(dialogEl()!.textContent).toContain("已忽略 1 项")
    expect(mocks.files.get("/project/.qmai/bindable-characters-ignore.json")).toContain("甲")
  })

  it("「已忽略 N 项」可以展开恢复，恢复后名字重新出现在列表里", async () => {
    const { element } = mountBindingDialog({ names: ["甲", "乙"] })
    await act(async () => root.render(element))
    await click(dialogEl()!.querySelector('[aria-label="忽略甲"]'))
    expect(shownNames()).toEqual(["乙"])
    await click(buttonWith("已忽略 1 项"))
    await click(dialogEl()!.querySelector('[aria-label="恢复甲"]'))
    expect(filterSpies.remove).toHaveBeenCalledWith("/project", "甲")
    expect(shownNames()).toEqual(["甲", "乙"])
    expect(dialogEl()!.textContent).not.toContain("已忽略 1 项")
  })
})

describe("绑定对话框：名单来源与后台精修", () => {
  /** 角色卡片上的「绑定…」按钮。 */
  const bindButton = () => [...(host.querySelector(`[data-testid="wb-soul-actions-林烬"]`)
    ?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent?.includes("绑定…"))!
  const openDialog = async () => {
    await act(async () => root.render(<BookAnalysisWorkbench />))
    await act(async () => bindButton().click())
  }

  beforeEach(() => {
    mocks.old.selectedLibraryBookId = "book-1"
    mocks.load.mockResolvedValue({ books: [legacyBook] })
  })

  it("已绑定的人物即使命中过滤规则也必须留在候选里（alwaysKeep 安全阀）", async () => {
    mocks.listBindable.mockResolvedValue(["甲", "当前状态", "冲突点"])
    mocks.loadSoulStatus.mockResolvedValue({ bound: ["冲突点"] })
    await openDialog()
    // 安全阀只保护已绑定的那一个：同批次里没绑定的「当前状态」仍然要被过滤掉。
    expect(shownNames()).toEqual(["甲", "冲突点"])
  })

  it("后台精修返回的新名字会补进已打开的列表", async () => {
    const refined = deferred<string[]>()
    mocks.listBindable.mockResolvedValue(["甲"])
    mocks.refine.mockReturnValue(refined.promise)
    await openDialog()
    expect(shownNames()).toEqual(["甲"])
    expect(mocks.refine).toHaveBeenCalledWith("/project")
    await act(async () => { refined.resolve(["甲", "乙"]) })
    await act(async () => {})
    expect(shownNames()).toEqual(["甲", "乙"])
  })

  it("精修失败时已勾选的人物不受影响，仍可提交", async () => {
    const refined = deferred<string[]>()
    mocks.listBindable.mockResolvedValue(["甲", "乙"])
    mocks.refine.mockReturnValue(refined.promise)
    await openDialog()
    await click(checkboxFor("甲"))
    await act(async () => { refined.reject(new Error("模型超时")) })
    await act(async () => {})
    expect(shownNames()).toEqual(["甲", "乙"])
    expect(confirmButton()!.textContent).toContain("绑定所选 1 个人物")
    expect(confirmButton()!.disabled).toBe(false)
    await click(confirmButton())
    expect(mocks.bindCharacters).toHaveBeenCalledWith("/project", legacyBook, expect.anything(), "林烬", ["甲"])
  })

  it("对话框关闭后迟到的精修结果不会污染下一次打开的名单", async () => {
    const late = deferred<string[]>()
    mocks.listBindable.mockResolvedValue(["甲"])
    mocks.refine.mockReturnValueOnce(late.promise).mockResolvedValue([])
    await openDialog()
    expect(shownNames()).toEqual(["甲"])
    await click(buttonWith("取消"))
    expect(dialogEl()).toBeNull()
    await act(async () => { late.resolve(["甲", "迟到名"]) })
    await act(async () => {})
    await act(async () => bindButton().click())
    expect(dialogEl()).not.toBeNull()
    expect(shownNames()).toEqual(["甲"])
  })

  it("重新打开同一角色后，上一次会话迟到的精修结果不会并进新名单", async () => {
    // 第一次会话的精修永远挂着，直到第二次打开已经把新名单渲染出来之后才返回。
    const firstRefine = deferred<string[]>()
    // 两次打开读到的是不同名单：迟到的名字与第二次的新名单没有任何交集，
    // 所以只要它出现就一定来自第一次会话，不可能是重新拉取带回来的。
    mocks.listBindable.mockReset()
    mocks.listBindable.mockResolvedValueOnce(["甲"]).mockResolvedValue(["乙"])
    mocks.refine.mockReturnValueOnce(firstRefine.promise).mockResolvedValue([])
    await openDialog()
    expect(shownNames()).toEqual(["甲"])
    await click(buttonWith("取消"))
    expect(dialogEl()).toBeNull()
    // 同一个角色重新打开：新会话已经落地了它自己的名单。
    await act(async () => bindButton().click())
    expect(dialogEl()).not.toBeNull()
    expect(shownNames()).toEqual(["乙"])
    // 第一次会话的精修这时才回来，它属于那个已经关掉的对话框，绝不能并进新名单。
    await act(async () => { firstRefine.resolve(["陈旧甲", "陈旧乙"]) })
    await act(async () => {})
    expect(shownNames()).not.toContain("陈旧甲")
    expect(shownNames()).not.toContain("陈旧乙")
    expect(shownNames()).toEqual(["乙"])
  })

  it("后台精修落地后已勾选的人物仍然勾着，确认提交的正是这些人物", async () => {
    const refined = deferred<string[]>()
    mocks.listBindable.mockResolvedValue(["甲", "乙"])
    mocks.refine.mockReturnValue(refined.promise)
    await openDialog()
    await click(checkboxFor("甲"))
    await click(checkboxFor("乙"))
    expect(checkboxFor("甲")!.checked).toBe(true)
    expect(checkboxFor("乙")!.checked).toBe(true)
    // 精修补进新名字：names 换成一个新数组，勾选不能被顺带清空。
    await act(async () => { refined.resolve(["丙"]) })
    await act(async () => {})
    expect(shownNames()).toEqual(["甲", "乙", "丙"])
    expect(checkboxFor("甲")!.checked).toBe(true)
    expect(checkboxFor("乙")!.checked).toBe(true)
    expect(confirmButton()!.textContent).toContain("绑定所选 2 个人物")
    await click(confirmButton())
    expect(mocks.bindCharacters).toHaveBeenCalledWith("/project", legacyBook, expect.anything(), "林烬", ["甲", "乙"])
  })
})
