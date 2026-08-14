import type { OutlineSaveRequestFileType } from "./outline-save-request"
import { formatChapterOutlineFileName, sanitizeOutlineFileNamePart } from "./outline-workbench"

export interface OutlineSaveClassificationInput {
  explicitFileType?: OutlineSaveRequestFileType
  referencedSkills?: string[]
  title: string
  content: string
  /** 用户原话、意图模块名等，用于在正文引用「卷纲」时仍能识别章纲 */
  sourceHint?: string
}

export interface OutlineSaveClassification {
  fileType: OutlineSaveRequestFileType
  targetFolder: string
  fileName: string
}

const FILE_TYPE_FOLDERS: Record<OutlineSaveRequestFileType, string> = {
  outline: "大纲",
  "volume-outline": "卷纲",
  "chapter-outline": "章纲",
  character: "人物小传",
  setting: "设定",
  foreshadowing: "伏笔",
  organization: "组织",
  "quality-report": "质量检查",
}

export function getDefaultFolderForOutlineFileType(fileType: OutlineSaveRequestFileType): string {
  return FILE_TYPE_FOLDERS[fileType]
}

export function inferOutlineFileTypeFromSkills(skills: string[] = []): OutlineSaveRequestFileType | null {
  const text = skills.join("\n")
  if (text.includes("ZhanggangSkill/")) return "chapter-outline"
  if (text.includes("JueseSkill/")) return "character"
  if (text.includes("faction-system")) return "organization"
  if (text.includes("foreshadowing")) return "foreshadowing"
  if (text.includes("SheDingSkill/")) return "setting"
  if (text.includes("DagangSkill/")) return "outline"
  return null
}

const CHAPTER_TYPE_MARK = /章纲|细纲|章节细纲|章节大纲/
const VOLUME_TYPE_MARK = /卷纲|分卷大纲/
const CHAPTER_SUBJECT = /章纲|细纲|第\s*\d{1,4}\s*章/
const VOLUME_SUBJECT = /卷纲|分卷大纲|第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*卷/

function extractDocumentSubject(title: string, content: string): string {
  const heading = title.replace(/^#+\s*/, "").trim()
  const firstH1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? ""
  return `${heading}\n${firstH1}`
}

function resolveChapterOrVolumeType(text: string): OutlineSaveRequestFileType | null {
  const chapter = CHAPTER_SUBJECT.test(text)
  const volume = VOLUME_SUBJECT.test(text)
  if (chapter && !volume) return "chapter-outline"
  if (volume && !chapter) return "volume-outline"
  if (chapter && volume) {
    if (CHAPTER_TYPE_MARK.test(text) && !VOLUME_TYPE_MARK.test(text)) return "chapter-outline"
    if (VOLUME_TYPE_MARK.test(text) && !CHAPTER_TYPE_MARK.test(text)) return "volume-outline"
    if (CHAPTER_TYPE_MARK.test(text)) return "chapter-outline"
    return "volume-outline"
  }
  return null
}

function inferFileTypeFromHint(hint: string): OutlineSaveRequestFileType | null {
  const text = hint.trim()
  if (!text) return null
  const chapterOrVolume = resolveChapterOrVolumeType(text)
  if (chapterOrVolume) return chapterOrVolume
  if (/人物小传|角色小传/.test(text)) return "character"
  if (/伏笔计划|伏笔/.test(text) && /伏笔/.test(text)) return "foreshadowing"
  if (/组织势力|势力设定/.test(text)) return "organization"
  if (/力量体系|能力体系|金手指|世界观|背景设定|地理设定/.test(text)) return "setting"
  if (/质量检查/.test(text)) return "quality-report"
  if (/故事大纲|总纲/.test(text)) return "outline"
  return null
}

function inferFileTypeFromContent(title: string, content: string): OutlineSaveRequestFileType {
  const text = `${title}\n${content}`
  if (CHAPTER_TYPE_MARK.test(text)) return "chapter-outline"
  if (
    /(?:^|\n)#+\s*.*(?:卷纲|分卷大纲)/.test(text)
    || /第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*卷\s*(?:卷纲|大纲)/.test(text)
  ) {
    return "volume-outline"
  }
  if (/第\s*\d{1,4}\s*章/.test(text)) return "chapter-outline"
  if (/第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*卷/.test(text)) return "volume-outline"
  if (/人物小传|角色小传|男主|女主|男配|女配|反派|角色定位/.test(text)) return "character"
  if (/伏笔|线索|回收/.test(text)) return "foreshadowing"
  if (/组织|势力|阵营|门派|家族/.test(text)) return "organization"
  if (/世界观|设定|力量体系|金手指|地图|规则/.test(text)) return "setting"
  if (/质量检查|检查报告|问题清单/.test(text)) return "quality-report"
  return "outline"
}

function inferFileName(fileType: OutlineSaveRequestFileType, title: string, content: string): string {
  const chapter = `${title}\n${content}`.match(/第\s*(\d{1,4})\s*章\s*([^\n#]*)/)
  if (fileType === "chapter-outline" && chapter) {
    return formatChapterOutlineFileName(
      Number(chapter[1]),
      chapter[2]?.trim().replace(/^[：:\s-]+/, "") ?? "",
    )
  }

  const safe = sanitizeOutlineFileNamePart(title.replace(/^#+\s*/, "")) || "大纲"
  if (fileType === "character") {
    const characterFileName = safe.startsWith("角色-") ? safe : `角色-${safe}`
    return characterFileName.toLowerCase().endsWith(".md") ? characterFileName : `${characterFileName}.md`
  }
  return safe.toLowerCase().endsWith(".md") ? safe : `${safe}.md`
}

export function classifyOutlineSaveTarget(input: OutlineSaveClassificationInput): OutlineSaveClassification {
  const fileType =
    input.explicitFileType ??
    inferOutlineFileTypeFromSkills(input.referencedSkills) ??
    resolveChapterOrVolumeType(extractDocumentSubject(input.title, input.content)) ??
    inferFileTypeFromHint(input.sourceHint ?? "") ??
    inferFileTypeFromContent(input.title, input.content)

  return {
    fileType,
    targetFolder: getDefaultFolderForOutlineFileType(fileType),
    fileName: inferFileName(fileType, input.title, input.content),
  }
}
