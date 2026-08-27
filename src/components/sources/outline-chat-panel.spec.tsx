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
  filterOutlineGeneratedContent,
  OutlineChatPanel,
} from "./outline-chat-panel"
import {
  useOutlineChatStore,
  type OutlineChatConversation,
  type OutlineChatMessage,
} from "../../stores/outline-chat-store"
import type { AgentMessage } from "@/lib/agent/types"
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
        cacheHits: 3, reloaded: 2, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
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

    expect(container.textContent).toContain("上下文中控")
    expect(container.textContent).toContain("本次命中 3 项")
    expect(container.textContent).toContain("命中率 60%")
    expect(container.textContent).toContain("节省约 1,320 Token")
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
        { id: "old-assistant", role: "assistant", content: "已有回答", nextStepRecommendation: { recommendations: [
          { id: recId, label, reason: "推荐理由" },
          { id: "other", label: "另一个建议", reason: "其他理由" },
        ] } },
      ]), modelId: "gpt-4o", contextSummary: "当前会话摘要",
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
    const nextStep = { recommendations: [{ id: "next", label: "Continue A", reason: "next" }] }
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
    const recommendationMessage = { id: "assistant-next", role: "assistant" as const, content: "已有回答", nextStepRecommendation: { recommendations: [{ id: "A", label: "继续完善", reason: "推荐" }] } }
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
    setOutlineConversations([conversation([{ id: "assistant-next", role: "assistant", content: "已有回答", nextStepRecommendation: { recommendations: [{ id: "A", label: "继续完善", reason: "推荐" }] } }])], "outline-active", { pendingReferenceTokens: [reference] })
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

  it("标准菜单生成补 forceRefresh，收尾把工具过程留在对话里", () => {
    expect(source).toContain("intentPhase: \"intent_analysis\"")
    expect(source).toContain("forceRefresh: true")
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
    expect(source).toContain("msg.multiAgentRun ? null")
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

  it("renders outline generation from an icon button and keeps the menu backed by existing configs", () => {
    expect(source).toContain("ListPlus")
    expect(source).toContain('aria-label="生成大纲模块"')
    expect(source).toContain("qmai-outline-generation-menu")
    expect(source).toContain('className="qmai-outline-generation-menu fixed')
    expect(source).toContain("OUTLINE_SECTION_GENERATION_CONFIGS.map")
    expect(source).toContain("onGenerate(config.title, config.requestHint)")
    expect(source).toContain("onGenerate={handleGenerateSection}")
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
    const runSpy = vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (config, _registry, _messages, callbacks) => {
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
    expect(container.textContent).toContain("请确认章节范围")
    expect(container.textContent).toContain("生成最近章节")
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
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("保存为大纲"))).toBe(false)
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
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("保存为大纲"))).toBe(false)
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

  it("快速模式系统提示去掉工作流强制段，仍保留保存协议和 Markdown 约束", () => {
    const prompt = buildOutlineAgentSystemPrompt({ projectName: "测试项目", mode: "fast" })

    expect(prompt).not.toContain("## AI大纲生成工作流")
    expect(prompt).not.toContain("## 意图清晰度分析阶段")
    expect(prompt).not.toContain("## AI大纲固定分析流程")
    expect(prompt).toContain("outlineSaveRequest")
    expect(prompt).toContain("Markdown 格式约束：结构化资料使用一级标题")
    expect(prompt).toContain("像普通对话一样直接出结果")
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
  })

  it("快速模式源码跳过意图分析和多 Agent，人物小传不再降级为 analysis 预算", () => {
    expect(source).toContain('outlineWorkflowMode === "fast"')
    expect(source).toContain("enableMultiAgent = Boolean(options.enableMultiAgent) && outlineMode !== \"fast\"")
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
    expect(source).toMatch(/if \(intentProtocol\.kind === "none" && !intentProtocolError && !deliverableTruncated\)/)
    expect(source).toContain("handleAutoSaveOutlineRequests(capturedConvId, finalContent, isCurrentRun)")
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
    expect(container.textContent).toContain("再交给 AI 分析和追问")

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
    expect(container.textContent).toContain("直接生成大纲正文")
    expect(container.textContent).not.toContain("再交给 AI 分析和追问")
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
      .find((button) => button.textContent?.includes("保存为大纲"))

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
    const trigger = container.querySelector<HTMLButtonElement>(".h-8.w-32") ?? undefined
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
    const fallbackCalls: Array<{ modelId: string; messages: Array<{ role: string; content: string }> }> = []
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
    const wizardTrigger = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("\u9009\u62e9\u751f\u6210\u4f60\u60f3\u8981\u7684\u5c0f\u8bf4"))
    expect(wizardTrigger).toBeDefined()

    await act(async () => wizardTrigger?.click())
    const inspiration = document.querySelector<HTMLTextAreaElement>("#outline-wizard-inspiration")
    expect(inspiration).not.toBeNull()
    await act(async () => {
      if (!inspiration) return
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setValue?.call(inspiration, inspirationText)
      inspiration.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const submit = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("\u786e\u5b9a\u751f\u6210"))
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
    expect(fallbackCalls[0].messages.some((message) => message.role === "user" && message.content.includes(inspirationText))).toBe(true)
    expect(fallbackCalls[0].messages.some((message) => message.role === "user" && message.content.includes("\u65e2\u6709\u4e16\u754c\u89c2"))).toBe(true)
    expect(state.activeConversationId).toBe("outline-active")
    expect(current?.modelId).toBe("openai/gpt-4o")
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0].attachedReferences).toEqual([reference])
    expect(userMessages[0].novelGenerationRequest?.modelContent).toContain(inspirationText)
    expect(assistant?.multiAgentRun?.mode).toBe("single-agent-fallback")
    expect(assistant?.content).toContain("\u6cbf\u7528\u65e2\u6709\u4e16\u754c\u89c2\u5b8c\u6210\u666e\u901a\u751f\u6210\u7ed3\u679c\u3002")
    expect(container.textContent).toContain("\u591a Agent \u751f\u6210\u5931\u8d25\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u4e3a\u666e\u901a\u751f\u6210\u3002")
    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("\u4fdd\u5b58\u4e3a\u5927\u7eb2"))
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
    const wizardTrigger = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("\u9009\u62e9\u751f\u6210\u4f60\u60f3\u8981\u7684\u5c0f\u8bf4"))
    await act(async () => wizardTrigger?.click())
    const inspiration = document.querySelector<HTMLTextAreaElement>("#outline-wizard-inspiration")
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      if (inspiration) setValue?.call(inspiration, "\u89e6\u53d1\u5408\u5e76\u5931\u8d25\u56de\u9000")
      inspiration?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const submit = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("\u786e\u5b9a\u751f\u6210"))
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
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes("\u91cd\u65b0\u751f\u6210"))
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
    const runSpy = vi.spyOn(AgentRunner.prototype, "run").mockImplementation(async (config, _registry, _messages, callbacks) => {
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
      .find((item) => item.textContent?.includes("重新生成"))

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
      .find((item) => item.textContent?.includes("重新生成"))
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
    setOutlineConversations([conversation([{ id: "u0", role: "user", content: "\u751f\u6210\u5927\u7eb2", novelGenerationRequest: { version: 1, summary: "\u751f\u6210\u5927\u7eb2", details: [], modelContent: "\u751f\u6210\u5927\u7eb2" } }, { id: "a1", role: "assistant", content: "# \u5927\u7eb2\n\n## \u7ed3\u679c\n\u5df2\u5b8c\u6210", nextStepRecommendation: { recommendations: [{ id: "A", label, reason: "\u7ee7\u7eed" }] } }])], "outline-active")
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
    setOutlineConversations([conversation([{ id: "a1", role: "assistant", content: "\u5df2\u56de\u7b54", nextStepRecommendation: { recommendations: [{ id: "A", label, reason: "\u8bf4\u660e" }] } }])], "outline-active")
    const container = await renderOutlineChatPanel()
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes(label))
    await act(async () => { button?.click(); for (let i = 0; i < 100 && useOutlineChatStore.getState().runStates["outline-active"]?.status === "running"; i += 1) await new Promise((resolve) => setTimeout(resolve, 5)) })
    expect(useOutlineChatStore.getState().conversations[0].messages.at(-1)?.content).toContain("```markdown")
  })

  it("structured next step forwards references to Agent and clears them after successful send", async () => {
    const reference = { id: "next-ref", category: "outline" as const, title: "\u4eba\u7269\u8bbe\u5b9a", displayTitle: "\u4eba\u7269\u8bbe\u5b9a", path: "\u5927\u7eb2/\u4eba\u7269.md" }
    let sentMessages: Array<{ role: string; content: string }> = []
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
    expect(sentMessages.some((message) => message.role === "user" && message.content.includes("\u4eba\u7269\u8bbe\u5b9a"))).toBe(true)
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
