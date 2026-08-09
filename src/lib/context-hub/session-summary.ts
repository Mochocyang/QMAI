import type { SessionContextSummary } from "./types"

export interface SessionSummaryMessage {
  role: string
  content: unknown
}

export interface BuildSessionContextSummaryInput {
  messages: SessionSummaryMessage[]
  dependencyFingerprint: string
  maxChars?: number
}

export function selectContextHistoryMessages<T extends SessionSummaryMessage>(
  messages: readonly T[],
  summary: string | undefined,
): T[] {
  return summary?.trim() ? messages.slice(-2) : [...messages]
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return ""
      const value = block as { type?: string; text?: unknown }
      return value.type === "text" && typeof value.text === "string" ? value.text : ""
    })
    .join("")
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function selectSentences(value: string, limit: number): string {
  const sentences = compactText(value).match(/[^。！？!?]+[。！？!?]?/g) ?? []
  return sentences.slice(0, limit).join("").trim()
}

function fitHeadTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  if (maxChars <= 1) return value.slice(0, maxChars)
  const available = maxChars - 1
  const head = Math.ceil(available * 0.65)
  return `${value.slice(0, head)}…${value.slice(-(available - head))}`
}

function fitRecentTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  if (maxChars <= 0) return ""
  if (maxChars === 1) return value.slice(-1)
  return `…${value.slice(-(maxChars - 1))}`
}

export function buildSessionContextSummary(
  input: BuildSessionContextSummaryInput,
): SessionContextSummary {
  const maxChars = Math.max(0, input.maxChars ?? 4000)
  const eligible = input.messages.filter((message) => message.role === "user" || message.role === "assistant")
  const firstUser = eligible.find((message) => message.role === "user")
  const toLine = (message: SessionSummaryMessage): string => {
    const text = selectSentences(messageText(message.content), message.role === "user" ? 3 : 2)
    return text ? `${message.role === "user" ? "用户" : "助手"}：${text}` : ""
  }
  const firstLine = firstUser ? toLine(firstUser) : ""
  const recentLines = eligible
    .slice(-11)
    .filter((message) => message !== firstUser)
    .map(toLine)
    .filter(Boolean)
  const recentText = recentLines.join("\n")
  const fullText = [firstLine, recentText].filter(Boolean).join("\n")
  let text = fullText
  if (fullText.length > maxChars) {
    if (firstLine && recentText && maxChars > 1) {
      const firstBudget = Math.max(1, Math.floor((maxChars - 1) * 0.45))
      const recentBudget = Math.max(0, maxChars - firstBudget - 1)
      text = `${fitHeadTail(firstLine, firstBudget)}\n${fitRecentTail(recentText, recentBudget)}`
    } else if (firstLine) {
      text = fitHeadTail(firstLine, maxChars)
    } else {
      text = fitRecentTail(recentText, maxChars)
    }
  }

  return {
    text,
    dependencyFingerprint: input.dependencyFingerprint,
    updatedAt: Date.now(),
  }
}

export function isSessionSummaryFresh(
  summary: SessionContextSummary | undefined,
  currentDependencyFingerprint: string,
): boolean {
  return Boolean(
    summary?.dependencyFingerprint
    && summary.dependencyFingerprint === currentDependencyFingerprint,
  )
}

export function isLegacySessionContextSummary(value: unknown): boolean {
  if (typeof value === "string") return true
  if (!value || typeof value !== "object") return false
  const candidate = value as { text?: unknown; dependencies?: unknown; dependencyFingerprint?: unknown }
  return typeof candidate.text === "string"
    && typeof candidate.dependencyFingerprint !== "string"
    && candidate.dependencies !== undefined
}

export function normalizeSessionContextSummary(value: unknown): SessionContextSummary | undefined {
  if (typeof value === "string") {
    return { text: value, updatedAt: 0 }
  }
  if (!value || typeof value !== "object") return undefined
  const candidate = value as Partial<SessionContextSummary>
  if (typeof candidate.text !== "string") return undefined
  return {
    text: candidate.text,
    ...(typeof candidate.dependencyFingerprint === "string" && candidate.dependencyFingerprint
      ? { dependencyFingerprint: candidate.dependencyFingerprint }
      : {}),
    updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
      ? candidate.updatedAt
      : 0,
  }
}
