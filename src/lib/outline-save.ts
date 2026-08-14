import { parseFrontmatter } from "./frontmatter"
import { stripStructuredMarkers } from "./novel/outline-intent-clarity"
import { cleanNextStepArtifacts } from "./novel/outline-next-step"
import {
  classifyOutlineSaveTarget,
  type OutlineSaveClassification,
} from "./novel/outline-save-classifier"
import { extractBodyContent, type OutlineSaveRequest } from "./novel/outline-save-request"

export interface OutlineSaveDraft {
  title: string
  content: string
}

export interface ClassifiedOutlineSaveRequest {
  draft: OutlineSaveDraft
  classification: OutlineSaveClassification
  request: OutlineSaveRequest
}

const DEFAULT_TITLE_PREFIX = "AI大纲"

/**
 * 将 AI 大纲回复清洗为可展示/可保存的正文（与「保存为大纲」同源）。
 */
export function prepareOutlineSaveSourceContent(raw: string): string {
  const stripped = stripStructuredMarkers(raw)
  const bodyContent = extractBodyContent(stripped)
  const cleaned = cleanNextStepArtifacts(bodyContent || stripped)
  return normalizeOutlineMarkdown(cleaned).trim()
}

export function prepareOutlineSaveDraft(content: string, existingTitles: string[]): OutlineSaveDraft {
  const parsed = parseFrontmatter(content)
  const body = normalizeOutlineMarkdown(parsed.body).trim()
  const baseTitle = sanitizeOutlineTitle(extractOutlineTitle(body))
  const title = makeDistinctOutlineTitle(baseTitle, existingTitles)
  return { title, content: body }
}

const SAVEABLE_TYPE_MARK = /章纲|卷纲|总纲|细纲|分卷大纲|人物小传|^#\s+角色-/m
const CHAPTER_STRUCTURE_MARK = /本章目标[\s\S]{0,200}核心事件|核心事件[\s\S]{0,400}场景顺序/

/** 判断回复是否像一份可落盘的大纲正文（而非问答/确认摘要）。 */
export function isSaveableOutlineDeliverable(content: string): boolean {
  const cleaned = prepareOutlineSaveSourceContent(content).trim()
  if (!cleaned) return false
  if (/^#\s+/.test(cleaned) && SAVEABLE_TYPE_MARK.test(cleaned.slice(0, 400)) && cleaned.length >= 80) {
    return true
  }
  return cleaned.length >= 200
    && CHAPTER_STRUCTURE_MARK.test(cleaned)
    && /第\s*\d{1,4}\s*章/.test(cleaned)
}

export function buildClassifiedOutlineSaveRequest(input: {
  content: string
  sourceIntent: string
  sourceHint?: string
}): ClassifiedOutlineSaveRequest | null {
  const cleaned = prepareOutlineSaveSourceContent(input.content)
  if (!cleaned.trim()) return null
  const draft = prepareOutlineSaveDraft(cleaned, [])
  if (!draft.content.trim()) return null
  const classification = classifyOutlineSaveTarget({
    title: draft.title,
    content: draft.content,
    sourceHint: input.sourceHint,
  })
  const body = draft.content.replace(/^#\s+.+(?:\r?\n){1,2}/, "").trim()
  const titleHeading = classification.fileName.replace(/\.md$/i, "")
  const mdContent = body ? `# ${titleHeading}\n\n${body}` : draft.content.trim()
  return {
    draft,
    classification,
    request: {
      targetFolder: classification.targetFolder,
      fileName: classification.fileName,
      fileType: classification.fileType,
      writeMode: "create",
      referencedSkills: [],
      sourceIntent: input.sourceIntent,
      content: mdContent,
    },
  }
}

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < 2 || trimmed.length > 50) return false
  if (/^#{1,6}\s/.test(trimmed)) return false
  if (/^[-*+]\s/.test(trimmed)) return false
  if (/^\d+\.\s/.test(trimmed)) return false
  if (trimmed.includes("：") || trimmed.includes(":")) return false
  if (trimmed.startsWith("```") || trimmed.endsWith("```")) return false
  return true
}

function convertChineseNumberedHeadings(lines: string[]): string[] {
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!looksLikeHeading(trimmed)) {
      result.push(line)
      i++
      continue
    }

    if (/^[一二三四五六七八九十百]+[、．.]\s*/.test(trimmed)) {
      const title = trimmed.replace(/^[一二三四五六七八九十百]+[、．.]\s*/, "")
      if (title && !/^#/.test(trimmed)) {
        result.push(`# ${trimmed}`)
        i++
        continue
      }
    }

    if (/^（[一二三四五六七八九十百]+）\s*/.test(trimmed)) {
      const title = trimmed.replace(/^（[一二三四五六七八九十百]+）\s*/, "")
      if (title && !/^#/.test(trimmed)) {
        result.push(`## ${trimmed}`)
        i++
        continue
      }
    }

    if (/^\([一二三四五六七八九十百]+\)\s*/.test(trimmed)) {
      const title = trimmed.replace(/^\([一二三四五六七八九十百]+\)\s*/, "")
      if (title && !/^#/.test(trimmed)) {
        result.push(`## ${trimmed}`)
        i++
        continue
      }
    }

    if (/^\d+[、．.]\s*/.test(trimmed) && trimmed.length < 30) {
      const title = trimmed.replace(/^\d+[、．.]\s*/, "")
      if (title && !/^#/.test(trimmed)) {
        result.push(`## ${trimmed}`)
        i++
        continue
      }
    }

    const commonH2Keywords = /^(核心主角|核心配角|主要人物|次要人物|反派|主角团|世界观|修炼体系|能力体系|金手指|势力分布|伏笔|大纲|总纲|卷纲|章纲|分卷大纲|章节细纲|故事背景|核心设定|主要设定|分卷)/
    if (commonH2Keywords.test(trimmed)) {
      result.push(`## ${trimmed}`)
      i++
      continue
    }

    const nextLines = lines.slice(i + 1, i + 4).map(l => l.trim()).filter(Boolean)
    const hasAttributeLines = nextLines.length > 0 && nextLines.every(l =>
      /^[：:]/.test(l) ||
      /(年龄|身份|技能|性格|核心|外貌|背景|目标|动机|欲望|恐惧|关系|冲突|弧光|定位|阵营|资源|能力|限制|代价|成长|功法|武器|装备)/.test(l) ||
      /^[-*+]\s/.test(l)
    )

    if (hasAttributeLines && trimmed.length < 30 && !trimmed.endsWith("。") && !trimmed.endsWith("，")) {
      if (/（.*）/.test(trimmed) || /\(.*\)/.test(trimmed) || /^[\u4e00-\u9fa5]{2,6}$/.test(trimmed)) {
        result.push(`### ${trimmed}`)
        i++
        continue
      }
    }

    result.push(line)
    i++
  }

  return result
}

function convertAttributeLines(lines: string[]): string[] {
  return lines.map(line => {
    const trimmed = line.trim()
    if (/^#{1,6}\s/.test(trimmed)) return line
    if (/^[-*+]\s/.test(trimmed)) return line
    if (/^\d+\.\s/.test(trimmed)) return line
    if (trimmed.startsWith("```") || trimmed.endsWith("```")) return line

    const attrMatch = trimmed.match(/^([^：:]{1,12})[：:]\s*(.*)$/)
    if (attrMatch) {
      const attrName = attrMatch[1].trim()
      const attrValue = attrMatch[2].trim()
      if (attrName && attrValue && attrName.length <= 12) {
        return `- **${attrName}：** ${attrValue}`
      }
    }

    return line
  })
}

const OUTLINE_START_KEYWORDS = /^(第[一二三四五六七八九十百千\d]+[章卷节部编]|[总卷章节分卷分章]+[纲要]|章纲|卷纲|总纲|大纲|细纲|故事背景|世界观|核心设定|主要人物|核心主角|人物设定|角色设定|势力分布|修炼体系|能力体系|金手指|伏笔|背景设定)/

function stripPrefaceText(content: string): string {
  const lines = content.split(/\r?\n/)
  let startIdx = 0
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    if (/^#{1,6}\s/.test(trimmed)) {
      startIdx = i
      break
    }
    if (OUTLINE_START_KEYWORDS.test(trimmed)) {
      startIdx = i
      break
    }
  }
  return lines.slice(startIdx).join("\n")
}

export function normalizeOutlineMarkdown(content: string): string {
  let result = content
    .replace(/```(?:markdown|md)\s*\r?\n([\s\S]*?)\r?\n```/gi, (_, inner: string) => inner.trim())
    .replace(/^\\(#{1,6}\s)/gm, "$1")
    .replace(/^\\([-*+]\s)/gm, "$1")
    .replace(/^\\(>\s)/gm, "$1")
    .replace(/^\\(\d+\.\s)/gm, "$1")
    .replace(/\\([*_`[\]])/g, "$1")

  result = stripPrefaceText(result)

  const lines = result.split(/\r?\n/)
  const withHeadings = convertChineseNumberedHeadings(lines)
  const withAttributes = convertAttributeLines(withHeadings)

  return withAttributes.join("\n")
}

function detectOutlineContentType(content: string): "chapter-outline" | "character" | "volume-outline" | "setting" | "foreshadowing" | "organization" | "outline" {
  const text = content.slice(0, 2000)
  if (/第\s*\d{1,4}\s*章/.test(text)) return "chapter-outline"
  if (/第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*卷/.test(text)) return "volume-outline"
  if (/人物小传|角色小传|人物设定|角色设定/.test(text) && /姓名|身份|性格|外貌/.test(text)) return "character"
  if (/伏笔|线索|回收/.test(text)) return "foreshadowing"
  if (/组织|势力|阵营|门派|家族/.test(text)) return "organization"
  if (/世界观|修炼体系|能力体系|金手指|核心设定|主要设定/.test(text)) return "setting"
  return "outline"
}

function extractChapterOutlineTitle(content: string, _lines: string[]): string | null {
  const chapterMatch = content.match(/第\s*(\d{1,4}|[一二三四五六七八九十百千万]+)\s*章\s*([^\n#：:，,。.]*)/)
  if (chapterMatch) {
    const chapterNum = chapterMatch[1]
    const chapterTitle = chapterMatch[2]?.trim()
    if (chapterTitle) {
      return `第${chapterNum}章 ${chapterTitle}`
    }
    return `第${chapterNum}章`
  }
  return null
}

function extractCharacterTitle(content: string, lines: string[]): string | null {
  const nameMatch = content.match(/(?:姓名|名字|角色名|人物名)[：:]\s*([^\n，,。.；;]+)/)
  if (nameMatch && nameMatch[1].trim()) {
    return nameMatch[1].trim()
  }
  for (const line of lines.slice(0, 10)) {
    const trimmed = line.trim()
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/)
    const text = headingMatch ? headingMatch[1].trim() : trimmed
    if (!text || text.length > 20) continue
    if (/[：:]/.test(text)) {
      const parts = text.split(/[：:]/)
      if (parts[0].length <= 4 && /姓名|名字|角色|人物/.test(parts[0]) && parts[1]?.trim()) {
        return parts[1].trim()
      }
    }
    if (/^(男主|女主|男配|女配|反派|主角|配角)/.test(text) && text.length <= 15) {
      return text
    }
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(text) && !/的|与|和|之|是|在|有|为/.test(text)) {
      return text
    }
  }
  return null
}

function extractVolumeOutlineTitle(content: string, _lines: string[]): string | null {
  const volumeMatch = content.match(/第\s*(\d+|[一二三四五六七八九十百千万]+)\s*卷\s*([^\n#：:，,。.]*)/)
  if (volumeMatch) {
    const volumeNum = volumeMatch[1]
    const volumeTitle = volumeMatch[2]?.trim()
    if (volumeTitle) {
      return `第${volumeNum}卷 ${volumeTitle}`
    }
    return `第${volumeNum}卷`
  }
  return null
}

function extractGeneralOutlineTitle(content: string, lines: string[]): string | null {
  const workNameMatch = content.match(/(?:作品名|书名|小说名|作品名称)[：:]\s*([^\n，,。.；;]+)/)
  if (workNameMatch && workNameMatch[1].trim()) {
    return workNameMatch[1].trim()
  }
  for (const line of lines.slice(0, 5)) {
    const trimmed = line.trim()
    const h1Match = trimmed.match(/^#\s+(.+)/)
    if (h1Match) {
      const title = h1Match[1].trim()
      if (title.length >= 2 && title.length <= 30) {
        return title
      }
    }
  }
  for (const line of lines.slice(0, 10)) {
    const trimmed = line.trim()
    const h2Match = trimmed.match(/^##\s+(.+)/)
    if (h2Match) {
      const title = h2Match[1].trim()
      if (/总纲|大纲|全书大纲|故事大纲|整体大纲/.test(title)) {
        continue
      }
      if (title.length >= 2 && title.length <= 25) {
        return title
      }
    }
  }
  return null
}

function extractOutlineTitle(content: string): string {
  const normalized = content.trim()
  if (!normalized) return `${DEFAULT_TITLE_PREFIX}-${new Date().toISOString().slice(0, 10)}`

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return `${DEFAULT_TITLE_PREFIX}-${new Date().toISOString().slice(0, 10)}`

  for (const line of lines.slice(0, 15)) {
    const h1Match = line.match(/^#\s+(.+)/)
    if (h1Match) {
      const title = h1Match[1].trim()
      if (title && title.length >= 1 && title.length <= 50) {
        return title
      }
    }
  }

  const contentType = detectOutlineContentType(normalized)

  let extracted: string | null = null
  switch (contentType) {
    case "chapter-outline":
      extracted = extractChapterOutlineTitle(normalized, lines)
      break
    case "character":
      extracted = extractCharacterTitle(normalized, lines)
      break
    case "volume-outline":
      extracted = extractVolumeOutlineTitle(normalized, lines)
      break
    case "outline":
    case "setting":
    case "foreshadowing":
    case "organization":
    default:
      extracted = extractGeneralOutlineTitle(normalized, lines)
      break
  }

  if (extracted) return extracted

  for (const line of lines.slice(0, 10)) {
    const trimmed = line.trim()
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)/)
    const text = headingMatch ? headingMatch[1].trim() : trimmed
    if (
      text.length >= 2 &&
      text.length <= 30 &&
      !/^[-*+]/.test(text) &&
      !/^[：:]/.test(text) &&
      !/[，。；？！、]$/.test(text)
    ) {
      return text
    }
  }

  const typeNames: Record<string, string> = {
    "chapter-outline": "章纲",
    "volume-outline": "卷纲",
    "character": "人物设定",
    "setting": "设定",
    "foreshadowing": "伏笔",
    "organization": "组织势力",
    "outline": "大纲",
  }
  const typeLabel = typeNames[contentType] || "大纲"
  return `${DEFAULT_TITLE_PREFIX}-${typeLabel}-${new Date().toISOString().slice(0, 10)}`
}

function sanitizeOutlineTitle(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24)
  return cleaned || `${DEFAULT_TITLE_PREFIX}-${new Date().toISOString().slice(0, 10)}`
}

function makeDistinctOutlineTitle(title: string, existingTitles: string[]): string {
  const existing = new Set(existingTitles.map((item) => item.trim()).filter(Boolean))
  if (!existing.has(title)) return title

  const first = `${title}-AI生成`
  if (!existing.has(first)) return first

  for (let index = 2; index <= 99; index++) {
    const candidate = `${first}-${index}`
    if (!existing.has(candidate)) return candidate
  }
  return `${first}-${Date.now()}`
}
