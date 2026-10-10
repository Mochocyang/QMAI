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
import type { EventOutlineData, EventOutlineRequest } from "@/lib/novel/event-outline"

const fixture = vi.hoisted(() => ({
  generateEventOutline: vi.fn(),
}))

vi.mock("@/lib/ui-test", () => ({ get IS_UI_TEST_BUILD() { return true } }))
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

/** 走完「点按钮 → 填向导 → 提交」这条真实路径，返回生成函数的调用参数。 */
async function submitWizard(requirement = ""): Promise<EventOutlineRequest> {
  await click("生成章节细纲")
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog, "点「生成章节细纲」应弹出向导").not.toBeNull()
  if (requirement) {
    await act(async () => {
      setTextarea(document.querySelector('textarea[aria-label="本章想法/硬要求"]')!, requirement)
    })
  }
  await act(async () => { button("生成细纲", dialogRoot()).click() })
  await act(async () => { await Promise.resolve() })
  return fixture.generateEventOutline.mock.calls.at(-1)![1] as EventOutlineRequest
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
    await mount()
    await click("生成章节细纲")
    const input = document.querySelector<HTMLInputElement>('input[aria-label="目标章节"]')!
    // listDirectory 返回空树 → 空库回落到第 1 章（resolveNextChapterNumber 的既有约定）
    expect(input.value).toBe("1")
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
