// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatPanel } from "@/components/chat/chat-panel"
import { OutlineChatPanel } from "@/components/sources/outline-chat-panel"
import { useChatStore } from "@/stores/chat-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { getUiTestAiMenuStyle } from "./ui-test-ai-parts"

const build = vi.hoisted(() => ({ enabled: true }))
vi.mock("@/lib/ui-test", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ui-test")>(),
  get IS_UI_TEST_BUILD() { return build.enabled },
}))
// 只隔离磁盘、模型请求和配置持久化；两种面板、消息、输入框、选择器及会话 store 均用真实实现。
vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async () => ""), writeFile: vi.fn(async () => {}),
  writeFileAtomic: vi.fn(async () => {}), createDirectory: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}), fileExists: vi.fn(async () => false),
  listDirectory: vi.fn(async () => []), getFileSize: vi.fn(async () => 0),
}))
vi.mock("@/lib/project-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/project-store")>(),
  saveAiChatModel: vi.fn(async () => {}), saveAiOutlineModel: vi.fn(async () => {}),
  saveAiWorkflowMode: vi.fn(async () => {}), saveOutlineWorkflowMode: vi.fn(async () => {}),
}))
vi.mock("@/lib/llm-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/llm-client")>(),
  streamChat: vi.fn(async () => { throw new Error("界面测试不允许请求模型") }),
}))
vi.mock("@/hooks/use-agent-config", () => ({
  useAgentConfig: (systemPrompt: string) => ({
    config: { maxRounds: 3, tools: [], systemPrompt, llmConfig: useWikiStore.getState().llmConfig },
    registry: { get: vi.fn(), has: () => false, list: () => [], register: vi.fn() },
    supportsTools: true, skillConfigLoaded: true, skillConfig: null,
    writingSkills: [], mcpCapabilities: [], mcpWarnings: [],
  }),
}))
vi.mock("@/components/chat/chat-shared", () => ({ useSourceFiles: () => [], getLastQueryPages: () => [] }))
vi.mock("@/lib/novel/story-simulation/framework-binding", () => ({ loadBinding: vi.fn(async () => null) }))
vi.mock("@/lib/novel/story-simulation/framework-store", () => ({ loadFrameworks: vi.fn(async () => []) }))

type Panel = "chapter" | "outline"
const mounted: Array<{ root: Root; container: HTMLDivElement }> = []
const title = "当前会话的完整长标题".repeat(6)
const userText = "请检查这段测试内容。"
const answerText = "这是 store 中已有的回复，不能用图稿示例消息代替。"
const now = Date.now()
const closeOutline = vi.fn()

function seed(kind: Panel, empty = false) {
  const id = `${kind}-active`
  const messages = empty ? [] : [
    { id: "user-existing", role: "user" as const, content: userText, timestamp: now, conversationId: id },
    { id: "answer-existing", role: "assistant" as const, content: answerText, timestamp: now, conversationId: id },
  ]
  const conversations = [
    { id, title, createdAt: now, updatedAt: now, deAiMode: false, messages, inputDraft: "" },
    { id: `${kind}-running`, title: "另一个正在生成的会话", createdAt: now, updatedAt: now, deAiMode: false, messages: [], inputDraft: "" },
    { id: `${kind}-old`, title: "以前的会话", createdAt: 1, updatedAt: 1, deAiMode: false, messages: [], inputDraft: "" },
  ]
  const runStates = { [`${kind}-running`]: { status: "running" as const, runId: "run-test", updatedAt: now } }
  if (kind === "chapter") {
    useChatStore.setState({ conversations, activeConversationId: id, messages, streamingContents: {}, runStates, pendingReferenceTokens: [] })
  } else {
    useOutlineChatStore.setState({ conversations, activeConversationId: id, streamingContents: {}, runStates, loaded: true, pendingReferenceTokens: [] })
  }
}

async function mount(kind: Panel) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(kind === "chapter" ? <ChatPanel /> : <OutlineChatPanel onClose={closeOutline} />)
  })
  await flushLayoutFrame()
  return container
}

async function flushLayoutFrame() {
  // 菜单先提交 open 状态，再在 RAF 中测量定位；等待真实帧而不是猜测机器负载。
  await act(async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  })
}

async function click(element: Element | null) {
  expect(element).not.toBeNull()
  await act(async () => {
    (element as HTMLElement).click()
  })
  await flushLayoutFrame()
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  build.enabled = true
  closeOutline.mockClear()
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() })
  useChatStore.setState({ conversations: [], activeConversationId: null, messages: [], runStates: {}, streamingContents: {}, pendingReferenceTokens: [] })
  useOutlineChatStore.setState({ conversations: [], activeConversationId: null, runStates: {}, streamingContents: {}, loaded: true, pendingReferenceTokens: [] })
  useWikiStore.setState({
    project: { id: "ui-test-project", path: "C:/__qmai_ui_test__/book", name: "内存测试项目" },
    novelMode: true, selectedFile: null, fileTree: [], chatExpanded: true,
    aiWorkflowMode: "standard", outlineWorkflowMode: "standard", planExecuteEnabled: false,
    aiChatModel: "openai/ui-model", aiOutlineModel: "openai/ui-model",
    llmConfig: { ...useWikiStore.getState().llmConfig, provider: "openai", apiKey: "ui-test-only", model: "ui-model", maxContextSize: 8192 },
    providerConfigs: { openai: { enabled: true, apiKey: "ui-test-only", savedModels: [{ id: "ui-model", model: "ui-model", name: "本地验证模型", createdAt: 1 }] } },
  })
})

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount())
    container.remove()
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe.each<Panel>(["chapter", "outline"])("独立 UI 测试版 %s 助手", (kind) => {
  it("仅测试构建出现专用面板；正式版仍保留原消息与输入 DOM", async () => {
    build.enabled = false
    seed(kind)
    const container = await mount(kind)
    expect(container.querySelector("[data-ui-ai-panel]")).toBeNull()
    expect(container.querySelector("[data-ui-ai-header]")).toBeNull()
    expect(container.querySelector('[aria-label="引用输入框"]')).not.toBeNull()
    expect(container.textContent).toContain(answerText)
    expect(container.querySelector(".qmai-new-conversation-button")).not.toBeNull()
  })

  it("标题、当前会话副标题、历史、新建和关闭入口取真实会话状态", async () => {
    seed(kind)
    const container = await mount(kind)
    const panel = container.querySelector(`[data-ui-ai-panel="${kind}"]`)
    expect(panel).not.toBeNull()
    const header = panel?.querySelector("[data-ui-ai-header]")
    expect(header?.textContent).toContain(kind === "chapter" ? "写作助手" : "大纲助手")
    expect(header?.querySelector(".ui-test-ai-session")?.textContent).toBe(`当前会话 · ${title}`)
    expect(header?.querySelector(".ui-test-ai-session")?.getAttribute("title")).toBe(title)
    expect(header?.querySelector(".qmai-new-conversation-button")).not.toBeNull()
    expect(header?.querySelector("[aria-expanded]")).not.toBeNull()
    await click(header?.querySelector(`[aria-label="关闭${kind === "chapter" ? "写作" : "大纲"}助手"]`) ?? null)
    if (kind === "chapter") expect(useWikiStore.getState().chatExpanded).toBe(false)
    else expect(closeOutline).toHaveBeenCalledOnce()
  })

  it("独立滚动区渲染原始消息，保存与重试动作仍在消息后", async () => {
    seed(kind)
    const container = await mount(kind)
    const scroll = container.querySelector("[data-ui-ai-scroll]")
    expect(scroll).not.toBeNull()
    expect(scroll?.querySelector('[data-ui-ai-message="user"]')?.textContent).toContain(userText)
    const assistant = scroll?.querySelector('[data-ui-ai-message="assistant"]')
    expect(assistant?.textContent).toContain(answerText)
    expect(assistant?.textContent).toContain(kind === "chapter" ? "保存到章节库" : "保存为大纲")
    expect(assistant?.textContent).toContain("重新生成")
    expect(container.textContent).not.toMatch(/黑雨之下|雨停之前|28%/)
  })

  it("模式与真实上下文占用在输入框上方，引用和模型保留于输入框底部", async () => {
    seed(kind)
    const container = await mount(kind)
    const tools = container.querySelector("[data-ui-ai-tools]")
    expect(tools).not.toBeNull()
    const mode = tools?.querySelector(`[aria-label="${kind === "chapter" ? "AI 会话执行模式" : "AI 大纲执行模式"}"]`)
    expect(mode).not.toBeNull()
    expect(tools?.querySelector('[aria-label="上下文用量"]')).not.toBeNull()
    const footer = container.querySelector("[data-reference-input-footer]")
    expect(footer?.querySelector('[aria-label="引用内容"]')).not.toBeNull()
    expect(footer?.textContent).toContain("本地验证模型")
    expect(footer?.contains(mode!)).toBe(false)
    expect(container.querySelectorAll("textarea")).toHaveLength(1)
    expect(container.querySelector("[data-ui-ai-composer]")?.textContent).toContain("Shift + Enter 换行")
    await click(mode ?? null)
    const menu = document.querySelector('[data-ui-ai-menu="mode"]')
    expect(menu).not.toBeNull()
    expect(menu?.querySelectorAll('[role="option"]')).toHaveLength(kind === "chapter" ? 3 : 2)
    await click(menu?.querySelector('[role="option"]') ?? null)
    expect(kind === "chapter" ? useWikiStore.getState().aiWorkflowMode : useWikiStore.getState().outlineWorkflowMode).toBe("fast")
  })

  it("模式菜单在慢帧测量完成后仍可验证，不依赖固定 30ms 等待", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => window.setTimeout(() => callback(performance.now()), 120))
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => window.clearTimeout(id))
    seed(kind)
    const container = await mount(kind)
    await click(container.querySelector('[data-ui-ai-tools] [aria-haspopup="listbox"]'))
    expect(document.querySelector('[data-ui-ai-menu="mode"]')).not.toBeNull()
  })

  it("历史菜单包括当前、后台运行与旧会话，切换仍由各自 store 处理", async () => {
    seed(kind)
    const container = await mount(kind)
    await click(container.querySelector("[data-ui-ai-header] [aria-expanded]"))
    const menu = document.querySelector('[data-ui-ai-menu="history"]')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain("全部会话 3 条")
    expect(menu?.querySelector('[aria-label="清理旧会话"]')?.textContent).toContain("清理旧会话")
    for (const name of [title, "另一个正在生成的会话", "以前的会话"]) {
      expect(Array.from(menu?.querySelectorAll("button[title]") ?? []).some((button) => button.getAttribute("title") === name)).toBe(true)
    }
    expect(menu?.querySelector('[aria-label="正在生成"]')).not.toBeNull()
    await click(menu?.querySelector('button[title="以前的会话"]') ?? null)
    expect(kind === "chapter" ? useChatStore.getState().activeConversationId : useOutlineChatStore.getState().activeConversationId).toBe(`${kind}-old`)
    expect(document.querySelector('[data-ui-ai-menu="history"]')).toBeNull()
  })

  it("窄窗口历史菜单受视口限制，Escape 返回入口焦点", async () => {
    seed(kind)
    vi.stubGlobal("innerWidth", 260)
    vi.stubGlobal("innerHeight", 260)
    const container = await mount(kind)
    const trigger = container.querySelector<HTMLButtonElement>("[data-ui-ai-header] [aria-expanded]")
    expect(trigger).not.toBeNull()
    vi.spyOn(trigger!, "getBoundingClientRect").mockReturnValue({ left: 210, right: 242, top: 150, bottom: 182, width: 32, height: 32, x: 210, y: 150, toJSON: () => ({}) })
    await click(trigger)
    const menu = document.querySelector<HTMLElement>('[data-ui-ai-menu="history"]')
    expect(menu).not.toBeNull()
    expect(Number.parseFloat(menu!.style.width)).toBeLessThanOrEqual(244)
    expect(Number.parseFloat(menu!.style.left)).toBeGreaterThanOrEqual(8)
    const menuTop = menu!.style.top ? Number.parseFloat(menu!.style.top) : 260 - Number.parseFloat(menu!.style.bottom) - Number.parseFloat(menu!.style.maxHeight)
    expect(menuTop + Number.parseFloat(menu!.style.maxHeight)).toBeLessThanOrEqual(252)
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(document.querySelector('[data-ui-ai-menu="history"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    vi.unstubAllGlobals()
  })

  it("十条长引用保留真实芯片，移除引用不自动发送消息", async () => {
    seed(kind)
    const tokens = Array.from({ length: 10 }, (_, index) => ({ id: `ref-${index}`, category: "chapter" as const, title: `测试引用${index}`, displayTitle: `很长的引用标题${index}`.repeat(16), path: `chapters/ref-${index}.md` }))
    if (kind === "chapter") useChatStore.setState({ pendingReferenceTokens: tokens })
    else useOutlineChatStore.setState({ pendingReferenceTokens: tokens })
    const container = await mount(kind)
    const composer = container.querySelector("[data-ui-ai-composer]")
    expect(composer?.querySelectorAll("[data-reference-id]")).toHaveLength(10)
    await click(composer?.querySelector('[data-reference-id="ref-0"] button') ?? null)
    expect(composer?.querySelectorAll("[data-reference-id]")).toHaveLength(9)
    const messages = kind === "chapter" ? useChatStore.getState().messages : useOutlineChatStore.getState().conversations[0].messages
    expect(messages).toHaveLength(2)
  })

  it("流式作者状态取真实运行标志，停止生成仍调用原停止流程", async () => {
    seed(kind)
    const running = { status: "running" as const, runId: "active-run", updatedAt: now }
    if (kind === "chapter") {
      useChatStore.setState((state) => ({ runStates: { [`${kind}-active`]: running }, streamingContents: { [`${kind}-active`]: "" }, messages: state.messages.map((message) => message.role === "assistant" ? { ...message, isAgentRunning: true } : message) }))
    } else {
      useOutlineChatStore.setState((state) => ({ runStates: { [`${kind}-active`]: running }, conversations: state.conversations.map((conversation) => ({ ...conversation, messages: conversation.messages.map((message) => message.role === "assistant" ? { ...message, isAgentRunning: true } : message) })) }))
    }
    const container = await mount(kind)
    expect(container.querySelector(".ui-test-ai-author")?.textContent).toContain("正在生成")
    expect(container.textContent).not.toContain("已完成")
    await click(container.querySelector('[aria-label="停止生成"]'))
    const run = kind === "chapter" ? useChatStore.getState().runStates[`${kind}-active`] : useOutlineChatStore.getState().runStates[`${kind}-active`]
    expect(run?.status).toBe("idle")
    expect(container.querySelector('[aria-label="停止生成"]')).toBeNull()
    expect(container.querySelector(".ui-test-ai-author")?.textContent).not.toContain("正在生成")
  })

  it("历史消息残留运行标记时不伪装成正在生成", async () => {
    seed(kind)
    if (kind === "chapter") useChatStore.setState((state) => ({ messages: state.messages.map((message) => ({ ...message, isAgentRunning: true })) }))
    else useOutlineChatStore.setState((state) => ({ conversations: state.conversations.map((conversation) => ({ ...conversation, messages: conversation.messages.map((message) => ({ ...message, isAgentRunning: true })) })) }))
    const container = await mount(kind)
    expect(container.querySelector(".ui-test-ai-author")?.textContent).not.toContain("正在生成")
  })

  it("模型名称在窄栏截断后仍可读取完整名称与模型标识", async () => {
    seed(kind)
    const container = await mount(kind)
    expect(container.querySelector(".ui-test-ai-model")?.getAttribute("title")).toBe("本地验证模型 · openai/ui-model")
  })

  it("空会话不注入假消息，保留真实操作并禁止重复新建空会话", async () => {
    seed(kind, true)
    const container = await mount(kind)
    expect(container.querySelector(".ui-test-ai-empty")).not.toBeNull()
    expect(container.querySelector('[data-ui-ai-message="assistant"]')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>(".qmai-new-conversation-button")?.disabled).toBe(true)
    expect(container.querySelector('[aria-label="引用输入框"]')).not.toBeNull()
    if (kind === "outline") expect(container.querySelector(".ui-test-ai-empty")?.textContent).toContain("生成小说大纲")
  })
})

it("专用样式仅命中测试版标识，覆盖对话/长引用/菜单并消费主代理的主题 token", () => {
  const cssPath = resolve(__dirname, "ui-test-ai.css")
  expect(existsSync(cssPath)).toBe(true)
  const css = readFileSync(cssPath, "utf8")
  for (const token of ["paper", "panel", "soft", "ink", "muted", "accent", "on-accent"]) expect(css).toContain(`var(--ui-${token})`)
  expect(css).toContain("var(--ui)")
  expect(css).toContain("[data-ui-ai-scroll]")
  expect(css).toContain("[data-reference-id]")
  expect(css).toContain("overflow-wrap: anywhere")
  expect(css).toContain("overflow-y: auto")
  expect(css).not.toMatch(/(^|\})\s*(body|:root|\.ui-test-root)\s*\{/m)
})

it("大纲空会话的生成入口沿用原有不可发送状态", async () => {
  seed("outline", true)
  useOutlineChatStore.setState({ runStates: Object.fromEntries(["one", "two", "three"].map((id) => [id, { status: "running" as const, runId: id, updatedAt: now }])) })
  const container = await mount("outline")
  expect(container.querySelector<HTMLButtonElement>(".ui-test-ai-empty button")?.disabled).toBe(true)
})

it("离开视口的菜单锚点也不能使菜单超出窗口", () => {
  vi.stubGlobal("innerWidth", 260)
  vi.stubGlobal("innerHeight", 260)
  const style = getUiTestAiMenuStyle({ left: 900, top: 500, bottom: 532 }, 320, true)
  expect(Number(style.left) + Number(style.width)).toBeLessThanOrEqual(252)
  const menuTop = style.top !== undefined ? Number(style.top) : 260 - Number(style.bottom) - Number(style.maxHeight)
  expect(menuTop + Number(style.maxHeight)).toBeLessThanOrEqual(252)
})

it("大纲生成菜单保留完整向导与九类分项入口，窗口缩小时重新限位", async () => {
  seed("outline")
  const container = await mount("outline")
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="生成大纲模块"]')
  expect(trigger).not.toBeNull()
  vi.spyOn(trigger!, "getBoundingClientRect").mockReturnValue({ left: 600, right: 700, top: 450, bottom: 482, width: 100, height: 32, x: 600, y: 450, toJSON: () => ({}) })
  await click(trigger)
  let menu = document.querySelector<HTMLElement>('[data-ui-ai-menu="generation"]')
  expect(menu?.querySelectorAll('[role="menuitem"]')).toHaveLength(10)
  expect(menu?.textContent).toContain("生成小说大纲")
  vi.stubGlobal("innerWidth", 260)
  vi.stubGlobal("innerHeight", 260)
  await act(async () => window.dispatchEvent(new Event("resize")))
  menu = document.querySelector<HTMLElement>('[data-ui-ai-menu="generation"]')
  expect(Number.parseFloat(menu!.style.left) + Number.parseFloat(menu!.style.width)).toBeLessThanOrEqual(252)
})


it("向上弹出的短菜单贴近触发入口，不预留整块最大高度空白", () => {
  vi.stubGlobal("innerWidth", 1000)
  vi.stubGlobal("innerHeight", 800)
  const style = getUiTestAiMenuStyle({ left: 700, top: 650, bottom: 682 }, 320, true)
  expect(style.bottom).toBe(158)
  expect(style.top).toBeUndefined()
})
