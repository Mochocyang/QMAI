// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const outlineModelPreferenceMocks = vi.hoisted(() => ({
  saveAiOutlineModel: vi.fn(async (_modelId: string) => {}),
  saveOutlineWorkflowMode: vi.fn(async (_mode: string) => {}),
}))

vi.mock("@/lib/project-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-store")>()),
  saveAiOutlineModel: outlineModelPreferenceMocks.saveAiOutlineModel,
  saveOutlineWorkflowMode: outlineModelPreferenceMocks.saveOutlineWorkflowMode,
}))

import { outlineConversationRunRegistry } from "@/lib/conversation-run-registry"
import { AgentRunner } from "@/lib/agent/runner"
import { toast } from "@/lib/toast"
import { useWikiStore } from "@/stores/wiki-store"
import {
  buildOutlineAgentSystemPrompt,
  buildVolumeOutlineRepairPrompt,
  filterOutlineGeneratedContent,
  OutlineChatPanel,
} from "./outline-chat-panel"
import {
  useOutlineChatStore,
  type OutlineChatConversation,
  type OutlineChatMessage,
} from "../../stores/outline-chat-store"
import type { AgentConfig, AgentMessage } from "@/lib/agent/types"
import type { ContextHubSnapshotRef } from "@/lib/context-hub/types"

const source = readFileSync(resolve(__dirname, "outline-chat-panel.tsx"), "utf8")
const outlineSectionConfigsSource = readFileSync(resolve(__dirname, "../../lib/novel/outline-section-configs.ts"), "utf8")

const GEMINI_OUTLINE_THOUGHT_DUMP = [
  "I'm currently focused on defining the project scope and following the \"去 AI 味\" skill instructions.",
  "",
  "**Examining the Narrative Details**",
  "",
  "I'm now diving deep into analyzing the source text and identifying critical plot points.",
  "",
  "**Analyzing the Conflict's Dynamics**",
  "",
  "I've been mapping out the escalating conflict and the characters' motivations.",
].join("\n")

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = []

function agentMessageContentText(content: AgentMessage["content"]): string {
  if (typeof content === "string") return content
  return content.map((block) => block.type === "text" ? block.text : "").join("")
}

function conversation(messages: OutlineChatMessage[] = []): OutlineChatConversation {
  return {
    id: "outline-active",
    title: "测试大纲会话",
    createdAt: 100,
    updatedAt: 100,
    messages,
  }
}

function setOutlineConversations(
  conversations: OutlineChatConversation[],
  activeConversationId: string | null,
  options: {
    streamingContents?: Record<string, string>
    runStates?: ReturnType<typeof useOutlineChatStore.getState>["runStates"]
    pendingReferenceTokens?: ReturnType<typeof useOutlineChatStore.getState>["pendingReferenceTokens"]
  } = {},
) {
  useOutlineChatStore.setState({
    conversations,
    activeConversationId,
    streamingContents: options.streamingContents ?? {},
    runStates: options.runStates ?? {},
    loaded: true,
    pendingReferenceTokens: options.pendingReferenceTokens ?? [],
    dismissedIntentPromptIds: {},
  })
}

async function renderOutlineChatPanel() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push({ container, root })
  await act(async () => {
    root.render(<OutlineChatPanel onClose={() => {}} />)
  })
  return container
}

function getNewConversationButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    ".qmai-new-conversation-button",
  )
  expect(button).not.toBeNull()
  return button as HTMLButtonElement
}

/**
 * 打开「生成小说大纲」向导。
 *
 * 用户要求删掉输入区上方那条常驻的「选择生成你想要的小说」按钮之后，
 * 向导唯一入口是**空会话**中央的「生成小说大纲」按钮
 * （`ui-test-ai-parts.tsx` 的 `UiTestAiEmpty`，由 `activeMessages.length === 0` 决定）。
 * 因此调用它的用例必须让当前会话保持空消息 —— 曾有两个用例还在找那个已删除的按钮，
 * 结果 `wizardTrigger` 是 undefined、`?.click()` 静默什么都不做，
 * 表现为「子 Agent 一次都没被调用」这种和真实原因毫不相干的失败。
 */
async function openOutlineWizard(container: HTMLElement): Promise<void> {
  const trigger = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.includes("\u751f\u6210\u5c0f\u8bf4\u5927\u7eb2"))
  expect(trigger, "空会话应提供「生成小说大纲」按钮作为向导入口").toBeDefined()
  await act(async () => { trigger?.click() })
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  })
  setOutlineConversations([], null)
  useWikiStore.setState({
    project: { id: "project-1", name: "测试项目", path: "C:/Book" },
    llmConfig: { ...useWikiStore.getState().llmConfig, provider: "openai", apiKey: "test-key", model: "gpt-4o" },
    providerConfigs: { openai: { apiKey: "test-key", enabled: true, savedModels: [{ id: "gpt-4o", model: "gpt-4o", name: "GPT-4o", createdAt: 1 }] } },
    aiChatModel: "gpt-4o",
    aiOutlineModel: "",
    outlineWorkflowMode: "standard",
  })
  outlineModelPreferenceMocks.saveAiOutlineModel.mockReset()
  outlineModelPreferenceMocks.saveAiOutlineModel.mockResolvedValue(undefined)
  outlineModelPreferenceMocks.saveOutlineWorkflowMode.mockReset()
  outlineModelPreferenceMocks.saveOutlineWorkflowMode.mockResolvedValue(undefined)
})

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop()
    if (!mounted) continue
    await act(async () => {
      mounted.root.unmount()
    })
    mounted.container.remove()
  }
  setOutlineConversations([], null)
  vi.restoreAllMocks()
})

describe("AI 大纲完整结果过滤", () => {
  it("把 Gemini 普通文本思考摘要识别为无正文", () => {
    expect(filterOutlineGeneratedContent(GEMINI_OUTLINE_THOUGHT_DUMP)).toEqual({
      content: "",
      reasoningOnly: true,
    })
  })

  it("只移除前置思考摘要并保留后续大纲正文", () => {
    const output = filterOutlineGeneratedContent([
      GEMINI_OUTLINE_THOUGHT_DUMP,
      "",
      "# 第27章 地下乱战",
      "",
      "## 本章目标",
      "沈渊必须在增援抵达前夺下中枢。",
    ].join("\n"))

    expect(output.reasoningOnly).toBe(false)
    expect(output.content).toContain("# 第27章 地下乱战")
    expect(output.content).not.toContain("Examining the Narrative Details")
  })
})

describe("卷纲自动补全提示词与校验器同契约", () => {
  /*
   * 回归：补全提示词曾经手写一份精简要求，只要 pay / p / link / position / roles，
   * 却漏掉 stage / who / use / range / deliver / gift / hook / climax / beats / line ——
   * 而校验器（validateVolumeOutlineData）恰恰要求这些。
   * 结果是「自动补全」被要求产出的东西永远过不了校验：补一轮 → 还是同样的
   * 「卷纲内容仍不完整（N 项）」。修复方式是直接复用卷纲契约本身，
   * 这条用例把它钉住：任何一项被漏掉都必须红。
   */
  const prompt = buildVolumeOutlineRepairPrompt({
    fileName: "修真界卷级架构.md",
    problemsText: "第 1 个故事缺少字段 beats。",
  })

  it("带上问题清单与待保存文件名", () => {
    expect(prompt).toContain("修真界卷级架构.md")
    expect(prompt).toContain("第 1 个故事缺少字段 beats。")
  })

  it("覆盖校验器要求的每一个故事级字段（漏一个就会「补了还不过」）", () => {
    for (const field of ["range", "deliver", "gift", "mid", "twist", "hook", "link", "climax", "beats"]) {
      expect(prompt).toContain(field)
    }
  })

  it("覆盖环节的每一个必填项与 10 个环节名", () => {
    for (const field of ["stage", "who", "use", "pay"]) expect(prompt).toContain(field)
    for (const stage of ["起①", "起②", "起③", "承①", "承②", "承③", "转①", "转②", "合①", "合②"]) {
      expect(prompt).toContain(stage)
    }
  })

  it("覆盖 story.line 与顶层台账字段", () => {
    expect(prompt).toContain("line")
    for (const field of [
      "position", "roles", "foreshadows", "cast", "escalation", "debts", "rivals", "growth", "places",
    ]) {
      expect(prompt).toContain(field)
    }
  })

  it("要求完整重出、禁止省略，而不是只补缺项", () => {
    expect(prompt).toContain("完整重出")
    expect(prompt).toContain("禁止任何省略写法")
  })
})

describe("OutlineChatPanel controls", () => {
  it("上下文圆环使用 AI 大纲选中模型的窗口而不是全局模型窗口", async () => {
    useWikiStore.setState({
      llmConfig: {
        ...useWikiStore.getState().llmConfig,
        provider: "openai",
        apiKey: "test-key",
        model: "gpt-4o",
        maxContextSize: 204_800,
      },
      aiOutlineModel: "openai/gpt-4o",
      providerConfigs: {
        openai: {
          apiKey: "test-key",
          enabled: true,
          maxContextSize: 409_600,
          savedModels: [{ id: "gpt-4o", model: "gpt-4o", name: "GPT-4o", createdAt: 1 }],
        },
      },
    })
    setOutlineConversations([{
      ...conversation(),
      lastContextUsage: {
        windowTokens: 204_800,
        totalTokens: 100_000,
        measuredAt: 1,
        estimated: false,
        segments: [{ key: "dynamicContext", tokens: 100_000 }],
      },
    }], "outline-active")

    const container = await renderOutlineChatPanel()
    const ring = container.querySelector<HTMLButtonElement>('[aria-label="上下文用量"]')

    expect(ring).not.toBeNull()
    expect(ring?.textContent).toBe("24")
  })

  it("在 AI 大纲回复下方独立显示上下文中控摘要", async () => {
    const contextHubSnapshot: ContextHubSnapshotRef = {
      id: "outline-assistant-1",
      surface: "ai-outline",
      createdAt: 10,
      stats: {
        cacheHits: 3, reloaded: 2, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0, cacheableHits: 3, cacheableLoaded: 5,
        stableTokens: 1200,
        summaryTokens: 60,
        dynamicTokens: 420,
        candidateTokens: 3000,
        estimatedSavedTokens: 1320,
        estimatedSavedPercent: 44,
        expanded: false,
        providerCacheEnabled: true,
      },
    }
    setOutlineConversations([conversation([{
      id: "outline-assistant-1",
      role: "assistant",
      content: "大纲正文",
      contextHubSnapshot,
    }])], "outline-active")

    const container = await renderOutlineChatPanel()

    // 该期望于 26f80ee（全新界面统一、旧版界面移除）随「上下文中控单行数字摘要」变更：
    // 标题文案与「本地资料复用率 / 估算少发送约」长句已下线，改为用量按钮 + 用时 + 结束时间。
    const details = container.querySelector<HTMLElement>(".ui-test-context-details")
    expect(details).not.toBeNull()
    expect(details?.querySelector('[aria-label="查看本轮用量"]')).not.toBeNull()
    // 未提供 generationTiming，用时与结束时间都落到占位符
    expect(details?.querySelector('[aria-label="用时 —"]')).not.toBeNull()
    await act(async () => {
      details?.querySelector<HTMLButtonElement>('[aria-label="查看本轮用量"]')?.click()
    })
    const usageDialog = details?.querySelector<HTMLElement>('[aria-label="本轮用量"]')
    expect(usageDialog?.textContent).toContain("缓存命中")
    // cacheableHits 3 / cacheableLoaded 5 → 本地资料复用率 60%
    expect(usageDialog?.querySelector("strong")?.textContent).toBe("60%")
  })

  it.each([
    ["继续完善人物弧光", "A"],
    ["检查伏笔闭环", "B"],
    ["<script>alert(1)</script> **\u7ee7\u7eed**", "safe"],
  ])("下一步按钮把推荐 label 发送到当前会话且继承模型、历史、上下文和引用：%s", async (label, recId) => {
    const reference = { id: "ref-1", category: "outline" as const, title: "人物设定", displayTitle: "人物设定", path: "大纲/人物设定.md" }
    const runSpy = vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (config, _registry, messages, callbacks) => {
      callbacks.onText("完成")
      callbacks.onDone()
      expect(config.modelId).toBe("gpt-4o")
      expect(config.llmConfig.model).toBe("gpt-4o")
      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: "\u5f53\u524d\u4f1a\u8bdd\u6458\u8981" }),
        expect.objectContaining({ role: "user", content: "已有问题" }),
        expect.objectContaining({ role: "assistant", content: "已有回答" }),
        expect.objectContaining({ role: "user", content: expect.stringContaining(label) }),
      ]))
      return { toolCalls: [], roundsUsed: 1, finalText: "完成" }
    })
    setOutlineConversations([{
      ...conversation([
        { id: "old-user", role: "user", content: "已有问题" },
        { id: "old-assistant", role: "assistant", content: "已有回答", nextStepRecommendation: { completedModule: "人物设定", completedScope: "人物设定", recommendations: [
          { id: recId, label, reason: "推荐理由" },
          { id: "other", label: "另一个建议", reason: "其他理由" },
        ] } },
      ]), modelId: "gpt-4o", contextSummary: { text: "当前会话摘要", updatedAt: 100 },
    }], "outline-active", { pendingReferenceTokens: [reference] })
    const container = await renderOutlineChatPanel()
    const beforeCount = useOutlineChatStore.getState().conversations.length
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(label)) as HTMLButtonElement
    expect(container.querySelector("script")).toBeNull()
    expect(button.textContent).toContain(label)
    await act(async () => {
      button.click()
      for (let attempt = 0; attempt < 50 && button.disabled; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })
    expect(button.disabled).toBe(false)
    const state = useOutlineChatStore.getState()
    const current = state.conversations.find((item) => item.id === "outline-active")
    expect(runSpy).toHaveBeenCalled()
    expect(state.conversations).toHaveLength(beforeCount)
    expect(state.activeConversationId).toBe("outline-active")
    expect(current?.messages).toContainEqual(expect.objectContaining({ role: "user", content: label, attachedReferences: [reference] }))

  })


  it("A recommendation completion does not clear references added after switching to B", async () => {
    const referenceA = { id: "ref-a", category: "outline" as const, title: "A reference", displayTitle: "A reference", path: "outline/a.md" }
    const referenceB = { id: "ref-b", category: "outline" as const, title: "B new reference", displayTitle: "B new reference", path: "outline/b.md" }
    let releaseA!: () => void
    const pendingA = new Promise<void>((resolve) => { releaseA = resolve })
    const runSpy = vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      await pendingA
      callbacks.onText("A done")
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: "A done" }
    })
    const nextStep = { completedModule: "故事总纲", completedScope: "核心设定", recommendations: [{ id: "next", label: "Continue A", reason: "next" }] }
    setOutlineConversations([
      { id: "conversation-a", title: "A", createdAt: 1, updatedAt: 1, modelId: "gpt-4o", messages: [{ id: "a-assistant", role: "assistant", content: "A answer", nextStepRecommendation: nextStep }] },
      { id: "conversation-b", title: "B", createdAt: 2, updatedAt: 2, modelId: "gpt-4o", messages: [{ id: "b-assistant", role: "assistant", content: "B answer" }] },
    ], "conversation-a", { pendingReferenceTokens: [referenceA] })
    const container = await renderOutlineChatPanel()
    const sendA = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Continue A")) as HTMLButtonElement

    await act(async () => {
      sendA.click()
      for (let attempt = 0; attempt < 20 && runSpy.mock.calls.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })
    expect(runSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      useOutlineChatStore.getState().setActiveConversation("conversation-b")
      useOutlineChatStore.getState().enqueueReferenceTokens([referenceB])
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(container.textContent).toContain("B new reference")

    await act(async () => {
      releaseA()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(useOutlineChatStore.getState().activeConversationId).toBe("conversation-b")
    expect(container.textContent).toContain("B new reference")
  })

  it("当前会话运行或已达到全局 3 并发上限时禁用下一步按钮并显示与输入区一致的中文原因", async () => {
    const recommendationMessage = { id: "assistant-next", role: "assistant" as const, content: "已有回答", nextStepRecommendation: { completedModule: "人物设定", completedScope: "主角", recommendations: [{ id: "A", label: "继续完善", reason: "推荐" }] } }
    setOutlineConversations([conversation([recommendationMessage])], "outline-active", { runStates: { "outline-active": { status: "running", updatedAt: 1, runId: "active-run" } } })
    const container = await renderOutlineChatPanel()
    let button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("继续完善")) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe("当前会话正在生成，请等待生成完成后再选择下一步。")
    await act(async () => setOutlineConversations([conversation([recommendationMessage])], "outline-active", { runStates: { one: { status: "running", updatedAt: 1, runId: "1" }, two: { status: "running", updatedAt: 2, runId: "2" }, three: { status: "running", updatedAt: 3, runId: "3" } } }))
    button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("继续完善")) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe("大纲 AI 会话最多同时运行 3 个任务，请等待任一任务结束后再发送。")
  })

  it("下一步发送失败时保留引用、恢复按钮并显示中文非阻塞提示", async () => {
    const reference = { id: "ref-fail", category: "outline" as const, title: "失败引用", displayTitle: "失败引用", path: "大纲/失败.md" }
    vi.spyOn(AgentRunner.prototype, "run").mockRejectedValue(new Error("网络中断"))
    const toastSpy = vi.spyOn(toast, "info")
    setOutlineConversations([conversation([{ id: "assistant-next", role: "assistant", content: "已有回答", nextStepRecommendation: { completedModule: "人物设定", completedScope: "主角", recommendations: [{ id: "A", label: "继续完善", reason: "推荐" }] } }])], "outline-active", { pendingReferenceTokens: [reference] })
    const container = await renderOutlineChatPanel()
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("继续完善")) as HTMLButtonElement
    await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(button.disabled).toBe(false)
    expect(container.textContent).toContain("失败引用")
    expect(toastSpy).toHaveBeenCalledWith("发送失败，推荐操作已恢复，请稍后重试。", expect.objectContaining({ dedupeKey: expect.any(String) }))
  })

  it("停止大纲生成时清理运行状态提示且不把状态提示写入消息", async () => {
    const controller = new AbortController()
    outlineConversationRunRegistry.register("outline-active", controller)
    setOutlineConversations([conversation([{
      id: "assistant-running",
      role: "assistant",
      content: "",
      isAgentRunning: true,
    }])], "outline-active", {
      streamingContents: { "outline-active": "正在运行：世界观 Agent" },
      runStates: {
        "outline-active": { status: "running", updatedAt: 200, runId: "outline-run" },
      },
    })
    const container = await renderOutlineChatPanel()

    const statusIcon = container.querySelector('[aria-label="正在生成"]')
    expect(statusIcon).not.toBeNull()
    expect(statusIcon?.querySelector("svg")).not.toBeNull()
    expect(statusIcon?.hasAttribute("data-slot")).toBe(false)
    expect(container.textContent).not.toContain("\u6b63\u5728\u751f\u6210...")
    expect(container.querySelector(".animate-pulse.rounded-md.border.bg-sky-50")).toBeNull()
    // 运行状态提示以独立状态行展示
    expect(container.textContent).toContain("正在运行：世界观 Agent")

    const stopButton = container.querySelector<HTMLButtonElement>('[aria-label="停止生成"]')
    expect(stopButton).not.toBeNull()
    await act(async () => {
      stopButton?.click()
    })

    const state = useOutlineChatStore.getState()
    const stoppedConversation = state.conversations.find((item) => item.id === "outline-active")
    expect(controller.signal.aborted).toBe(true)
    expect(state.runStates["outline-active"]?.status).toBe("idle")
    expect(state.streamingContents["outline-active"]).toBeUndefined()
    // 状态提示不会被当成内容写入消息；已生成内容由生成流程 catch 分支收尾
    expect(stoppedConversation?.messages).toEqual([expect.objectContaining({
      id: "assistant-running",
      role: "assistant",
      content: "",
    })])
  })

  it("停止无部分内容的大纲生成时保留助手占位消息，由生成流程收尾", async () => {
    const controller = new AbortController()
    outlineConversationRunRegistry.register("outline-active", controller)
    setOutlineConversations([conversation([{
      id: "assistant-running-empty",
      role: "assistant",
      content: "",
      isAgentRunning: true,
    }])], "outline-active", {
      runStates: {
        "outline-active": { status: "running", updatedAt: 200, runId: "outline-run-empty" },
      },
    })
    const container = await renderOutlineChatPanel()

    const stopButton = container.querySelector<HTMLButtonElement>('[aria-label="停止生成"]')
    expect(stopButton).not.toBeNull()
    await act(async () => {
      stopButton?.click()
    })

    const state = useOutlineChatStore.getState()
    const stoppedConversation = state.conversations.find((item) => item.id === "outline-active")
    expect(controller.signal.aborted).toBe(true)
    expect(state.runStates["outline-active"]?.status).toBe("idle")
    expect(state.streamingContents["outline-active"]).toBeUndefined()
    // 不再删除占位消息：AgentRunner 整轮结束才回调文本，停止瞬间可能已有
    // 未送达的内容，改由 handleSend 的 catch 分支统一落盘或写停止占位。
    expect(stoppedConversation?.messages).toHaveLength(1)
    expect(stoppedConversation?.messages[0]?.id).toBe("assistant-running-empty")
  })

  it("根据当前大纲会话的已发送用户消息实时控制新建按钮", async () => {
    const container = await renderOutlineChatPanel()
    let button = getNewConversationButton(container)
    expect(button.disabled).toBe(false)
    expect(button.getAttribute("aria-describedby")).toBeNull()

    await act(async () => {
      setOutlineConversations([conversation()], "outline-active")
    })
    button = getNewConversationButton(container)
    expect(button.disabled).toBe(true)
    expect(button.parentElement?.title).toBe(
      "请先发送当前会话内容，再新建对话。",
    )
    expect(button.title).toBe("请先发送当前会话内容，再新建对话。")
    const reasonId = button.getAttribute("aria-describedby")
    expect(reasonId).toBe("outline-new-conversation-disabled-reason")
    expect(container.querySelector(`#${reasonId}`)?.textContent).toBe(
      "请先发送当前会话内容，再新建对话。",
    )

    await act(async () => {
      setOutlineConversations([
        conversation([{ id: "assistant-1", role: "assistant", content: "仅有助手消息" }]),
      ], "outline-active")
    })
    button = getNewConversationButton(container)
    expect(button.disabled).toBe(true)
    expect(button.parentElement?.title).toBe(
      "请先发送当前会话内容，再新建对话。",
    )
    expect(button.title).toBe("请先发送当前会话内容，再新建对话。")
    expect(button.getAttribute("aria-describedby")).toBe(
      "outline-new-conversation-disabled-reason",
    )
    expect(
      container.querySelector("#outline-new-conversation-disabled-reason")
        ?.textContent,
    ).toBe("请先发送当前会话内容，再新建对话。")

    await act(async () => {
      useOutlineChatStore.getState().addMessage("outline-active", {
        id: "user-1",
        role: "user",
        content: "已发送内容",
      })
    })
    button = getNewConversationButton(container)
    expect(button.disabled).toBe(false)
    expect(button.title).toBe("新建大纲对话")
    expect(button.getAttribute("aria-describedby")).toBeNull()
    expect(
      container.querySelector("#outline-new-conversation-disabled-reason"),
    ).toBeNull()
  })

  it("uses the shared accent new conversation button style", () => {
    expect(source).toContain("qmai-new-conversation-button")
    expect(source).toContain('aria-label="新建大纲对话"')
    expect(source).not.toContain("border-emerald-300")
    expect(source).not.toContain("bg-emerald-50")
    expect(source).not.toContain("text-emerald-700")
  })

  it("uses the same top conversation/history split as AI chat", () => {
    expect(source).toContain("splitConversationToolbarItems")
    expect(source).toContain("topConversations")
    expect(source).toContain("historyConversations")
    expect(source).toContain("qmai-outline-history-button")
    expect(source).toContain('aria-label="大纲会话历史"')
    expect(source).not.toContain("conversations.map((conv) => (")
  })

  it("标准菜单生成不强制清空数据源缓存，收尾把工具过程留在对话里", () => {
    expect(source).toContain("intentPhase: \"intent_analysis\"")
    // 大纲重新生成/后续生成只透传用户手动触发的强制刷新，不再自己写死 forceRefresh
    expect(source).toContain("const forceRefresh = options.forceRefresh === true || forceRefreshNext")
    expect(source).not.toContain("forceRefresh: true")
    expect(source).toContain("workflowMode: outlineMode")
    expect(source).toContain("intentPhase: options.intentPhase")
    expect(source).toContain("标准工作流必须把工具过程留在对话里")
    expect(source).toContain("message.agentToolCalls?.length ? message.agentToolCalls : hiddenToolCalls")
    expect(source).toContain("shouldShowToolProcess")
    expect(source).toContain("historyPlan.showToolProcess")
  })

  it("标准模式对话工作流用多 Agent 同款卡片，不改成真正的多 Agent", () => {
    expect(source).toContain("OutlineStandardWorkflowPanel")
    expect(source).toContain("shouldUseOutlineStandardWorkflowCard")
    expect(source).toContain("useStandardWorkflowCard")
    // 意图分析阶段连工具明细一起隐藏，所以这里多了一道 shouldShowOutlineToolCalls 闸门。
    expect(source).toContain("shouldShowOutlineToolCalls(msg.intentPhase)")
    expect(source).toContain("isRunning={Boolean(msg.isAgentRunning)}")
    expect(source).not.toContain("enableMultiAgent: true")
    expect(source).toContain("enableMultiAgent: !fastMode")
  })

  it("上下文复用重算历史计划时仍带上标准工作流过程标志", () => {
    expect(source).toContain("summaryInSystem: true")
    expect(source).toContain("workflowMode: outlineMode")
    expect(source).toContain("intentPhase: options.intentPhase")
    expect(source).toContain("enableMultiAgent,")
  })

  it("顶栏会话 chips 保底可见，阶段徽章不和会话列表抢宽度", () => {
    expect(source).toContain("min-w-[72px]")
    expect(source).toContain("topConversations.length > 0")
    expect(source).toContain("暂无大纲对话")
    const chipsBlockStart = source.indexOf("{topConversations.length > 0 ? (")
    const chipsBlock = source.slice(chipsBlockStart, source.indexOf("qmai-outline-history-button"))
    expect(chipsBlock).toContain("意图分析中")
    expect(chipsBlock).toContain("outlineWorkflowStage !== \"idle\"")
    expect(chipsBlockStart).toBeGreaterThan(-1)
  })

  it("有活跃大纲会话时顶栏显示会话而不是空状态", async () => {
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()
    expect(container.textContent).toContain("测试大纲会话")
    expect(container.textContent).not.toContain("暂无大纲对话")
  })

  it("provides one-click clearing for outline conversation history", () => {
    expect(source).toContain('aria-label="一键清理会话历史"')
    expect(source).toContain("requestClearHistory")
    expect(source).toContain("confirmClearHistory")
    expect(source).toContain("<ConversationHistoryClearDialog")
  })

  it("历史下拉列出当天非当前会话，避免非当前会话在 UI 上不可达", async () => {
    const today = Date.now()
    setOutlineConversations(
      [
        { id: "conv-b", title: "会话B", createdAt: today, updatedAt: today, messages: [] },
        { id: "conv-a", title: "会话A", createdAt: today - 1000, updatedAt: today - 1000, messages: [] },
      ],
      "conv-b",
    )
    const container = await renderOutlineChatPanel()
    const trigger = container.querySelector<HTMLButtonElement>(".qmai-outline-history-button")
    expect(trigger).not.toBeNull()
    await act(async () => {
      trigger?.click()
    })
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    // 当天会话会被 splitConversationToolbarItems 归入 top（顶栏 chips 在当前 UI 中隐藏），
    // 因此下拉必须能列出它们，否则会话 A 既不在 chips 也不在历史里。
    expect(document.body.textContent).toContain("会话A")
    expect(document.body.textContent).toContain("全部会话 2 条")
    expect(source).toContain("menuConversations.map((conv) => (")
  })

  it("passes confirm and reject handlers into the outline tool workflow", () => {
    expect(source).toContain("handleConfirmToolSave")
    expect(source).toContain("handleRejectTool")
    expect(source).toContain("createWriteOutlineNodeTool")
    expect(source).toContain("onConfirmToolSave={handleConfirmToolSave}")
    expect(source).toContain("onRejectTool={handleRejectTool}")
    expect(source).toContain("onConfirmSave={onConfirmToolSave}")
    expect(source).toContain("onReject={onRejectTool}")
  })

  it("uses the shared reference input and picker for @ references", () => {
    expect(source).toContain("ReferenceInput")
    expect(source).toContain("ReferencePickerDialog")
    expect(source).toContain("InsertReferenceTokens")
    expect(source).toContain("outlineReferenceTokens")
    expect(source).toContain("onAtTrigger={() => setReferencePickerOpen(true)}")
    expect(source).toContain("onSubmit={handleDirectSubmit}")
    expect(source).not.toContain("<ChatInput")
    expect(source).not.toContain('from "@/components/chat/chat-input"')
  })

  it("keeps outline generation menu in the reference input footer before model selection", () => {
    expect(source).toContain("leftFooterControls={")
    expect(source).not.toContain("qmai-outline-bottom-left-controls")
    expect(source).toContain("<OutlineGenerationMenu")
    expect(source).toContain("<ChatModelSelector")

    const footerIndex = source.indexOf("leftFooterControls={")
    const outlineIndex = source.indexOf("<OutlineGenerationMenu")
    const rightControlsIndex = source.indexOf("rightControls={")
    const modelIndex = source.indexOf("<ChatModelSelector")

    expect(footerIndex).toBeGreaterThan(-1)
    expect(outlineIndex).toBeGreaterThan(-1)
    expect(outlineIndex).toBeGreaterThan(footerIndex)
    expect(rightControlsIndex).toBeGreaterThan(outlineIndex)
    expect(modelIndex).toBeGreaterThan(rightControlsIndex)
  })

  it("把生成模块写入输入框，并允许用斜杠打开同一菜单", async () => {
    const runSpy = vi.spyOn(AgentRunner.prototype, "run")
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="生成大纲模块"]')
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((button) => button.textContent?.includes("章节细纲"))
    await act(async () => {
      item?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="引用输入框"]')
    expect(input?.value).toBe("/章节细纲 ")
    expect(runSpy).not.toHaveBeenCalled()

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(input, "/")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(document.querySelector(".qmai-outline-generation-menu")).not.toBeNull()
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      callbacks.onText("已收到")
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: "已收到" }
    })
    const request = "/章节细纲 生成关于第三章的细纲内容，结合故事生成"
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(input, request)
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(input?.parentElement?.querySelector(".ui-test-command-overlay")).toBeNull()
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (container.textContent?.includes(request)) break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })
    expect(container.textContent).toContain(request)
  })

  it("renders outline generation from an icon button and keeps the menu backed by existing configs", () => {
    expect(source).toContain("ListPlus")
    expect(source).toContain('aria-label="生成大纲模块"')
    expect(source).toContain("qmai-outline-generation-menu")
    expect(source).toContain('className="qmai-outline-generation-menu fixed')
    expect(source).toContain("OUTLINE_SECTION_GENERATION_CONFIGS.map")
    expect(source).toContain("onSelect(config.title, config.requestHint)")
    expect(source).toContain("onSelect={(title) => insertOutlineGenerationCommand(title)}")
  })

  it("adds selected references to the outline agent request instead of only storing chips", () => {
    expect(source).toContain("buildOutlineAgentUserContent")
    expect(source).toContain("本条消息附带的 @ 引用")
    expect(source).toContain("请优先使用工具读取引用内容")
  })

  it("hides internal prompts and legacy intent handoff bubbles without removing model history", async () => {
    setOutlineConversations([conversation([
      { id: "u1", role: "user", content: "把236章大纲补充详细" },
      { id: "a1", role: "assistant", content: "意图明确" },
      {
        id: "u2",
        role: "user",
        content: "请按「AI大纲生成工作流」生成「章节细纲」。\n## PRD 3.1 主流程要求\n禁止再次输出 intent_clarity",
      },
      { id: "u3", role: "user", content: "✓ 意图明确（章节细纲），开始生成..." },
      { id: "a2", role: "assistant", content: "# 第236章章纲" },
    ])], "outline-active")

    const container = await renderOutlineChatPanel()
    expect(container.textContent).toContain("把236章大纲补充详细")
    expect(container.textContent).toContain("第236章章纲")
    expect(container.textContent).not.toContain("PRD 3.1 主流程要求")
    expect(container.textContent).not.toContain("✓ 意图明确")
  })

  it("routes outline chat sends through AgentRunner with built-in tools", () => {
    expect(source).toContain("AgentRunner")
    expect(source).toContain("buildAgentConfig")
    expect(source).toContain("ToolRegistry")
    expect(source).toContain("read_outline")
    expect(source).toContain("read_chapter")
    expect(source).toContain("read_memory")
    expect(source).toContain("read_deduction")
    expect(source).not.toContain("runDeepOutlineGeneration(")
  })

  it("settles running outline tool calls when generation finishes", () => {
    expect(source).toContain("settleRunningAgentToolCalls")
    expect(source).toMatch(/settleRunningAgentToolCalls\(\s*record\.toolCalls\.length\s*\?\s*record\.toolCalls\s*:\s*message\.agentToolCalls/s)
    expect(source).toContain("historyPlan.showToolProcessOnError")
    expect(source).toContain("message.agentToolCalls?.length ? message.agentToolCalls : hiddenToolCalls")
  })

  it("uses an outline-only tool set that cannot write chapters, memory, or outline nodes", () => {
    expect(source).toContain("OUTLINE_CHAT_DISABLED_TOOLS")
    expect(source).toContain('"write_chapter"')
    expect(source).toContain('"write_memory"')
    expect(source).toContain('"write_outline_node"')
    expect(source).toContain("disabledTools: mergeDisabledTools(")
    expect(source).toContain("OUTLINE_CHAT_DISABLED_TOOLS,")
    expect(source).toContain("禁止调用 write_outline_node")
    expect(source).toContain("用户确认后才写入文件")
    expect(source).toContain("content 字段强制要求")
    expect(source).toContain("核心事件不少于6条")
    expect(source).toContain("用户确认前不得生成完整文件")
  })

  it("后续普通追问复用 AI 大纲上下文并节流资料读取工具", () => {
    expect(source).toContain("planOutlineContextReuse")
    expect(source).toContain("planOutlineAgentHistory")
    expect(source).toContain("buildSessionContextSummary")
    expect(source).toContain("contextDecision")
    expect(source).toContain("historyPlan")
    expect(source).toContain("contextDecision.instruction")
    expect(source).toContain("contextDecision.disabledTools")
    expect(source).toContain("contextDecision.sourceLabel")
    expect(source).toContain("historyPlan.messages")
    expect(source).toContain("hiddenToolCalls")
    expect(source).toContain("mergeDisabledTools")
  })

  it("提供 AI 大纲上下文状态、强制刷新和预算面板", () => {
    // 已删除上下文状态条，不再展示 "上下文状态" 和 "强制刷新上下文"
    // 输入区不再渲染独立的可见生成提示长条。
    expect(source).not.toContain("上下文状态")
    expect(source).not.toContain("强制刷新上下文")
    expect(source).not.toContain("正在生成...")
    expect(source).toContain("isStreaming")
  })

  it("将 AI 大纲上下文摘要持久化到会话字段而不是组件内存缓存", () => {
    expect(source).toContain("contextSummary:")
    expect(source).toContain("buildSessionContextSummary")
    expect(source).toContain("dependencyFingerprint: contextHubResult?.dependencyStamp.fingerprint")
    // 上下文摘要已通过 setConversationContextSummary 持久化到会话字段
    expect(source).toContain("setConversationContextSummary")
    expect(source).not.toContain("contextSummaryByConversation")
    expect(source).not.toContain("setContextSummaryByConversation")
  })

  it("主发送、续传多 Agent 和重新生成统一接入上下文中控快照", () => {
    expect(source.match(/contextHub\.prepare\(/g)).toHaveLength(3)
    expect(source.match(/readTextFile: contextHubResult\.readFile/g)).toHaveLength(3)
    expect(source.match(/\.saveSnapshot\(/g)).toHaveLength(3)
    expect(source).toContain("<ContextHubDetails")
    expect(source).not.toContain("formatContextHubStatsForDetails")
    expect(source.match(/buildContextHubSystemContent\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it("keeps outline reference chips as tool-readable hints instead of preloading file contents", () => {
    expect(source).toContain("buildOutlineAgentUserContent")
    expect(source).toContain("请优先使用工具读取引用内容")
    expect(source).not.toContain("loadReferenceTokenContext(tokens)")
  })

  it("renders sent @ references in outline chat user messages", () => {
    expect(source).toContain('import { ReferenceChip } from "@/components/reference/ReferenceChip"')
    expect(source).toContain("msg.attachedReferences")
    expect(source).toContain("<ReferenceChip")
    expect(source).toContain("readonly")
  })

  it("consumes outline reference tokens sent from the left outline tree", () => {
    expect(source).toContain("pendingReferenceTokens")
    expect(source).toContain("consumePendingReferenceTokens")
    expect(source).toContain("insertReferenceTokensRef.current?.(tokens)")
  })

  it("forces outline chat through a dedicated list-read-analyze-generate workflow", () => {
    expect(source).toContain("## AI大纲固定分析流程")
    expect(source).toContain("先调用 list_outlines、list_chapters、list_memories、list_deductions")
    expect(source).toContain("再调用 read_outline、read_chapter、read_memory、read_deduction")
    expect(source).toContain("分析冲突、缺口、伏笔、角色动机和章节承接")
    expect(source).toContain("最后再生成大纲建议")
  })

  it("主发送完整结果仅含 Gemini 思考摘要时关闭 reasoning 重试一次", async () => {
    useWikiStore.setState({
      outlineWorkflowMode: "fast",
      llmConfig: {
        ...useWikiStore.getState().llmConfig,
        reasoning: { mode: "high" },
      },
    })
    const finalOutline = "# 第27章 地下乱战\n\n## 本章目标\n沈渊必须在增援抵达前夺下中枢。"
    const runSpy = vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      const text = runSpy.mock.calls.length === 1 ? GEMINI_OUTLINE_THOUGHT_DUMP : finalOutline
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="引用输入框"]')

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(input, "说明第27章的剧情安排")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (runSpy.mock.calls.length === 2 && useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    expect(runSpy).toHaveBeenCalledTimes(2)
    expect(runSpy.mock.calls[1]?.[0].requestOverrides?.reasoning).toEqual({ mode: "off" })
    const assistant = useOutlineChatStore.getState().conversations[0].messages.findLast((message) => message.role === "assistant")
    expect(assistant?.content).toContain("沈渊必须在增援抵达前夺下中枢")
    expect(assistant?.content).not.toContain("Examining the Narrative Details")
  })

  it("停止主发送时不会把已流出的 Gemini 思考摘要保存在消息中", async () => {
    useWikiStore.setState({ outlineWorkflowMode: "fast" })
    const runSpy = vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      callbacks.onText(GEMINI_OUTLINE_THOUGHT_DUMP)
      throw new Error("aborted")
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="引用输入框"]')

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(input, "说明当前剧情")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (runSpy.mock.calls.length === 1 && useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    const assistant = useOutlineChatStore.getState().conversations[0].messages.findLast((message) => message.role === "assistant")
    expect(assistant?.content).toBe("已停止生成。")
    expect(assistant?.content).not.toContain("Examining the Narrative Details")
  })

  it("直接章纲完善请求按意图分析和正文生成两阶段执行，并保留原请求与引用", async () => {
    const reference = {
      id: "chapter-outline-236",
      category: "outline" as const,
      title: "第236章-远洋投送",
      displayTitle: "第236章-远洋投送",
      path: "章纲/第236章-远洋投送.md",
    }
    const calls: Array<{ system: string; user: string }> = []
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      const system = agentMessageContentText(messages.find((message) => message.role === "system")?.content ?? "")
      const user = agentMessageContentText(messages.findLast((message) => message.role === "user")?.content ?? "")
      calls.push({ system, user })
      const text = system.includes("本轮阶段：意图分析")
        ? `<!-- intent_clarity -->\n{"clarity":"clear","module":"章节细纲","analysis":"范围明确","detectedScope":"第236章","missingItems":[],"options":[],"question":""}\n<!-- /intent_clarity -->`
        : "# 第236章 远洋投送\n\n## 本章目标\n完善远洋投送细节。"
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation()], "outline-active", { pendingReferenceTokens: [reference] })
    const container = await renderOutlineChatPanel()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="引用输入框"]')
    expect(input).not.toBeNull()
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(input, "把236章大纲补充详细")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (calls.length >= 2 && useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    expect(calls).toHaveLength(2)
    expect(calls[0].system).toContain("本轮阶段：意图分析")
    expect(calls[0].system).toContain("<!-- /intent_clarity -->")
    expect(calls[1].system).toContain("本轮阶段：正文生成")
    expect(calls[1].system).toContain("禁止再次输出 intent_clarity")
    expect(calls[1].user).toContain("把236章大纲补充详细")
    expect(calls[1].user).toContain("第236章-远洋投送")
    const current = useOutlineChatStore.getState().conversations[0]
    expect(current.messages.findLast((message) => message.role === "assistant")?.content).toContain("完善远洋投送细节")
  })

  it("needs_input 停在推荐选项，不自动进入正文生成", async () => {
    const protocolText = `<!-- intent_clarity -->\n{"clarity":"needs_input","module":"章节细纲","analysis":"范围不足","detectedScope":"","missingItems":["章节范围"],"options":[{"id":"A","label":"生成最近章节","description":"最近5章"},{"id":"D","label":"自定义","description":"自行说明"}],"question":"请确认章节范围"}\n<!-- /intent_clarity -->`
    const runSpy = vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      callbacks.onText(protocolText)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: protocolText }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="引用输入框"]')
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(input, "补充章节大纲")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (runSpy.mock.calls.length === 1 && useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    expect(runSpy).toHaveBeenCalledTimes(1)
    // 需求分析浮层挂在面板根节点内（不是 Portal），用 body 文本兜住两种挂载方式。
    expect(document.body.textContent).toContain("请确认章节范围")
    expect(document.body.textContent).toContain("生成最近章节")
    expect(useOutlineChatStore.getState().conversations[0].messages.findLast((message) => message.role === "assistant")?.intentClarityResult?.clarity).toBe("needs_input")
  })

  it("历史未闭合 status clear 消息只显示手动继续生成，不在加载时调用模型", async () => {
    let sentSystem = ""
    let sentUser = ""
    const runSpy = vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      sentSystem = agentMessageContentText(messages.find((message) => message.role === "system")?.content ?? "")
      sentUser = agentMessageContentText(messages.findLast((message) => message.role === "user")?.content ?? "")
      const text = "# 第236章\n\n## 本章目标\n补全远洋投送。"
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation([
      { id: "u236", role: "user", content: "把236章大纲补充详细" },
      { id: "a236", role: "assistant", content: '<!-- intent_clarity -->\n{"status":"clear","intent":"完善第236章章纲","target":"章纲/第236章.md","scope":"第236章"}' },
    ])], "outline-active")
    const container = await renderOutlineChatPanel()

    expect(container.textContent).toContain("继续生成")
    expect(container.textContent).not.toContain('"status":"clear"')
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === "保存为大纲")).toBe(false)
    expect(runSpy).not.toHaveBeenCalled()

    const continueButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("继续生成"))
    await act(async () => {
      continueButton?.click()
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (runSpy.mock.calls.length === 1 && useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })
    expect(runSpy).toHaveBeenCalledTimes(1)
    expect(sentSystem).toContain("本轮阶段：正文生成")
    expect(sentUser).toContain("把236章大纲补充详细")
    expect(useOutlineChatStore.getState().conversations[0].messages.at(-1)?.content).toContain("补全远洋投送")
  })

  it("无效意图 JSON 显示协议错误且不提供保存入口", async () => {
    setOutlineConversations([conversation([
      { id: "u-invalid", role: "user", content: "完善章纲" },
      { id: "a-invalid", role: "assistant", content: '<!-- intent_clarity -->\n{"clarity":"clear"' },
    ])], "outline-active")
    const container = await renderOutlineChatPanel()

    expect(container.textContent).toContain("意图分析格式无效，尚未开始生成")
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === "保存为大纲")).toBe(false)
  })

  it("routes every outline generation menu item through the PRD 3.1 content workflow", () => {
    expect(source).toContain("## AI大纲生成工作流")
    expect(source).toContain("提取请求关键词")
    expect(source).toContain("识别用户意图")
    expect(source).toContain("本轮意图分析已经完成")
    expect(source).toContain("禁止再次输出 intent_clarity")
    expect(source).toContain("提取对小说创作有用的关键内容")
    expect(source).toContain("结合用户要用的 skill + soul.md 约束")
    expect(source).toContain("最终回复只输出大纲标题和大纲正文")
    expect(source).toContain("禁止输出工具调用报告、分析过程、完成报告、下一步行动")

    for (const title of ["章节细纲", "人物小传", "组织势力设定", "力量体系", "金手指设定", "伏笔计划", "地点设定"]) {
      expect(outlineSectionConfigsSource).toContain(title)
    }
  })

  it("locks outline generation to the upgraded staged workflow standard", () => {
    expect(source).toContain("充分性闸门")
    expect(source).toContain("先卷后章")
    expect(source).toContain("卷节拍表")
    expect(source).toContain("卷时间线")
    expect(source).toContain("滚动章纲")
    expect(source).toContain("新增设定写回")
    expect(source).toContain("CBN")
    expect(source).toContain("CPNs")
    expect(source).toContain("CEN")
    expect(source).toContain("CEN 必须能承接下一章 CBN")
  })

  it("lets outline chat bubbles expand to half of the window without overflowing narrow panels", () => {
    expect(source).toContain("lg:max-w-[50vw]")
    expect(source).toContain("max-w-full")
    expect(source).not.toContain("max-w-[85%]")
  })

  it("在 AI 大纲输入区接入固定生成向导并发送结构化 Prompt", () => {
    expect(source).toContain('import { OutlineWizardDialog } from "@/components/sources/outline-wizard-dialog"')
    expect(source).toContain("import {")
    expect(source).toContain("buildOutlineWizardPrompt")
    expect(source).toContain('aria-label="生成大纲模块"')
    expect(source).toContain("handleSubmitOutlineWizard")
    expect(source).toContain("buildOutlineWizardPrompt(request)")
    expect(source).toContain("disableWriteTools: true")
    expect(source).toContain("OUTLINE_CHAT_WIZARD_DISABLED_TOOLS")
    expect(source).toContain("<OutlineWizardDialog")
  })

  it("AI 大纲向导入口接入多 Agent 并行生成与单 Agent 回退提示", () => {
    expect(source).toContain("planOutlineSubAgents")
    expect(source).toContain("runOutlineMultiAgentWorkflow")
    expect(source).toContain("await runOutlineMultiAgentWorkflow({")
    expect(source).toContain("runSubAgent: async (subAgentPlan)")
    expect(source).toContain("runSingleAgentFallback")
    expect(source).toContain("mergeResults")
    expect(source).toContain("enableMultiAgent: !fastMode")
    expect(source).toContain('intentPhase: "generation"')
    expect(source).toContain("多 Agent 并行生成")
    expect(source).toContain("自动回退为单 Agent")
  })

  it("同人提交前编译原作正典，并用编译结果替换原始素材", () => {
    expect(source).toContain("compileFanficCanon({")
    expect(source).toContain("stripFanficCanonFrontmatter(compiled.document)")
    // 编译失败必须中断提交，而不是拿没编译的原文继续
    expect(source).toContain("原作正典编译失败，请重试。")
    // 超长原作分片编译时长，进度要透出
    expect(source).toContain("onProgress:")
  })

  it("同人提交支持复用已落盘正典，不再重复编译", () => {
    // 首次提交：编译并落盘
    expect(source).toContain("compileFanficCanon({")
    // 后续提交：勾选复用后直接读正典正文，跳过编译
    expect(source).toContain("request.fanficReuseCanon && !material")
    expect(source).toContain("loadFanficCanon(fanficProjectPath)")
    expect(source).toContain("已复用项目里已有的原作正典。")
    // 复用读的是完整正文，不是给上下文包用的 8000 字截断版
    expect(source).toContain("await loadFanficCanon(fanficProjectPath)")
    expect(source).toContain("const existing = stripFanficCanonFrontmatter(")
    expect(source).not.toContain("loadFanficCanonBody(")
  })

  it("原创作品残留同人正典时给出提示，但不擅自删文件", () => {
    // 残留正典仍会参与正文生成，会让模型把外部原作当权威
    expect(source).toContain("本项目已存在同人正典，它仍会参与正文生成")
    expect(source).toContain("fanficCanonPath(")
    expect(source).toContain("!isFanficRequest(request)")
    // 只提示，不调用删除
    expect(source).not.toContain("clearFanficCanon(")
  })

  it("快速模式系统提示去掉工作流强制段，仍保留保存协议和 Markdown 约束", () => {
    const prompt = buildOutlineAgentSystemPrompt({ projectName: "测试项目", mode: "fast" })

    expect(prompt).not.toContain("## AI大纲生成工作流")
    expect(prompt).not.toContain("## 意图清晰度分析阶段")
    expect(prompt).not.toContain("## AI大纲固定分析流程")
    expect(prompt).toContain("outlineSaveRequest")
    expect(prompt).toContain("Markdown 格式约束：结构化资料使用一级标题")
    expect(prompt).toContain("像普通对话一样直接出结果")
    expect(prompt).toContain("主动建议分成两章章纲")
    expect(prompt).not.toContain("必须按 PRD 3.1 主流程执行")
    expect(prompt).not.toContain("先提出最少必要澄清问题")
  })

  it("标准模式系统提示仍包含固定分析流程和生成工作流", () => {
    const prompt = buildOutlineAgentSystemPrompt({ projectName: "测试项目", mode: "standard" })

    expect(prompt).toContain("## AI大纲固定分析流程")
    expect(prompt).toContain("## AI大纲生成工作流")
    expect(prompt).toContain("## 意图清晰度分析阶段")
    expect(prompt).toContain("outlineSaveRequest")
    expect(prompt).toContain("必须按 PRD 3.1 主流程执行")
    expect(prompt).toContain("先提出最少必要澄清问题")
    expect(prompt).toContain("主动建议分成两章章纲")
  })

  it("快速模式提示分支引用两章章纲建议补丁，讨论轮不注入", () => {
    expect(source).toContain("TWO_CHAPTER_OUTLINE_SUGGESTION_RULE")
    expect(source).toMatch(/mode === "fast"[\s\S]{0,500}TWO_CHAPTER_OUTLINE_SUGGESTION_RULE/)
    const discussPrompt = buildOutlineAgentSystemPrompt({
      mode: "discuss",
      discussModule: "章节细纲",
    })
    expect(discussPrompt).not.toContain("主动建议分成两章章纲")
    expect(buildOutlineAgentSystemPrompt({ mode: "discuss" })).toContain("主动建议分成两章章纲")
  })

  it("快速模式源码跳过意图分析和多 Agent，人物小传不再降级为 analysis 预算", () => {
    // 这里原本还断言源码含 `outlineWorkflowMode === "fast"`，但那个表达式当时只用于
    // 挑选输入区上方那句说明文案的措辞；该文案已按用户要求删除，表达式随之消失。
    // 快速模式真正的门禁在生成路径上（下面两条 `outlineMode !== "fast"`），
    // 所以去掉那条只剩 UI 措辞意义的断言，不降低对本用例目标（跳过意图分析与多 Agent）的覆盖。
    expect(source).toMatch(
      /enableMultiAgent = Boolean\(options\.enableMultiAgent\)\s*\n\s*&& outlineMode !== "fast"/,
    )
    expect(source).toContain("outlineMode !== \"fast\"")
    expect(source).toMatch(/const charRun = await runOutlineAgentOnce\([\s\S]{0,400}budgetStage: "generation"/)
    expect(source).not.toMatch(/const charRun = await runOutlineAgentOnce\([\s\S]{0,400}budgetStage: "analysis"/)
    expect(source).toContain('budgetStage: "generation"')
    expect(source).toContain("intentPhase === \"intent_analysis\"")
    expect(source).toContain('? "analysis"')
    expect(source).toContain(': "generation"')
  })

  it("截断残稿不会自动弹出保存确认", () => {
    expect(source).toContain("!deliverableTruncated")
    expect(source).toContain("isOutlineOutputTruncated")
    expect(source).toMatch(
      /intentProtocol\.kind === "none"\s*\n\s*&& !intentProtocolError\s*\n\s*&& !deliverableTruncated/,
    )
    // 这条被截断闸门守着的调用必须存在；允许后面继续追加参数（如 assistantId），
    // 否则每次给这个函数加参数都要来改守卫，而守卫真正要守的是「调用没有被删掉」。
    expect(source).toMatch(
      /handleAutoSaveOutlineRequests\(capturedConvId, finalContent, isCurrentRun[,)]/,
    )
    expect(source).toContain("isSaveableOutlineDeliverable")
    expect(source).toContain("生成完成后自动保存")
    expect(source).toContain("if (isOutlineOutputTruncated(charRun.error)) deliverableTruncated = true")
    expect(source).toContain("if (isOutlineOutputTruncated(subRun.error)) deliverableTruncated = true")
    expect(source).toContain("if (agentError && !isOutlineOutputTruncated(agentError)) throw agentError")
    expect(source).toContain("if (mergeError && !isOutlineOutputTruncated(mergeError)) throw mergeError")
  })

  it("快速向导不把多 Agent 计划写进用户消息", () => {
    expect(source).toContain('buildOutlineWizardPrompt(request, { mode: "fast" })')
    expect(source).toContain("buildOutlineWizardMultiAgentPrompt(request)")
  })

  it("AI 大纲输入区默认标准模式，下拉可切换到快速", async () => {
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 10,
        top: 400,
        left: 20,
        bottom: 432,
        right: 120,
        width: 80,
        height: 32,
        toJSON: () => ({}),
      }),
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="AI 大纲执行模式"]')
    expect(trigger).not.toBeNull()
    expect(trigger?.textContent).toContain("标准")
    // 用户要求删掉输入区上方那两段文案（固定选项说明与重复的「选择生成你想要的小说」）；
    // 模式本身仍由下拉切换，所以下面继续验下拉的行为。
    expect(container.textContent).not.toContain("再交给 AI 分析和追问")
    expect(container.textContent).not.toContain("通过固定选项")
    expect(container.textContent).not.toContain("选择生成你想要的小说")

    await act(async () => {
      trigger?.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    const fastOption = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.getAttribute("role") === "option" && button.textContent?.includes("快速"))
    expect(fastOption).toBeDefined()
    await act(async () => {
      fastOption?.click()
    })

    expect(useWikiStore.getState().outlineWorkflowMode).toBe("fast")
    expect(outlineModelPreferenceMocks.saveOutlineWorkflowMode).toHaveBeenCalledWith("fast")
    expect(container.querySelector('[aria-label="AI 大纲执行模式"]')?.textContent).toContain("快速")
    // 切模式后那段说明也不再出现（它已被整体删除）。
    expect(container.textContent).not.toContain("再交给 AI 分析和追问")
    // 显式还原成标准模式：这个用例会切到 fast，而下面共用同一份 wiki store 的
    // 用例假设的是标准模式 —— 不还原就会把它们一起带红（实测过一次）。
    await act(async () => { useWikiStore.getState().setOutlineWorkflowMode("standard") })
  })

  it("执行模式下拉里有互斥的计划模式选项", async () => {
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10, y: 10, top: 400, left: 20, bottom: 432, right: 120, width: 80, height: 32,
        toJSON: () => ({}),
      }),
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="AI 大纲执行模式"]')

    await act(async () => {
      trigger?.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    const options = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .filter((button) => button.getAttribute("role") === "option")
    const menu = document.querySelector<HTMLElement>('[role="listbox"]')
    expect(menu?.style.maxHeight).toBe("none")
    expect(options.map((option) => option.textContent)).toHaveLength(4)
    expect(options.some((option) => option.textContent?.includes("共创"))).toBe(true)
    const planOption = options.find((option) => option.textContent?.includes("计划"))
    expect(planOption).toBeDefined()

    await act(async () => { planOption?.click() })

    expect(useWikiStore.getState().outlineWorkflowMode).toBe("plan")
    expect(outlineModelPreferenceMocks.saveOutlineWorkflowMode).toHaveBeenCalledWith("plan")
    expect(container.querySelector('[aria-label="AI 大纲执行模式"]')?.textContent).toContain("计划")
  })

  async function submitOutlineInput(container: HTMLElement, text: string) {
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="引用输入框"]')
    expect(input).not.toBeNull()
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(input, text)
      input?.dispatchEvent(new Event("input", { bubbles: true }))
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })
  }

  function outlinePlanBlock(payload: unknown): string {
    return `<!-- outline_plan -->\n${JSON.stringify(payload)}\n<!-- /outline_plan -->`
  }

  it("计划模式自由输入先做要素盘点，缺口渲染多问题追问卡片", async () => {
    useWikiStore.setState({ outlineWorkflowMode: "plan" })
    const calls: Array<{ system: string; user: string }> = []
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      calls.push({
        system: agentMessageContentText(messages.find((message) => message.role === "system")?.content ?? ""),
        user: agentMessageContentText(messages.findLast((message) => message.role === "user")?.content ?? ""),
      })
      const text = outlinePlanBlock({
        status: "needs_input",
        module: "章节细纲",
        elements: [{ key: "chapterRange", value: "第236章", source: "user", satisfied: true }],
        missing: ["本章目标"],
        questions: [{
          id: "q1",
          key: "chapterGoal",
          question: "本章目标是什么？",
          options: [
            { id: "A", label: "推进主线", description: "" },
            { id: "B", label: "铺垫伏笔", description: "" },
            { id: "C", label: "兑现爽点", description: "" },
          ],
        }],
      })
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()

    await submitOutlineInput(container, "把236章大纲补充详细")

    expect(calls).toHaveLength(1)
    expect(calls[0].system).toContain("## 本轮阶段：计划模式要素盘点")
    expect(calls[0].system).not.toContain("本轮阶段：意图分析")
    expect(calls[0].user).toContain("计划模式要素盘点")

    const assistant = useOutlineChatStore.getState().conversations[0].messages
      .findLast((message) => message.role === "assistant")
    expect(assistant?.outlinePlanPhase).toBe("element_check")
    expect(assistant?.outlinePlanProtocol?.status).toBe("needs_input")
    expect(assistant?.outlinePlanError).toBeUndefined()
    // 协议 JSON 只走卡片，不能漏进气泡
    expect(container.textContent).not.toContain("outline_plan")
    expect(container.textContent).not.toContain("needs_input")
    expect(container.textContent).toContain("待补要素：本章目标")
    expect(container.textContent).toContain("推进主线")
    // 系统自动补齐的自定义输入项
    expect(container.textContent).toContain("其它（我来补充描述）")
    // 停机态不被复位，徽章留在收集要素
    expect(container.textContent).toContain("收集要素")
    expect(document.body.textContent).not.toContain("请确认要保存的大纲文件")
  })

  it("计划模式要素齐备才渲染计划卡片，未齐的 ready 被闸门打回追问", async () => {
    useWikiStore.setState({ outlineWorkflowMode: "plan" })
    const readyPlan = {
      summary: "补齐三位主角小传",
      steps: [{ id: "s1", title: "读取已有大纲", detail: "确认人物出场" }],
      files: [{
        targetFolder: "人物小传",
        fileName: "角色-林风.md",
        fileType: "character",
        writeMode: "create",
        elements: ["moduleRequirement"],
      }],
      order: "先主角后配角",
      risks: [],
      openQuestions: [],
    }
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      const text = outlinePlanBlock({
        status: "ready",
        module: "人物小传",
        elements: [],
        missing: [],
        questions: [],
        plan: readyPlan,
      })
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()

    await submitOutlineInput(container, "生成人物小传")

    // 要素全空：ready 被强制降级为追问，不给确认按钮
    expect(container.querySelector('[aria-label="确认生成计划"]')).toBeNull()
    expect(container.querySelector('[aria-label="提交补充要素"]')).not.toBeNull()
    const downgraded = useOutlineChatStore.getState().conversations[0].messages
      .findLast((message) => message.role === "assistant")
    expect(downgraded?.outlinePlanProtocol?.status).toBe("needs_input")
    expect(downgraded?.outlinePlanProtocol?.plan).toBeUndefined()

    vi.restoreAllMocks()
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      const text = outlinePlanBlock({
        status: "ready",
        module: "人物小传",
        elements: [
          { key: "generationScope", value: "全部缺失项", source: "user", satisfied: true },
          { key: "existingBaseline", value: "已有主角设定", source: "project", satisfied: true },
          { key: "moduleRequirement", value: "补三位主角", source: "user", satisfied: true },
          { key: "storyConstraints", value: "遵守总纲设定", source: "project", satisfied: true },
        ],
        missing: [],
        questions: [],
        plan: readyPlan,
      })
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })

    await submitOutlineInput(container, "生成人物小传")

    expect(container.querySelector('[aria-label="确认生成计划"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="修改生成计划"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="补充生成要素"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="取消生成计划"]')).not.toBeNull()
    expect(container.textContent).toContain("人物小传/角色-林风.md")
    expect(container.textContent).toContain("等待确认计划")
    // 计划仍未确认，不能进入保存确认
    expect(document.body.textContent).not.toContain("请确认要保存的大纲文件")
  })

  it("快速模式自由输入跳过意图分析，直接单轮生成", async () => {
    useWikiStore.setState({ outlineWorkflowMode: "fast" })
    const calls: Array<{ system: string; user: string }> = []
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      const system = agentMessageContentText(messages.find((message) => message.role === "system")?.content ?? "")
      const user = agentMessageContentText(messages.findLast((message) => message.role === "user")?.content ?? "")
      calls.push({ system, user })
      const text = "# 第236章 远洋投送\n\n## 本章目标\n完善远洋投送细节。"
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="引用输入框"]')
    expect(input).not.toBeNull()
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(input, "把236章大纲补充详细")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (calls.length >= 1 && useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].system).not.toContain("本轮阶段：意图分析")
    expect(calls[0].system).toContain("像普通对话一样直接出结果")
    expect(calls[0].user).toContain("把236章大纲补充详细")
  })

  it("网络断流后显示并保留已接收设定，已有保存协议也不自动弹出确认", async () => {
    useWikiStore.setState({ outlineWorkflowMode: "fast" })
    const body = "# 金手指设定：回响\n\n## 能力概述\n已收到的触发条件：接触旧物。"
    const text = body + '\n\n```json\n' + JSON.stringify({outlineSaveRequest:{targetFolder:"金手指设定",fileName:"回响.md",fileType:"setting",writeMode:"create",referencedSkills:[],sourceIntent:"金手指设定",content:""}}) + '\n```'
    const runSpy = vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      callbacks.onText(text)
      callbacks.onError(new Error("error decoding response body"))
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="引用输入框"]')
    expect(input).toBeInstanceOf(HTMLTextAreaElement)
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(input, "随便写点设定")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      for (let attempt = 0; attempt < 200; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5))
        if (runSpy.mock.calls.length && useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
      }
    })
    expect(runSpy).toHaveBeenCalledTimes(1)
    const assistant = useOutlineChatStore.getState().conversations.find(item => item.id === "outline-active")?.messages.filter(item => item.role === "assistant").at(-1)
    expect(assistant?.content).toContain("已收到的触发条件")
    expect(assistant?.content).toContain("生成中断")
    expect(assistant?.content).not.toContain("生成失败：")
    expect(assistant?.isAgentRunning).toBe(false)
    expect(document.body.textContent).not.toContain("请确认要保存的大纲文件")
  })

  it("单 Agent 输出被截断时不自动弹出保存确认", async () => {
    useWikiStore.setState({ outlineWorkflowMode: "fast" })
    const body = "# 总纲\n\n## 核心设定\n残稿"
    const text = `${body}\n\n\`\`\`json\n${JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "大纲",
        fileName: "总纲.md",
        fileType: "outline",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "生成总纲",
        content: body,
      },
    })}\n\`\`\``
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      callbacks.onText(text)
      callbacks.onError(new Error("输出被截断：模型已达到最大输出 token 上限"))
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="引用输入框"]')
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(input, "随便写点设定")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    expect(container.textContent).toContain("输出被截断")
    expect(container.textContent).not.toContain("请确认要保存的大纲文件")
    expect(document.body.textContent).not.toContain("请确认要保存的大纲文件")
  })

  it("计划模式系统提示注入要素盘点规则并去掉意图分析段", () => {
    const planningPrompt = buildOutlineAgentSystemPrompt({
      projectName: "测试项目",
      mode: "plan",
      planModule: "章节细纲",
    })

    expect(planningPrompt).toContain("## AI大纲固定分析流程")
    expect(planningPrompt).toContain("## 计划模式总则")
    expect(planningPrompt).toContain("## 本轮阶段：计划模式要素盘点")
    expect(planningPrompt).toContain("<!-- outline_plan -->")
    expect(planningPrompt).toContain("chapterRange")
    expect(planningPrompt).not.toContain("## 意图清晰度分析阶段")
    // 盘点轮只允许输出协议块，不能再要求附加下一步推荐
    expect(planningPrompt).not.toContain("## 下一步推荐输出")

    const generationPrompt = buildOutlineAgentSystemPrompt({
      projectName: "测试项目",
      mode: "plan",
    })

    expect(generationPrompt).toContain("## 计划模式总则")
    expect(generationPrompt).not.toContain("## 本轮阶段：计划模式要素盘点")
    expect(generationPrompt).toContain("## 下一步推荐输出")
    expect(generationPrompt).toContain("outlineSaveRequest")
  })

  it("共创讨论轮系统提示必须输出 outline_discuss，且不含计划/意图闸门", () => {
    const discussPrompt = buildOutlineAgentSystemPrompt({
      projectName: "测试项目",
      mode: "discuss",
      discussModule: "章节细纲",
    })

    expect(discussPrompt).toContain("## 共创讨论模式总则")
    expect(discussPrompt).toContain("未经作者确认定稿前，不要输出完整大纲正文")
    expect(discussPrompt).toContain("1-3 个需要作者拍板的具体分歧点")
    expect(discussPrompt).toContain("禁止只抛开放式问题让作者自己想")
    expect(discussPrompt).toContain("必须输出 outline_discuss")
    expect(discussPrompt).toContain("## 本轮阶段：共创讨论")
    expect(discussPrompt).toContain("禁止输出 intent_clarity 和 outline_plan")
    expect(discussPrompt).not.toContain("## 意图清晰度分析阶段")
    expect(discussPrompt).not.toContain("## 计划模式总则")
    expect(discussPrompt).not.toContain("## 下一步推荐输出")
    expect(discussPrompt).not.toContain("必须按 PRD 3.1 主流程执行")
    expect(discussPrompt).not.toContain("## AI 大纲输出协议")

    const generationPrompt = buildOutlineAgentSystemPrompt({
      projectName: "测试项目",
      mode: "discuss",
    })
    expect(generationPrompt).toContain("作者已经确认定稿")
    expect(generationPrompt).toContain("outlineSaveRequest")
    expect(generationPrompt).not.toContain("## 本轮阶段：共创讨论")
  })

  /**
   * 回归：讨论轮提示词里**不能**再出现「生成并保存正文」的契约。
   *
   * 实测故障：这两套契约同时出现时，模型挑了生成那套照做 ——
   * 直接返回完整卷纲 + 写回清单，一个 outline_discuss 标记都没有，
   * 于是被协议闸门判成「共创协议格式无效，尚未开始生成」，整轮作废。
   *
   * 起因有两处：①「## AI大纲生成工作流」整段（含「生成章纲后必须列出新增设定
   * 写回清单」，正是模型输出的那个「写回清单」）被讨论轮沿用；
   * ②「## Markdown 格式强制要求」只把**标题**放进了排除数组，
   * 正文与整段大纲示例留在外面，等于一边禁止输出正文、一边给了正文格式与范例。
   */
  it("讨论轮不得携带任何生成/保存契约，否则模型会直接产出正文而不给协议", () => {
    const discussPrompt = buildOutlineAgentSystemPrompt({
      projectName: "测试项目",
      mode: "discuss",
      discussModule: "卷纲",
    })

    const generationOnlyRules = [
      "## AI大纲生成工作流",
      "生成章纲后必须列出新增设定写回清单",
      "生成章纲时必须使用章纲标准结构",
      "结构节点必须包含 CBN、CPNs、CEN",
      "## Markdown 格式强制要求",
      "所有大纲正文必须使用标准 Markdown 格式输出",
      "# 五、主要人物设定",
      "当本轮要交付可保存的大纲正文时",
      "需要保存大纲时只输出 outlineSaveRequest",
    ]
    for (const rule of generationOnlyRules) {
      expect(discussPrompt, `讨论轮不该出现生成契约：「${rule}」`).not.toContain(rule)
    }

    // 反过来：讨论轮该有的都在，删干净不能连带把协议要求删掉
    expect(discussPrompt).toContain("必须输出 outline_discuss 协议块")
    expect(discussPrompt).toContain("## 本轮阶段：共创讨论")
    expect(discussPrompt).toContain("## AI大纲固定分析流程")
    // 讨论轮排除生成工作流，但不能连「先读资料」的纪律一起删掉
    expect(discussPrompt).toContain("list_outlines")

    // 生成轮必须原样保留这些契约（排除逻辑只能作用于讨论轮）
    const generationTurn = buildOutlineAgentSystemPrompt({ projectName: "测试项目", mode: "discuss" })
    expect(generationTurn).toContain("## AI 大纲输出协议")
    expect(generationTurn).toContain("## Markdown 格式强制要求")
    expect(generationTurn).toContain("生成章纲后必须列出新增设定写回清单")
    expect(generationTurn).toContain("当本轮要交付可保存的大纲正文时")
  })

  it("讨论轮不再被「只输出正文」规则压制，且质疑必须带替代方案", () => {
    const standardPrompt = buildOutlineAgentSystemPrompt({
      projectName: "测试项目",
      mode: "standard",
    })

    expect(standardPrompt).toContain("## 输出边界（按本轮性质区分）")
    expect(standardPrompt).toContain("当本轮要交付可保存的大纲正文时")
    expect(standardPrompt).toContain("不要用「只输出正文」的规则压制讨论")
    expect(standardPrompt).toContain("## 主动性要求")
    expect(standardPrompt).toContain("每轮最多提出 1 条对用户已有设定的质疑")
    expect(standardPrompt).toContain("必须同时给出替代方案")

    // 盘点轮只允许输出协议块，主动性要求不能挤进来
    expect(buildOutlineAgentSystemPrompt({ mode: "plan", planModule: "章节细纲" }))
      .not.toContain("## 主动性要求")
  })

  it("共创模式三个入口都不进意图分析和多 Agent", () => {
    expect(source).toContain("function buildOutlineDiscussionPrompt(")
    expect(source).toContain('&& outlineMode !== "discuss"')
    expect(source).toContain("insertOutlineGenerationCommand")
    expect(source).toMatch(/if \(outlineMode === "discuss"\) \{\s*\n\s*void handleSend\(buildOutlineDiscussionPrompt\(title, requestHint\)/)
    expect(source).toContain("// 共创模式把向导需求当讨论起点：先对齐方案再产出，不直接开写")
    expect(source).toContain('outlineModeForBudget === "discuss" && options.intentPhase !== "generation"')
    expect(source).toContain("isOutlineDiscussFinalizeRequest")
  })

  function outlineDiscussBlock(payload: unknown): string {
    return `判断如下。\n<!-- outline_discuss -->\n${JSON.stringify(payload)}\n<!-- /outline_discuss -->\n下一步先定钩子。`
  }

  it("共创模式自由输入渲染决策点卡片，协议 JSON 不进气泡", async () => {
    useWikiStore.setState({ outlineWorkflowMode: "discuss" })
    const calls: Array<{ system: string; user: string }> = []
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      calls.push({
        system: agentMessageContentText(messages.find((message) => message.role === "system")?.content ?? ""),
        user: agentMessageContentText(messages.findLast((message) => message.role === "user")?.content ?? ""),
      })
      const text = outlineDiscussBlock({
        status: "needs_decision",
        module: "章节细纲",
        judgment: "第45章还缺一个开场选择",
        nextStep: "先定钩子",
        decisions: [{
          id: "d1",
          question: "这章用什么钩子？",
          options: [
            { id: "A", label: "仇人登门", description: "更狠" },
            { id: "B", label: "旧信重现", description: "更慢" },
          ],
          preferenceId: "A",
          preferenceReason: "冲突来得更快",
        }],
        agreed: [],
      })
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()

    await submitOutlineInput(container, "我们来写第45章")

    expect(calls).toHaveLength(1)
    expect(calls[0].system).toContain("## 本轮阶段：共创讨论")
    expect(calls[0].system).not.toContain("本轮阶段：意图分析")
    expect(calls[0].system).not.toContain("## 本轮阶段：计划模式要素盘点")

    const assistant = useOutlineChatStore.getState().conversations[0].messages
      .findLast((message) => message.role === "assistant")
    expect(assistant?.outlineDiscussPhase).toBe("decision")
    expect(assistant?.outlineDiscussProtocol?.status).toBe("needs_decision")
    expect(assistant?.outlineDiscussError).toBeUndefined()
    expect(container.textContent).not.toContain("outline_discuss")
    expect(container.textContent).not.toContain("needs_decision")
    expect(container.textContent).toContain("需要你拍板")
    expect(container.textContent).toContain("仇人登门")
    expect(container.textContent).toContain("AI 倾向")
    expect(container.textContent).toContain("等待拍板")
    expect(container.textContent).not.toContain("缺少要素")
    expect(document.body.textContent).not.toContain("请确认要保存的大纲文件")
  })

  it("共创轮直接交付卷纲时不再判「未返回 outline_discuss」作废", async () => {
    useWikiStore.setState({ outlineWorkflowMode: "discuss" })
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      // 模型没走讨论协议，而是直接交付了卷纲：MD 正文 + volumeOutlineData + outlineSaveRequest。
      const output = [
        "# 修真界卷级架构",
        "",
        "## 总体定位",
        "整体基调先抑后扬，围绕守护展开。",
        "",
        "```json",
        JSON.stringify({ volumeOutlineData: { position: { level: "volume-outline", scope: "修真界部分（共三卷）" }, subVolumes: ["卷一"] } }),
        "```",
        "```json",
        JSON.stringify({ outlineSaveRequest: { targetFolder: "卷纲", fileName: "修真界卷级架构.md", fileType: "volume-outline", writeMode: "create", referencedSkills: [], sourceIntent: "生成完成后自动保存", content: "# 修真界卷级架构\n\n## 总体定位\n\n整体基调先抑后扬。" } }),
        "```",
      ].join("\n")
      callbacks.onText(output)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: output }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()

    await submitOutlineInput(container, "帮我把修真界的卷级架构定下来")

    const assistant = useOutlineChatStore.getState().conversations[0].messages
      .findLast((message) => message.role === "assistant")
    // 回归核心：直接交付的卷纲不得被判成「模型未返回 outline_discuss 协议块」而整轮作废
    expect(assistant?.outlineDiscussError).toBeUndefined()
    expect(container.textContent).not.toContain("模型未返回 outline_discuss 协议块")
    // 内容没有被藏起来：正文可见
    expect(container.textContent).toContain("修真界卷级架构")
    expect(container.textContent).toContain("整体基调先抑后扬")
  })

  it("共创轮直接交付可保存大纲时进入保存确认链路（内容未丢）", async () => {
    useWikiStore.setState({ outlineWorkflowMode: "discuss" })
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      const output = [
        "# 修真界卷级架构",
        "",
        "## 总体定位",
        "整体基调先抑后扬，三卷递进。",
        "",
        "```json",
        JSON.stringify({ outlineSaveRequest: { targetFolder: "大纲", fileName: "修真界卷级架构.md", fileType: "outline", writeMode: "create", referencedSkills: [], sourceIntent: "生成完成后自动保存", content: "# 修真界卷级架构\n\n## 总体定位\n\n整体基调先抑后扬。" } }),
        "```",
      ].join("\n")
      callbacks.onText(output)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: output }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()

    await submitOutlineInput(container, "把这版卷级架构整理出来")

    const assistant = useOutlineChatStore.getState().conversations[0].messages
      .findLast((message) => message.role === "assistant")
    expect(assistant?.outlineDiscussError).toBeUndefined()
    // 交付物被真正产出：弹出保存确认（而不是只把源码截断/隐藏）
    expect(document.body.textContent).toContain("请确认要保存的大纲文件")
    // 气泡里能看到正文
    expect(container.textContent).toContain("三卷递进")
  })

  /*
   * 端到端：卷纲结构化数据不完整时，
   *   ① 校验问题必须挂在**生成结果下方**那条消息上（而不是只弹浮层）；
   *   ② 自动补全提示词必须复用卷纲契约，否则补了也过不了校验。
   */
  it("卷纲不完整时，校验问题挂在生成结果下方，且补全提示词带上完整契约", async () => {
    const repairPrompts: string[] = []
    let callIndex = 0
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      const lastUser = agentMessageContentText(
        messages.findLast((message) => message.role === "user")?.content ?? "",
      )
      if (callIndex > 0) repairPrompts.push(lastUser)
      callIndex += 1
      // 两轮都返回「故事数不足 + 环节缺失」的不完整卷纲：第一轮触发自动补全，
      // 第二轮补完仍不完整 → 挂报告 + 提示可保存当前内容。
      const output = [
        "# 修真界卷级架构",
        "",
        "## 总体定位",
        "整体基调先抑后扬。",
        "",
        "```json",
        JSON.stringify({
          volumeOutlineData: {
            title: "修真界卷级架构",
            stories: [{ id: 1, title: "故事一", st: [{ stage: "起①", p: ["a", "b", "c"] }] }],
          },
        }),
        "```",
        "```json",
        JSON.stringify({
          outlineSaveRequest: {
            targetFolder: "卷纲",
            fileName: "修真界卷级架构.md",
            fileType: "volume-outline",
            writeMode: "create",
            referencedSkills: [],
            sourceIntent: "生成完成后自动保存",
            content: "# 修真界卷级架构\n\n## 总体定位\n\n整体基调先抑后扬。",
          },
        }),
        "```",
      ].join("\n")
      callbacks.onText(output)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: output }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()

    await submitOutlineInput(container, "把这一卷的卷纲写出来")
    // 自动补全那一轮是 effect 触发的，等它跑完
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    // ① 报告挂在消息上，并显示在生成结果下方
    const reported = useOutlineChatStore.getState().conversations[0].messages
      .filter((message) => message.role === "assistant" && message.outlineSaveReport)
      .at(-1)
    expect(reported?.outlineSaveReport?.fileType).toBe("volume-outline")
    expect(reported!.outlineSaveReport!.problems.length).toBeGreaterThan(0)
    expect(container.textContent).toContain("卷纲内容不完整（")
    expect(container.textContent).toContain("待保存文件：修真界卷级架构.md")
    // 明细逐条可读，且保留「照样保存」的出口
    expect(container.textContent).toContain(reported!.outlineSaveReport!.problems[0])
    expect(container.textContent).toContain("可以保存当前内容，或让 AI 重新生成")

    // ② 补全提示词复用卷纲契约（否则「补一轮→还是同样的 N 项」）
    expect(repairPrompts.length).toBeGreaterThan(0)
    const repairPrompt = repairPrompts[0]
    for (const field of ["range", "deliver", "gift", "mid", "twist", "hook", "climax", "beats", "stage", "who", "use", "line"]) {
      expect(repairPrompt).toContain(field)
    }
  })

  it("共创模式定稿后才进入正文生成", async () => {
    useWikiStore.setState({ outlineWorkflowMode: "discuss" })
    const calls: Array<{ system: string; user: string }> = []
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      calls.push({
        system: agentMessageContentText(messages.find((message) => message.role === "system")?.content ?? ""),
        user: agentMessageContentText(messages.findLast((message) => message.role === "user")?.content ?? ""),
      })
      const text = outlineDiscussBlock({
        status: "ready",
        module: "章节细纲",
        judgment: "冲突和人物动机已经对齐",
        nextStep: "确认后开写",
        decisions: [],
        agreed: [{ id: "a1", question: "开场钩子", value: "仇人登门" }],
      })
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()

    await submitOutlineInput(container, "继续讨论第45章")

    expect(container.textContent).toContain("可以定稿")
    expect(container.textContent).toContain("开场钩子：仇人登门")
    expect(container.textContent).toContain("等待定稿")

    const confirm = container.querySelector<HTMLButtonElement>('[aria-label="定稿开始生成"]')
    expect(confirm).not.toBeNull()

    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      calls.push({
        system: agentMessageContentText(messages.find((message) => message.role === "system")?.content ?? ""),
        user: agentMessageContentText(messages.findLast((message) => message.role === "user")?.content ?? ""),
      })
      const text = "# 第45章\n\n章纲正文"
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })

    await act(async () => {
      confirm?.click()
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[1].system).toContain("作者已经确认定稿")
    expect(calls[1].system).not.toContain("## 本轮阶段：共创讨论")
    expect(calls[1].user).toContain("已经定稿")
  })

  it("三个入口在计划模式下都走要素盘点，不直接进生成", () => {
    expect(source).toContain("const startOutlinePlanElementCheck = useCallback")
    expect(source).toContain('planPhase: "element_check"')
    expect(source).toContain("buildOutlinePlanElementCheckPrompt")
    // 分项菜单
    expect(source).toMatch(/if \(outlineMode === "plan"\) \{\s*\n\s*void startOutlinePlanElementCheck\(capturedConvId, \{\s*\n\s*module: title,/)
    // 自由输入仍用生成类意图闸门
    expect(source).toContain("const directRequest = classifyDirectOutlineGenerationRequest(text)")
    expect(source).toMatch(/if \(outlineMode === "plan"\) \{\s*\n\s*return startOutlinePlanElementCheck\(capturedConvId, \{\s*\n\s*module: directRequest\.module,/)
    // 向导不再短路到 generation
    expect(source).toContain("// 计划模式不直接短路到生成：向导需求先当作要素输入做盘点")
  })

  it("计划模式盘点轮跳过自动保存并把停机态留在界面上", () => {
    expect(source).toContain("&& !options.planPhase")
    expect(source).toMatch(/advanceCapturedWorkflowStages\(\[\s*"sufficiency_check",/)
    expect(source).toContain('if (stage === "collecting_requirements" || stage === "waiting_user_confirm") return stages')
    // 成功收尾和 finally 都必须走带守卫的复位，否则停机态会被立刻抹掉
    expect(source).toMatch(/saveToDisk\(\);\s*\n\s*resetCapturedWorkflowStageToIdle\(\);/)
    expect(source).toMatch(/outlineConversationRunRegistry\.remove\(capturedConvId, controller\);\s*\n\s*resetCapturedWorkflowStageToIdle\(\);/)
  })

  it("AI 大纲多 Agent 过程写入消息状态并渲染结构化面板", () => {
    expect(source).toContain('import { OutlineMultiAgentPanel } from "@/components/sources/outline-multi-agent-panel"')
    expect(source).toContain("multiAgentRun")
    expect(source).toContain("updateOutlineMultiAgentRun")
    expect(source).toContain("<OutlineMultiAgentPanel")
    expect(source).toContain("run={msg.multiAgentRun}")
    expect(source).toContain("status: \"pending\"")
    expect(source).toContain("status: \"running\"")
    expect(source).toContain("status: \"merging\"")
    expect(source).toContain("fallbackReason")
  })

  it("子 Agent 重试统一由依赖调度器控制为一次", () => {
    expect(source).toContain("onStatusChange: (event)")
    expect(source).toContain('event.status === "retrying"')
    expect(source).not.toContain("retrySubAgentMessages")
    expect(source).not.toContain("subAgentRetryRun")
  })

  it("接入动态 Agent 规划并在规划无效时保留规则规划", () => {
    expect(source).toContain("buildDynamicOutlinePlannerPrompt")
    expect(source).toContain("parseDynamicOutlinePlan")
    expect(source).toContain("outlineWritingSkills.map((skill)")
    expect(source).toContain("targetConversation?.contextSummary")
    expect(source).toContain("existingModules: outlineSources")
    expect(source).toContain("let subAgentPlan = fallbackSubAgentPlan")
    expect(source).toContain("if (dynamicPlan.ok) subAgentPlan = dynamicPlan.plan")
    expect(source).not.toContain("failureFallbackThreshold")
  })

  it("keeps wizard prompt bubbles readable and stops streaming in the selected conversation", () => {
    expect(source).toContain("outlineConversationRunRegistry")
    expect(source).toContain("const capturedConvId = convId")
    expect(source).toContain("outlineConversationRunRegistry.abort(activeConversationId)")
    expect(source).toContain('className="block whitespace-pre-wrap break-words"')
  })

  it("saves AI outline results into the inferred outline category folder", () => {
    expect(source).toContain("buildClassifiedOutlineSaveRequest")
    expect(source).toContain("built.request")
    expect(source).toContain("保存大纲文件")
    expect(source).toContain("手动保存 AI 大纲结果")
  })

  it("历史消息中的 Gemini 思考摘要不会再次展示或进入手动保存", async () => {
    setOutlineConversations([conversation([{
      id: "thought-only-outline",
      role: "assistant",
      content: GEMINI_OUTLINE_THOUGHT_DUMP,
    }])], "outline-active")
    const container = await renderOutlineChatPanel()
    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.getAttribute("aria-label") === "保存为大纲")

    expect(saveButton).toBeUndefined()
    expect(container.textContent).not.toContain("Examining the Narrative Details")
    expect(document.body.textContent).not.toContain("请确认要保存的大纲文件")
  })

  it("parses structured AI outline save requests and requires user confirmation before writing", () => {
    expect(source).toContain("parseOutlineSaveRequests")
    expect(source).toContain("formatOutlineSaveParseFeedback")
    expect(source).toContain("saveOutlineSaveRequests")
    expect(source).toContain("outlineSaveRequest")
    expect(source).toContain("检测到可保存大纲，请确认后写入")
    expect(source).toContain("请确认要保存的大纲文件")
    expect(source).not.toContain("已自动保存")
    expect(source).toContain("AI 大纲输出协议")
  })

  it("uses folder save confirm dialog for classified outline saves", () => {
    expect(source).toContain("OutlineSaveConfirmDialog")
    expect(source).toContain("OutlineSaveConfirmPayload")
    expect(source).toContain("extractCharacterSaveDrafts")
    expect(source).toContain("buildClassifiedOutlineSaveRequest")
    expect(source).toContain("characterDraftsToSaveRequests")
    expect(source).toContain("splitConfirmRequiredSaveRequests")
    expect(source).toContain("mode={saveConfirmState.mode}")
    expect(source).toContain("requests={saveConfirmState.requests}")
    expect(source).toContain("characterDrafts={saveConfirmState.characterDrafts}")
    expect(source).not.toContain("<AiChangeReview")
    expect(source).not.toContain("reviewItems")
    expect(source).toContain("confirmed: true")
  })

  it("does not silently auto-save outline requests without confirmation", () => {
    expect(source).toContain("confirmRequired")
    expect(source).toContain("请确认要保存的人物角色")
    expect(source).toContain("请确认要保存的大纲文件")
    expect(source).toContain("pendingSaveBatchesRef")
    expect(source).toContain("presentOrQueueSaveBatch")
  })

  it("queues or merges pending outline saves across turns instead of overwriting", () => {
    expect(source).toContain("mergeOutlineSaveRequests")
    expect(source).toContain("saveConfirmStateRef")
    expect(source).toContain("pendingSaveBatchesRef")
    expect(source).toContain('current.mode === "normal" && batch.mode === "normal"')
    expect(source).toContain("presentOrQueueSaveBatch")
    expect(source).toContain("drainNextSaveBatch")
    // 确认/关闭后继续 drain，避免未确认批次被覆盖丢失
    expect(source).toContain("drainNextSaveBatch()")
    expect(source).toContain("onClose={handleCloseSaveConfirm}")
    expect(source).toContain("handleCloseSaveConfirm")
    expect(source).not.toContain("pendingNormalSaveRequestsRef")
  })

  it("keeps a confirmation fallback when character extraction fails", () => {
    expect(source).toContain("buildFallbackCharacterDraftsFromRequests")
    expect(source).toContain("无法自动拆分角色")
  })


  it("AI 大纲系统提示实际包含简短 Markdown 约束", () => {
    const prompt = buildOutlineAgentSystemPrompt({ projectName: "测试项目" })

    expect(prompt).toContain("Markdown 格式约束：结构化资料使用一级标题")
    expect(prompt).toContain("不要用代码围栏包裹全文")
  })


  async function chooseOutlineModel(container: HTMLElement, label: string) {
    // 触发器样式于 5388348（调整大纲章节编辑与对话界面）由 .h-8.w-32 改为 h-8 w-fit max-w-40，
    // 改用模型区容器定位：该区域内只有模型选择按钮没有 aria-label（思考深度按钮带 aria-label）。
    const trigger = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".ui-test-ai-model button"),
    ).find((button) => !button.hasAttribute("aria-label"))
    expect(trigger).toBeDefined()
    await act(async () => {
      trigger?.click()
    })
    let option: HTMLButtonElement | undefined
    for (let attempt = 0; attempt < 50 && !option; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      option = Array.from(document.body.querySelectorAll("button")).find((button) =>
        button !== trigger && button.textContent?.includes(label),
      ) as HTMLButtonElement | undefined
    }
    expect(option).toBeDefined()
    await act(async () => {
      option?.click()
      await Promise.resolve()
    })
  }

  it("restores the global outline model after remounting and switching projects", async () => {
    useWikiStore.setState({
      aiOutlineModel: "openai/gpt-4.1",
      providerConfigs: {
        openai: {
          apiKey: "test-key",
          enabled: true,
          savedModels: [
            { id: "gpt-4o", model: "gpt-4o", name: "GPT-4o", createdAt: 1 },
            { id: "gpt-4.1", model: "gpt-4.1", name: "GPT-4.1", createdAt: 2 },
          ],
        },
      },
    })
    setOutlineConversations([{ ...conversation(), modelId: "openai/gpt-4o" }], "outline-active")

    const firstContainer = await renderOutlineChatPanel()
    expect(firstContainer.textContent).toContain("GPT-4.1")

    const firstMounted = mountedRoots.pop()
    expect(firstMounted).toBeDefined()
    await act(async () => firstMounted?.root.unmount())
    firstMounted?.container.remove()

    useWikiStore.setState({ project: { id: "project-2", name: "Project 2", path: "C:/Book-2" } })
    setOutlineConversations([{ ...conversation(), id: "project-2-conversation", modelId: "openai/gpt-4o" }], "project-2-conversation")
    const secondContainer = await renderOutlineChatPanel()

    expect(secondContainer.textContent).toContain("GPT-4.1")
    expect(useWikiStore.getState().aiOutlineModel).toBe("openai/gpt-4.1")
  })

  it("saves a stable outline model id immediately without changing the AI chat model", async () => {
    useWikiStore.setState({
      aiChatModel: "openai/gpt-4o",
      aiOutlineModel: "openai/gpt-4o",
      providerConfigs: {
        openai: {
          apiKey: "test-key",
          enabled: true,
          savedModels: [
            { id: "gpt-4o", model: "gpt-4o", name: "GPT-4o", createdAt: 1 },
            { id: "gpt-4.1", model: "gpt-4.1", name: "GPT-4.1", createdAt: 2 },
          ],
        },
      },
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()

    await chooseOutlineModel(container, "GPT-4.1")

    expect(useWikiStore.getState().aiOutlineModel).toBe("openai/gpt-4.1")
    expect(useWikiStore.getState().aiChatModel).toBe("openai/gpt-4o")
    expect(useOutlineChatStore.getState().conversations[0].modelId).toBe("openai/gpt-4.1")
    expect(outlineModelPreferenceMocks.saveAiOutlineModel).toHaveBeenCalledWith("openai/gpt-4.1")
  })

  it("keeps the selected outline model usable when persistence fails", async () => {
    outlineModelPreferenceMocks.saveAiOutlineModel.mockRejectedValueOnce(new Error("disk failed"))
    const toastSpy = vi.spyOn(toast, "info").mockImplementation(() => {})
    useWikiStore.setState({
      aiOutlineModel: "openai/gpt-4o",
      providerConfigs: {
        openai: {
          apiKey: "test-key",
          enabled: true,
          savedModels: [
            { id: "gpt-4o", model: "gpt-4o", name: "GPT-4o", createdAt: 1 },
            { id: "gpt-4.1", model: "gpt-4.1", name: "GPT-4.1", createdAt: 2 },
          ],
        },
      },
    })
    setOutlineConversations([conversation()], "outline-active")
    const container = await renderOutlineChatPanel()

    await chooseOutlineModel(container, "GPT-4.1")
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(useWikiStore.getState().aiOutlineModel).toBe("openai/gpt-4.1")
    expect(toastSpy).toHaveBeenCalledWith(
      "\u0041\u0049 \u5927\u7eb2\u6a21\u578b\u4fdd\u5b58\u5931\u8d25\uff0c\u672c\u6b21\u9009\u62e9\u4ecd\u53ef\u7ee7\u7eed\u4f7f\u7528\u3002",
      expect.objectContaining({ dedupeKey: "outline-model-save-failed" }),
    )
  })

  it("falls back when the persisted outline model or provider is unavailable", async () => {
    const toastSpy = vi.spyOn(toast, "info").mockImplementation(() => {})
    useWikiStore.setState({
      aiChatModel: "openai/gpt-4o",
      aiOutlineModel: "removed/missing-model",
      providerConfigs: {
        openai: {
          apiKey: "test-key",
          enabled: true,
          savedModels: [{ id: "gpt-4o", model: "gpt-4o", name: "GPT-4o", createdAt: 1 }],
        },
      },
    })
    setOutlineConversations([{ ...conversation(), modelId: "removed/old-model" }], "outline-active")

    const container = await renderOutlineChatPanel()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(container.textContent).toContain("GPT-4o")
    expect(useWikiStore.getState().aiOutlineModel).toBe("openai/gpt-4o")
    expect(useWikiStore.getState().aiChatModel).toBe("openai/gpt-4o")
    expect(outlineModelPreferenceMocks.saveAiOutlineModel).toHaveBeenCalledWith("openai/gpt-4o")
    expect(toastSpy).toHaveBeenCalledWith(
      "\u539f \u0041\u0049 \u5927\u7eb2\u6a21\u578b\u5df2\u4e0d\u53ef\u7528\uff0c\u5df2\u56de\u9000\u5230\u5f53\u524d\u9ed8\u8ba4\u6a21\u578b\u3002",
      expect.objectContaining({ dedupeKey: "outline-model-fallback" }),
    )
  })

  it("migrates a legacy plain model id to a stable key without an unavailable warning", async () => {
    const toastSpy = vi.spyOn(toast, "info").mockImplementation(() => {})
    useWikiStore.setState({
      aiChatModel: "openai/gpt-4o",
      aiOutlineModel: "gpt-4o",
      providerConfigs: {
        openai: {
          apiKey: "test-key",
          enabled: true,
          savedModels: [{ id: "gpt-4o", model: "gpt-4o", name: "GPT-4o", createdAt: 1 }],
        },
      },
    })
    setOutlineConversations([conversation()], "outline-active")

    const container = await renderOutlineChatPanel()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(container.textContent).toContain("GPT-4o")
    expect(useWikiStore.getState().aiOutlineModel).toBe("openai/gpt-4o")
    expect(outlineModelPreferenceMocks.saveAiOutlineModel).toHaveBeenCalledWith("openai/gpt-4o")
    expect(toastSpy).not.toHaveBeenCalledWith(
      "\u539f \u0041\u0049 \u5927\u7eb2\u6a21\u578b\u5df2\u4e0d\u53ef\u7528\uff0c\u5df2\u56de\u9000\u5230\u5f53\u524d\u9ed8\u8ba4\u6a21\u578b\u3002",
      expect.anything(),
    )
  })

  it("falls back when the selected outline provider is disabled", async () => {
    const toastSpy = vi.spyOn(toast, "info").mockImplementation(() => {})
    useWikiStore.setState({
      aiChatModel: "openai/gpt-4o",
      aiOutlineModel: "openai/gpt-4o",
      defaultLlmModel: "anthropic/claude-sonnet",
      novelConfig: { ...useWikiStore.getState().novelConfig, defaultLlmModel: "anthropic/claude-sonnet" },
      providerConfigs: {
        openai: {
          apiKey: "old-key",
          enabled: false,
          savedModels: [{ id: "gpt-4o", model: "gpt-4o", name: "GPT-4o", createdAt: 1 }],
        },
        anthropic: {
          apiKey: "test-key",
          enabled: true,
          savedModels: [{ id: "claude-sonnet", model: "claude-sonnet", name: "Claude Sonnet", createdAt: 2 }],
        },
      },
    })
    setOutlineConversations([{ ...conversation(), modelId: "openai/gpt-4o" }], "outline-active")

    const container = await renderOutlineChatPanel()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(container.textContent).toContain("Claude Sonnet")
    expect(useWikiStore.getState().aiOutlineModel).toBe("anthropic/claude-sonnet")
    expect(outlineModelPreferenceMocks.saveAiOutlineModel).toHaveBeenCalledWith("anthropic/claude-sonnet")
    expect(toastSpy).toHaveBeenCalledWith(
      "\u539f \u0041\u0049 \u5927\u7eb2\u6a21\u578b\u5df2\u4e0d\u53ef\u7528\uff0c\u5df2\u56de\u9000\u5230\u5f53\u524d\u9ed8\u8ba4\u6a21\u578b\u3002",
      expect.objectContaining({ dedupeKey: "outline-model-fallback" }),
    )
  })


  it("\u591a Agent \u5168\u90e8\u5931\u8d25\u540e\u6cbf\u7528\u540c\u4e00\u9700\u6c42\u5305\u3001\u6a21\u578b\u3001\u4f1a\u8bdd\u548c\u5f15\u7528\u56de\u9000\uff0c\u4e14\u4e0d\u963b\u65ad\u4fdd\u5b58\u4e0e\u4e0b\u4e00\u6b65", async () => {
    const reference = {
      id: "fallback-reference",
      category: "outline" as const,
      title: "\u65e2\u6709\u4e16\u754c\u89c2",
      displayTitle: "\u65e2\u6709\u4e16\u754c\u89c2",
      path: "\u5927\u7eb2/\u4e16\u754c\u89c2.md",
    }
    const inspirationText = "\u57fa\u4e8e\u73b0\u6709\u4e16\u754c\u89c2\u751f\u6210\u4e00\u4efd\u65b0\u7684\u6545\u4e8b\u603b\u7eb2"
    const fallbackText = [
      "# \u6545\u4e8b\u603b\u7eb2",
      "",
      "## \u6838\u5fc3\u8bbe\u5b9a",
      "\u6cbf\u7528\u65e2\u6709\u4e16\u754c\u89c2\u5b8c\u6210\u666e\u901a\u751f\u6210\u7ed3\u679c\u3002",
      "",
      "<!-- next_step -->",
      JSON.stringify({
        completedModule: "\u6545\u4e8b\u603b\u7eb2",
        completedScope: "\u6838\u5fc3\u8bbe\u5b9a",
        recommendations: [
          { id: "A", label: "\u7ee7\u7eed\u5b8c\u5584\u4eba\u7269\u5173\u7cfb", reason: "\u8865\u9f50\u4eba\u7269\u51b2\u7a81\u3002" },
          { id: "D", label: "\u81ea\u5b9a\u4e49", reason: "\u81ea\u884c\u8bf4\u660e\u4e0b\u4e00\u6b65\u3002" },
        ],
      }),
      "<!-- /next_step -->",
    ].join("\n")
    const fallbackCalls: Array<{ modelId: AgentConfig["modelId"]; messages: AgentMessage[] }> = []
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (config, _registry, messages, callbacks) => {
      const system = agentMessageContentText(
        messages.find((message) => message.role === "system")?.content ?? "",
      )
      if (system.includes("\u53ea\u8d1f\u8d23\u89c4\u5212\u5927\u7eb2\u5b50 Agent \u4efb\u52a1\u56fe")) {
        return { toolCalls: [], roundsUsed: 1, finalText: "{}" }
      }
      if (system.includes("\u5b50 Agent \u8fd0\u884c\u89c4\u5219")) {
        throw new Error("\u4e0a\u6e38 Agent \u670d\u52a1\u4e0d\u53ef\u7528")
      }
      fallbackCalls.push({ modelId: config.modelId, messages })
      callbacks.onText(fallbackText)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: fallbackText }
    })
    setOutlineConversations([{ ...conversation(), modelId: "openai/gpt-4o" }], "outline-active", {
      pendingReferenceTokens: [reference],
    })
    const container = await renderOutlineChatPanel()
    await openOutlineWizard(container)

    // 该期望于 26f80ee（全新界面统一、旧版界面移除）随之变更：旧版向导的
    // #outline-wizard-inspiration / 「确定生成」分支被删除，只留新版向导的
    // aria-label="故事灵感/处理要求" 与「提交需求」按钮。
    const inspiration = document.querySelector<HTMLTextAreaElement>('[aria-label="故事灵感/处理要求"]')
    expect(inspiration).not.toBeNull()
    await act(async () => {
      if (!inspiration) return
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(inspiration, inspirationText)
      inspiration.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const submit = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("提交需求"))
    expect(submit).toBeDefined()
    await act(async () => {
      submit?.click()
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const run = useOutlineChatStore.getState().runStates["outline-active"]
        if (fallbackCalls.length > 0 && run?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    const state = useOutlineChatStore.getState()
    const current = state.conversations.find((item) => item.id === "outline-active")
    const userMessages = current?.messages.filter((message) => message.role === "user") ?? []
    const assistant = current?.messages.findLast((message) => message.role === "assistant")
    expect(fallbackCalls).toHaveLength(1)
    expect(fallbackCalls[0].modelId).toBe("openai/gpt-4o")
    expect(fallbackCalls[0].messages.some((message) => message.role === "user" && agentMessageContentText(message.content).includes(inspirationText))).toBe(true)
    expect(fallbackCalls[0].messages.some((message) => message.role === "user" && agentMessageContentText(message.content).includes("\u65e2\u6709\u4e16\u754c\u89c2"))).toBe(true)
    expect(state.activeConversationId).toBe("outline-active")
    expect(current?.modelId).toBe("openai/gpt-4o")
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0].attachedReferences).toEqual([reference])
    expect(userMessages[0].novelGenerationRequest?.modelContent).toContain(inspirationText)
    expect(assistant?.multiAgentRun?.mode).toBe("single-agent-fallback")
    expect(assistant?.content).toContain("\u6cbf\u7528\u65e2\u6709\u4e16\u754c\u89c2\u5b8c\u6210\u666e\u901a\u751f\u6210\u7ed3\u679c\u3002")
    expect(container.textContent).toContain("\u591a Agent \u751f\u6210\u5931\u8d25\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u4e3a\u666e\u901a\u751f\u6210\u3002")
    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.getAttribute("aria-label") === "保存为大纲")
    const nextButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("\u7ee7\u7eed\u5b8c\u5584\u4eba\u7269\u5173\u7cfb"))
    expect(saveButton?.disabled).toBe(false)
    expect(nextButton?.disabled).toBe(false)
  })
  it("\u81f3\u5c11\u4e00\u4e2a\u5b50 Agent \u6210\u529f\u4f46\u5408\u5e76\u629b\u9519\u65f6\uff0c\u56de\u9000\u4fdd\u7559 merge error \u72b6\u6001\u4e0e\u539f\u56e0", async () => {
    const fallbackText = "# \u56de\u9000\u5927\u7eb2\n\n## \u7ed3\u679c\n\u5408\u5e76\u5931\u8d25\u540e\u7684\u666e\u901a\u751f\u6210\u7ed3\u679c\u3002"
    let subAgentCallCount = 0
    let fallbackCallCount = 0
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      const system = agentMessageContentText(
        messages.find((message) => message.role === "system")?.content ?? "",
      )
      if (system.includes("\u53ea\u8d1f\u8d23\u89c4\u5212\u5927\u7eb2\u5b50 Agent \u4efb\u52a1\u56fe")) {
        return { toolCalls: [], roundsUsed: 1, finalText: "{}" }
      }
      if (system.includes("\u5b50 Agent \u8fd0\u884c\u89c4\u5219")) {
        subAgentCallCount += 1
        if (subAgentCallCount === 1) {
          return {
            toolCalls: [],
            roundsUsed: 1,
            finalText: JSON.stringify({
              agent_id: "outline-agent",
              agent_name: "\u5927\u7eb2 Agent",
              stage: "outline",
              used_skills: ["outline-master-builder"],
              confidence: 0.8,
              summary: "\u5b50 Agent \u5df2\u6210\u529f",
              content_markdown: "## \u5b50 Agent \u7ed3\u679c",
              constraints: [],
              writeback_items: [],
              risks: [],
              questions: [],
            }),
          }
        }
        throw new Error("\u5176\u4ed6\u5b50 Agent \u5931\u8d25")
      }
      if (system.includes("\u5408\u5e76 Agent \u8fd0\u884c\u89c4\u5219")) {
        throw new Error("\u5408\u5e76\u670d\u52a1\u5931\u8d25\nMERGE_FLOW_SECRET_BODY")
      }
      fallbackCallCount += 1
      callbacks.onText(fallbackText)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: fallbackText }
    })
    setOutlineConversations([{ ...conversation(), modelId: "openai/gpt-4o" }], "outline-active")
    const container = await renderOutlineChatPanel()
    await openOutlineWizard(container)
    const inspiration = document.querySelector<HTMLTextAreaElement>('[aria-label="故事灵感/处理要求"]')
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      if (inspiration) setValue?.call(inspiration, "\u89e6\u53d1\u5408\u5e76\u5931\u8d25\u56de\u9000")
      inspiration?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const submit = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("提交需求"))
    await act(async () => {
      submit?.click()
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const run = useOutlineChatStore.getState().runStates["outline-active"]
        if (fallbackCallCount > 0 && run?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    const current = useOutlineChatStore.getState().conversations.find((item) => item.id === "outline-active")
    const assistant = current?.messages.findLast((message) => message.role === "assistant")
    expect(subAgentCallCount).toBeGreaterThan(1)
    expect(fallbackCallCount).toBe(1)
    expect(assistant?.multiAgentRun?.mode).toBe("single-agent-fallback")
    expect(assistant?.multiAgentRun?.merge?.status).toBe("error")
    expect(assistant?.multiAgentRun?.merge?.error).toContain("\u5408\u5e76\u670d\u52a1\u5931\u8d25")
    expect(assistant?.multiAgentRun?.agents.some((agent) => agent.status === "done")).toBe(true)
    expect(current?.messages.filter((message) => message.role === "user")).toHaveLength(1)
    const detailsButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("\u67e5\u770b\u8be6\u60c5"))
    await act(async () => detailsButton?.click())
    expect(container.textContent).toContain("\u5408\u5e76\u670d\u52a1\u5931\u8d25")
    expect(container.textContent).not.toContain("MERGE_FLOW_SECRET_BODY")
  })

  it("regeneration finalizes whole-document Markdown fences for a structured original request", async () => {
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      const text = "```markdown\n# \u4eba\u7269\u8bbe\u5b9a\n\n## \u4e3b\u89d2\n\u6210\u957f\u5f27\u5149\n```"
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation([
      { id: "u1", role: "user", content: "\u751f\u6210\u4eba\u7269\u8bbe\u5b9a", novelGenerationRequest: { version: 1, summary: "\u751f\u6210\u4eba\u7269\u8bbe\u5b9a", details: [], modelContent: "\u8bf7\u751f\u6210\u4eba\u7269\u8bbe\u5b9a" } },
      { id: "a1", role: "assistant", content: "# \u65e7\u7ed3\u679c\n\n## \u4e3b\u89d2\n\u65e7\u5185\u5bb9" },
    ])], "outline-active")
    const container = await renderOutlineChatPanel()
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label") === "重新生成")
    await act(async () => { button?.click(); for (let i = 0; i < 100 && useOutlineChatStore.getState().runStates["outline-active"]?.status === "running"; i += 1) await new Promise((resolve) => setTimeout(resolve, 5)) })
    const answer = useOutlineChatStore.getState().conversations[0].messages.at(-1)?.content ?? ""
    expect(answer).toContain("# \u4eba\u7269\u8bbe\u5b9a")
    expect(answer).not.toContain("```markdown")
  })

  it("重新生成完整结果仅含 Gemini 思考摘要时关闭 reasoning 重试一次", async () => {
    useWikiStore.setState({
      llmConfig: {
        ...useWikiStore.getState().llmConfig,
        reasoning: { mode: "high" },
      },
    })
    const regenerated = "# 第27章 地下乱战\n\n## 核心事件\n沈渊截断敌方增援。"
    const runSpy = vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      const text = runSpy.mock.calls.length === 1 ? GEMINI_OUTLINE_THOUGHT_DUMP : regenerated
      callbacks.onText(text)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation([
      { id: "u-retry", role: "user", content: "生成第27章章纲" },
      { id: "a-retry", role: "assistant", content: "# 旧章纲", intentPhase: "generation" },
    ])], "outline-active")
    const container = await renderOutlineChatPanel()
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((item) => item.getAttribute("aria-label") === "重新生成")

    await act(async () => {
      button?.click()
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (runSpy.mock.calls.length === 2 && useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    expect(runSpy).toHaveBeenCalledTimes(2)
    expect(runSpy.mock.calls[1]?.[0].requestOverrides?.reasoning).toEqual({ mode: "off" })
    const answer = useOutlineChatStore.getState().conversations[0].messages.at(-1)?.content ?? ""
    expect(answer).toContain("沈渊截断敌方增援")
    expect(answer).not.toContain("Analyzing the Conflict's Dynamics")
  })

  it("生成阶段重新生成若再次返回意图标记则报错并阻止循环", async () => {
    const protocolText = `<!-- intent_clarity -->\n{"clarity":"clear","module":"章节细纲","analysis":"重复分析","detectedScope":"第236章","missingItems":[],"options":[],"question":""}\n<!-- /intent_clarity -->`
    const runSpy = vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      callbacks.onText(protocolText)
      callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: protocolText }
    })
    setOutlineConversations([conversation([
      { id: "u-generation", role: "user", content: "直接生成第236章章纲" },
      { id: "a-generation", role: "assistant", content: "# 旧章纲", intentPhase: "generation" },
    ])], "outline-active")
    const container = await renderOutlineChatPanel()
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((item) => item.getAttribute("aria-label") === "重新生成")
    await act(async () => {
      button?.click()
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (useOutlineChatStore.getState().runStates["outline-active"]?.status !== "running") break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })

    expect(runSpy).toHaveBeenCalledTimes(1)
    const assistant = useOutlineChatStore.getState().conversations[0].messages.at(-1)
    expect(assistant?.intentProtocolError).toContain("已阻止重复意图分析和自动循环")
    expect(container.textContent).toContain("已阻止重复意图分析和自动循环")
    expect(container.textContent).not.toContain("继续生成")
  })

  it.each(["\u751f\u6210\u4eba\u7269\u8bbe\u5b9a", "\u751f\u6210\u4e16\u754c\u89c2", "\u7ee7\u7eed\u5b8c\u5584\u4eba\u7269\u5173\u7cfb", "\u7ee7\u7eed\u8865\u5145\u4e16\u754c\u89c2", "\u7ec6\u5316\u5f53\u524d\u5927\u7eb2", "\u7ee7\u7eed\u5b8c\u5584\u5f53\u524d\u6a21\u5757"])("structured next step triggers Markdown finalization: %s", async (label) => {
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      const text = "```markdown\n# \u8bbe\u5b9a\n\n## \u7ed3\u679c\n\u5185\u5bb9\n```"
      callbacks.onText(text); callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    setOutlineConversations([conversation([{ id: "u0", role: "user", content: "\u751f\u6210\u5927\u7eb2", novelGenerationRequest: { version: 1, summary: "\u751f\u6210\u5927\u7eb2", details: [], modelContent: "\u751f\u6210\u5927\u7eb2" } }, { id: "a1", role: "assistant", content: "# \u5927\u7eb2\n\n## \u7ed3\u679c\n\u5df2\u5b8c\u6210", nextStepRecommendation: { completedModule: "\u5927\u7eb2", completedScope: "\u5f53\u524d\u5927\u7eb2", recommendations: [{ id: "A", label, reason: "\u7ee7\u7eed" }] } }])], "outline-active")
    const container = await renderOutlineChatPanel()
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes(label))
    await act(async () => { button?.click(); for (let i = 0; i < 100 && useOutlineChatStore.getState().runStates["outline-active"]?.status === "running"; i += 1) await new Promise((resolve) => setTimeout(resolve, 5)) })
    expect(useOutlineChatStore.getState().conversations[0].messages.at(-1)?.content).not.toContain("```markdown")
  })

  it("ordinary Q&A next step does not trigger AI Markdown finalization", async () => {
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, _messages, callbacks) => {
      const text = "```markdown\n# \u666e\u901a\u56de\u7b54\n\n## \u8bf4\u660e\n\u5185\u5bb9\n```"
      callbacks.onText(text); callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: text }
    })
    const label = "\u89e3\u91ca\u4e00\u4e0b\u8fd9\u4e2a\u8bbe\u5b9a"
    setOutlineConversations([conversation([{ id: "a1", role: "assistant", content: "\u5df2\u56de\u7b54", nextStepRecommendation: { completedModule: "\u4eba\u7269\u8bbe\u5b9a", completedScope: "\u4e3b\u89d2", recommendations: [{ id: "A", label, reason: "\u8bf4\u660e" }] } }])], "outline-active")
    const container = await renderOutlineChatPanel()
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes(label))
    await act(async () => { button?.click(); for (let i = 0; i < 100 && useOutlineChatStore.getState().runStates["outline-active"]?.status === "running"; i += 1) await new Promise((resolve) => setTimeout(resolve, 5)) })
    expect(useOutlineChatStore.getState().conversations[0].messages.at(-1)?.content).toContain("```markdown")
  })

  it("structured next step forwards references to Agent and clears them after successful send", async () => {
    const reference = { id: "next-ref", category: "outline" as const, title: "\u4eba\u7269\u8bbe\u5b9a", displayTitle: "\u4eba\u7269\u8bbe\u5b9a", path: "\u5927\u7eb2/\u4eba\u7269.md" }
    let sentMessages: AgentMessage[] = []
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (_config, _registry, messages, callbacks) => {
      sentMessages = messages
      callbacks.onText("# \u4eba\u7269\u5173\u7cfb\n\n## \u7ed3\u679c\n\u5b8c\u6210"); callbacks.onDone()
      return { toolCalls: [], roundsUsed: 1, finalText: "# \u4eba\u7269\u5173\u7cfb\n\n## \u7ed3\u679c\n\u5b8c\u6210" }
    })
    const label = "\u7ee7\u7eed\u5b8c\u5584\u4eba\u7269\u5173\u7cfb"
    setOutlineConversations([conversation([{ id: "u0", role: "user", content: "\u751f\u6210\u5927\u7eb2", novelGenerationRequest: { version: 1, summary: "\u751f\u6210\u5927\u7eb2", details: [], modelContent: "\u751f\u6210\u5927\u7eb2" } }, { id: "a1", role: "assistant", content: "# \u5927\u7eb2\n\n## \u7ed3\u679c\n\u5b8c\u6210", nextStepRecommendation: { completedModule: "\u5927\u7eb2", completedScope: "", recommendations: [{ id: "A", label, reason: "\u7ee7\u7eed" }] } }])], "outline-active", { pendingReferenceTokens: [reference] })
    const container = await renderOutlineChatPanel()
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes(label))
    await act(async () => { button?.click(); for (let i = 0; i < 100 && useOutlineChatStore.getState().runStates["outline-active"]?.status === "running"; i += 1) await new Promise((resolve) => setTimeout(resolve, 5)) })
    expect(sentMessages.some((message) => message.role === "user" && agentMessageContentText(message.content).includes("\u4eba\u7269\u8bbe\u5b9a"))).toBe(true)
    expect(container.querySelector("[aria-label=\"\u79fb\u9664\u5f15\u7528\u0020\u4eba\u7269\u8bbe\u5b9a\"]")).toBeNull()
  })

  it("structured next step keeps references when send fails", async () => {
    const reference = { id: "failed-ref", category: "outline" as const, title: "\u4e16\u754c\u89c2", displayTitle: "\u4e16\u754c\u89c2", path: "\u5927\u7eb2/\u4e16\u754c\u89c2.md" }
    vi.spyOn(AgentRunner.prototype, "run").mockRejectedValue(new Error("network failed"))
    const label = "\u7ee7\u7eed\u8865\u5145\u4e16\u754c\u89c2"
    setOutlineConversations([conversation([{ id: "u0", role: "user", content: "\u751f\u6210\u5927\u7eb2", novelGenerationRequest: { version: 1, summary: "\u751f\u6210\u5927\u7eb2", details: [], modelContent: "\u751f\u6210\u5927\u7eb2" } }, { id: "a1", role: "assistant", content: "# \u5927\u7eb2\n\n## \u7ed3\u679c\n\u5b8c\u6210", nextStepRecommendation: { completedModule: "\u5927\u7eb2", completedScope: "", recommendations: [{ id: "A", label, reason: "\u7ee7\u7eed" }] } }])], "outline-active", { pendingReferenceTokens: [reference] })
    const container = await renderOutlineChatPanel()
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes(label))
    await act(async () => { button?.click(); await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(container.querySelector("[aria-label=\"\u79fb\u9664\u5f15\u7528\u0020\u4e16\u754c\u89c2\"]")).not.toBeNull()
  })

})

describe("需求分析浮层不被无关操作弄丢", () => {
  /** 直接造一条「需要用户定范围」的助手消息，不经模型，避免依赖输入框先挂载。 */
  function needsInputMessage(): OutlineChatMessage {
    return {
      id: "a-needs-input",
      role: "assistant",
      content: "已读取总纲，范围不足。",
      intentClarityResult: {
        clarity: "needs_input",
        module: "卷纲",
        analysis: "已读取总纲，范围不足。",
        detectedScope: "",
        missingItems: ["未明确要生成哪一卷的折叠树卷纲"],
        options: [{ id: "A", label: "第二卷归墟寄魂", description: "已有设定" }],
        question: "请选择本次要生成哪一卷的折叠树卷纲",
      },
    }
  }

  function intentDialog(container: HTMLElement) {
    return container.querySelector('[data-testid="outline-intent-dialog"]')
  }

  /**
   * 条件轮询：整套测试并行、CPU 紧张时，面板可能要先跑完一段异步副作用才把浮层提交出来。
   * 每次轮询都单独走一次 act 再退出，让 React 有机会提交；若把整个循环塞进一个 act，
   * 提交会被推迟到 act 退出之后，轮询永远看不到浮层（曾在整套运行里假失败）。
   */
  async function waitFor<T>(probe: () => T | null | undefined, label: string): Promise<T> {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const found = probe()
      if (found) return found
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
    const found = probe()
    if (found) return found
    throw new Error(`等待超时：${label}`)
  }

  /** 渲染面板并等到需求分析浮层出现。 */
  async function renderPanelWithNeedsInput() {
    setOutlineConversations([conversation([needsInputMessage()])], "outline-active")
    const container = await renderOutlineChatPanel()
    await waitFor(() => intentDialog(container), "需求分析浮层")
    return container
  }

  /** 模拟切换到其他功能：卸载当前面板（store 是模块级单例，状态照旧保留）。 */
  async function unmountLatestPanel() {
    const mounted = mountedRoots.pop()
    if (!mounted) return
    await act(async () => {
      mounted.root.unmount()
    })
    mounted.container.remove()
  }

  it("拖动窗口不再关掉浮层（回归：点外部曾把它永久关掉）", async () => {
    const container = await renderPanelWithNeedsInput()

    const dragRegion = document.createElement("header")
    dragRegion.setAttribute("data-tauri-drag-region", "deep")
    document.body.appendChild(dragRegion)
    // 用同步 act 包住派发：修复后这里不该产生 React 更新，
    // 一旦回归成旧的「点外部就关闭」，下面的断言立刻失败。
    act(() => {
      dragRegion.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    })
    dragRegion.remove()

    expect(intentDialog(container)).not.toBeNull()
  })

  it("点其他功能不再关掉浮层", async () => {
    const container = await renderPanelWithNeedsInput()

    const otherFeature = document.createElement("button")
    otherFeature.textContent = "其他功能"
    document.body.appendChild(otherFeature)
    act(() => {
      otherFeature.dispatchEvent(new Event("pointerdown", { bubbles: true }))
      otherFeature.dispatchEvent(new Event("click", { bubbles: true }))
    })
    otherFeature.remove()

    expect(intentDialog(container)).not.toBeNull()
  })

  it("没关闭时，切到其他功能再回来浮层依然存在", async () => {
    const first = await renderPanelWithNeedsInput()
    expect(intentDialog(first)).not.toBeNull()

    await unmountLatestPanel()
    const second = await renderOutlineChatPanel()

    await waitFor(() => intentDialog(second), "重挂后的需求分析浮层")
    expect(second.textContent).toContain("请选择本次要生成哪一卷的折叠树卷纲")
  })

  it("显式关闭后，切到其他功能再回来也不重复弹出", async () => {
    const first = await renderPanelWithNeedsInput()
    await act(async () => {
      first.querySelector<HTMLButtonElement>('button[aria-label="关闭需求分析"]')?.click()
    })
    expect(intentDialog(first)).toBeNull()

    await unmountLatestPanel()
    const second = await renderOutlineChatPanel()
    // 先确认面板确实重新渲染了内容，再断言浮层没有跟着回来
    // （避免把「还没渲染」误判成「没弹出」）。
    await waitFor(
      () => (second.textContent?.includes("已读取总纲") ? true : null),
      "重挂后的会话内容",
    )
    expect(intentDialog(second)).toBeNull()
  })
})
