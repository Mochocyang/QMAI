import type { AgentToolEvent } from "./types"
import type { ContextTrace, TraceMcpCall } from "./context-trace"

function createFallbackContextInfo(mcpCalls: TraceMcpCall[]): NonNullable<ContextTrace["contextInfo"]> {
  return {
    intent: "general_chat" as any,
    confidence: 1,
    routeSource: "default",
    loadedSources: [],
    blockedSources: [],
    webSearches: [],
    mcpCalls,
    retrievalHits: [],
    trimmedSections: [],
  }
}

export function appendMcpCallTrace(trace: ContextTrace, event: AgentToolEvent): ContextTrace {
  const mcpCall = extractMcpCallTrace(event)
  if (!mcpCall) return trace

  const contextInfo = trace.contextInfo ?? createFallbackContextInfo([])
  return {
    ...trace,
    contextInfo: {
      ...contextInfo,
      mcpCalls: [...(contextInfo.mcpCalls ?? []), mcpCall],
    },
  }
}

function extractMcpCallTrace(event: AgentToolEvent): TraceMcpCall | null {
  if (!event.name.startsWith("mcp_")) return null
  if (event.type !== "result" && event.type !== "error") return null

  const fallback = fallbackMcpCall(event)
  if (!event.result) return fallback

  try {
    const parsed = JSON.parse(event.result) as {
      status?: "ok" | "error"
      serverId?: string
      serverName?: string
      toolName?: string
      summary?: string
      message?: string
    }
    return {
      serverId: parsed.serverId || fallback.serverId,
      serverName: parsed.serverName || fallback.serverName,
      toolName: parsed.toolName || fallback.toolName,
      status: event.type === "error" ? "error" : parsed.status || "error",
      summary: parsed.summary,
      message: parsed.message,
      calledAt: event.timestamp,
    }
  } catch {
    return fallback
  }
}

function fallbackMcpCall(event: AgentToolEvent): TraceMcpCall {
  const [, serverId = "unknown", ...toolParts] = event.name.split("_")
  return {
    serverId,
    serverName: serverId,
    toolName: toolParts.join("_") || event.name,
    status: "error",
    message: event.result || "MCP 调用失败，普通 AI 会话可以继续。",
    calledAt: event.timestamp,
  }
}


export type { TraceMcpCall }
