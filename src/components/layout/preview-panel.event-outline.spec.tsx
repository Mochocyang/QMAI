// @vitest-environment jsdom

/**
 * 丙-2a：章节区「生成章节细纲」全流程。
 * 丙-2b：确认细纲后**直接在章节区写出正文**（不切视图、不进对话、不再点「写入本章」）。
 *
 * ── 为什么是渲染断言而不是源码文本断言 ──
 * 本批的要害是**入口换了地方之后仍然真的能用**：点按钮要弹向导、提交要真的
 * 发起生成、结果要在章节区出现一张能确认的卡片。这些全是行为，
 * 源码里存在 `EventOutlineCard` 这个字符串证明不了其中任何一条
 * （preview-panel.chapter-toolbar.spec.tsx 的注释里记录过同类教训：
 * 把入口包成 `{false ? … : null}` 时源码断言依然全绿）。
 *
 * 生成函数被 mock 掉：这里测的是接线（谁在什么时候调用它、结果怎么落地），
 * 不是 LLM 交互。真实解析逻辑在 event-outline-generation.spec.ts 里测，
 * 真实章节工作流在 deep-chapter-generation.spec.ts 里测。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { useWikiStore } from "@/stores/wiki-store"
import { useEventOutlineTaskStore } from "@/stores/event-outline-task-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { useWritingStatsStore } from "@/stores/writing-stats-store"
import { normalizeCountableText } from "@/lib/writing-stats"
import { normalizeComparablePath } from "@/lib/path-utils"
import { USER_ABORT_MESSAGE } from "@/lib/user-abort"
import type { EventOutlineData, EventOutlineRequest } from "@/lib/novel/event-outline"
import type { DeepChapterGenerationResult } from "@/lib/novel/deep-chapter-generation"

const fixture = vi.hoisted(() => ({
  generateEventOutline: vi.fn(),
  runDeepChapterGeneration: vi.fn(),
  ingestChapter: vi.fn(),
  /**
   * 内存文件系统。
   *
   * 丙-2b 的落盘路径要「写盘 → 选中」并靠 readFile 打归属基线，用一个会说谎的
   * readFile（永远返回同一段模板文本）测不出这些；而且新章节的 readFile 必须能
   * **失败**（文件还不存在 → 走 `.catch(() => undefined)`）。
   */
  files: new Map<string, string>(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  writeFileAtomic: vi.fn(),
  createDirectory: vi.fn(),
  listDirectory: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock("@/lib/novel/event-outline-generation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/novel/event-outline-generation")>(),
  generateEventOutline: fixture.generateEventOutline,
}))
/*
 * 只替换这条顶层入口：它是丙-2b 唯一的正文来源，测试要断言「传了什么进去」。
 * 不走 importOriginal —— 那个模块会拖进整条上下文/审查链，而本文件测的是接线。
 */
vi.mock("@/lib/novel/deep-chapter-generation", () => ({
  runDeepChapterGeneration: fixture.runDeepChapterGeneration,
}))
/*
 * 草稿隔离的另一半在这里：**没有**任何自动摄取。
 * ingestChapter 是全仓唯一的章节摄取入口，把它换成 spy，就钉住了
 * 「AI 刚写出来的草稿不得被摄取进记忆库」。
 */
vi.mock("@/lib/novel/chapter-ingest", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/novel/chapter-ingest")>(),
  ingestChapter: fixture.ingestChapter,
}))
vi.mock("@/commands/fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/commands/fs")>(),
  readFile: fixture.readFile,
  writeFile: fixture.writeFile,
  writeFileAtomic: fixture.writeFileAtomic,
  createDirectory: fixture.createDirectory,
  listDirectory: fixture.listDirectory,
  fileExists: fixture.fileExists,
}))
vi.mock("@/components/skill-library/use-de-ai-skill-options", () => ({
  useDeAiSkillOptions: () => ({ loading: false, skills: [], effectiveName: "未启用", currentSkillId: null, defaultSkillId: null, loadError: "" }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const project = { id: "event-outline-spec", name: "测试书", path: "C:/test-book" }
/** 编辑器里一开始打开的那一章（第 16 章，章节区的规范命名）。 */
const openChapterPath = `${project.path}/wiki/chapters/第16章.md`
const CHAPTER = "---\ntype: chapter\nchapter_number: 16\nchapter_status: draft\n---\n\n# 第16章 实际章名\n\n　　雨停了。"

/*
 * 「writing」这一档的模型解析要求模型**已注册**（resolveNovelModel → isModelKeyRegistered），
 * 只设 apiKey/model 是不够的：那样 hasUsableLlm 会判为不可用，
 * 于是测的就不是生成接线而是"未配置模型"的报错分支了。
 * 这里照 outline-chat-panel.spec.tsx:138 的既有写法注册一个模型。
 */
const USABLE_PROVIDER_CONFIGS = {
  openai: {
    apiKey: "test-key",
    enabled: true,
    savedModels: [{ id: "gpt-4o", model: "gpt-4o", name: "GPT-4o", createdAt: 1 }],
  },
}

const OUTLINE: EventOutlineData = {
  version: 1,
  chapterNumber: 7,
  title: "第7章 · 雨夜递刀",
  targetWords: 3000,
  events: [{ id: 1, title: "楚白在巷口截住骆轻竹", points: ["关键台词：别回头", "神情动作：手按刀柄"] }],
  endingHook: "刀落下的声音从身后传来。",
}

/**
 * 丙-2b 用的细纲：**必须能通过 `validateEventOutlineData`**（4~8 个事件、每事件
 * ≥2 条抓手、有钩子），否则 `EventOutlineCard` 的那枚确认按钮根本不会渲染
 * （它由 `onWriteChapter && validation.ok` 双条件 gate），用例就点不到确认件。
 * 上面那条 1 个事件的 `OUTLINE` 是丙-2a 的历史夹具，故意不动它。
 */
function outlineFor(chapterNumber: number): EventOutlineData {
  const titles = [
    "楚白在巷口截住骆轻竹",
    "两人沿河堤追出三里地",
    "骆轻竹抽出腰间短刀",
    "刀落下的声音从身后传来",
  ]
  return {
    version: 1,
    chapterNumber,
    title: `第${chapterNumber}章 · 雨夜递刀`,
    targetWords: 3000,
    events: titles.map((title, index) => ({
      id: index + 1,
      title,
      points: ["关键台词：别回头", "神情动作：手按刀柄"],
    })),
    endingHook: "刀落下的声音从身后传来。",
  }
}

/**
 * 章节区自己的规范命名：`第N章-标题.md` / `第N章.md`（`makeChapterFileName` 的口径）。
 *
 * ⚠️ 这个夹具口径本身是被测对象的一部分。旧的夹具用的是 `chapter-NNN.md`，
 * 那恰好是缺陷里那个**错的**目标名 —— 用错的名字做夹具，等于让「路径拼错了」
 * 这件事看起来像正常。
 */
function chapterAreaPath(chapterNumber: number, title?: string): string {
  const stem = title ? `第${chapterNumber}章-${title}` : `第${chapterNumber}章`
  return `${project.path}/wiki/chapters/${stem}.md`
}

/**
 * AI 对话那条链路落盘的**草稿**命名（`chapter-006.md`）——`isDraftChapterPath` 的定义。
 *
 * 丙-2b 不再往这里写（`chat-panel` 随后会把它改名成规范名）。保留这个 helper
 * 只为一件事：断言「**没有**写到那儿去」——同一章两个文件正是缺陷 N3 的形状。
 */
function draftChapterPath(chapterNumber: number): string {
  return `${project.path}/wiki/chapters/chapter-${String(chapterNumber).padStart(3, "0")}.md`
}

/** 往内存盘里种一个既有的章节区文件，返回它的路径。 */
function seedExistingChapter(chapterNumber: number, options: { title?: string; body?: string } = {}): string {
  const title = options.title ?? `第${chapterNumber}章-原稿`
  const path = chapterAreaPath(chapterNumber, options.title ?? "原稿")
  fixture.files.set(
    path,
    `---\ntype: chapter\nchapter_number: ${chapterNumber}\nchapter_status: draft\ntitle: "${title}"\n---\n\n${options.body ?? "　　原本的正文。"}`,
  )
  return path
}

/**
 * 让 `listDirectory` 如实反映内存盘里 `wiki/chapters` 的内容。
 *
 * 这不是可有可无的仿真：`findChapterFileByNumber`（N3 的目标路径解析）就是
 * 「列目录 + 读 frontmatter」，返回空数组等于**假装章节库是空的** ——
 * 那样测的就只是「新建」这一半，而「同一章已经在盘上」正是缺陷所在。
 */
function chapterDirectoryEntries(): Array<{ name: string; path: string; is_dir: boolean }> {
  const prefix = `${project.path}/wiki/chapters/`
  return [...fixture.files.keys()]
    .filter((path) => path.startsWith(prefix))
    .map((path) => ({ name: path.slice(prefix.length), path, is_dir: false }))
}

function deepResult(finalContent: string): DeepChapterGenerationResult {
  return {
    finalContent,
    taskBrief: "",
    draftContent: finalContent,
    reviewResults: [],
    revised: false,
  }
}

/** 模型产出的章节正文（不含 H1：标题只进 frontmatter）。 */
const AI_PROSE = [
  "雨停在子时。",
  "",
  "楚白在巷口截住了骆轻竹，手一直按在刀柄上。",
  "「别回头。」他说。",
  "",
  "刀落下的声音从身后传来。",
].join("\n")

let container: HTMLDivElement
let root: Root

async function mount() {
  useWikiStore.setState({
    project,
    selectedFile: openChapterPath,
    novelMode: true,
    activeView: "wiki",
    aiChatModel: "gpt-4o",
    providerConfigs: USABLE_PROVIDER_CONFIGS,
    llmConfig: { ...useWikiStore.getInitialState().llmConfig, provider: "openai", apiKey: "test-key", model: "gpt-4o" },
  })
  await act(async () => { root.render(<PreviewPanel />) })
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
}

function button(label: string, scope: ParentNode = container) {
  const found = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => (
    item.getAttribute("aria-label") === label || item.textContent?.trim() === label
  ))
  expect(found, `应有可操作的「${label}」入口`).toBeDefined()
  return found!
}

async function click(label: string) {
  await act(async () => { button(label).click() })
}

function setTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

/**
 * 向导是 Radix Dialog，内容被 **portal 到 document.body**，
 * 不在 container 里面 —— 用 container 查会一律拿到 null。
 */
function dialogRoot(): ParentNode {
  return document.body
}

/**
 * 给章节库种两个已存在的章节（第001/第003章），让「默认章号」有唯一正确答案 4。
 *
 * 写法照 outline-chat-panel.spec.tsx:2799-2805：`nextEventOutlineChapterNumber` 走的是
 * flattenMdFiles(fileTree) → pickChapterLibraryFiles → resolveNextChapterNumber，
 * 所以只要往 fileTree 里放章节文件即可，不需要真的去 mock listDirectory 的递归输出。
 */
function seedChapterLibrary() {
  useWikiStore.setState({
    fileTree: [
      { name: "第001章.md", path: `${project.path}/wiki/chapters/第001章.md`, is_dir: false },
      { name: "第003章.md", path: `${project.path}/wiki/chapters/第003章.md`, is_dir: false },
    ],
  })
}

/**
 * 种一条**非空**的大纲会话。
 *
 * 用途只有一个：让「生成细纲全程不碰大纲会话」那条用例的比较有判别力 ——
 * store 初值是 `conversations: []`，不 seed 的话 `[] toEqual []` 恒真。
 */
function seedOutlineConversation() {
  useOutlineChatStore.setState({
    conversations: [{
      id: "seeded-outline-chat",
      title: "生成第1章事件细纲（6 个事件）",
      createdAt: 1,
      updatedAt: 1,
      messages: [
        { id: "seeded-user", role: "user", content: "生成第 1 章事件细纲（6 个事件）" },
      ],
    }],
    activeConversationId: "seeded-outline-chat",
  })
}

/** 走完「点按钮 → 填向导 → 提交」这条真实路径，返回生成函数的调用参数。 */
async function submitWizard(requirement = "", chapterNumber = ""): Promise<EventOutlineRequest> {
  await click("生成章节细纲")
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog, "点「生成章节细纲」应弹出向导").not.toBeNull()
  if (chapterNumber) {
    await act(async () => {
      setInput(document.querySelector('input[aria-label="目标章节"]')!, chapterNumber)
    })
  }
  if (requirement) {
    await act(async () => {
      setTextarea(document.querySelector('textarea[aria-label="本章想法/硬要求"]')!, requirement)
    })
  }
  await act(async () => { button("生成细纲", dialogRoot()).click() })
  await act(async () => { await Promise.resolve() })
  return fixture.generateEventOutline.mock.calls.at(-1)![1] as EventOutlineRequest
}

/**
 * 让 mock 表现得像真实模块：**取消时 reject**。
 *
 * 真实 generateEventOutline 在 await 之后自查信号并抛 USER_ABORT_MESSAGE
 * （因为 streamChat 取消时是正常 onDone 返回、不 reject）；
 * 这里必须照抄这个契约，否则组件测试测不到「取消 → 任务被收尾」这条链路。
 * 返回一个 resolve 钩子，让用例自行决定何时算生成完。
 */
function mockAbortableGeneration() {
  const resolvers = new Map<number, (value: { outline: EventOutlineData | null; rawContent: string; error: string | null }) => void>()
  // 每次调用的 signal 都留档：F1/F2 的断言必须能直接看「第几次调用的那个 controller 被 abort 了吗」，
  // 靠 store 行数或调用次数都推不出这件事（旧实现照样调两次、行数也照样是 1）。
  const signals: AbortSignal[] = []
  let callIndex = 0
  fixture.generateEventOutline.mockImplementation(
    (_p: string, _r: unknown, _c: unknown, _cb: unknown, signal?: AbortSignal) => {
      const index = callIndex++
      if (signal) signals[index] = signal
      return new Promise((resolve, reject) => {
        resolvers.set(index, resolve)
        signal?.addEventListener("abort", () => {
          const abortError = Object.assign(new Error(USER_ABORT_MESSAGE), { name: "AbortError" })
          reject(abortError)
        })
      })
    },
  )
  return { resolvers, signals, callIndexOf: (index: number) => resolvers.get(index) }
}

function taskRows(): HTMLElement[] {
  const section = container.querySelector('[aria-label="待确认的事件细纲"]')
  return section ? Array.from(section.querySelectorAll<HTMLElement>("[data-event-outline-task]")) : []
}

/** 取某一行的「取消」按钮（每行各有一个，按行取才能真正测到「取消哪一行」）。 */
function cancelButtonOf(row: HTMLElement): HTMLButtonElement {
  const found = Array.from(row.querySelectorAll("button")).find((item) => item.textContent?.trim() === "取消")
  expect(found, "生成中的行应有「取消」按钮").toBeDefined()
  return found as HTMLButtonElement
}

/**
 * 按章号找行，**不靠下标**：store 的 startTask 把新任务 prepend 在最前，
 * 所以「第几个」会随提交顺序反过来 —— 用下标选行会让用例选错目标，
 * 而这种错误看起来像被测代码有问题。
 */
function rowForChapter(chapterNumber: number): HTMLElement {
  const row = taskRows().find((item) => item.textContent?.includes(`正在生成第 ${chapterNumber} 章`))
  expect(row, `应有第 ${chapterNumber} 章那一行`).toBeDefined()
  return row!
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

/**
 * 等异步链路跑完（生成 → 落盘 → 选中 → 刷新目录）。
 *
 * 用一次宏任务而不是若干个 `Promise.resolve()`：落盘链路里串了多次真实 await
 * （createDirectory / readFile / writeFile / listDirectory 全是 mock 出来的 promise），
 * 宏任务把它们一次性排空，逐个微任务数数只会写成对实现顺序过度敏感的脆弱断言。
 */
async function settleAsync(rounds = 3): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
  }
}

/** 点细纲卡片上那枚确认件（即「用这份细纲写这一章」）。 */
async function confirmOutline(): Promise<void> {
  await click("用这份细纲写这一章")
  await settleAsync()
}

/** 找一行正文生成中的行（它的文案与细纲生成那行不同，不能靠下标猜）。 */
function writingRow(chapterNumber: number): HTMLElement {
  const row = taskRows().find((item) => item.textContent?.includes(`正在写第 ${chapterNumber} 章正文`))
  expect(row, `应有第 ${chapterNumber} 章的正文生成行`).toBeDefined()
  return row!
}

/**
 * 把两个 store 动作换成**带顺序记录**的包装，用于断言相对次序。
 *
 * 为什么不用 `vi.spyOn(store.getState(), "recordChapter")`：zustand 每次 `set` 都
 * `Object.assign({}, state, partial)` 造一个**新** state 对象，spy 装在旧对象上，
 * 组件下一次 `getState()` 拿到的就已经是没有 spy 的那份了。
 * `setState` 合并替换 + `beforeEach` 的 `setState(getInitialState())` 能干净还原。
 */
function trackStoreCallOrder() {
  const order: string[] = []
  const statsState = useWritingStatsStore.getState()
  const wikiState = useWikiStore.getState()
  const originalRecord = statsState.recordChapter
  const originalSelect = wikiState.setSelectedFile
  const record = vi.fn((...args: Parameters<typeof originalRecord>) => {
    order.push("recordChapter")
    return originalRecord(...args)
  })
  const select = vi.fn((...args: Parameters<typeof originalSelect>) => {
    order.push("setSelectedFile")
    return originalSelect(...args)
  })
  useWritingStatsStore.setState({ recordChapter: record })
  useWikiStore.setState({ setSelectedFile: select })
  return { order, record, select }
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  useWikiStore.setState(useWikiStore.getInitialState())
  useEventOutlineTaskStore.setState({ tasks: [] })
  // 大纲会话也归零：不 reset 的话种子会话会漏到下一条用例里
  // （「不碰大纲会话」那条用例的 before/after 都取自这里）。
  useOutlineChatStore.setState({ conversations: [], activeConversationId: null })
  /*
   * 写作统计也要归零：丙-2b 的用例会断言 recordChapter 的差分结果，
   * 而本文件此前从没碰过这个 store —— 不 reset 的话上一条用例的账本
   * （provenance / chapters）会漏下来，让「今日 AI 字数」变成两条用例的和。
   */
  useWritingStatsStore.setState(useWritingStatsStore.getInitialState())
  for (const spy of [
    fixture.generateEventOutline,
    fixture.runDeepChapterGeneration,
    fixture.ingestChapter,
    fixture.readFile,
    fixture.writeFile,
    fixture.writeFileAtomic,
    fixture.createDirectory,
    fixture.listDirectory,
    fixture.fileExists,
  ]) spy.mockReset()
  fixture.files.clear()
  // 磁盘上先有一份丙-2a 的既有章节（mount 会选中它）。
  fixture.files.set(openChapterPath, CHAPTER)
  fixture.readFile.mockImplementation(async (path: string) => {
    const content = fixture.files.get(path)
    // 文件不存在就 reject，跟真实 Tauri 一致：落盘路径必须先经历「读不到旧正文」。
    if (content === undefined) throw new Error(`文件不存在: ${path}`)
    return content
  })
  fixture.writeFile.mockImplementation(async (path: string, contents: string) => { fixture.files.set(path, contents) })
  fixture.writeFileAtomic.mockImplementation(async (path: string, contents: string) => { fixture.files.set(path, contents) })
  fixture.createDirectory.mockImplementation(async () => {})
  fixture.listDirectory.mockImplementation(async (path: string) => (
    path === `${project.path}/wiki/chapters` ? chapterDirectoryEntries() : []
  ))
  fixture.fileExists.mockImplementation(async (path: string) => fixture.files.has(path))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { useWikiStore.setState({ selectedFile: null, fileContent: "" }) })
  await act(async () => { root.unmount() })
  container.remove()
  // 向导 portal 挂在 document.body 上，卸载后可能留下残余节点；
  // 留着会让下一条用例的 `[role="dialog"]` 查到上一轮的对话框。
  document.body.innerHTML = ""
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("章节区生成章节细纲", () => {
  it("工具栏入口点击后弹出向导，且向导的默认章号来自章节库而不是写死", async () => {
    /*
     * 章节库必须**非空**，否则这条用例测不到它名字里的东西：
     * 空库下 resolveNextChapterNumber 回落到 1，把
     * defaultChapterNumber={nextEventOutlineChapterNumber} 换成字面量 1 也照样绿。
     * 这里照 outline-chat-panel.spec.tsx:2799-2815 的既有做法种下第001/第003章，
     * 于是「下一章」唯一正确的答案是 4。
     */
    seedChapterLibrary()
    await mount()
    await click("生成章节细纲")
    const input = document.querySelector<HTMLInputElement>('input[aria-label="目标章节"]')!
    expect(input.value).toBe("4")
  })

  it("提交向导会真的发起生成，并把向导里的要求原样带过去", async () => {
    fixture.generateEventOutline.mockResolvedValue({ outline: OUTLINE, rawContent: "", error: null })
    await mount()
    const request = await submitWizard("必须交代骆轻竹为什么失望")
    expect(fixture.generateEventOutline).toHaveBeenCalledTimes(1)
    expect(request.chapterNumber).toBe(1)
    expect(request.eventCount).toBe(6)
    expect(request.requirement).toBe("必须交代骆轻竹为什么失望")
  })

  /*
   * 下一步（丙-2b）要的正是这份数据：细纲要能落进 store 变成一张卡片。
   * 本批先把「生成结果确实出现在章节区」钉住。
   */
  it("生成成功后，细纲卡片出现在章节区（不切视图、不进对话）", async () => {
    fixture.generateEventOutline.mockResolvedValue({ outline: OUTLINE, rawContent: "", error: null })
    await mount()
    await submitWizard()

    const section = container.querySelector('[aria-label="待确认的事件细纲"]')
    expect(section, "章节区应出现待确认细纲区").not.toBeNull()
    expect(section!.textContent).toContain("第7章 · 雨夜递刀")
    expect(section!.textContent).toContain("楚白在巷口截住骆轻竹")
    expect(section!.querySelector("[data-event-outline-card]")).not.toBeNull()
    // 全程留在章节区：不能因为生成细纲把用户踢去大纲会话
    expect(useWikiStore.getState().activeView).toBe("wiki")
  })

  it("生成中显示进度提示，不是静默等待", async () => {
    let release: (value: { outline: EventOutlineData | null; rawContent: string; error: string | null }) => void = () => {}
    fixture.generateEventOutline.mockImplementation((_p: string, _r: unknown, _c: unknown, callbacks: { onToken?: (token: string, receivedChars: number) => void }) => {
      callbacks.onToken?.("x".repeat(2500), 2500)
      return new Promise((resolve) => { release = resolve })
    })
    await mount()
    await submitWizard()

    const section = container.querySelector('[aria-label="待确认的事件细纲"]')!
    expect(section.textContent).toContain("正在生成第")
    expect(section.textContent).toContain("已收到 2500 字")

    await act(async () => { release({ outline: OUTLINE, rawContent: "", error: null }) })
  })

  /*
   * 需求原话是「不切视图、**不走大纲会话**」。前一半由上面「卡片出现在章节区」钉住，
   * 后一半需要单独钉：往 handleSubmitEventOutline 里加一句
   * useOutlineChatStore.getState().addMessage(...) 不会让任何别的用例变红。
   *
   * ⚠️ 这条用例过去是**空数组比较**（useOutlineChatStore 初始 conversations: []，
   * 而 spec 既不 seed 也不 reset ⇒ `[] toEqual []` 恒真）。所以必须在 mount 前
   * seed 一条**含消息**的会话，`afterEach` 里再清掉，否则它只证明了「0 == 0」。
   */
  it("生成细纲全程不碰大纲会话（会话数与消息数都不变）", async () => {
    seedOutlineConversation()
    const before = useOutlineChatStore.getState().conversations
    // 反向控制：seed 必须真的生效，否则下面两条断言又会退化成空数组比较。
    expect(before).toHaveLength(1)
    expect(before[0].messages.length).toBeGreaterThan(0)
    fixture.generateEventOutline.mockResolvedValue({ outline: OUTLINE, rawContent: "", error: null })
    await mount()
    await submitWizard("必须交代骆轻竹为什么失望")
    await act(async () => { await Promise.resolve() })

    const after = useOutlineChatStore.getState().conversations
    expect(after).toHaveLength(before.length)
    expect(after.map((conversation) => conversation.messages.length))
      .toEqual(before.map((conversation) => conversation.messages.length))
    // 视图也没被切走
    expect(useWikiStore.getState().activeView).toBe("wiki")
  })

  /*
   * 进度节流：「每 2000 字**或**每 1 秒才写一次 store」这个条件必须是 `&&`。
   *
   * 只有一条 2500 字的用例是**测不到算符**的：那种输入下 `&&` 与 `||` 都会写
   * （2500 已超 2000）。这里用「窗口内的小增量」把差别逼出来：
   * - 第 1 次（距上次上报已远超 1 秒、但只收到 500 字）：
   *   `&&` → 时间达标 → 写；`||` → 500 < 2000 成立 → 被抑制。
   *   **这一步就是算符的区分点**（实测把 `&&` 改成 `||` 会在这里变红）。
   * - 第 2 次（仅 +500 字、又只过 100ms）：两种算符都该抑制，不构成区分，
   *   它守的是「节流确实生效」这件事本身。
   * - 第 3 次（累计差正好 2000 字、但时间仍在 1 秒内）：`&&` → 写。
   *   这条顺带钉住「写进 store 的是**累计**字数而不是本次增量」——
   *   若误写成增量，显示会是 1500 而不是 2500。
   *
   * 时间用 Date.now 的 spy 精确控制：靠真实等待既慢又不稳（CI 抖动会让
   * 「1 秒内」偶然不成立，测试随机变红）。
   */
  it("进度节流：窗口内的小增量不刷 UI，时间达标就写累计字数", async () => {
    let release: (value: { outline: EventOutlineData | null; rawContent: string; error: string | null }) => void = () => {}
    let emit: ((token: string, receivedChars: number) => void) | null = null
    fixture.generateEventOutline.mockImplementation((_p: string, _r: unknown, _c: unknown, callbacks: { onToken?: (token: string, receivedChars: number) => void }) => {
      emit = (token, receivedChars) => callbacks.onToken?.(token, receivedChars)
      return new Promise((resolve) => { release = resolve })
    })

    let now = 1_000_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    await mount()
    await submitWizard()

    const progressText = () => container.querySelector('[aria-label="待确认的事件细纲"]')!.textContent ?? ""

    // 第 1 次：距上次上报（初始 0）远超 1 秒 → 必须写
    await act(async () => { emit?.("x".repeat(500), 500) })
    expect(progressText()).toContain("已收到 500 字")

    // 第 2 次：仅 +500 字、且只过了 100ms → 两种算符都该抑制
    now += 100
    await act(async () => { emit?.("x".repeat(500), 1000) })
    expect(progressText(), "窗口内的小增量不该刷新 UI").toContain("已收到 500 字")
    expect(progressText()).not.toContain("已收到 1000 字")

    // 第 3 次：累计差正好 2000 字（字数达标），但时间仍在 1 秒内
    now += 100
    await act(async () => { emit?.("x".repeat(1500), 2500) })
    // && → 写；|| → 仍被时间条件卡住。这条断言是算符的区分点。
    expect(progressText(), "累计字数达标就该写一次").toContain("已收到 2500 字")

    await act(async () => { release({ outline: OUTLINE, rawContent: "", error: null }) })
  })

  it("生成失败时在章节区显示原因，并提供「知道了」收掉它", async () => {
    fixture.generateEventOutline.mockResolvedValue({ outline: null, rawContent: "", error: "网络连接中断" })
    await mount()
    await submitWizard()

    const section = container.querySelector('[aria-label="待确认的事件细纲"]')!
    expect(section.querySelector('[role="alert"]')?.textContent).toContain("网络连接中断")

    await act(async () => { button("知道了", container).click() })
    expect(container.querySelector('[aria-label="待确认的事件细纲"]')).toBeNull()
  })

  it("「丢弃这份细纲」把卡片收掉", async () => {
    fixture.generateEventOutline.mockResolvedValue({ outline: OUTLINE, rawContent: "", error: null })
    await mount()
    await submitWizard()
    expect(container.querySelector("[data-event-outline-card]")).not.toBeNull()

    await act(async () => { button("丢弃这份细纲", container).click() })
    expect(container.querySelector("[data-event-outline-card]")).toBeNull()
  })

  /*
   * 切章不该把卡片藏起来：用户完全可能在第 16 章上点了生成、拿到第 7 章的细纲
   * （向导的章号是可编辑的）。卡片按项目显示，不按 selectedFile。
   */
  it("切到别的章节后卡片仍在（它属于章节区，不属于某一份文档）", async () => {
    fixture.generateEventOutline.mockResolvedValue({ outline: OUTLINE, rawContent: "", error: null })
    await mount()
    await submitWizard()
    expect(container.querySelector("[data-event-outline-card]")).not.toBeNull()

    await act(async () => { useWikiStore.setState({ selectedFile: `${project.path}/wiki/chapters/第17章.md` }) })
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    expect(container.querySelector("[data-event-outline-card]")).not.toBeNull()
  })

  it("未配置可用模型时明确报错，不静默什么都不发生", async () => {
    const toastModule = await import("@/lib/toast")
    const errorSpy = vi.spyOn(toastModule.toast, "error").mockImplementation(() => {})
    await mount()
    await act(async () => {
      useWikiStore.setState({
        llmConfig: { ...useWikiStore.getInitialState().llmConfig, apiKey: "", model: "" },
        providerConfigs: {},
        defaultLlmModel: "",
        aiChatModel: "",
      })
    })
    await click("生成章节细纲")
    await act(async () => { button("生成细纲", dialogRoot()).click() })
    await act(async () => { await Promise.resolve() })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("未配置可用的 AI 模型"))
    expect(fixture.generateEventOutline).not.toHaveBeenCalled()
  })
})

/*
 * ── 取消：多任务并行时「取消哪一行」必须精确 ──
 *
 * 这一组补的是一个真实缺陷（两个症状、同一个根因）：
 *
 * `streamChat` 在用户取消时**不 reject**，而是正常 onDone() 返回
 * （llm-client.ts 请求阶段与读取流阶段各一处）。所以
 * 「取消之后任务会被收尾」这件事**不可能**靠 streamChat 抛错来实现。
 *
 * 修复前：取消用的是**单个** AbortController ref，且 .then 里
 * `if (controller.signal.aborted) return` —— 于是
 * (A) 被取消的任务永远停在 generating（那行 early-return 不收尾）；
 * (B) 在 A 行点「取消」会 abort 掉 ref 当时指向的 **B**，
 *     恰好停掉用户想保留的那个生成，两个任务随后都变成僵尸。
 *
 * 现在：controller 按 taskId 存（哪行取消哪个），取消语义的**唯一**归属点是
 * generateEventOutline（它 await 之后自查信号并抛 USER_ABORT_MESSAGE），
 * 调用方的 catch 负责 removeTask。
 */
describe("章节区生成章节细纲 · 取消", () => {
  it("在 A 行点取消：只停 A，B 仍在生成（不误停用户想留的那个）", async () => {
    const { callIndexOf } = mockAbortableGeneration()
    await mount()
    await submitWizard("", "1")
    await submitWizard("", "2")

    expect(taskRows(), "两章各起一个任务，应有两行").toHaveLength(2)
    const firstRow = rowForChapter(1)
    const firstTaskId = firstRow.getAttribute("data-event-outline-task")!
    const secondRow = rowForChapter(2)
    const secondTaskId = secondRow.getAttribute("data-event-outline-task")!
    expect(firstTaskId).not.toBe(secondTaskId)

    // 取消「第 1 章」那一行（它**不是**最新提交的那个，正是缺陷所在的情形）
    await act(async () => { cancelButtonOf(firstRow).click() })
    await act(async () => { await Promise.resolve() })

    // (i) A 行消失
    expect(taskRows().map((row) => row.getAttribute("data-event-outline-task"))).not.toContain(firstTaskId)
    // (ii) B 仍在，且仍是生成中
    const survivor = taskRows().find((row) => row.getAttribute("data-event-outline-task") === secondTaskId)
    expect(survivor, "B 不该被 A 的取消带走").toBeDefined()
    expect(survivor!.textContent).toContain("正在生成第 2 章")
    expect(cancelButtonOf(survivor!), "B 仍应可以取消（说明它还在生成中）").toBeDefined()

    // (iii) 没有任何「无人收尾」的僵尸任务：store 里只剩 B，且它还能被推进到终态
    const tasks = useEventOutlineTaskStore.getState().tasks
    expect(tasks.map((task) => task.id)).toEqual([secondTaskId])
    expect(tasks[0].status).toBe("generating")

    // B 正常收尾，证明确实还活着
    await act(async () => { callIndexOf(1)?.({ outline: OUTLINE, rawContent: "", error: null }) })
    expect(useEventOutlineTaskStore.getState().tasks[0].status).toBe("awaiting-confirm")
  })

  it("被取消的任务不会永远停在 generating（早退时必须收尾）", async () => {
    mockAbortableGeneration()
    await mount()
    await submitWizard("", "1")
    expect(useEventOutlineTaskStore.getState().tasks[0].status).toBe("generating")

    await act(async () => { cancelButtonOf(taskRows()[0]).click() })
    await act(async () => { await Promise.resolve() })

    // 取消不是失败：任务被摘掉，而不是留下一条 error，更不是停在 generating
    expect(useEventOutlineTaskStore.getState().tasks).toHaveLength(0)
    expect(taskRows()).toHaveLength(0)
  })

  /*
   * F8 的**乐观 removeTask** 的唯一行为覆盖。
   *
   * 上面那条「被取消的任务不会永远停在 generating」其实**钉不住**这一行：
   * 它的 mock 在 abort 时同步 reject，于是 generateEventOutline 的 catch
   * 本来就会 removeTask —— 删掉取消里的乐观 removeTask 照样绿（已实测）。
   *
   * F8 存在的那个场景是另一种传输：**忽略 abort、永不 settle**
   * （装配期的 buildContextPack 也不吃 signal）。此时没有任何回调会收尾，
   * 那一行只能靠取消时的乐观 removeTask 收掉；否则它会永远写着「正在生成」。
   * 这个 mock 就照抄那种传输：abort 之后既不 resolve 也不 reject。
   */
  it("传输忽略 abort、永不 settle 时，「取消」仍立刻把行收掉（不靠 promise 收尾）", async () => {
    // 永不 settle：没有 .then/.catch 会跑，removeTask 只可能来自取消本身
    fixture.generateEventOutline.mockImplementation(() => new Promise(() => {}))
    await mount()
    await submitWizard("", "1")
    expect(taskRows(), "生成中应有一行").toHaveLength(1)

    await act(async () => { cancelButtonOf(taskRows()[0]).click() })
    await act(async () => { await Promise.resolve() })

    // 刻意不 settle、不 await 任何生成 promise：行必须在点击后当场消失
    expect(taskRows(), "忽略 abort 的传输不得让那一行永远停在「正在生成」").toHaveLength(0)
    expect(useEventOutlineTaskStore.getState().tasks).toHaveLength(0)
  })

  /*
   * F1（major 回归）：同项目 + 同章号重提时，被取代的那次生成**必须被中止**。
   *
   * startTask 会把旧任务从 store 里移除（同一章两份细纲没有语义），
   * 但旧请求还在跑、还在计费，而它的行已经没了 —— finishTask(oldId) 按 id
   * 匹配会静默无用，用户既看不到那一行也没有「取消」可点。
   * 触发只要一步：向导提交后关掉，工具栏那枚按钮仍可点。
   *
   * 断言必须落在 **第一个 controller 的 aborted** 上：只看「调用两次」或
   * 「store 里剩一行」都区分不出修没修（把上面那段 abort 循环删掉，两者照样成立）。
   */
  it("同章重提会中止被取代的那次生成（旧请求不能继续计费）", async () => {
    const { signals } = mockAbortableGeneration()
    await mount()
    await submitWizard("", "1")
    expect(signals[0].aborted, "第一次提交时不该已经是 aborted").toBe(false)

    await submitWizard("", "1")
    await act(async () => { await Promise.resolve() })

    expect(fixture.generateEventOutline).toHaveBeenCalledTimes(2)
    expect(signals[0].aborted, "被取代的那次生成必须被 abort").toBe(true)
    expect(signals[1].aborted, "新任务不能被误中止").toBe(false)
    // store 里只剩新那一条
    expect(taskRows()).toHaveLength(1)
  })

  it("跨章重提不互相中止（只有同章号才取代）", async () => {
    const { signals } = mockAbortableGeneration()
    await mount()
    await submitWizard("", "1")
    await submitWizard("", "2")
    await act(async () => { await Promise.resolve() })

    expect(signals[0].aborted, "第 2 章的重提不该中止第 1 章").toBe(false)
    expect(signals[1].aborted).toBe(false)
    expect(taskRows()).toHaveLength(2)
  })

  /*
   * F2：controller 的 Map 必须是**模块级**的。
   *
   * PreviewPanel 会被真实重挂（ui-test-shell 在 wiki/sources 视图之间
   * 切换 ContentArea 与 UiTestWorkspace；sources-view / outline-workbench 也各自二选一）。
   * 重挂后新实例如果只有自己那份 Map，仍在 generating 的任务会从全局 store 里
   * 照常渲染出来，但点「取消」走 `if (!controller)` 分支 —— 只丢行、**不 abort**，
   * 请求继续计费。这条用例就是那次重挂。
   */
  it("重挂之后「取消」仍然真的中止请求（controller 不随组件实例丢失）", async () => {
    const { signals } = mockAbortableGeneration()
    await mount()
    await submitWizard("", "1")

    // 重挂：模拟视图切换导致 PreviewPanel 卸载重建
    await act(async () => { root.unmount() })
    container.remove()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await mount()

    expect(taskRows(), "重挂后仍在 generating 的任务必须照常渲染").toHaveLength(1)
    await act(async () => { cancelButtonOf(taskRows()[0]).click() })
    await act(async () => { await Promise.resolve() })

    expect(signals[0].aborted, "重挂后点取消仍必须真的 abort 那个请求").toBe(true)
    expect(taskRows()).toHaveLength(0)
  })

  /*
   * 本用例**不点任何按钮**，它断言的是 store 层语义（没有活跃 controller 时
   * removeTask 是安全的），所以标题如实写成 store 层。
   *
   * 原先的标题「生成已经结束的行再点取消」名不副实：awaiting-confirm 那行渲染的是
   * 「丢弃这份细纲」，根本没有「取消」可点 —— 这个场景在 UI 上不可达。
   */
  it("store 层：没有活跃 controller 时 removeTask 直接收掉该行且不抛错", async () => {
    const { callIndexOf } = mockAbortableGeneration()
    await mount()
    await submitWizard("", "1")
    // 先正常收尾（此时 controller 已从映射里摘掉）
    await act(async () => { callIndexOf(0)?.({ outline: OUTLINE, rawContent: "", error: null }) })
    expect(useEventOutlineTaskStore.getState().tasks[0].status).toBe("awaiting-confirm")

    // awaiting-confirm 那行显示的是「丢弃这份细纲」，不是「取消」；
    // 这里直接用 store 的公开动作模拟同一意图，确认没有活跃 controller 时不会抛错。
    await act(async () => {
      useEventOutlineTaskStore.getState().removeTask(useEventOutlineTaskStore.getState().tasks[0].id)
    })
    expect(useEventOutlineTaskStore.getState().tasks).toHaveLength(0)
  })
})

/*
 * ── 丙-2b：确认之后**直接在章节区**写出正文 ──
 *
 * 用户原话：「点击这个功能后，在章节区生成内容。生成内容后需要用户确认，
 * 用户确认之后，**直接在章节区当中生成最新的章节内容**。」
 * 前半段（生成 → 可确认的细纲卡片）由上面丙-2a 那组用例钉住；这里钉最后一句：
 * 点「用这份细纲写这一章」之后不得再有第二次手动采纳（没有聊天回合、没有
 * 「写入本章」按钮），正文必须直接落成章节文件并在章节区显示出来。
 */

/** 章节库种下第1/第3章（章节区规范命名）——「下一章」的唯一正确答案是 4。 */
function seedChapterAreaLibrary(): void {
  useWikiStore.setState({
    fileTree: [
      { name: "第1章.md", path: chapterAreaPath(1), is_dir: false },
      { name: "第3章.md", path: chapterAreaPath(3), is_dir: false },
    ],
  })
}

/** 让写作统计「认得这个项目」：`recordChapter` 在没有 projectPath 时直接早退、不记账。 */
function seedWritingStatsProject(): void {
  useWritingStatsStore.setState({
    projectPath: normalizeComparablePath(project.path),
    hydrated: true,
    humanChars: 0,
    aiChars: 0,
    provenance: {},
    chapters: {},
  })
}

/**
 * **实际交给 writeFile 的那串 markdown**（断言落盘内容，而不是断言内存盘里的副本）。
 *
 * 参数是**完整路径**而不是章号：本批的核心之一就是「写到哪个路径」（N3），
 * 按章号再去拼一个路径会把被测代码的目标名假设复制到断言里。
 */
function markdownHandedToWriteFile(path: string): string {
  const call = fixture.writeFile.mock.calls.find(([written]) => written === path)
  expect(call, `应有一笔写向 ${path} 的 writeFile`).toBeDefined()
  return call![1] as string
}

/** 手动控制的 promise：「取消之后生成才返回」这种时序只能这样造。 */
function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** 提交向导 → 确认细纲 → 等落盘跑完。 */
async function outlineThenConfirm(chapterNumber: number, prose = AI_PROSE): Promise<void> {
  fixture.generateEventOutline.mockResolvedValue({ outline: outlineFor(chapterNumber), rawContent: "", error: null })
  await submitWizard("", String(chapterNumber))
  fixture.runDeepChapterGeneration.mockResolvedValue(deepResult(prose))
  await confirmOutline()
}

describe("确认细纲后直接在章节区写出正文", () => {
  it("确认即生成：计划文本原样进 planBlueprint，正文写进规范章节名并选中它", async () => {
    seedWritingStatsProject()
    /*
     * 章节库种的是第1/第3章（下一章是 4），而向导里提交的是**第 2 章** ——
     * 两者故意不同：目标章号必须以**任务**（用户在向导里的指定）为准，
     * 若哪天改成 library+1，落盘路径会变成第4章.md，这条用例立刻变红。
     */
    seedChapterAreaLibrary()
    await mount()
    await outlineThenConfirm(2)

    // (1) 正文生成入口被调用**恰好一次**，且细纲真的进了 planBlueprint
    expect(fixture.runDeepChapterGeneration).toHaveBeenCalledTimes(1)
    const [input, , , signal] = fixture.runDeepChapterGeneration.mock.calls[0] as [
      { planBlueprint?: string; userRequest: string; chapterNumber?: number; projectPath: string },
      unknown,
      unknown,
      AbortSignal,
    ]
    expect(input.projectPath).toBe(project.path)
    expect(input.chapterNumber).toBe(2)
    expect(input.planBlueprint, "细纲必须作为计划文本传进去").toContain("楚白在巷口截住骆轻竹")
    expect(input.planBlueprint).toContain("第 2 章正文")
    expect(input.planBlueprint).toContain("刀落下的声音从身后传来")
    // userRequest 只放一句短指令：完整要求已经在 planBlueprint 里，不重复一遍
    expect(input.userRequest).not.toContain("楚白在巷口截住骆轻竹")
    expect(input.userRequest).toContain("第 2 章")
    expect(signal, "必须把取消信号交给正文生成").toBeInstanceOf(AbortSignal)

    // (2) 写进章节区自己的规范名（第2章.md），**不是** chapter-002.md 那种 AI 草稿名
    const targetPath = chapterAreaPath(2)
    expect(fixture.writeFile).toHaveBeenCalledTimes(1)
    expect(fixture.writeFile.mock.calls[0][0]).toBe(targetPath)
    expect(fixture.files.has(draftChapterPath(2)), "同一章不得再出现一份 chapter-NNN.md 的重复文件").toBe(false)
    expect(markdownHandedToWriteFile(targetPath)).toContain("chapter_number: 2")
    expect(markdownHandedToWriteFile(targetPath)).toContain("雨停在子时")
    expect(fixture.createDirectory).toHaveBeenCalledWith(`${project.path}/wiki/chapters`)

    // (3) 章节区就在这一章上：选中它、编辑器内容就是刚生成的正文、卡片交接完成后收掉
    expect(useWikiStore.getState().selectedFile).toBe(targetPath)
    expect(useWikiStore.getState().fileContent).toContain("雨停在子时")
    expect(container.querySelector("[data-event-outline-card]"), "交接完成后不该再留细纲卡片").toBeNull()
    expect(useEventOutlineTaskStore.getState().tasks).toHaveLength(0)
    // 没有切视图：这一整条链路都在章节区里完成
    expect(useWikiStore.getState().activeView).toBe("wiki")
  })

  it("写进章节文件的是 draft：草稿隔离在代码里是字面量，没有开关可翻", async () => {
    await mount()
    await outlineThenConfirm(2)

    const written = markdownHandedToWriteFile(chapterAreaPath(2))
    expect(written).toContain("chapter_status: draft")
    expect(written).not.toMatch(/chapter_status:\s*final/)
    // 标题只在 frontmatter，正文不带 H1（否则章节头会出现两遍章名）
    expect(written.startsWith("---\ntype: chapter\nchapter_number: 2\nchapter_status: draft\n")).toBe(true)
    expect(written).not.toMatch(/^#\s/m)
  })

  /*
   * ⚠️ 这条用例**钉的是源码次序约定，不是它的可观测后果**（F4）。
   *
   * 此前它的标题与注释把下面那句 aiChars 断言说成「顺序反了的可观测后果」——
   * 那是**过度声称**：recordChapter 与 setSelectedFile 之间没有 await，React 的
   * effect 不会插进两个同步语句之间，所以把源码里两句对调，aiChars **不会变**
   * （实测：只关掉本用例的次序断言、保留 aiChars 断言，对调源码仍是 26/26 全绿）。
   *
   * 于是这里诚实地分成两半：
   * - 次序断言：这是**约定**（下面那句 aiChars 只是「这一章确实记进了今日 AI」，
   *   与新章、无旧正文这条路径有关，与次序无关）；
   * - 真正会因次序出错的场景，需要有人将来在两句之间插入 await —— 那时代入
   *   重载 effect 的 primeChapter 打基线才会发生（见组件里那段注释）。
   */
  it("记账与选中的相对次序是约定：recordChapter 必须排在 setSelectedFile 之前", async () => {
    seedWritingStatsProject()
    const { order } = trackStoreCallOrder()
    await mount()
    await outlineThenConfirm(2)

    expect(order, "记账与选中都必须发生").toContain("recordChapter")
    expect(order).toContain("setSelectedFile")
    expect(
      order.indexOf("recordChapter"),
      "recordChapter 必须在 setSelectedFile 之前（约定；选中会触发重载 effect 打归属基线）",
    ).toBeLessThan(order.indexOf("setSelectedFile"))
    // 另一半（与次序无关）：这一章确实整章记进了「今日 AI 生成」。
    // 新章没有旧正文，recordChapter 走的是「无从得知旧正文 + 来源是 ai」那条分支。
    const written = markdownHandedToWriteFile(chapterAreaPath(2))
    expect(useWritingStatsStore.getState().aiChars).toBe(normalizeCountableText(written).length)
  })

  it("目标就是编辑器里当前这一章时，先把未保存改动冲刷到磁盘再覆盖", async () => {
    seedWritingStatsProject()
    const chapterThree = seedExistingChapter(3)
    const originalDraft = fixture.files.get(chapterThree)!
    const unsavedEdit = "---\ntype: chapter\nchapter_number: 3\nchapter_status: draft\ntitle: \"第3章-原稿\"\n---\n\n　　用户刚敲下、还没保存的一段话。"
    fixture.generateEventOutline.mockResolvedValue({ outline: outlineFor(3), rawContent: "", error: null })
    fixture.runDeepChapterGeneration.mockResolvedValue(deepResult(AI_PROSE))
    await mount()

    // 切到第 3 章（磁盘上有原稿），再把编辑器内容改成「未保存的改动」：
    // fileContent → fileContentRef 的 effect 会让落盘路径读到它，磁盘仍是原稿。
    await act(async () => { useWikiStore.setState({ selectedFile: chapterThree }) })
    await settleAsync(2)
    await act(async () => { useWikiStore.setState({ fileContent: unsavedEdit }) })
    await settleAsync(1)
    expect(fixture.files.get(chapterThree)).toBe(originalDraft)

    const atomicCallsBeforeConfirm = fixture.writeFileAtomic.mock.calls.length
    /*
     * 冲刷那一笔刻意做成**慢一拍**（真实 Tauri IPC 本来就不是同步的）。
     *
     * 只有慢下来，「没 await 冲刷就直接覆盖写」这个缺陷才会以它真正的后果暴露：
     * AI 正文先落盘、旧编辑器快照后落盘，把刚生成的一整章盖回用户的半句草稿。
     * 两条 promise 链在同一个微任务批次里赛跑时**恰好**会对（实测：把
     * `await flushChapterBeforeLeave` 改成 `void`，慢下来之前全绿），
     * 那样的用例等于没测「await」这件事。
     */
    fixture.writeFileAtomic.mockImplementation(async (path: string, contents: string) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      fixture.files.set(path, contents)
    })
    await submitWizard("", "3")
    await confirmOutline()

    /*
     * 断言的是**确认那一刻新发生的那一笔** writeFileAtomic（冲刷），而不是
     * 历史上任何一笔 —— 否则「冲刷有没有跑」会被别的保存路径冒充。
     */
    const flushCall = fixture.writeFileAtomic.mock.calls
      .slice(atomicCallsBeforeConfirm)
      .find(([path, content]) => path === chapterThree && String(content).includes("用户刚敲下"))
    expect(flushCall, "同章覆盖前必须先把这一章的未保存改动冲刷到磁盘").toBeDefined()
    const flushIndex = fixture.writeFileAtomic.mock.calls.indexOf(flushCall!)
    expect(
      fixture.writeFileAtomic.mock.invocationCallOrder[flushIndex],
      "冲刷必须早于覆盖写（不 await 就会与 writeFile 抢同一个文件）",
    ).toBeLessThan(fixture.writeFile.mock.invocationCallOrder[0])
    // 覆盖之后盘上、编辑器里都是 AI 正文
    expect(markdownHandedToWriteFile(chapterThree)).toContain("雨停在子时")
    expect(
      fixture.files.get(chapterThree),
      "冲刷晚于覆盖写的话，旧快照会把刚生成的整章盖回去",
    ).toBe(markdownHandedToWriteFile(chapterThree))
    expect(useWikiStore.getState().fileContent).toContain("雨停在子时")
  })

  it("正文生成失败：退回待确认、细纲原样保留、原因可见且可直接重试", async () => {
    await mount()
    fixture.generateEventOutline.mockResolvedValue({ outline: outlineFor(2), rawContent: "", error: null })
    await submitWizard("", "2")
    fixture.runDeepChapterGeneration.mockRejectedValue(new Error("模型超时"))
    await confirmOutline()

    const task = useEventOutlineTaskStore.getState().tasks[0]
    expect(task.outline?.title, "细纲要原样留着，否则用户没法重试").toBe("第2章 · 雨夜递刀")
    expect(task.status, "失败后必须回到可确认状态").toBe("awaiting-confirm")
    expect(task.writingError).toContain("模型超时")
    // 卡片与主按钮都还在（那枚按钮同时就是「重试」）
    expect(container.querySelector("[data-event-outline-card]")).not.toBeNull()
    expect(button("用这份细纲写这一章").disabled).toBe(false)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("模型超时")
    // 失败不落盘
    expect(fixture.writeFile).not.toHaveBeenCalled()
  })

  it("正文生成中点「取消」会 abort 请求，晚到的结果也绝不落盘", async () => {
    const deferred = createDeferred<DeepChapterGenerationResult>()
    const signals: AbortSignal[] = []
    // 不接受 signal 的传输：abort 只影响我们自己的收尾，生成照常返回（F8 那种形态）
    fixture.runDeepChapterGeneration.mockImplementation((_i: unknown, _c: unknown, _d: unknown, signal: AbortSignal) => {
      signals.push(signal)
      return deferred.promise
    })
    await mount()
    fixture.generateEventOutline.mockResolvedValue({ outline: outlineFor(1), rawContent: "", error: null })
    await submitWizard("", "1")
    await confirmOutline()

    const row = writingRow(1)
    expect(signals[0].aborted, "还没取消时不该是 aborted").toBe(false)
    await act(async () => { cancelButtonOf(row).click() })

    expect(signals[0].aborted, "点取消必须真的 abort 那次请求").toBe(true)
    const task = useEventOutlineTaskStore.getState().tasks[0]
    expect(task.status).toBe("awaiting-confirm")
    // 取消不是失败：不留红色错误
    expect(task.writingError).toBeNull()
    expect(task.outline?.title).toBe("第1章 · 雨夜递刀")
    expect(container.querySelector("[data-event-outline-card]")).not.toBeNull()
    expect(taskRows()[0].textContent).not.toContain("正在写第 1 章正文")

    // 传输忽略 abort、生成在取消之后才返回：晚到的正文必须被丢弃
    await act(async () => { deferred.resolve(deepResult(AI_PROSE)) })
    await settleAsync()
    expect(fixture.writeFile, "取消之后晚到的正文不得落盘").not.toHaveBeenCalled()
    expect(useEventOutlineTaskStore.getState().tasks[0].status).toBe("awaiting-confirm")
  })

  it("正文生成中同章重提细纲：被取代的那次请求必须被中止", async () => {
    const signals: AbortSignal[] = []
    fixture.runDeepChapterGeneration.mockImplementation((_i: unknown, _c: unknown, _d: unknown, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise(() => {})
    })
    fixture.generateEventOutline.mockResolvedValue({ outline: outlineFor(1), rawContent: "", error: null })
    await mount()
    await submitWizard("", "1")
    await confirmOutline()
    expect(signals[0].aborted).toBe(false)

    // 同项目同章号重提：startTask 会把那条正在写正文的任务整行换掉
    await submitWizard("", "1")
    await settleAsync()

    expect(signals[0].aborted, "被取代的正文生成不能继续跑（还在计费）").toBe(true)
    expect(fixture.writeFile, "被取代的生成不得再落盘").not.toHaveBeenCalled()
    expect(useEventOutlineTaskStore.getState().tasks).toHaveLength(1)
  })

  it("没有可用模型时明确报错，不静默什么都不发生", async () => {
    const toastModule = await import("@/lib/toast")
    const errorSpy = vi.spyOn(toastModule.toast, "error").mockImplementation(() => {})
    fixture.generateEventOutline.mockResolvedValue({ outline: outlineFor(2), rawContent: "", error: null })
    await mount()
    await submitWizard("", "2")
    await act(async () => {
      useWikiStore.setState({
        llmConfig: { ...useWikiStore.getInitialState().llmConfig, apiKey: "", model: "" },
        providerConfigs: {},
        defaultLlmModel: "",
        aiChatModel: "",
      })
    })
    await act(async () => { button("用这份细纲写这一章").click() })
    await settleAsync()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("未配置可用的 AI 模型"))
    expect(fixture.runDeepChapterGeneration).not.toHaveBeenCalled()
    expect(fixture.writeFile).not.toHaveBeenCalled()
  })

  it("草稿隔离：全程不摄取、不自动标记 final", async () => {
    await mount()
    await outlineThenConfirm(2)

    expect(fixture.ingestChapter, "AI 刚写出来的草稿不得被摄取进记忆库").not.toHaveBeenCalled()
    // 落盘内容是 draft，且没有任何「保存为正式章节」的副作用
    expect(markdownHandedToWriteFile(chapterAreaPath(2))).toContain("chapter_status: draft")
    expect(useWikiStore.getState().finalChapterSave).toBeNull()
  })
})
