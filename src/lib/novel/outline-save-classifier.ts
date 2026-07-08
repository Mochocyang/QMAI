import type { OutlineSaveRequestFileType } from "./outline-save-request"
import { formatChapterOutlineFileName, sanitizeOutlineFileNamePart } from "./outline-workbench"

export interface OutlineSaveClassificationInput {
  explicitFileType?: OutlineSaveRequestFileType
  referencedSkills?: string[]
  title: string
  content: string
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

function inferFileTypeFromContent(title: string, content: string): OutlineSaveRequestFileType {
  const text = `${title}\n${content}`
  if (/卷纲|分卷|第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*卷/.test(text)) return "volume-outline"
  if (/章纲|细纲|第\s*\d{1,4}\s*章/.test(text)) return "chapter-outline"
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
    return formatChapterOutlineFileName(Number(chapter[1]), chapter[2]?.trim() ?? "")
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
    inferFileTypeFromContent(input.title, input.content)

  return {
    fileType,
    targetFolder: getDefaultFolderForOutlineFileType(fileType),
    fileName: inferFileName(fileType, input.title, input.content),
  }
}
