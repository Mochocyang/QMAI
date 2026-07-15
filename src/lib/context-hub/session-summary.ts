import type { SessionContextSummary } from "./types"

export interface SessionSummaryMessage {
  role: string
  content: unknown
}

export interface BuildSessionContextSummaryInput {
  messages: SessionSummaryMessage[]
  dependencies: Record<string, number>
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

export function buildSessionContextSummary(
  input: BuildSessionContextSummaryInput,
): SessionContextSummary {
  const maxChars = Math.max(0, input.maxChars ?? 4000)
  const lines = input.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => {
      const text = selectSentences(messageText(message.content), message.role === "user" ? 3 : 2)
      if (!text) return ""
      return `${message.role === "user" ? "用户" : "助手"}：${text}`
    })
    .filter(Boolean)
  const text = lines.join("\n").slice(0, maxChars)

  return {
    text,
    dependencies: { ...input.dependencies },
    updatedAt: Date.now(),
  }
}

export function isSessionSummaryFresh(
  summary: SessionContextSummary | undefined,
  currentDependencies: Record<string, number>,
): boolean {
  if (!summary) return false
  return Object.entries(summary.dependencies).every(
    ([path, revision]) => currentDependencies[path] === revision,
  )
}

export function normalizeSessionContextSummary(value: unknown): SessionContextSummary | undefined {
  if (typeof value === "string") {
    return { text: value, dependencies: {}, updatedAt: 0 }
  }
  if (!value || typeof value !== "object") return undefined
  const candidate = value as Partial<SessionContextSummary>
  if (typeof candidate.text !== "string") return undefined
  const dependencies = candidate.dependencies && typeof candidate.dependencies === "object"
    ? Object.fromEntries(
        Object.entries(candidate.dependencies).filter((entry): entry is [string, number] => (
          typeof entry[1] === "number" && Number.isFinite(entry[1])
        )),
      )
    : {}
  return {
    text: candidate.text,
    dependencies,
    updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
      ? candidate.updatedAt
      : 0,
  }
}
