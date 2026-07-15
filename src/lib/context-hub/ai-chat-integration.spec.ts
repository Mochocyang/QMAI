import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "../../components/chat/chat-panel.tsx"), "utf8")

describe("AI chat context hub integration", () => {
  it("prepares one context hub result and reuses its context pack in pre-plugins", () => {
    expect(source).toContain("await contextHub.prepare({")
    expect(source).toContain("buildContextPack: async () => contextHubResult.contextPack")
    expect(source).toContain("contextPack = contextHubResult.contextPack")
  })

  it("uses cacheable system blocks and cache-aware read tools only for hub requests", () => {
    expect(source).toContain("buildContextHubSystemContent(")
    expect(source).toContain("prePluginResult?.finalSystemRulesPrompt?.trim()")
    expect(source).toContain("contextHubSoftwareRules")
    expect(source).toContain("readTextFile: contextHubResult.readFile")
    expect(source).toContain("setConversationContextSummary")
  })

  it("does not resend full chat history when the system context contains a summary", () => {
    expect(source).toContain("selectContextHistoryMessages(")
    expect(source).toContain("contextHubResult?.sessionSummary")
  })

  it("persists a snapshot reference on the target assistant message", () => {
    expect(source).toContain("await contextHub.saveSnapshot(assistantMessage.id, contextHubResult)")
    expect(source).toContain("contextHubSnapshot")
  })

  it("clears the stale session summary before regenerating a chat answer", () => {
    expect(source).toContain("const capturedConversationId = storeState.activeConversationId")
    expect(source).toMatch(
      /removeLastAssistantMessage\(\)[\s\S]{0,900}setConversationContextSummary\(capturedConversationId, undefined\)[\s\S]{0,300}handleSend\(/,
    )
  })
})
