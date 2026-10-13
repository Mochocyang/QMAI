// @vitest-environment jsdom

/**
 * 章节区「生成章节细纲」的新契约：**请求进 AI 对话，结果在 AI 对话框里生成**。
 *
 * ── 这个文件原来是 2099 行的全流程用例 ──
 * 它守的是旧链路：点按钮 → 本地调模型 → 结果渲染成卡片挂在章节正文区顶部 →
 * 确认 → 就地写出正文。用户 2026-10-13 明确推翻了这条形态（缺陷描述：截图里
 * 细纲内容出现在**章节正文区**，而正确形态是「点击该图标后，内容直接在 AI 对话中
 * 发送，随后生成的内容在 AI 对话框中显示」）。于是本地生成、任务 store、卡片区、
 * 「确认细纲 → 就地写正文」整条链一起拆除（拆除清单与理由见 preview-panel.tsx
 * 里 handleSubmitEventOutline 上面那段注释）。
 *
 * 用例随之重写，现在只守两件事：
 * 1. **投递**：投给谁（AI 对话）、投什么（完整提示词 + 给用户看的一句）、
 *    什么时候**不**投（取消、模型不可用）；
 * 2. **正文区不再出现细纲**：既没有卡片节点，源代码里也不再引用那三个模块 ——
 *    第二条是防「改回去」的关键，因为渲染断言只能证明"这一次没渲染出来"。
 *
 * ── 为什么是渲染断言而不是源码文本断言 ──
 * 「点按钮弹向导、提交真的投递了」全是行为，源码里出现 `requestComposerSend`
 * 这个字符串证明不了其中任何一条（preview-panel.chapter-toolbar.spec.tsx 的注释里
 * 记录过同类教训：把入口包成 `{false ? … : null}` 时源码断言依然全绿）。
 * 源码断言只用在**否定**上（"这个文件里不该再有 X"），那里它才是最合适的工具。
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { useWikiStore } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"
import { buildEventOutlinePrompt } from "@/lib/novel/event-outline"

const fixture = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  writeFileAtomic: vi.fn(),
  createDirectory: vi.fn(),
  listDirectory: vi.fn(),
  fileExists: vi.fn(),
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
 * 只设 apiKey/model 是不够的：那样 hasUsableLlm 会判为不可用，于是测的就不是投递
 * 而是"未配置模型"的报错分支了。写法照 outline-chat-panel.spec.tsx 的既有做法。
 */
const USABLE_PROVIDER_CONFIGS = {
  openai: {
    apiKey: "test-key",
    enabled: true,
    savedModels: [{ id: "gpt-4o", model: "gpt-4o", name: "GPT-4o", createdAt: 1 }],
  },
}

let container: HTMLDivElement
let root: Root

/**
 * 章节库种两个已存在的章节（第001/第003章），让「默认章号」有唯一正确答案 4。
 *
 * 走的是 flattenMdFiles(fileTree) → pickChapterLibraryFiles → resolveNextChapterNumber，
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

async function mount(): Promise<void> {
  useWikiStore.setState({
    project,
    selectedFile: openChapterPath,
    novelMode: true,
    activeView: "wiki",
    aiChatModel: "gpt-4o",
    providerConfigs: USABLE_PROVIDER_CONFIGS,
    llmConfig: { ...useWikiStore.getInitialState().llmConfig, provider: "openai", apiKey: "test-key", model: "gpt-4o" },
  })
  fixture.readFile.mockResolvedValue(CHAPTER)
  await act(async () => { root.render(<PreviewPanel />) })
  await act(async () => { await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())) })
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

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function setTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

/** 向导是 Radix Dialog，内容被 **portal 到 document.body**，不在 container 里。 */
function dialogRoot(): ParentNode {
  return document.body
}

/**
 * 走完「点按钮 → 填向导 → 提交」，返回这次投递出去的请求。
 *
 * 断言的是**投递**（chat-store 的 pendingComposerSend）而不是某次 mock 调用的参数：
 * 新链路里已经没有任何本地生成函数可 mock，真实的产出就是那条队列。
 */
async function submitWizard(options: { requirement?: string; chapterNumber?: string; targetWords?: string } = {}) {
  await click("生成章节细纲")
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog, "点「生成章节细纲」应弹出向导").not.toBeNull()
  if (options.chapterNumber) {
    await act(async () => { setInput(document.querySelector('input[aria-label="目标章节"]')!, options.chapterNumber!) })
  }
  if (options.targetWords) {
    await act(async () => { setInput(document.querySelector('input[aria-label="本章目标字数"]')!, options.targetWords!) })
  }
  if (options.requirement) {
    await act(async () => { setTextarea(document.querySelector('textarea[aria-label="本章想法/硬要求"]')!, options.requirement!) })
  }
  await act(async () => { button("生成细纲", dialogRoot()).click() })
  await act(async () => { await Promise.resolve() })
  return useChatStore.getState().pendingComposerSend
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  useWikiStore.setState(useWikiStore.getInitialState())
  /*
   * AI 对话的 store 也要归零：本文件断言的是 pendingComposerSend，
   * 不清的话上一条用例投递的请求会漏到下一条里（`not.toBeNull()` 类断言会假绿）。
   */
  useChatStore.setState({ conversations: [], activeConversationId: null, messages: [], pendingComposerSend: null })
  seedChapterLibrary()
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

describe("章节区生成章节细纲 · 投递给 AI 对话", () => {
  it("工具栏入口点击后弹出向导，且默认章号来自章节库而不是写死", async () => {
    await mount()
    await click("生成章节细纲")
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog, "点「生成章节细纲」应弹出向导").not.toBeNull()
    // 章节库里有第001 / 第003 章 ⇒ 下一章是第 4 章
    expect(dialog!.querySelector<HTMLInputElement>('input[aria-label="目标章节"]')!.value).toBe("4")
  })

  it("提交后把**完整提示词**投给 AI 对话，并展开写作助手", async () => {
    await mount()
    const payload = await submitWizard()

    expect(payload, "提交后应把请求投给 AI 对话").not.toBeNull()
    /*
     * 逐字比对 `buildEventOutlinePrompt` 的结果，而不是断言几个子串：
     * 提示词是这条链路的**全部内容**，只查"含第 4 章"会让「事件数没带进去」、
     * 「要求丢了」这类缺陷照样变绿。
     * `hasFileTools: true` 是刻意的：AI 对话有工具循环，能让模型先读前文与章纲。
     */
    expect(payload!.text).toBe(buildEventOutlinePrompt(
      { chapterNumber: 4, eventCount: 6, targetWords: 3000, requirement: "" },
      { hasFileTools: true },
    ))
    /*
     * 气泡上给用户看的**不是**提示词本身：它有几十行，铺进对话会淹掉整屏。
     * 所以这里钉住那句人话 —— 它必须说清给哪一章、拆几个事件、目标多少字。
     */
    expect(payload!.displayText).toBe("请为第 4 章生成事件细纲（6 个事件 · 目标 3000 字）")

    // 写作助手要当场展开：否则草稿落进一个看不见的面板（本文件下面那条不变式同理）
    expect(useWikiStore.getState().chatExpanded, "提交后应展开写作助手栏").toBe(true)
    expect(useWikiStore.getState().activeView).toBe("wiki")
  })

  it("「先打开这一章、再切到『大纲』标签」的次序下也能落到写作助手", async () => {
    /*
     * 这条守的是一个**窄但可达**的次序：`activeView` 决定工作区 mode
     * （`activeView === "sources" ? "outline" : "chapter"`），而切标签**不会**清掉
     * `selectedFile` —— 于是「已打开第 16 章 → 点『大纲』标签」之后，章节工具栏
     * 连本章按钮都还在，右侧助手却换成了**大纲助手**，而它不消费这条队列。
     * 不把视图切回来，请求就静默躺在队列里等用户自己切回去。
     */
    await mount()
    useWikiStore.setState({ activeView: "sources" })
    await act(async () => { await Promise.resolve() })

    const payload = await submitWizard()

    expect(payload, "无论当时在哪个视图，请求都该投出来").not.toBeNull()
    expect(useWikiStore.getState().activeView, "必须切回写作工作区，否则助手栏是另一个面板").toBe("wiki")
  })

  it("向导里填的要求与事件数会进提示词（不是只回显在表单上）", async () => {
    await mount()
    await click("生成章节细纲")
    await act(async () => { setTextarea(document.querySelector('textarea[aria-label="本章想法/硬要求"]')!, "这一章要让主角第一次动用令牌。") })
    await act(async () => { setInput(document.querySelector('input[aria-label="目标章节"]')!, "12") })
    await act(async () => { setInput(document.querySelector('input[aria-label="本章目标字数"]')!, "4200") })
    await act(async () => { button("生成细纲", dialogRoot()).click() })
    await act(async () => { await Promise.resolve() })

    const payload = useChatStore.getState().pendingComposerSend!
    expect(payload.text).toBe(buildEventOutlinePrompt(
      { chapterNumber: 12, eventCount: 6, targetWords: 4200, requirement: "这一章要让主角第一次动用令牌。" },
      { hasFileTools: true },
    ))
    expect(payload.displayText).toContain("第 12 章")
    expect(payload.displayText).toContain("目标 4200 字")
  })

  it("提交后章节正文区**不再**出现细纲卡片或生成中的任务行", async () => {
    await mount()
    await submitWizard()

    /*
     * 这一条就是本次改动的验收点：截图里那块内容（卡片）原先挂在预览面板顶部，
     * 于是用户看到的是「细纲出现在正文里」。新形态下它只能出现在 AI 对话框里，
     * 而这三种节点在正文区一个都不该有。
     */
    expect(container.querySelector("[data-event-outline-card]"), "正文区不该再渲染细纲卡片").toBeNull()
    expect(container.querySelector("[data-event-outline-task]"), "正文区不该再有细纲任务行").toBeNull()
    expect(container.querySelector('[aria-label="待确认的事件细纲"]'), "正文区不该再有待确认细纲分区").toBeNull()
  })

  it("向导里点取消不投递任何请求", async () => {
    await mount()
    await click("生成章节细纲")
    await act(async () => { button("取消", dialogRoot()).click() })
    await act(async () => { await Promise.resolve() })

    expect(useChatStore.getState().pendingComposerSend, "取消不该发起任何生成").toBeNull()
  })

  it("向导本身挡住了非法章号：不投递，且给出可见原因", async () => {
    await mount()
    await click("生成章节细纲")
    await act(async () => { setInput(document.querySelector('input[aria-label="目标章节"]')!, "0") })
    await act(async () => { button("生成细纲", dialogRoot()).click() })
    await act(async () => { await Promise.resolve() })

    expect(useChatStore.getState().pendingComposerSend).toBeNull()
    expect(dialogRoot().textContent).toContain("请填写有效的目标章号")
  })

  it("未配置可用的 AI 模型时**不投递**（不在对话面板里留下一条注定失败的请求）", async () => {
    await mount()
    /*
     * 把模型配置清空。投递是异步的（对话面板可能还没挂载），所以这道闸只能在
     * 章节区这一侧先关：否则请求会先进队列，等面板去报一句更含糊的"未配置模型"，
     * 而用户点完按钮到那一刻之间经历的是一段"什么都没发生"。
     */
    useWikiStore.setState({ providerConfigs: {}, llmConfig: { ...useWikiStore.getState().llmConfig, apiKey: "" } })
    const payload = await submitWizard()

    expect(payload, "没有可用模型时不该投递").toBeNull()
  })
})

/**
 * 源码守卫：正文区那一侧**不得**再引用被拆掉的三个模块。
 *
 * 为什么必须有它（渲染断言不够）：上面那条只能证明"这一次没渲染出来"。
 * 把卡片再挂回预览面板、或者把本地生成接回去，渲染断言在**投递**用例里照样全绿
 * —— 因为那时也可以既投递又渲染。这条按名字把三个模块钉死，恢复旧形态必须
 * 同时改掉这个文件的断言，改的人会当场看到这段理由。
 */
describe("章节区生成章节细纲 · 源码守卫", () => {
  const source = readFileSync(resolve(__dirname, "preview-panel.tsx"), "utf8")

  it("preview-panel 不再引用事件细纲卡片、本地生成与任务 store", () => {
    expect(source).not.toContain("EventOutlineCard")
    expect(source).not.toContain("event-outline-generation")
    expect(source).not.toContain("event-outline-task-store")
  })

  it("投递的写法只有一处，且用的是 chat-store 的待发送队列", () => {
    expect(source.match(/requestComposerSend\(/g)?.length).toBe(1)
    expect(source).toContain("buildEventOutlinePrompt(")
  })
})
