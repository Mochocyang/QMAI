import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ContextTracePanel } from "./context-trace-panel"
import type { ContextTrace } from "@/lib/agent/context-trace"

describe("ContextTracePanel selected skills", () => {
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
            kind: ["structure", "planning"],
            stages: ["planning", "drafting"],
            modes: ["standard", "strict"],
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
