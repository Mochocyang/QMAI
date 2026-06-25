import { createDirectory, readFile, writeFile } from "@/commands/fs"
import {
  rebuildChapterBody,
  replaceChapterBodySelection,
  splitChapterHeading,
  type ChapterBodySelection,
} from "@/lib/chapter-selection"
import { parseFrontmatter } from "@/lib/frontmatter"
import { normalizePath } from "@/lib/path-utils"

export interface DashboardIssueAnchor {
  evidence: string
  selection: ChapterBodySelection
}

export interface DashboardIssueRewriteBackup {
  itemId: string
  targetPath: string
  evidence: string
  originalText: string
  replacementText: string
  updatedAt: string
}

export interface DashboardFactCheckInsertPlan {
  anchorText: string
  insertText: string
}

export interface DashboardIssueState {
  ignored: Record<string, true>
  rewrites: Record<string, DashboardIssueRewriteBackup>
}

export interface DashboardRewriteMessage {
  role: "system" | "user"
  content: string
}

const DASHBOARD_ISSUE_FILE = ".qmai/dashboard-issues.json"

export function createEmptyDashboardIssueState(): DashboardIssueState {
  return { ignored: {}, rewrites: {} }
}

export function buildDashboardIssueId(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part ?? "").trim())
    .map((part) => part.replace(/\s+/g, " "))
    .join("|")
}

export function getDashboardIssueStorePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/${DASHBOARD_ISSUE_FILE}`
}

export async function loadDashboardIssueState(projectPath: string): Promise<DashboardIssueState> {
  try {
    const raw = await readFile(getDashboardIssueStorePath(projectPath))
    const parsed = JSON.parse(raw) as Partial<DashboardIssueState>
    return {
      ignored: normalizeIgnored(parsed.ignored),
      rewrites: normalizeRewrites(parsed.rewrites),
    }
  } catch {
    return createEmptyDashboardIssueState()
  }
}

export async function saveDashboardIssueState(projectPath: string, state: DashboardIssueState): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.qmai`).catch(() => {})
  await writeFile(
    getDashboardIssueStorePath(pp),
    JSON.stringify(
      {
        ignored: normalizeIgnored(state.ignored),
        rewrites: normalizeRewrites(state.rewrites),
      },
      null,
      2,
    ),
  )
}

export function sanitizeDashboardEvidence(input: string): string {
  let text = String(input || "").trim()
  text = text.replace(/^第\s*\d+\s*章[：:]\s*/u, "")
  text = text.replace(/^\[[^\]]+\]\s*/u, "")
  text = text.replace(/^[“"'\[（(]+/u, "")
  text = text.replace(/[”"'\]）)]+$/u, "")
  return text.trim()
}

export function findChapterSelectionByEvidence(
  markdown: string,
  evidences: Array<string | null | undefined>,
): DashboardIssueAnchor | null {
  const { body: markdownBody } = parseFrontmatter(markdown)
  const { body } = splitChapterHeading(markdownBody)
  for (const evidence of evidences) {
    const candidate = sanitizeDashboardEvidence(evidence || "")
    if (!candidate) continue
    const snippets = buildEvidenceCandidates(candidate)
    for (const snippet of snippets) {
      const start = body.indexOf(snippet)
      if (start < 0) continue
      const text = body.slice(start, start + snippet.length)
      return {
        evidence: candidate,
        selection: {
          start,
          end: start + snippet.length,
          text,
          bodySnapshot: body,
        },
      }
    }
  }
  return null
}

export function buildDashboardRewriteMessages(
  message: string,
  suggestion: string | undefined,
  sourceContent: string,
): DashboardRewriteMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是长篇小说编辑。",
        "请根据问题说明和修改建议，直接改写给定正文片段。",
        "不要改变未被要求修改的剧情事实、人物关系、章节时序和关键信息。",
        "只输出修改后的正文片段，不要解释，不要加标题，不要加引号。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `问题说明：${message}`,
        `修改建议：${suggestion || "请直接修正这个问题，并保持原段落信息不丢失。"}`,
        "需要修改的正文片段：",
        sourceContent,
      ].join("\n\n"),
    },
  ]
}

export function buildFactCheckInsertMessages(
  issueType: string,
  message: string,
  suggestion: string | undefined,
  evidenceA: string | undefined,
  evidenceB: string | undefined,
  chapterContent: string,
): DashboardRewriteMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是长篇小说编辑。",
        "请根据事实检查问题，为当前章节补写一小段必要的过渡事件。",
        "目标是补足中间因果、移动过程、物品转移或状态变化支撑，而不是整章重写。",
        "不要删除原文已有内容，不要改变章节主线，不要改动无关人物、时间线和设定。",
        "你必须先从当前章节正文中选择一个合适的插入锚点，再输出要插入的正文。",
        "只返回 JSON，不要解释，不要加代码块。",
        'JSON 格式：{"anchor_text":"从当前章节原文中原样复制的一句或一段锚点文本","insert_text":"需要补写到锚点前的正文内容"}',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `问题类型：${issueType}`,
        `问题说明：${message}`,
        `修改建议：${suggestion || "请补足支撑这次事实变化的中间事件。"}`,
        evidenceA ? `上一处证据：${evidenceA}` : "",
        evidenceB ? `当前证据：${evidenceB}` : "",
        "当前章节正文：",
        chapterContent,
      ].filter(Boolean).join("\n\n"),
    },
  ]
}

export function parseFactCheckInsertPlan(raw: string): DashboardFactCheckInsertPlan | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim()
  if (!cleaned) return null
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    const anchorText = String(parsed.anchorText || parsed.anchor_text || "").trim()
    const insertText = String(parsed.insertText || parsed.insert_text || "").trim()
    if (!anchorText || !insertText) return null
    return { anchorText, insertText }
  } catch {
    return null
  }
}

export function applyDashboardRewriteToMarkdown(
  markdown: string,
  anchor: DashboardIssueAnchor,
  replacement: string,
): string | null {
  const { rawBlock, body: markdownBody } = parseFrontmatter(markdown)
  const { heading, body } = splitChapterHeading(markdownBody)
  const replaced = replaceChapterBodySelection(body, anchor.selection, replacement)
  if (!replaced.ok) return null
  return rawBlock + rebuildChapterBody(heading, replaced.body)
}

export function applyDashboardInsertBeforeToMarkdown(
  markdown: string,
  anchor: DashboardIssueAnchor,
  insertion: string,
): string | null {
  const normalizedInsertion = insertion.trim()
  if (!normalizedInsertion) return null
  return applyDashboardRewriteToMarkdown(
    markdown,
    anchor,
    `${normalizedInsertion}\n${anchor.selection.text}`,
  )
}

export function restoreDashboardRewriteInMarkdown(
  markdown: string,
  backup: DashboardIssueRewriteBackup,
): string | null {
  const { rawBlock, body: markdownBody } = parseFrontmatter(markdown)
  const { heading, body } = splitChapterHeading(markdownBody)
  const replacement = backup.replacementText
  const original = backup.originalText
  const index = body.indexOf(replacement)
  if (index >= 0) {
    const nextBody = `${body.slice(0, index)}${original}${body.slice(index + replacement.length)}`
    return rawBlock + rebuildChapterBody(heading, nextBody)
  }

  const anchor = findChapterSelectionByEvidence(markdown, [backup.evidence, backup.originalText])
  if (!anchor) return null
  const restored = replaceChapterBodySelection(body, anchor.selection, original)
  if (!restored.ok) return null
  return rawBlock + rebuildChapterBody(heading, restored.body)
}

function buildEvidenceCandidates(evidence: string): string[] {
  const direct = normalizeEvidenceForMatch(evidence.trim())
  const parts = direct
    .split(/[，。！？；：“”‘’,.!?;:\n…]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4)
    .sort((a, b) => b.length - a.length)

  const prefixes = buildEvidencePrefixes(direct)
  return Array.from(new Set([direct, ...parts, ...prefixes].filter(Boolean)))
}

function normalizeEvidenceForMatch(evidence: string): string {
  return evidence
    .replace(/(\.\.\.|…)+$/u, "")
    .replace(/[“”‘’]/gu, "")
    .trim()
}

function buildEvidencePrefixes(evidence: string): string[] {
  const normalized = evidence.trim()
  if (normalized.length < 8) return normalized ? [normalized] : []
  const sizes = [Math.min(normalized.length, 24), Math.min(normalized.length, 18), Math.min(normalized.length, 12)]
  return Array.from(new Set(
    sizes
      .filter((size) => size >= 8)
      .map((size) => normalized.slice(0, size).trim())
      .filter(Boolean),
  ))
}

function normalizeIgnored(input: DashboardIssueState["ignored"] | unknown): Record<string, true> {
  if (!input || typeof input !== "object") return {}
  const result: Record<string, true> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value) result[key] = true
  }
  return result
}

function normalizeRewrites(input: DashboardIssueState["rewrites"] | unknown): Record<string, DashboardIssueRewriteBackup> {
  if (!input || typeof input !== "object") return {}
  const result: Record<string, DashboardIssueRewriteBackup> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue
    const row = value as Partial<DashboardIssueRewriteBackup>
    if (!row.itemId || !row.targetPath || !row.originalText || !row.replacementText) continue
    result[key] = {
      itemId: String(row.itemId),
      targetPath: String(row.targetPath),
      evidence: String(row.evidence || ""),
      originalText: String(row.originalText),
      replacementText: String(row.replacementText),
      updatedAt: String(row.updatedAt || ""),
    }
  }
  return result
}
