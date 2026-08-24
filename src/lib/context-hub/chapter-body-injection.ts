import { fileExists } from "@/commands/fs"
import { loadSnapshot } from "@/lib/novel/chapter-ingest"
import { extractChapterNumber, findChapterFileByNumber } from "@/lib/novel/chapter-utils"
import { normalizePath } from "@/lib/path-utils"
import type { AgentMessage } from "@/lib/agent/types"

export const CHAPTER_BODY_FOLD_MIN_CHARS = 1500

export interface ChapterRef {
  chapterNumber: number
  path: string
  savedAt: number
}

interface ChapterHistoryMessage {
  id?: string
  role: string
  content: string
  chapterRef?: ChapterRef
  agentToolCalls?: Array<{
    name: string
    params?: Record<string, unknown>
    result?: string
    status?: string
  }>
  reasoning_content?: string
}

interface BuildHistoryContentDeps {
  projectPath: string
  novelMode: boolean
  /** When false, skip folding even if the chapter is on disk. */
  readChapterToolAvailable?: boolean
  pathMemo?: Map<number, string | null>
}

function paddedChapterFileName(chapterNumber: number): string {
  return `chapter-${String(chapterNumber).padStart(3, "0")}.md`
}

export function isFoldableChapterBody(content: string): boolean {
  if (!content || content.length < CHAPTER_BODY_FOLD_MIN_CHARS) return false
  if (content.includes("<!-- chapter_plan -->")) return false
  return true
}

function chapterNumberFromToolName(name: string): number | undefined {
  const match = name.match(/(?:^|[^0-9])(\d{1,4})(?:[^0-9]|$)/)
  if (!match?.[1]) return undefined
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function resolveChapterNumberFromMessage(
  message: ChapterHistoryMessage,
): number | undefined {
  const fromRef = message.chapterRef?.chapterNumber
  if (typeof fromRef === "number" && Number.isFinite(fromRef) && fromRef > 0) {
    return Math.floor(fromRef)
  }

  for (const call of message.agentToolCalls ?? []) {
    if (call.name === "run_chapter_workflow") {
      const raw = call.params?.chapterNumber
      const value = typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? Number.parseInt(raw, 10)
          : Number.NaN
      if (Number.isFinite(value) && value > 0) return Math.floor(value)
    }
    if (call.name === "write_chapter") {
      const name = typeof call.params?.name === "string" ? call.params.name : ""
      const fromName = chapterNumberFromToolName(name) ?? extractChapterNumber(name) ?? undefined
      if (fromName && fromName > 0) return fromName
    }
  }

  const fromText = extractChapterNumber(message.content)
  return fromText && fromText > 0 ? fromText : undefined
}

async function resolveSavedChapterPath(
  projectPath: string,
  chapterNumber: number,
  pathMemo?: Map<number, string | null>,
): Promise<string | null> {
  if (pathMemo?.has(chapterNumber)) {
    return pathMemo.get(chapterNumber) ?? null
  }

  const pp = normalizePath(projectPath)
  const fastPath = `${pp}/wiki/chapters/${paddedChapterFileName(chapterNumber)}`
  let resolved: string | null = null
  try {
    if (await fileExists(fastPath)) {
      resolved = fastPath
    } else {
      resolved = await findChapterFileByNumber(pp, chapterNumber)
    }
  } catch {
    resolved = null
  }

  pathMemo?.set(chapterNumber, resolved)
  return resolved
}

function toProjectRelativePath(projectPath: string, absolutePath: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(absolutePath)
  const prefix = `${pp}/`
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized
}

export function buildFoldedChapterPointer(input: {
  chapterNumber: number
  relativePath: string
  originalChars: number
  summary?: string
}): string {
  const lines = [
    `[第${input.chapterNumber}章正文已入库，未在此重复注入｜原文约 ${input.originalChars} 字｜${input.relativePath}]`,
  ]
  const summary = input.summary?.trim()
  if (summary) lines.push(`提要：${summary}`)
  lines.push("需要正文细节时用 read_chapter 读取该章节，以盘上版本为准。")
  return lines.join("\n")
}

export async function buildHistoryContentForModel(
  message: ChapterHistoryMessage,
  deps: BuildHistoryContentDeps,
): Promise<string> {
  if (!deps.novelMode) return message.content
  if (deps.readChapterToolAvailable === false) return message.content
  if (message.role !== "assistant") return message.content
  if (!isFoldableChapterBody(message.content)) return message.content

  try {
    const chapterNumber = resolveChapterNumberFromMessage(message)
    if (!chapterNumber) return message.content

    const savedPath = await resolveSavedChapterPath(
      deps.projectPath,
      chapterNumber,
      deps.pathMemo,
    )
    if (!savedPath) return message.content

    let summary = ""
    try {
      const snapshot = await loadSnapshot(deps.projectPath, chapterNumber)
      summary = snapshot?.summary?.trim() ?? ""
    } catch {
      summary = ""
    }

    return buildFoldedChapterPointer({
      chapterNumber,
      relativePath: toProjectRelativePath(deps.projectPath, savedPath),
      originalChars: message.content.length,
      summary,
    })
  } catch {
    return message.content
  }
}

export async function buildAgentHistoryMessages(
  messages: readonly ChapterHistoryMessage[],
  deps: BuildHistoryContentDeps,
): Promise<AgentMessage[]> {
  const pathMemo = deps.pathMemo ?? new Map<number, string | null>()
  const resolvedDeps = { ...deps, pathMemo }
  const result: AgentMessage[] = []
  for (const message of messages) {
    const content = await buildHistoryContentForModel(message, resolvedDeps)
    result.push({
      role: message.role as AgentMessage["role"],
      content,
      ...(message.reasoning_content !== undefined
        ? { reasoning_content: message.reasoning_content }
        : {}),
    })
  }
  return result
}
