import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { EMPTY_CONVERSATION_CREATE_REASON } from "../../lib/conversation-create-guard"

const panelSource = readFileSync(resolve(__dirname, "outline-chat-panel.tsx"), "utf8")
const storeSource = readFileSync(resolve(__dirname, "../../stores/outline-chat-store.ts"), "utf8")

describe("OutlineChatPanel 多会话运行状态", () => {
  it("当前大纲会话未发送用户消息时禁止新建并暴露中文原因", () => {
    expect(panelSource).toContain("canCreateNewConversation")
    expect(panelSource).toContain("EMPTY_CONVERSATION_CREATE_REASON")
    expect(panelSource).toContain(
      'activeConv?.messages.some((message) => message.role === "user")',
    )
    expect(panelSource).toContain("disabled={!canCreateConversation}")
    expect(EMPTY_CONVERSATION_CREATE_REASON).toBe(
      "请先发送当前会话内容，再新建对话。",
    )
    expect(panelSource).toContain('className="inline-flex shrink-0"')
    expect(panelSource).toContain(
      "title={!canCreateConversation ? EMPTY_CONVERSATION_CREATE_REASON : undefined}",
    )
    expect(panelSource).toContain("aria-describedby={!canCreateConversation")
    expect(panelSource).toContain(
      '<span id="outline-new-conversation-disabled-reason" className="sr-only">',
    )
    expect(
      panelSource.match(/outline-new-conversation-disabled-reason/g)?.length,
    ).toBe(2)
  })

  it("按当前会话读取流式内容和运行状态，不再依赖全局兼容字段", () => {
    expect(panelSource).toContain("streamingContents")
    expect(panelSource).toContain("runStates")
    expect(panelSource).toContain('activeRunState?.status === "running"')
    expect(panelSource).not.toMatch(/\(s\) => s\.streamingContent[);]/)
    expect(panelSource).not.toMatch(/\(s\) => s\.isStreaming[);]/)
    expect(panelSource).not.toContain("setIsStreaming")
    expect(storeSource).not.toMatch(/^\s*streamingContent:/m)
    expect(storeSource).not.toMatch(/^\s*isStreaming:/m)
    expect(storeSource).not.toMatch(/^\s*setIsStreaming:/m)
  })

  it("为每次任务固定会话和 runId，并由共享 registry 独立停止", () => {
    expect(panelSource).toContain("outlineConversationRunRegistry")
    expect(panelSource).toContain("const capturedConvId =")
    expect(panelSource).toContain("const runId = crypto.randomUUID()")
    expect(panelSource).toContain("startConversationRun(capturedConvId, runId)")
    expect(panelSource).toContain("outlineConversationRunRegistry.register(capturedConvId, controller)")
    expect(panelSource).toMatch(/finishConversationRun\(\s*capturedConvId/)
    expect(panelSource).toContain("failConversationRun(capturedConvId")
    expect(panelSource).toContain("stopConversationRun(activeConversationId, runningState.runId)")
    expect(panelSource).toContain("outlineConversationRunRegistry.abort(activeConversationId)")
  })

  it("三任务满额只禁发送/生成，输入与模型选择仍可编辑", () => {
    expect(panelSource).toContain("canStartConversationRun")
    expect(panelSource).toContain("submitDisabled={submitDisabled}")
    expect(panelSource).toContain("submitDisabledReason={submitDisabledReason}")
    expect(panelSource).toContain("大纲 AI 会话最多同时运行 3 个任务，请等待任一任务结束后再发送。")
    expect(panelSource).toContain("<OutlineGenerationMenu")
    expect(panelSource).toContain("disabled={submitDisabled}")
    expect(panelSource).toContain("<ChatModelSelector")
    expect(panelSource).toContain("disabled={false}")
  })

  it("顶标签和历史均展示共享状态图标，运行会话删除前确认", () => {
    expect(panelSource).toContain("ConversationRunStatusIcon")
    expect(panelSource.match(/<ConversationRunStatusIcon/g)?.length).toBeGreaterThanOrEqual(2)
    expect(panelSource).toContain("ConversationDeleteConfirmDialog")
    expect(panelSource).toContain("pendingDeleteConversationId")
  })

  it("自动保存错误使用右下角持久 Toast 且标题栏不再渲染 saveStatus", () => {
    expect(panelSource).toContain("toast.error(message, {")
    expect(panelSource).toContain('title: "自动保存失败"')
    expect(panelSource).toContain("persistent: true")
    expect(panelSource).toContain("dedupeKey: `outline-auto-save:${message}`")
    expect(panelSource).not.toContain("{saveStatus &&")
  })
})
