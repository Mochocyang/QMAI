import { describe, expect, it } from "vitest"
import { buildInitialContextTraceInfo } from "./context-trace-builders"

describe("context trace builders", () => {
  it("initializes web search trace collection", () => {
    const info = buildInitialContextTraceInfo(
      {
        intent: "general_chat",
        confidence: 0.9,
        extractedParams: {},
      } as any,
    )

    expect(info.webSearches).toEqual([])
  })

  it("carries classification metadata from the pre-plugin result into initial trace context", () => {
    const info = buildInitialContextTraceInfo(
      {
        intent: "write_chapter",
        confidence: 0.91,
        extractedParams: {},
      } as any,
      {
        routeSource: "project_with_feature",
        blockedSources: ["revision", "graph"],
        classificationFallbackReason: "使用项目 classification.md",
        classificationVersion: {
          upToDate: false,
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          needsUpgrade: true,
        },
      } as any,
    )

    expect(info.routeSource).toBe("project_with_feature")
    expect(info.blockedSources).toEqual(["revision", "graph"])
    expect(info.fallbackReason).toBe("使用项目 classification.md")
    expect(info.classificationVersion).toEqual({
      upToDate: false,
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      needsUpgrade: true,
    })
  })

  it("carries workflow mode into initial trace context", () => {
    const info = buildInitialContextTraceInfo(
      {
        intent: "write_chapter",
        confidence: 0.91,
        extractedParams: {},
      } as any,
      null,
      { workflowMode: "strict" },
    )

    expect(info.workflowMode).toBe("strict")
  })

  it("carries selected skill metadata into initial trace context without skill content", () => {
    const info = buildInitialContextTraceInfo(
      {
        intent: "write_chapter",
        confidence: 0.91,
        extractedParams: {},
      } as any,
      {
        selectedSkills: [
          {
            id: "three-four",
            name: "三翻四抖",
            description: "结构技能",
            kind: ["structure", "planning"],
            stages: ["planning", "drafting"],
            modes: ["standard", "strict"],
            content: "三次转折，四次震惊。",
            source: "project",
          },
        ],
      } as any,
    )

    expect(info.selectedSkills).toEqual([
      {
        id: "three-four",
        name: "三翻四抖",
        kind: ["structure", "planning"],
        stages: ["planning", "drafting"],
        modes: ["standard", "strict"],
        source: "project",
      },
    ])
    expect(JSON.stringify(info.selectedSkills)).not.toContain("三次转折")
  })
  it("carries selected capability summaries into initial trace context without sensitive content", () => {
    const info = buildInitialContextTraceInfo(
      {
        intent: "write_chapter",
        confidence: 0.91,
        extractedParams: {},
      } as any,
      {
        selectedCapabilities: [
          {
            id: "skill:three-four",
            name: "Three Four Skill",
            kind: "user_skill",
            permission: "auto",
            source: "project",
            reason: "selected skill for writing",
            skillContent: "private skill content should not be traced",
          },
          {
            id: "tool:web_search",
            name: "External Search",
            kind: "web_search",
            permission: "auto",
            source: "built-in",
            reason: "user requested search",
            rawResult: "raw web page body should not be traced",
          },
        ],
      } as any,
    )

    expect(info.selectedCapabilities).toEqual([
      {
        id: "skill:three-four",
        name: "Three Four Skill",
        kind: "user_skill",
        permission: "auto",
        source: "project",
        reason: "selected skill for writing",
      },
      {
        id: "tool:web_search",
        name: "External Search",
        kind: "web_search",
        permission: "auto",
        source: "built-in",
        reason: "user requested search",
      },
    ])
    expect(JSON.stringify(info.selectedCapabilities)).not.toContain("private skill content")
    expect(JSON.stringify(info.selectedCapabilities)).not.toContain("raw web page body")
  })

  it("initializes MCP call trace collection", () => {
    const info = buildInitialContextTraceInfo(
      {
        intent: "character_query",
        confidence: 0.9,
        extractedParams: {},
      } as any,
    )

    expect(info.mcpCalls).toEqual([])
  })
})
