import type { ChatMessage } from "@/lib/llm-providers"
import { parseFrontmatter } from "@/lib/frontmatter"
import {
  rebuildChapterBody,
  replaceChapterBodySelection,
  splitChapterHeading,
} from "@/lib/chapter-selection"
import {
  findChapterSelectionByEvidence,
  type DashboardIssueAnchor,
  type DashboardIssueRewriteBackup,
} from "@/lib/dashboard-issue-actions"

export interface ReviewRewriteEdit {
  id: string
  originalText: string
  replacementText: string
  note?: string
}

export interface ReviewRewriteIssue {
  message: string
  suggestion?: string
  evidence?: string
  secondaryEvidence?: string
  chapterContent: string
  directAnchors?: DashboardIssueAnchor[]
}

export interface AppliedReviewRewriteEdit {
  edit: ReviewRewriteEdit
  backup: DashboardIssueRewriteBackup
}

export type ReviewRewriteApplyResult =
  | { ok: true; markdown: string; applied: AppliedReviewRewriteEdit[] }
  | { ok: false; markdown: string; applied: AppliedReviewRewriteEdit[]; failed: ReviewRewriteEdit[] }

export function buildReviewRewritePlanMessages(issue: ReviewRewriteIssue): ChatMessage[] {
  const directFragments = (issue.directAnchors ?? [])
    .map((anchor, index) => `片段${index + 1}：${anchor.selection.text}`)
    .join("\n\n")

  return [
    {
      role: "system",
      content: [
        "你是长篇小说审稿编辑。",
        "请根据审稿问题，找出当前章节中需要修改的一个或多个原文片段，并为每个片段给出替换后的正文。",
        "如果已给出可定位片段，请优先只修改这些片段；如果问题需要多处联动修改，可以补充其他必须修改的原文片段。",
        "不要整章重写，不要改变无关剧情事实、人物关系、时间线和关键设定。",
        "只返回 JSON 数组，不要解释，不要加代码块。",
        '数组元素格式：{"original_text":"当前章节中必须原样存在的原文片段","replacement_text":"替换后的正文片段","note":"简短说明"}',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `审稿问题：${issue.message}`,
        `修改建议：${issue.suggestion || "请直接修正这个问题，并保持原段落信息不丢失。"}`,
        issue.evidence ? `审稿证据：${issue.evidence}` : "",
        issue.secondaryEvidence ? `补充证据：${issue.secondaryEvidence}` : "",
        directFragments ? `已定位到的候选原文片段：\n${directFragments}` : "",
        `当前章节全文：\n${issue.chapterContent}`,
      ].filter(Boolean).join("\n\n"),
    },
  ]
}

export function parseReviewRewritePlan(raw: string): ReviewRewriteEdit[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim()
  if (!cleaned) return []

  const jsonText = extractJsonArray(cleaned)
  if (!jsonText) return []

  try {
    const parsed = JSON.parse(jsonText) as unknown
    if (!Array.isArray(parsed)) return []
    const edits: ReviewRewriteEdit[] = []
    parsed.forEach((item, index) => {
      if (!item || typeof item !== "object") return
      const row = item as Record<string, unknown>
      const originalText = String(row.original_text ?? row.originalText ?? row.search ?? "").trim()
      const replacementText = String(row.replacement_text ?? row.replacementText ?? row.replace ?? "").trim()
      const note = String(row.note ?? row.reason ?? "").trim()
      if (!originalText || !replacementText) return
      edits.push({
        id: String(row.id ?? `edit-${index + 1}`),
        originalText,
        replacementText,
        note: note || undefined,
      })
    })
    return edits
  } catch {
    return []
  }
}

export function findReviewRewriteAnchors(markdown: string, evidences: Array<string | null | undefined>): DashboardIssueAnchor[] {
  const anchors: DashboardIssueAnchor[] = []
  const seen = new Set<string>()

  for (const evidence of evidences) {
    for (const candidate of splitEvidenceCandidates(evidence || "")) {
      const anchor = findChapterSelectionByEvidence(markdown, [candidate])
      if (!anchor) continue
      const key = `${anchor.selection.start}:${anchor.selection.end}`
      if (seen.has(key)) continue
      seen.add(key)
      anchors.push(anchor)
    }
  }

  return anchors
}

export function applyReviewRewriteEditsToMarkdown(markdown: string, edits: ReviewRewriteEdit[]): ReviewRewriteApplyResult {
  let currentMarkdown = markdown
  const applied: AppliedReviewRewriteEdit[] = []
  const failed: ReviewRewriteEdit[] = []

  for (const edit of edits) {
    const anchor = findUniqueExactReviewRewriteAnchor(currentMarkdown, edit.originalText)
    if (!anchor) {
      failed.push(edit)
      continue
    }

    const nextMarkdown = replaceReviewRewriteAnchor(currentMarkdown, anchor, edit.replacementText)
    if (!nextMarkdown) {
      failed.push(edit)
      continue
    }

    currentMarkdown = nextMarkdown
    applied.push({
      edit,
      backup: {
        itemId: edit.id,
        targetPath: "",
        evidence: anchor.evidence,
        originalText: anchor.selection.text,
        replacementText: edit.replacementText,
        updatedAt: new Date().toISOString(),
      },
    })
  }

  if (failed.length > 0) {
    return { ok: false, markdown: currentMarkdown, applied, failed }
  }
  return { ok: true, markdown: currentMarkdown, applied }
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start < 0 || end <= start) return null
  return text.slice(start, end + 1)
}

function splitEvidenceCandidates(evidence: string): string[] {
  const cleaned = evidence
    .replace(/[「」]/g, "\n")
    .replace(/[“”]/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4)

  return Array.from(new Set([evidence.trim(), ...cleaned].filter(Boolean)))
}

function findUniqueExactReviewRewriteAnchor(markdown: string, originalText: string): DashboardIssueAnchor | null {
  const needle = originalText.trim()
  if (!needle) return null
  const { body: markdownBody } = parseFrontmatter(markdown)
  const { body } = splitChapterHeading(markdownBody)
  const first = body.indexOf(needle)
  if (first >= 0) {
    const second = body.indexOf(needle, first + needle.length)
    if (second >= 0) return null
    return {
      evidence: needle,
      selection: {
        start: first,
        end: first + needle.length,
        text: needle,
        bodySnapshot: body,
      },
    }
  }
  return findUniqueWhitespaceInsensitiveReviewRewriteAnchor(body, needle)
}

function findUniqueWhitespaceInsensitiveReviewRewriteAnchor(body: string, needle: string): DashboardIssueAnchor | null {
  const normalizedBody = compactTextWithSourceMap(body)
  const normalizedNeedle = compactText(needle)
  if (!normalizedNeedle) return null

  const first = normalizedBody.text.indexOf(normalizedNeedle)
  if (first < 0) return null
  const second = normalizedBody.text.indexOf(normalizedNeedle, first + normalizedNeedle.length)
  if (second >= 0) return null

  const start = normalizedBody.sourceIndexes[first]
  const lastSourceIndex = normalizedBody.sourceIndexes[first + normalizedNeedle.length - 1]
  if (start === undefined || lastSourceIndex === undefined) return null
  const end = lastSourceIndex + 1

  return {
    evidence: body.slice(start, end),
    selection: {
      start,
      end,
      text: body.slice(start, end),
      bodySnapshot: body,
    },
  }
}

function compactTextWithSourceMap(text: string): { text: string; sourceIndexes: number[] } {
  let compact = ""
  const sourceIndexes: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    if (/\s/.test(text[index])) continue
    compact += text[index]
    sourceIndexes.push(index)
  }
  return { text: compact, sourceIndexes }
}

function compactText(text: string): string {
  return text.replace(/\s+/g, "")
}

function replaceReviewRewriteAnchor(
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
