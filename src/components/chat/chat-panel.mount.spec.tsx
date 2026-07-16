// @vitest-environment jsdom
import { act } from "react"
import { describe, expect, it, vi } from "vitest"
import { renderChatPanel } from "@/test/chat-panel-mount"
import { clearTaskBreakpoint, loadTaskBreakpoint } from "@/lib/agent/task-breakpoint"
import type { Conversation } from "@/stores/chat-store"
import { useChatStore } from "@/stores/chat-store"
import { chatConversationRunRegistry } from "@/lib/conversation-run-registry"
import { deleteFile } from "@/commands/fs"

const breakpoint = {
  taskId: "task_resume_1",
  taskGoal: "生成第19章",
  completedStages: ["agent_round_4"],
  currentStage: "agent_round_4",
  usedSkills: [],
  usedTools: ["run_chapter_workflow"],
  searches: [],
  mcpCalls: [],
  createdAt: 100,
  updatedAt: 200,
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
  })
}

function conversation(id: string, title: string, updatedAt: number, inputDraft = ""): Conversation {
  return { id, title, createdAt: updatedAt, updatedAt, deAiMode: false, inputDraft }
}

async function click(element: Element | null) {
  expect(element).not.toBeNull()
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

describe("ChatPanel mount 基础设施", () => {
  it("根据当前会话是否已发送用户消息控制新建对话按钮", async () => {
    const first = await renderChatPanel()
    expect((first.container.querySelector(".qmai-new-conversation-button") as HTMLButtonElement).disabled).toBe(false)
    await first.unmount()

    const empty = await renderChatPanel({ activeConversationId: "empty" })
    const emptyButton = empty.container.querySelector(".qmai-new-conversation-button") as HTMLButtonElement
    expect(emptyButton.disabled).toBe(true)
    expect(emptyButton.title).toBe("请先发送当前会话内容，再新建对话。")
    const reasonId = emptyButton.getAttribute("aria-describedby")
    expect(reasonId).toBeTruthy()
    expect(empty.container.querySelector(`#${reasonId}`)?.textContent).toBe(
      "请先发送当前会话内容，再新建对话。",
    )
    await empty.unmount()

    const draft = await renderChatPanel({
      activeConversationId: "draft",
      conversations: [conversation("draft", "草稿", 100, "仅填写未发送")],
    })
    expect((draft.container.querySelector(".qmai-new-conversation-button") as HTMLButtonElement).disabled).toBe(true)
    await draft.unmount()

    const sent = await renderChatPanel({
      activeConversationId: "sent",
      messages: [{ id: "user-1", role: "user", content: "已发送内容", timestamp: 1, conversationId: "sent" }],
    })
    expect((sent.container.querySelector(".qmai-new-conversation-button") as HTMLButtonElement).disabled).toBe(false)
    await sent.unmount()
  })

  it("基础渲染：chat-panel mount 成功并显示空会话入口", async () => {
    const view = await renderChatPanel()

    expect(view.container.textContent).toContain("novel.chat.startNewConversation")

    await view.unmount()
  })

  it("Agent skill 配置为空时仍可打开 ChatPanel", async () => {
    const view = await renderChatPanel({ agentSkillConfig: null })

    expect(view.container.textContent).toContain("novel.chat.startNewConversation")

    await view.unmount()
  })

  it("输入工具栏显示模式下拉按钮，不再显示深度模式按钮", async () => {
    const view = await renderChatPanel({ activeConversation: true })

    expect(view.container.textContent).toContain("标准")
    expect(view.container.querySelector('[aria-label="开启深度模式"]')).toBeNull()
    expect(view.container.querySelector('[aria-label="关闭深度模式"]')).toBeNull()

    await view.unmount()
  })

  it("输入工具栏单独显示计划开关，可与模式下拉按钮并列使用", async () => {
    const view = await renderChatPanel({ activeConversation: true })

    expect(view.container.textContent).toContain("标准")
    expect(view.container.textContent).toContain("计划")
    expect(view.container.querySelector('[aria-label="开启计划模式"]')).not.toBeNull()

    await view.unmount()
  })

  it("存在旧断点时不再自动弹出继续未完成任务对话框", async () => {
    const loadMock = vi.mocked(loadTaskBreakpoint)
    const clearMock = vi.mocked(clearTaskBreakpoint)
    loadMock.mockClear()
    clearMock.mockClear()

    const view = await renderChatPanel({ taskBreakpoint: breakpoint })
    await flushEffects()

    expect(loadMock).not.toHaveBeenCalled()
    expect(clearMock).not.toHaveBeenCalled()
    expect(view.container.textContent).not.toContain("继续未完成任务")
    expect(view.container.textContent).not.toContain("确认后将继续执行断点任务")
    expect(view.container.textContent).not.toContain("恢复提示词")

    await view.unmount()
  })

  it("在顶部会话标签显示逐会话运行状态", async () => {
    const view = await renderChatPanel({
      activeConversationId: "conv-active",
      conversations: [
        conversation("conv-active", "当前会话", 400),
        conversation("conv-running", "生成中会话", 300),
      ],
      runStates: {
        "conv-running": { status: "running", updatedAt: 500, runId: "run-running" },
      },
    })

    const statusIcon = view.container.querySelector('[aria-label="正在生成"]')
    expect(statusIcon).not.toBeNull()
    expect(statusIcon?.querySelector("svg")).not.toBeNull()
    expect(statusIcon?.hasAttribute("data-slot")).toBe(false)
    expect(view.container.textContent).not.toContain("正在生成")
    expect(document.body.querySelector('[data-slot="tooltip-content"]')).toBeNull()
    await view.unmount()
  })

  it("普通会话达到三任务并发上限时只禁止发送", async () => {
    const view = await renderChatPanel({
      activeConversationId: "conv-draft",
      conversations: [
        conversation("conv-a", "任务 A", 400),
        conversation("conv-b", "任务 B", 300),
        conversation("conv-c", "任务 C", 200),
        conversation("conv-draft", "草稿会话", 100, "仍可编辑的草稿"),
      ],
      runStates: {
        "conv-a": { status: "running", updatedAt: 500, runId: "run-a" },
        "conv-b": { status: "running", updatedAt: 501, runId: "run-b" },
        "conv-c": { status: "running", updatedAt: 502, runId: "run-c" },
      },
    })

    const input = view.container.querySelector('[aria-label="引用输入框"]') as HTMLTextAreaElement | null
    const send = view.container.querySelector('[aria-label="发送消息"]') as HTMLButtonElement | null
    expect(input?.disabled).toBe(false)
    expect(send?.disabled).toBe(true)
    expect(send?.title).toBe("普通 AI 会话最多同时运行 3 个任务，请等待任一任务结束后再发送。")
    await view.unmount()
  })

  it("停止当前会话不会中止其他正在运行的会话", async () => {
    const currentController = new AbortController()
    const backgroundController = new AbortController()
    chatConversationRunRegistry.register("conv-current", currentController)
    chatConversationRunRegistry.register("conv-background", backgroundController)
    const view = await renderChatPanel({
      activeConversationId: "conv-current",
      conversations: [
        conversation("conv-current", "当前任务", 200),
        conversation("conv-background", "后台任务", 100),
      ],
      runStates: {
        "conv-current": { status: "running", updatedAt: 300, runId: "run-current" },
        "conv-background": { status: "running", updatedAt: 301, runId: "run-background" },
      },
    })
    await act(async () => {
      useChatStore.setState({
        streamingContents: { "conv-current": "部分内容", "conv-background": "后台内容" },
        messages: [{
          id: "assistant-running",
          role: "assistant",
          content: "部分内容",
          timestamp: 300,
          conversationId: "conv-current",
          isAgentRunning: true,
        }],
      })
    })

    await click(view.container.querySelector('[aria-label="停止生成"]'))

    expect(currentController.signal.aborted).toBe(true)
    expect(backgroundController.signal.aborted).toBe(false)
    expect(useChatStore.getState().runStates["conv-current"]?.status).toBe("idle")
    expect(useChatStore.getState().runStates["conv-background"]?.status).toBe("running")
    const currentMessages = useChatStore.getState().messages.filter((message) => message.conversationId === "conv-current")
    expect(currentMessages).toHaveLength(1)
    expect(currentMessages[0]).toMatchObject({ isAgentRunning: false })
    expect(currentMessages[0].content).toContain("已停止生成。")
    expect(currentMessages[0].content).not.toContain("出错")
    chatConversationRunRegistry.abort("conv-background")
    await view.unmount()
  })

  it("删除运行中会话时先显示中文确认，取消后不删除", async () => {
    const view = await renderChatPanel({
      activeConversationId: "conv-running",
      conversations: [conversation("conv-running", "运行中会话", 100)],
      runStates: {
        "conv-running": { status: "running", updatedAt: 200, runId: "run-delete" },
      },
    })
    const chip = view.container.querySelector('button[title="运行中会话"]')
    await act(async () => {
      chip?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    })
    await click(view.container.querySelector('[aria-label="删除会话"]'))
    expect(document.body.textContent).toContain("停止并删除会话？")
    await click(Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent === "取消") ?? null)
    expect(useChatStore.getState().conversations.some((item) => item.id === "conv-running")).toBe(true)
    await view.unmount()
  })

  it("一键清理只删除历史会话并保留顶部当前会话", async () => {
    const deleteFileMock = vi.mocked(deleteFile)
    deleteFileMock.mockClear()
    const view = await renderChatPanel({
      activeConversationId: "conv-current",
      conversations: [
        conversation("conv-current", "当前会话", Date.now()),
        conversation("conv-history-a", "历史会话 A", 100),
        conversation("conv-history-b", "历史会话 B", 200),
      ],
      messages: [
        { id: "current", role: "user", content: "保留", timestamp: 300, conversationId: "conv-current" },
        { id: "history-a", role: "user", content: "删除 A", timestamp: 100, conversationId: "conv-history-a" },
        { id: "history-b", role: "assistant", content: "删除 B", timestamp: 200, conversationId: "conv-history-b" },
      ],
    })

    await click(view.container.querySelector('[aria-label="novel.chat.conversationHistory"]'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await click(document.body.querySelector('[aria-label="chat.clearHistory"]'))
    expect(document.body.textContent).toContain("chat.clearHistoryTitle")
    await click(Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent === "chat.clearHistoryConfirm") ?? null)

    const state = useChatStore.getState()
    expect(state.conversations.map((item) => item.id)).toEqual(["conv-current"])
    expect(state.messages.map((item) => item.id)).toEqual(["current"])
    expect(deleteFileMock).toHaveBeenCalledWith("C:/QMAI_C/QMAI-main/.qmai/chats/conv-history-a.json")
    expect(deleteFileMock).toHaveBeenCalledWith("C:/QMAI_C/QMAI-main/.qmai/chats/conv-history-b.json")
    await view.unmount()
  })

  it.todo("PrePlugin 链触发：发送消息后 pipeline 执行")
  it.todo("Stage C 对话框：standard 模式 chapter_plan 触发对话框")
  it.todo("Stage C 跳过：fast 模式直接生成正文")
  it.todo("Stage D 自检：章节写完后 PostWriteCheck 写入 trace")
  it.todo("Stage D 降级：无模型时降级到规则检查")
  it.todo("断点保存：失败时记录调试信息但不自动弹窗")
})
