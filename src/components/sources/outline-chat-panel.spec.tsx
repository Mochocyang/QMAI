// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const outlineModelPreferenceMocks = vi.hoisted(() => ({
  saveAiOutlineModel: vi.fn(async (_modelId: string) => {}),
}))

vi.mock("@/lib/project-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-store")>()),
  saveAiOutlineModel: outlineModelPreferenceMocks.saveAiOutlineModel,
}))

import { outlineConversationRunRegistry } from "@/lib/conversation-run-registry"
import { AgentRunner } from "@/lib/agent/runner"
import { toast } from "@/lib/toast"
import { useWikiStore } from "@/stores/wiki-store"
import { buildOutlineAgentSystemPrompt, OutlineChatPanel } from "./outline-chat-panel"
import {
  useOutlineChatStore,
  type OutlineChatConversation,
  type OutlineChatMessage,
} from "../../stores/outline-chat-store"
import type { AgentMessage } from "@/lib/agent/types"
import type { ContextHubSnapshotRef } from "@/lib/context-hub/types"

const source = readFileSync(resolve(__dirname, "outline-chat-panel.tsx"), "utf8")
const outlineSectionConfigsSource = readFileSync(resolve(__dirname, "../../lib/novel/outline-section-configs.ts"), "utf8")

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
  })
  outlineModelPreferenceMocks.saveAiOutlineModel.mockReset()
  outlineModelPreferenceMocks.saveAiOutlineModel.mockResolvedValue(undefined)
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

describe("OutlineChatPanel controls", () => {

  it("在 AI 大纲回复下方独立显示上下文中控摘要", async () => {
    const contextHubSnapshot: ContextHubSnapshotRef = {
      id: "outline-assistant-1",
      surface: "ai-outline",
      createdAt: 10,
      stats: {
        hits: 3,
        refreshed: 2,
        failures: 0,
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
    expect(container.textContent).toContain("本轮缓存事件：命中 3，刷新 2，失败 0")
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

  it("停止大纲生成时保留部分内容并清理运行状态", async () => {
    const controller = new AbortController()
    outlineConversationRunRegistry.register("outline-active", controller)
    setOutlineConversations([conversation([{
      id: "assistant-running",
      role: "assistant",
      content: "",
      isAgentRunning: true,
    }])], "outline-active", {
      streamingContents: { "outline-active": "部分大纲" },
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
    expect(stoppedConversation?.messages).toEqual([expect.objectContaining({
      id: "assistant-running",
      role: "assistant",
      content: "部分大纲",
      isAgentRunning: false,
    })])
  })

  it("停止无部分内容的大纲生成时删除助手占位消息", async () => {
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
    expect(stoppedConversation?.messages).toEqual([])
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
    expect(source).toContain("onSubmit={handleSend}")
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

  it("uses an outline-only tool set that cannot write chapters or memory", () => {
    expect(source).toContain("OUTLINE_CHAT_DISABLED_TOOLS")
    expect(source).toContain('"write_chapter"')
    expect(source).toContain('"write_memory"')
    expect(source).toContain("disabledTools: OUTLINE_CHAT_DISABLED_TOOLS")
    expect(source).toContain("需要保存大纲时只能使用 write_outline_node")
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
    expect(source).toContain("dependencies: contextHubResult?.dependencies")
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

  it("routes every outline generation menu item through the PRD 3.1 content workflow", () => {
    expect(source).toContain("buildOutlineSectionGenerationPrompt")
    expect(source).toContain("## AI大纲生成工作流")
    expect(source).toContain("提取请求关键词")
    expect(source).toContain("识别用户意图")
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
    expect(source).toContain("enableMultiAgent: true")
    expect(source).toContain("多 Agent 并行生成")
    expect(source).toContain("自动回退为单 Agent")
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
    expect(source).toContain("classifyOutlineSaveTarget")
    expect(source).toContain("classification.targetFolder")
    expect(source).toContain("classification.fileName")
    expect(source).toContain("保存大纲文件")
    expect(source).toContain("summarizeChapterOutlineQuality")
    expect(source).toContain("formatChapterOutlineQualityReport")
    expect(source).toContain("includeWarnings: true")
  })

  it("auto-saves structured AI outline save requests from assistant output", () => {
    expect(source).toContain("parseOutlineSaveRequests")
    expect(source).toContain("formatOutlineSaveParseFeedback")
    expect(source).toContain("saveOutlineSaveRequests")
    expect(source).toContain("outlineSaveRequest")
    expect(source).toContain("已自动保存")
    expect(source).toContain("AI 大纲输出协议")
  })

  it("生成后对可保存大纲内容输出质量检查反馈并支持继续修订", () => {
    expect(source).toContain("buildOutlineGenerationQualityFeedback")
    expect(source).toContain("qualityFeedback")
    expect(source).toContain("生成后质量检查")
    expect(source).toContain("修订质量问题")
    expect(source).toContain("repairPrompt")
  })

  it("uses save confirm dialog for classified outline saves", () => {
    expect(source).toContain("AiChangeReview")
    expect(source).toContain("AiChangeReviewItem")
    expect(source).toContain("extractCharacterSaveDrafts")
    expect(source).toContain("classifyOutlineSaveTarget")
    expect(source).toContain("characterDraftsToSaveRequests")
    expect(source).toContain("splitConfirmRequiredSaveRequests")
    expect(source).toContain("reviewItems")
    expect(source).toContain("confirmed: true")
  })

  it("does not silently auto-save character requests without confirmation", () => {
    expect(source).toContain("confirmRequired")
    expect(source).toContain("请确认要保存的人物角色")
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
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    const option = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button !== trigger && button.textContent?.includes(label),
    ) as HTMLButtonElement | undefined
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
