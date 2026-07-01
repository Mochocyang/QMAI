import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "chat-panel.tsx"), "utf8")

describe("chat-panel de-AI skill handling", () => {
  it("loads the chat de-AI skill safely and surfaces a warning without aborting send", () => {
    expect(source).toContain("loadEffectiveDeAiSkillSafely")
    expect(source).toContain("deAiSkillWarning")
    expect(source).toContain("deAiSkillWarningMessage")
    expect(source).toContain("setDeAiSkillWarningMessage(deAiSkillWarning)")
    expect(source).not.toContain("setChapterSaveStatus(deAiSkillWarning)")
  })

  it("uses an icon-only de-AI skill trigger in the chat input toolbar", () => {
    expect(source).toContain("<DeAiSkillPicker")
    expect(source).toContain("iconOnly")
  })

  it("uses an icon-only accent new conversation button", () => {
    expect(source).toContain("qmai-new-conversation-button")
    expect(source).toContain('aria-label={t(novelMode ? "novel.chat.newChat" : "chat.newChat")}')
    expect(source).not.toContain('          {t(novelMode ? "novel.chat.newChat" : "chat.newChat")}')
  })
})

describe("chat-panel agent reference integration", () => {
  it("replaces the legacy chat input with the reference input and picker", () => {
    expect(source).toContain("<ReferenceInput")
    expect(source).toContain("<ReferencePickerDialog")
    expect(source).toContain("insertTokensRef")
    expect(source).not.toContain("<ChatInput")
    expect(source).not.toContain('from "./chat-input"')
  })

  it("routes sends through AgentRunner and stores reference/tool metadata", () => {
    expect(source).toContain("useAgentConfig")
    expect(source).toContain("new AgentRunner()")
    expect(source).toContain("attachedReferences")
    expect(source).toContain("isAgentRunning")
    expect(source).toContain("agentToolCalls")
    expect(source).toContain("当前模型不支持Agent功能，请更换模型")
  })

  it("scopes reference input drafts to the active conversation", () => {
    expect(source).toContain("setConversationInputDraft")
    expect(source).toContain("getReferenceTokensForConversation")
    expect(source).toContain("setReferenceTokensForConversation")
    expect(source).not.toContain('const [referenceText, setReferenceText] = useState("")')
    expect(source).not.toContain("const [currentTokens, setCurrentTokens] = useState<ReferenceToken[]>([])")
  })

  it("stores successful Agent read tool calls as assistant message references", () => {
    expect(source).toContain("agentToolCallsToMessageReferences")
    expect(source).toContain("references:")
  })

  it("keeps model and stop controls in the reference input footer", () => {
    expect(source).toContain("rightControls={")
    expect(source).toContain("<ChatModelSelector")
    expect(source).toContain("isStreaming={isStreaming}")
    expect(source).toContain("onStop={handleStop}")
  })

  it("consumes externally queued reference tokens into the active chat draft", () => {
    expect(source).toContain("pendingReferenceTokens")
    expect(source).toContain("consumePendingReferenceTokens")
    expect(source).toContain("setReferenceTokensForConversation(drafts, targetConversationId")
  })

  it("keeps chapter-generation replies limited to chapter body", () => {
    expect(source).toContain("章节生成、续写或改写任务的最终回复必须只包含章节正文")
    expect(source).toContain("不要输出读取说明、执行总结、完成目标表格、章节结构、后续建议")
  })

  it("shows the sent chat message before asynchronous chapter context building", () => {
    const appendIndex = source.indexOf("const { assistantMessage } = appendAgentChatMessages")
    const resolveIndex = source.indexOf("await resolveTargetChapterNumberForChat")
    const contextIndex = source.indexOf("await buildContextPack")

    expect(appendIndex).toBeGreaterThan(-1)
    expect(resolveIndex).toBeGreaterThan(-1)
    expect(contextIndex).toBeGreaterThan(-1)
    expect(appendIndex).toBeLessThan(resolveIndex)
    expect(appendIndex).toBeLessThan(contextIndex)
  })
})
