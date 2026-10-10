import type { OutlineSaveRequestFileType } from "./outline-save-request"
import { formatChapterOutlineFileName, sanitizeOutlineFileNamePart } from "./outline-workbench"

interface OutlineSaveClassificationInput {
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
  "event-outline": "事件细纲",
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

/*
 * 「事件细纲」这个字符串**包含**「细纲」，而下面的 CHAPTER_TYPE_MARK / CHAPTER_SUBJECT 都认「细纲」。
 * 事件标记必须先判：否则模型漏写 fileType 时，事件细纲会按名字被判成 chapter-outline 落进「章纲」文件夹，
 * 章纲写作上下文引擎的 resolveChapterOutline 随后会把它当成真正的 17 节章纲读走 —— 隔离保证就此失效。
 * CHAPTER_TYPE_MARK / CHAPTER_SUBJECT 本身不动：没有「事件」二字时，「细纲」仍然只指章纲。
 */
const EVENT_TYPE_MARK = /事件细纲|事件清单|事件序列/
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
  // 事件细纲优先级最高：它命中 CHAPTER_SUBJECT 的「细纲」，必须先被摘出去
  if (EVENT_TYPE_MARK.test(text)) return "event-outline"
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
  if (EVENT_TYPE_MARK.test(text)) return "event-outline"
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
  // 事件标记先于章纲标记：正文里出现「事件序列 / 事件清单」就是事件细纲，别被标题的「细纲」抢走
  if (EVENT_TYPE_MARK.test(text)) return "event-outline"
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
  // 事件细纲固定命名「事件细纲-第NNN章.md」，与 event-outline.ts 的提示词示例保持一致，不照抄标题
  if (fileType === "event-outline" && chapter) {
    return `事件细纲-第${String(Number(chapter[1])).padStart(3, "0")}章.md`
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
    // 标题语义优先于正文推断：避免「《XX》全版本力量体系总纲」因正文提到「第N章」被误判为章纲
    inferFileTypeFromHint(input.title.replace(/^#+\s*/, "")) ??
    inferFileTypeFromContent(input.title, input.content)

  return {
    fileType,
    targetFolder: getDefaultFolderForOutlineFileType(fileType),
    fileName: inferFileName(fileType, input.title, input.content),
  }
}
