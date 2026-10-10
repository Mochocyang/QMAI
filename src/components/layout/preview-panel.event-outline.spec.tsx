// @vitest-environment jsdom

/**
 * 丙-2a：章节区「生成章节细纲」全流程。
 *
 * ── 为什么是渲染断言而不是源码文本断言 ──
 * 本批的要害是**入口换了地方之后仍然真的能用**：点按钮要弹向导、提交要真的
 * 发起生成、结果要在章节区出现一张能确认的卡片。这些全是行为，
 * 源码里存在 `EventOutlineCard` 这个字符串证明不了其中任何一条
 * （preview-panel.chapter-toolbar.spec.tsx 的注释里记录过同类教训：
 * 把入口包成 `{false ? … : null}` 时源码断言依然全绿）。
 *
 * 生成函数被 mock 掉：这里测的是接线（谁在什么时候调用它、结果怎么落地），
 * 不是 LLM 交互。真实解析逻辑在 event-outline-generation.spec.ts 里测。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { useWikiStore } from "@/stores/wiki-store"
import { useEventOutlineTaskStore } from "@/stores/event-outline-task-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { USER_ABORT_MESSAGE } from "@/lib/user-abort"
import type { EventOutlineData, EventOutlineRequest } from "@/lib/novel/event-outline"

const fixture = vi.hoisted(() => ({
  generateEventOutline: vi.fn(),
}))

vi.mock("@/lib/novel/event-outline-generation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/novel/event-outline-generation")>(),
  generateEventOutline: fixture.generateEventOutline,
}))
vi.mock("@/commands/fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/commands/fs")>(),
  readFile: vi.fn(async (path: string) => (path.endsWith("第16章.md") ? CHAPTER : "# 大纲\n\n正文")),
  writeFileAtomic: vi.fn(async () => {}),
  listDirectory: vi.fn(async () => []),
  fileExists: vi.fn(async () => true),
}))
vi.mock("@/components/skill-library/use-de-ai-skill-options", () => ({
  useDeAiSkillOptions: () => ({ loading: false, skills: [], effectiveName: "未启用", currentSkillId: null, defaultSkillId: null, loadError: "" }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const project = { id: "event-outline-spec", name: "测试书", path: "C:/test-book" }
const chapterPath = `${project.path}/wiki/chapters/第16章.md`
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

let container: HTMLDivElement
let root: Root

async function mount() {
  useWikiStore.setState({
    project,
    selectedFile: chapterPath,
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
  let callIndex = 0
  fixture.generateEventOutline.mockImplementation(
    (_p: string, _r: unknown, _c: unknown, _cb: unknown, signal?: AbortSignal) => {
      const index = callIndex++
      return new Promise((resolve, reject) => {
        resolvers.set(index, resolve)
        signal?.addEventListener("abort", () => {
          const abortError = Object.assign(new Error(USER_ABORT_MESSAGE), { name: "AbortError" })
          reject(abortError)
        })
      })
    },
  )
  return { resolvers, callIndexOf: (index: number) => resolvers.get(index) }
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

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  useWikiStore.setState(useWikiStore.getInitialState())
  useEventOutlineTaskStore.setState({ tasks: [] })
  fixture.generateEventOutline.mockReset()
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
   */
  it("生成细纲全程不碰大纲会话（会话数与消息数都不变）", async () => {
    const before = useOutlineChatStore.getState().conversations
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

  it("生成已经结束的行再点取消，只收掉这一行、不抛错", async () => {
    const { callIndexOf } = mockAbortableGeneration()
    await mount()
    await submitWizard("", "1")
    // 先正常收尾（此时 controller 已从映射里摘掉），再让用户点「取消」
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
