import { sanitizeOutlineFileNamePart } from "./outline-workbench"

export type CharacterSaveConfidence = "high" | "medium" | "low"

export interface CharacterSaveDraft {
  id: string
  characterName: string
  roleType: string
  fileName: string
  content: string
  selected: boolean
  confidence: CharacterSaveConfidence
}

export interface CharacterSaveExtractionResult {
  drafts: CharacterSaveDraft[]
  errors: string[]
}

const ROLE_PATTERN = /(男主|女主|男配|女配|反派|导师|盟友|配角|主角)/
const NON_CHARACTER_HEADING_PATTERN =
  /^(?:人物设定|角色设定|人物小传|角色小传|人物关系|角色关系|群像|设定总览|世界观|卷纲|章纲|细纲|大纲|设定|背景|地图|力量体系|金手指|伏笔|组织|势力|时间线|剧情线|第.{1,12}卷(?:[：:].*)?)$/

function extractRoleFromTrailing(text: string): string | null {
  // 支持 "张三（男主）"、"张三(男主)"、"张三 — 男主"、"张三 - 男主"、"张三 男主"
  const parenMatch = text.match(/[（(]\s*(男主|女主|男配|女配|反派|导师|盟友|配角|主角)\s*[)）]/)
  if (parenMatch) return parenMatch[1]
  const tailMatch = text.match(/[\s—\-–]+\s*(男主|女主|男配|女配|反派|导师|盟友|配角|主角)\s*$/)
  if (tailMatch) return tailMatch[1]
  const endMatch = text.match(/\s+(男主|女主|男配|女配|反派|导师|盟友|配角|主角)\s*$/)
  if (endMatch) return endMatch[1]
  return null
}

function extractNameFromHeading(rawTitle: string): string {
  // 去掉前缀 "角色设定"、"角色"、"人物小传" 等
  let name = rawTitle.replace(/^角色(?:设定|小传|简介)?[：:\-\s]*/, "")
  name = name.replace(/^人物(?:设定|小传|简介)?[：:\-\s]*/, "")
  // 去掉尾部 role 标注
  name = name.replace(/[（(]\s*(?:男主|女主|男配|女配|反派|导师|盟友|配角|主角)\s*[)）]/, "")
  name = name.replace(/[\s—\-–]+\s*(?:男主|女主|男配|女配|反派|导师|盟友|配角|主角)\s*$/, "")
  name = name.replace(/\s+(?:男主|女主|男配|女配|反派|导师|盟友|配角|主角)\s*$/, "")
  return cleanFieldValue(name)
}

export function buildCharacterFileName(roleType: string, characterName: string): string {
  const role = sanitizeOutlineFileNamePart(roleType) || "角色"
  const name = sanitizeOutlineFileNamePart(characterName) || "未命名"
  return `角色-${role}-${name}.md`
}

function normalizeRole(value: string | undefined): string {
  return value?.match(ROLE_PATTERN)?.[1] ?? "角色"
}

function cleanFieldValue(value: string): string {
  return value
    .replace(/[*_`#]/g, "")
    .replace(/^[-\s]+/, "")
    .trim()
}

function createDraft(
  roleType: string | undefined,
  characterName: string,
  content: string,
  confidence: CharacterSaveConfidence,
): CharacterSaveDraft {
  const role = normalizeRole(roleType)
  const name = sanitizeOutlineFileNamePart(cleanFieldValue(characterName))
  return {
    id: `${role}:${name}`,
    characterName: name,
    roleType: role,
    fileName: buildCharacterFileName(role, name),
    content: content.trim(),
    selected: confidence !== "low",
    confidence,
  }
}

function splitByCharacterHeadings(content: string): CharacterSaveDraft[] {
  const lines = content.split(/\r?\n/)
  const ranges: Array<{ start: number; end: number; roleType: string; name: string; confidence: CharacterSaveConfidence }> = []

  for (let index = 0; index < lines.length; index++) {
    // 匹配 ## 标题，捕获标题原文
    const match = lines[index].match(/^#{1,4}\s+(.{1,32})\s*$/)
    if (!match) continue

    const rawTitle = match[1]
    // 优先尝试从标题前缀提取 "男主：/女主：/..." 旧格式
    const prefixRoleMatch = rawTitle.match(/^(男主|女主|男配|女配|反派|导师|盟友|配角|主角)[：:\-\s]+(.{1,24})$/)

    let name: string
    let roleType: string | null

    if (prefixRoleMatch) {
      // 旧格式："## 男主：张三"
      name = extractNameFromHeading(prefixRoleMatch[2])
      roleType = prefixRoleMatch[1]
    } else {
      // 新格式："## 张三（男主）"、"## 张三 - 男主"、"## 角色设定：张三"、"## 张三"
      name = extractNameFromHeading(rawTitle)
      if (!name) continue
      roleType = extractRoleFromTrailing(rawTitle)
    }

    if (!name || NON_CHARACTER_HEADING_PATTERN.test(name)) continue

    // 从邻近 8 行查找 "角色定位：男主" 字段
    const nearbyText = lines.slice(index, index + 8).join("\n")
    const roleFromFields = nearbyText.match(/角色定位[：:]\s*(男主|女主|男配|女配|反派|导师|盟友|配角|主角)/)?.[1]

    const finalRole = roleType ?? roleFromFields
    // 没有任何 role 信息时跳过纯名字标题，避免误识别 "## 第一章" 之类的章节
    if (!finalRole) continue

    ranges.push({
      start: index,
      end: lines.length,
      roleType: finalRole,
      name,
      confidence: roleType ? "high" : "medium",
    })
  }

  ranges.forEach((range, index) => {
    range.end = ranges[index + 1]?.start ?? lines.length
  })

  return ranges.map((range) => createDraft(
    range.roleType,
    range.name,
    lines.slice(range.start, range.end).join("\n"),
    range.confidence,
  ))
}

function extractSingleByFields(content: string): CharacterSaveDraft | null {
  const name = content.match(/(?:姓名|角色名|名字)[：:]\s*([^\n，,。；;]{1,24})/)?.[1]?.trim()
  const role = content.match(/(?:角色定位|定位|身份)[：:]\s*(男主|女主|男配|女配|反派|导师|盟友|配角|主角)/)?.[1]?.trim()
  if (!name) return null
  return createDraft(role, name, content, role ? "medium" : "low")
}

const PARAGRAPH_ROLE_PATTERN = /(男主|女主|男配|女配|反派|导师|盟友|配角|主角)/
const PARAGRAPH_NAME_PATTERNS = [
  /(?:姓名|角色名|名字)[：:]\s*([^\n，,。；;]{1,24})/,
  /^([^\n，,。；:：\-—\s]{1,24})[，,]/,
  /^([^\n，,。；:：\-—\s]{1,24})\s*[,，]/,
]

function splitByParagraphs(content: string): CharacterSaveDraft[] {
  // 按空行或 --- 分割段落
  const paragraphs = content
    .split(/\n\s*\n|\n---\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  if (paragraphs.length <= 1) return []

  const drafts: CharacterSaveDraft[] = []
  for (const para of paragraphs) {
    // 必须包含角色关键字才认为是角色描述
    const roleMatch = para.match(PARAGRAPH_ROLE_PATTERN)
    if (!roleMatch) continue

    // 尝试从段落首行提取名字
    const firstLine = para.split(/\r?\n/)[0] ?? para
    let name: string | null = null
    for (const pattern of PARAGRAPH_NAME_PATTERNS) {
      const m = firstLine.match(pattern)
      if (m && m[1]) {
        name = cleanFieldValue(m[1])
        if (name) break
      }
    }
    // 没有明确名字时跳过，避免误识别
    if (!name) continue

    const draft = createDraft(roleMatch[1], name, para, "low")
    // 段落兜底默认选中，让用户在弹窗中确认
    draft.selected = true
    drafts.push(draft)
  }

  return drafts
}

export function extractCharacterSaveDrafts(content: string): CharacterSaveExtractionResult {
  const headingDrafts = splitByCharacterHeadings(content)
  if (headingDrafts.length > 0) return { drafts: headingDrafts, errors: [] }

  const fieldDraft = extractSingleByFields(content)
  if (fieldDraft) return { drafts: [fieldDraft], errors: [] }

  // 段落兜底：无标题无字段时按段落分割
  const paragraphDrafts = splitByParagraphs(content)
  if (paragraphDrafts.length > 0) {
    return {
      drafts: paragraphDrafts,
      errors: [`已按段落自动拆分 ${paragraphDrafts.length} 个角色，请检查命名和角色定位是否准确。`],
    }
  }

  return {
    drafts: [],
    errors: ["未识别到可单独保存的角色，请手动选择保存范围或让 AI 按一人一档重新输出。"],
  }
}
