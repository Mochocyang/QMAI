import type { AgentRunRecord } from "@/lib/agent/types"
import type { ReferenceToken } from "@/lib/reference/types"
import type { MessageReference } from "@/stores/chat-store"

export type ReferenceTokensByConversation = Record<string, ReferenceToken[]>

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  return typeof value === "string" ? value.trim() : ""
}

function normalizeReferencePath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const lower = normalized.toLowerCase()
  const wikiIndex = lower.lastIndexOf("/wiki/")
  if (wikiIndex >= 0) return normalized.slice(wikiIndex + 1)
  const qmaiIndex = lower.lastIndexOf("/.qmai/")
  if (qmaiIndex >= 0) return normalized.slice(qmaiIndex + 1)
  return normalized.replace(/^\/+/, "")
}

function titleFromPath(path: string): string {
  const fileName = path.replace(/\\/g, "/").split("/").pop() ?? path
  return fileName.replace(/\.[^.]+$/, "")
}

function referenceFromReadTool(call: AgentRunRecord["toolCalls"][number]): MessageReference | null {
  if (call.status !== "done") return null

  const name = stringParam(call.params, "name")
  const path = stringParam(call.params, "path")

  switch (call.name) {
    case "read_chapter": {
      const referencePath = path ? normalizeReferencePath(path) : name ? `wiki/chapters/${name}.md` : ""
      if (!referencePath) return null
      return { title: name || titleFromPath(referencePath), path: referencePath }
    }
    case "read_outline": {
      const referencePath = path ? normalizeReferencePath(path) : name ? `wiki/outlines/${name}.md` : ""
      if (!referencePath) return null
      return { title: name || titleFromPath(referencePath), path: referencePath }
    }
    case "read_memory": {
      if (!name) return null
      return { title: name, path: `wiki/memory/${name}.md` }
    }
    case "read_deduction": {
      if (!name) return null
      return { title: name, path: `.qmai/simulations/${name}.json` }
    }
    default:
      return null
  }
}

export function agentToolCallsToMessageReferences(
  toolCalls: AgentRunRecord["toolCalls"] | undefined,
): MessageReference[] {
  if (!toolCalls || toolCalls.length === 0) return []

  const references: MessageReference[] = []
  const seen = new Set<string>()
  for (const call of toolCalls) {
    const reference = referenceFromReadTool(call)
    if (!reference || seen.has(reference.path)) continue
    seen.add(reference.path)
    references.push(reference)
  }
  return references
}

export function getReferenceTokensForConversation(
  drafts: ReferenceTokensByConversation,
  conversationId: string | null | undefined,
): ReferenceToken[] {
  if (!conversationId) return []
  return drafts[conversationId] ?? []
}

export function setReferenceTokensForConversation(
  drafts: ReferenceTokensByConversation,
  conversationId: string | null | undefined,
  tokens: ReferenceToken[],
): ReferenceTokensByConversation {
  if (!conversationId) return drafts
  if (tokens.length === 0) {
    const { [conversationId]: _removed, ...rest } = drafts
    return rest
  }
  return { ...drafts, [conversationId]: tokens }
}
