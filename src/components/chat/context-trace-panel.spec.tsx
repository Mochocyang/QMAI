import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ContextTracePanel } from "./context-trace-panel"
import type { ContextTrace } from "@/lib/agent/context-trace"
import type { ContextHubSnapshotRef } from "@/lib/context-hub/types"

describe("ContextTracePanel selected skills", () => {
  it("renders local cache and token composition without claiming a provider hit", () => {
    const trace: ContextTrace = {
      id: "trace-context-hub",
      startedAt: 1,
      finishedAt: 5,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "write_chapter",
        confidence: 0.9,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        contextHub: {
          hits: 4,
          refreshed: 1,
          failures: 0,
          stableTokens: 1200,
          summaryTokens: 180,
          dynamicTokens: 420,
          candidateTokens: 3200,
          estimatedSavedTokens: 1400,
          estimatedSavedPercent: 44,
          expanded: false,
          providerCacheEnabled: true,
        },
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("上下文中控")
    expect(html).not.toContain("4ms")
    expect(html).toContain("本地缓存：命中 4，刷新 1，失败 0")
    expect(html).toContain("稳定核心 1,200 Token")
    expect(html).toContain("会话摘要 180 Token")
    expect(html).toContain("动态片段 420 Token")
    expect(html).toContain("项目资料预计节省 1,400 Token（44%）")
    expect(html).toContain("已启用稳定前缀缓存")
    expect(html).not.toContain("供应商已确认命中")
  })

  it("only reports a confirmed provider hit when cached token usage exists", () => {
    const trace: ContextTrace = {
      id: "trace-provider-cache-hit",
      startedAt: 1,
      finishedAt: 5,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "generate_outline",
        confidence: 0.9,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        contextHub: {
          hits: 0,
          refreshed: 2,
          failures: 0,
          stableTokens: 900,
          summaryTokens: 0,
          dynamicTokens: 300,
          candidateTokens: 1800,
          estimatedSavedTokens: 600,
          estimatedSavedPercent: 33,
          expanded: true,
          providerCacheEnabled: true,
          providerCachedTokens: 768,
        },
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("低置信度扩展：已启用")
    expect(html).toContain("供应商已确认命中 768 Token")
  })

  it("uses the shared cache viewer when a persisted snapshot reference exists", () => {
    const trace: ContextTrace = {
      id: "trace-snapshot",
      startedAt: 1,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "generate_outline",
        confidence: 0.9,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
      },
    }
    const contextHubSnapshot: ContextHubSnapshotRef = {
      id: "assistant:1",
      surface: "ai-chat",
      createdAt: 10,
      stats: {
        hits: 2,
        refreshed: 1,
        failures: 0,
        stableTokens: 100,
        summaryTokens: 20,
        dynamicTokens: 30,
        candidateTokens: 300,
        estimatedSavedTokens: 150,
        estimatedSavedPercent: 50,
        expanded: false,
        providerCacheEnabled: true,
      },
    }

    const html = renderToStaticMarkup(
      <ContextTracePanel trace={trace} contextHubSnapshot={contextHubSnapshot} />,
    )

    expect(html).toContain("展开上下文中控")
    expect(html).toContain("本地缓存：命中 2，刷新 1，失败 0")
  })

  it("renders web search trace entries in the overview", () => {
    const trace: ContextTrace = {
      id: "trace-web",
      startedAt: 1,
      finishedAt: 5,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "general_chat",
        confidence: 0.9,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        webSearches: [
          {
            query: "黄蓉",
            provider: "tavily",
            status: "ok",
            resultCount: 2,
            sources: ["example.com", "wiki.example"],
            searchedAt: 100,
          },
        ],
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("外部搜索")
    expect(html).toContain("黄蓉")
    expect(html).toContain("2 条结果")
    expect(html).toContain("example.com")
  })

  it("renders selected skill names and metadata in the overview", () => {
    const trace: ContextTrace = {
      id: "trace-1",
      startedAt: 1,
      finishedAt: 5,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "write_chapter",
        confidence: 0.9,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        selectedSkills: [
          {
            id: "three-four",
            name: "三翻四抖",
            description: "",
            kind: ["structure", "planning"],
            stages: ["planning", "drafting"],
            modes: ["standard", "strict"],
            content: "",
            source: "project",
          },
        ],
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("使用 Skill")
    expect(html).toContain("三翻四抖")
    expect(html).toContain("structure")
    expect(html).toContain("planning")
    expect(html).not.toContain("三次转折")
  })
  it("renders selected capability names and permissions in the overview", () => {
    const trace: ContextTrace = {
      id: "trace-capability",
      startedAt: 1,
      finishedAt: 5,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "write_chapter",
        confidence: 0.9,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        selectedCapabilities: [
          {
            id: "tool:read_chapter",
            name: "Read Chapter",
            kind: "built_in_tool",
            permission: "auto",
            source: "built-in",
            reason: "required reading tool",
          },
          {
            id: "tool:write_chapter",
            name: "Write Chapter",
            kind: "built_in_tool",
            permission: "confirm",
            source: "built-in",
            reason: "write action requires confirmation",
          },
        ],
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("启用能力")
    expect(html).toContain("Read Chapter")
    expect(html).toContain("built_in_tool")
    expect(html).toContain("auto")
    expect(html).toContain("Write Chapter")
    expect(html).toContain("confirm")
  })

  it("renders MCP call summaries in the overview", () => {
    const trace: ContextTrace = {
      id: "trace-mcp",
      startedAt: 1,
      finishedAt: 5,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "character_query",
        confidence: 0.9,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        mcpCalls: [
          {
            serverId: "graph",
            serverName: "Graph MCP",
            toolName: "query",
            status: "error",
            summary: "not available",
            message: "MCP 调用失败，普通 AI 会话可以继续。",
            calledAt: 100,
          },
        ],
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("MCP 调用")
    expect(html).toContain("Graph MCP")
    expect(html).toContain("query")
    expect(html).toContain("error")
    expect(html).toContain("普通 AI 会话可以继续")
  })

  it("renders AI mode label when postWriteCheckMeta source is ai", () => {
    const trace: ContextTrace = {
      id: "trace-ai-mode",
      startedAt: 1,
      finishedAt: 5,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "write_chapter",
        confidence: 0.9,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        postWriteCheck: {
          items: [
            { name: "人物一致性", passed: true, detail: "通过" },
          ],
          passedCount: 1,
          totalCount: 1,
          allPassed: true,
        },
        postWriteCheckMeta: {
          source: "ai",
        },
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("写后自检")
    expect(html).toContain("AI 推理")
    expect(html).not.toContain("规则检查")
  })

  it("renders rule mode label and fallback reason when postWriteCheckMeta source is rule", () => {
    const trace: ContextTrace = {
      id: "trace-rule-mode",
      startedAt: 1,
      finishedAt: 5,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "write_chapter",
        confidence: 0.9,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        postWriteCheck: {
          items: [
            { name: "字数检查", passed: true, detail: "通过" },
          ],
          passedCount: 1,
          totalCount: 1,
          allPassed: true,
        },
        postWriteCheckMeta: {
          source: "rule",
          fallbackReason: "AI 检查接口不可用，降级为规则检查",
        },
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("写后自检")
    expect(html).toContain("规则检查")
    expect(html).toContain("AI 检查接口不可用，降级为规则检查")
    expect(html).not.toContain("AI 推理")
  })

  it("renders evidence and suggestion for postWriteCheck items in AI mode", () => {
    const trace: ContextTrace = {
      id: "trace-evidence",
      startedAt: 1,
      finishedAt: 5,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "write_chapter",
        confidence: 0.9,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        postWriteCheck: {
          items: [
            {
              name: "人物一致性",
              passed: false,
              detail: "主角性格前后不一致",
              evidence: "前文主角性格沉稳，此处表现冲动",
              suggestion: "调整主角在该场景的反应，保持性格一致",
            },
          ],
          passedCount: 0,
          totalCount: 1,
          allPassed: false,
        },
        postWriteCheckMeta: {
          source: "ai",
        },
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("人物一致性")
    expect(html).toContain("前文主角性格沉稳，此处表现冲动")
    expect(html).toContain("调整主角在该场景的反应，保持性格一致")
  })
})
