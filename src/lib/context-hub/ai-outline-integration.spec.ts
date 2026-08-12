import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "../../components/sources/outline-chat-panel.tsx"), "utf8")

describe("AI outline context hub integration", () => {
  it("prepares one shared context result in the main send flow", () => {
    expect(source).toContain("await contextHub.prepare({")
    expect(source).toContain('surface: "ai-outline"')
    expect(source).toContain("forceRefresh,")
  })

  it("shares cacheable system content and cached reads with sub-agents", () => {
    expect(source).toContain("buildOutlineRunSystemContent")
    expect(source).toContain("readTextFile: contextHubResult.readFile")
    expect(source).toContain("buildSessionContextSummary({")
    expect(source).toContain("contextSummary?.text")
  })

  it("avoids stale or duplicated summaries in refresh and regeneration flows", () => {
    expect(source).toContain("existingSummary: forceRefresh ? undefined : targetConversation?.contextSummary")
    expect(source).toContain("summaryInSystem: true")
    expect(source).toMatch(/task: lastUserRequest,[\s\S]{0,240}existingSummary: undefined,/)
  })

  it("persists snapshots for main send, resume, and regeneration", () => {
    expect(source.match(/\.saveSnapshot\(/g)).toHaveLength(3)
    expect(source.match(/persistContextHubProviderUsage\(/g)).toHaveLength(3)
    expect(source).toContain("addLlmUsage(")
    expect(source).toContain("contextHubSnapshot")
    expect(source).toContain("<ContextHubDetails")
    expect(source).not.toContain("formatContextHubStatsForDetails")
    expect(source).toContain("contextHub.saveSnapshot(`${messageId}:${runId}`, contextHubResult)")
  })

  it("passes the shared workflow budget and model window to Context Hub", () => {
    expect(source).toContain("tokenBudget: outlineRequestBudget.contextTokenBudget,")
    expect(source).toContain("tokenBudget: resumeRequestBudget.contextTokenBudget,")
    expect(source).toContain("tokenBudget: regenerationRequestBudget.contextTokenBudget,")
    expect(source).toContain("maxContextSize: effectiveLlmConfig.maxContextSize,")
    expect(source).toContain("max_tokens: requestBudget.outputTokens")
    expect(source).not.toContain("max_tokens: Math.max(")
  })
})
