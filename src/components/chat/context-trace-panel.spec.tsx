import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ContextTracePanel } from "./context-trace-panel"
import type { ContextTrace } from "@/lib/agent/context-trace"
import type { ContextHubSnapshotRef } from "@/lib/context-hub/types"

describe("ContextTracePanel selected skills", () => {
  it("renders provider, model, finish reason, all tool calls and fallback status", () => {
    const trace: ContextTrace = {
      id: "trace-required-workflow",
      startedAt: 1,
      finishedAt: 5,
      status: "error",
      toolCalls: [],
      contextInfo: {
        intent: "write_chapter",
        confidence: 1,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        requiredToolDiagnostics: {
          requiredTools: ["run_chapter_workflow"],
          satisfiedTools: [],
          missingTools: ["run_chapter_workflow"],
          fallbackAttempted: true,
          fallbackTool: "run_chapter_workflow",
          fallbackStatus: "error",
          fallbackError: "正文为空",
          provider: "custom",
          model: "deepseek-chat",
          reasoningMode: "enabled",
          roundsUsed: 2,
          finishReasons: ["tool_calls", "stop"],
          observedToolCalls: [
            { round: 1, index: 0, name: "read_outline" },
            { round: 1, index: 1, name: "run_chapter_workflow" },
          ],
        },
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("必调工作流诊断")
    expect(html).toContain("deepseek-chat")
    expect(html).toContain("tool_calls、stop")
    expect(html).toContain("工具调用（2）")
    expect(html).toContain("read_outline")
    expect(html).toContain("run_chapter_workflow")
    expect(html).toContain("正文为空")
  })

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
          cacheHits: 4, reloaded: 1, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
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
    expect(html).toContain("本轮数据源：命中 4，重载 1，无数据 0，fallback 0，失败 0")
    expect(html).toContain("稳定核心 1,200 Token")
    expect(html).toContain("会话摘要 180 Token")
    expect(html).toContain("动态片段 420 Token")
    expect(html).toContain("上下文压缩预计减少 1,400 Token（44%）")
    expect(html).toContain("已发送本地稳定核心，是否命中以供应商返回为准")
    expect(html).toContain("供应商前缀：不可判断")
    expect(html).toContain("实际用量不可用")
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
          cacheHits: 0, reloaded: 2, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
          stableTokens: 900,
          summaryTokens: 0,
          dynamicTokens: 300,
          candidateTokens: 1800,
          estimatedSavedTokens: 600,
          estimatedSavedPercent: 33,
          expanded: true,
          providerCacheEnabled: true,
          providerUsageReported: true,
          providerInputTokens: 1536,
          providerCachedTokens: 768,
          providerCacheWriteTokens: 256,
        },
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("低置信度扩展：已启用")
    expect(html).toContain("供应商已确认命中 768 Token（输入占比 50%）")
    expect(html).toContain("供应商新写入缓存 256 Token")
  })

  it("labels Codex thread totals and does not show the outer round as a request count", () => {
    const trace: ContextTrace = {
      id: "trace-codex-thread-total",
      startedAt: 1,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "write_chapter",
        confidence: 1,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        contextHub: {
          cacheHits: 1, reloaded: 0, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
          stableTokens: 100,
          summaryTokens: 0,
          dynamicTokens: 20,
          candidateTokens: 120,
          estimatedSavedTokens: 0,
          estimatedSavedPercent: 0,
          expanded: false,
          providerCacheEnabled: true,
          providerUsageReported: true,
          providerInputTokens: 125_732,
          providerCachedTokens: 120_576,
          requestDiagnostics: {
            requestCount: 0,
            requestCountAvailable: false,
            usageScope: "provider_thread",
            providerUsageAvailable: true,
            inputTokens: 3_676_375,
            outputTokens: 7_926,
            cacheReadTokens: 3_533_312,
            cacheWriteTokens: 0,
          },
        },
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("Codex 线程累计实际用量：内部请求数不可判断")
    expect(html).toContain("输入 3,676,375")
    expect(html).not.toContain("请求 1")
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
        cacheHits: 2, reloaded: 1, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
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
    expect(html).toContain("本轮数据源：命中 2，重载 1，无数据 0，fallback 0，失败 0")
  })

  it("renders sanitized per-request prefix, timing and cache diagnostics", () => {
    const trace: ContextTrace = {
      id: "trace-request-cache",
      startedAt: 1,
      status: "done",
      toolCalls: [],
      contextInfo: {
        intent: "write_chapter",
        confidence: 1,
        routeSource: "default",
        loadedSources: [],
        blockedSources: [],
        retrievalHits: [],
        trimmedSections: [],
        contextHub: {
          cacheHits: 1, reloaded: 0, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
          stableTokens: 100,
          summaryTokens: 20,
          dynamicTokens: 30,
          candidateTokens: 200,
          estimatedSavedTokens: 50,
          estimatedSavedPercent: 25,
          expanded: false,
          providerCacheEnabled: true,
          requestDiagnostics: {
            requestCount: 2,
            providerUsageAvailable: true,
            requests: [
              {
                provider: "openai",
                model: "gpt-test",
                apiMode: "chat_completions",
                prefixFingerprint: "abcdef0123456789",
                startedAt: 1_000,
                finishedAt: 1_400,
                durationMs: 400,
                firstResponseMs: 120,
                cacheReadTokens: 0,
                cacheWriteTokens: 500,
                status: "success",
              },
              {
                provider: "openai",
                model: "gpt-test",
                apiMode: "chat_completions",
                prefixFingerprint: "abcdef0123456789",
                startedAt: 2_000,
                finishedAt: 2_300,
                durationMs: 300,
                firstResponseMs: 80,
                startGapMs: 1_000,
                idleGapMs: 600,
                cacheReadTokens: 500,
                cacheWriteTokens: 0,
                status: "success",
              },
            ],
            omittedRequestCount: 4,
          },
        },
      },
    }

    const html = renderToStaticMarkup(<ContextTracePanel trace={trace} />)

    expect(html).toContain("供应商前缀：未变化")
    expect(html).toContain("请求缓存与间隔（2，另省略 4）")
    expect(html).toContain("开始间隔")
    expect(html).toContain("TTFT")
    expect(html).toContain("abcdef0123")
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
