import type { AgentRunRecord } from "@/lib/agent/types"
import type { ReferenceToken } from "@/lib/reference/types"
import type { MessageReference } from "@/stores/chat-store"

export type ReferenceTokensByConversation = Record<string, ReferenceToken[]>

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  return typeof value === "string" ? value.trim() : ""
}

/** Project-relative wiki path; maps legacy QM/ → wiki/ for UI virtualization. */
export function normalizeReferencePath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const lower = normalized.toLowerCase()
  const wikiIndex = lower.lastIndexOf("/wiki/")
  const qmIndex = lower.lastIndexOf("/qm/")
  const knowledgeIndex = Math.max(wikiIndex, qmIndex)
  if (knowledgeIndex >= 0) {
    const sliced = normalized.slice(knowledgeIndex + 1)
    return sliced.replace(/^QM\//i, "wiki/")
  }
  const qmaiIndex = lower.lastIndexOf("/.qmai/")
  if (qmaiIndex >= 0) return normalized.slice(qmaiIndex + 1)
  return normalized.replace(/^\/+/, "").replace(/^QM\//i, "wiki/")
}

function titleFromPath(path: string): string {
  const fileName = path.replace(/\\/g, "/").split("/").pop() ?? path
  return fileName.replace(/\.[^.]+$/, "")
}

function isDirectoryToolResult(result: string): boolean {
  return /」是目录，不是单个/.test(result) || /」是目录，但目录下没有找到/.test(result)
}

function isSnapshotFallbackResult(result: string): boolean {
  return result.includes("已读取大纲快照")
}

function isErrorToolResult(result: string): boolean {
  return result.startsWith("错误") || result.startsWith("错误：") || result.startsWith("错误:")
}

function looksLikeMarkdownFilePath(path: string): boolean {
  return /\.md$/i.test(path.replace(/\\/g, "/"))
}

function referenceFromReadTool(call: AgentRunRecord["toolCalls"][number]): MessageReference | null {
  if (call.status !== "done") return null
  if (
    isErrorToolResult(call.result)
    || isDirectoryToolResult(call.result)
    || isSnapshotFallbackResult(call.result)
  ) {
    return null
  }

  const name = stringParam(call.params, "name")
  const path = stringParam(call.params, "path")

  switch (call.name) {
    case "read_chapter": {
      // Prefer a real .md path (tool mutates params.path to the resolved file).
      // Never invent wiki/chapters/第40章.md — real files are usually 第40章-标题.md.
      if (path && looksLikeMarkdownFilePath(path)) {
        const referencePath = normalizeReferencePath(path)
        return { title: name || titleFromPath(referencePath), path: referencePath }
      }
      return null
    }
    case "read_outline": {
      if (path && looksLikeMarkdownFilePath(path)) {
        const referencePath = normalizeReferencePath(path)
        return { title: name || titleFromPath(referencePath), path: referencePath }
      }
      // Bare name / folder path without a resolved .md file must not become a citation.
      return null
    }
    case "read_memory": {
      if (path && looksLikeMarkdownFilePath(path)) {
        const referencePath = normalizeReferencePath(path)
        return { title: name || titleFromPath(referencePath), path: referencePath }
      }
      if (!name) return null
      return { title: name, path: `wiki/memory/${name.replace(/\.md$/i, "")}.md` }
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
