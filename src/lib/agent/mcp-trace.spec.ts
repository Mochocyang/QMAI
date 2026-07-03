import { describe, expect, it } from "vitest"
import type { AgentToolEvent } from "./types"
import { createContextTrace } from "./context-trace"
import { appendMcpCallTrace } from "./mcp-trace"

describe("appendMcpCallTrace", () => {
  it("adds a safe MCP call summary from mcp tool results", () => {
    const event: AgentToolEvent = {
      type: "result",
      callId: "call-1",
      name: "mcp_graph_query",
      params: { query: "主角关系" },
      result: JSON.stringify({
        status: "ok",
        serverId: "graph",
        serverName: "Knowledge Graph",
        toolName: "query",
        content: "very long private external result",
        summary: "主角与反派当前是合作中的敌对关系",
        message: "调用成功",
      }),
      timestamp: 123,
    }

    const trace = appendMcpCallTrace(createContextTrace("trace-1"), event)

    expect(trace.contextInfo?.mcpCalls).toEqual([
      {
        serverId: "graph",
        serverName: "Knowledge Graph",
        toolName: "query",
        status: "ok",
        summary: "主角与反派当前是合作中的敌对关系",
        message: "调用成功",
        calledAt: 123,
      },
    ])
    expect(JSON.stringify(trace.contextInfo?.mcpCalls)).not.toContain("very long private external result")
  })

  it("ignores non-MCP tool events", () => {
    const event: AgentToolEvent = {
      type: "result",
      callId: "call-1",
      name: "web_search",
      params: { query: "黄蓉" },
      result: "{}",
      timestamp: 456,
    }

    const trace = createContextTrace("trace-1")

    expect(appendMcpCallTrace(trace, event)).toBe(trace)
  })
})
