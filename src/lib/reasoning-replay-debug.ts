import type { ChatMessage } from "./llm-providers"
import { isTauri } from "./platform"

const TAG = "[reasoning-replay]"
const RECENT_LOG_KEY = "qmai.reasoningReplayLogs"
const MAX_RECENT_LOGS = 40

interface ReasoningMessageProbe {
  index: number
  role: string
  contentLen: number
  toolCallCount: number
  toolNames: string[]
  hasReasoningField: boolean
  reasoningLen: number
}

interface ReasoningReplayLogEntry {
  at: string
  stage: string
  details: Record<string, unknown>
}

const recentLogs: ReasoningReplayLogEntry[] = []

function persistRecentLogs(): void {
  try {
    if (typeof sessionStorage === "undefined") return
    sessionStorage.setItem(RECENT_LOG_KEY, JSON.stringify(recentLogs.slice(-MAX_RECENT_LOGS)))
  } catch {
    // ignore quota / private mode
  }
}

function pushRecentLog(entry: ReasoningReplayLogEntry): void {
  recentLogs.push(entry)
  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.splice(0, recentLogs.length - MAX_RECENT_LOGS)
  }
  persistRecentLogs()
}

function probeReasoningMessages(messages: ChatMessage[]): ReasoningMessageProbe[] {
  return messages.map((message, index) => ({
    index,
    role: message.role,
    contentLen: typeof message.content === "string"
      ? message.content.length
      : JSON.stringify(message.content).length,
    toolCallCount: message.tool_calls?.length ?? 0,
    toolNames: (message.tool_calls ?? []).map((call) => call.function.name),
    hasReasoningField: message.reasoning_content !== undefined,
    reasoningLen: message.reasoning_content?.length ?? 0,
  }))
}

function emitToTauriTerminal(line: string): void {
  if (!isTauri()) return
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("log_diagnostic", {
      message: line,
    }))
    .catch(() => {})
}

export function logReasoningReplay(
  stage: string,
  details: Record<string, unknown>,
): void {
  const entry: ReasoningReplayLogEntry = {
    at: new Date().toISOString(),
    stage,
    details,
  }
  pushRecentLog(entry)
  // WebView DevTools only — does NOT appear in `tauri dev` terminal.
  console.warn(TAG, stage, details)
  // Bridge to Rust eprintln so the iTerm/`tauri dev` terminal can see it.
  emitToTauriTerminal(`${TAG} ${stage} ${JSON.stringify(details)}`)
}

export function isReasoningContentRequiredError(errorDetail: string): boolean {
  return /reasoning_content/i.test(errorDetail)
    && /must be passed back/i.test(errorDetail)
}

/** Compact dump for diagnosing missing reasoning_content on tool-call assistants. */
export function summarizeReasoningReplayRisk(messages: ChatMessage[]): {
  assistantWithTools: number
  missingReasoningOnToolAssistants: number
  emptyReasoningOnToolAssistants: number
  probes: ReasoningMessageProbe[]
} {
  const probes = probeReasoningMessages(messages)
  const toolAssistants = probes.filter((probe) => probe.role === "assistant" && probe.toolCallCount > 0)
  return {
    assistantWithTools: toolAssistants.length,
    missingReasoningOnToolAssistants: toolAssistants.filter((probe) => !probe.hasReasoningField).length,
    emptyReasoningOnToolAssistants: toolAssistants.filter(
      (probe) => probe.hasReasoningField && probe.reasoningLen === 0,
    ).length,
    probes: toolAssistants,
  }
}

export function formatReasoningReplayRiskForError(
  summary: ReturnType<typeof summarizeReasoningReplayRisk>,
): string {
  const probeText = summary.probes
    .map((probe) => (
      `#${probe.index} tools=[${probe.toolNames.join(",") || "-"}] ` +
      `reasoning=${probe.hasReasoningField ? `${probe.reasoningLen}chars` : "MISSING"}`
    ))
    .join("; ")
  return (
    `[reasoning-replay] toolAssistants=${summary.assistantWithTools} ` +
    `missing=${summary.missingReasoningOnToolAssistants} ` +
    `empty=${summary.emptyReasoningOnToolAssistants}` +
    (probeText ? ` | ${probeText}` : "")
  )
}
