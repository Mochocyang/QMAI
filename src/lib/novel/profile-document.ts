/**
 * 「档案文档」通用内核：人物卡 / 势力卡 / 后续更多类型的共同底座。
 *
 * 提供：
 * - 统一的档案模型 `ProfileDocument`（name / tag / tagline / sections）；
 * - sections 三态 `kv` / `list` / `table`；
 * - AI ```json 围栏解析（单对象或数组）、MD 正文兜底解析（含 Markdown 表格）；
 * - 模板运行时（项目覆盖 → 程序 skills 目录 → 内置）；
 * - HTML 渲染（供各类型专属模板共用，占位符统一为 `__PROFILE_*__`）。
 *
 * 各类型模块（人物小传 character-profile-template.ts、组织势力 faction-profile-template.ts）
 * 只需提供：模板内容、JSON 顶层字段名、头部小标题。
 */

import { fileExists, getExecutableDir, getResourceDir, readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { normalizeProfileDiagram, renderProfileDiagram, type ProfileDiagram } from "./profile-diagram"

export interface ProfileKvItem {
  label?: string
  text: string
}

export type ProfileSection =
  | { kind: "kv"; heading: string; items: ProfileKvItem[] }
  | { kind: "list"; heading: string; items: string[] }
  | { kind: "table"; heading: string; head: string[]; rows: string[][] }
  /** Markdown 分区内的正文、列表与多张表，按原始顺序保留。 */
  | { kind: "mixed"; heading: string; blocks: ProfileSection[] }

export interface ProfileDocument {
  name: string
  /** 类型 / 定位徽章（男主 / 门派 / 家族 …） */
  tag?: string
  /** 一句话定位 */
  tagline?: string
  sections: ProfileSection[]
  /** 地理/地点的结构化关系示意，缺失时不伪造地图。 */
  diagram?: ProfileDiagram
}

/** JSON 顶层字段：单个对象字段 + 可选数组字段。 */
export interface ProfileDocumentKeys {
  single: string
  list?: string
}

// ---------------------------------------------------------------------------
// 归一化
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map((item) => asString(item)).filter(Boolean)
}

/** 零宽 / 控制类不可见字符：`trim()` 不会去掉，会导致「空白徽章」「看不见的标签」。 */
const INVISIBLE_CHARS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g

/** 是否含可见字符（决定是否渲染徽章 / 标签 / 芯片）。 */
export function hasVisibleText(value: string | undefined | null): boolean {
  if (!value) return false
  return /[^\s\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/.test(value)
}

/**
 * 清洗行内文本：去掉不可见字符 + markdown 行内标记。
 * ⚠️ AI 在 ```json 里也经常写 `**加粗**`，Json 路径必须与 MD 路径做同样的清洗，
 * 否则 `**` 会原样显示在卡片上。
 */
function sanitizeInline(value: string): string {
  return cleanInline(value.replace(INVISIBLE_CHARS, "")).trim()
}

function normalizeKvItem(raw: unknown): ProfileKvItem | null {
  if (typeof raw === "string") {
    const text = sanitizeInline(raw)
    return text ? { text } : null
  }
  if (!isRecord(raw)) return null
  const label = sanitizeInline(asString(raw.label ?? raw.k ?? raw.name ?? raw.field))
  const text = sanitizeInline(asString(raw.text ?? raw.value ?? raw.v ?? raw.content))
  if (!label && !text) return null
  return { ...(label ? { label } : {}), text }
}

/** 归一化一个分区：支持 kv / list / table，并容错 AI 的多种写法。 */
export function normalizeProfileSection(raw: unknown): ProfileSection | null {
  if (!isRecord(raw)) return null
  const heading = sanitizeInline(asString(raw.heading ?? raw.title ?? raw.name)) || "分区"

  const rowsRaw = Array.isArray(raw.rows) ? raw.rows : Array.isArray(raw.table) ? raw.table : null
  const tableObj = isRecord(raw.table) ? raw.table : null
  const tableRowsSource = tableObj && Array.isArray(tableObj.rows) ? tableObj.rows : rowsRaw
  if (Array.isArray(tableRowsSource)) {
    const rows = tableRowsSource
      .map((row) => (Array.isArray(row) ? row.map((cell) => sanitizeInline(asString(cell))) : []))
      .filter((row) => row.length > 0)
    const head = asStringArray(raw.head ?? (tableObj ? tableObj.head : undefined)).map(sanitizeInline)
    if (rows.length > 0) return { kind: "table", heading, head, rows }
  }

  const items = Array.isArray(raw.items) ? raw.items : []
  if (items.length === 0) return null
  if (items.every((item) => typeof item === "string")) {
    return { kind: "list", heading, items: items.map((item) => sanitizeInline(asString(item))).filter(Boolean) }
  }
  const kv = items.map(normalizeKvItem).filter((item): item is ProfileKvItem => Boolean(item))
  if (kv.length === 0) return null
  const anyLabel = kv.some((item) => (item.label ?? "").trim())
  return anyLabel
    ? { kind: "kv", heading, items: kv }
    : { kind: "list", heading, items: kv.map((item) => item.text) }
}

/** 归一化一个档案对象（容错 AI 的多种字段名）。 */
export function normalizeProfileDocument(raw: unknown, fallbackName = "未命名"): ProfileDocument | null {
  if (!isRecord(raw)) return null
  const payload = isRecord(raw.profile) ? raw.profile : raw
  const name = sanitizeInline(asString(payload.name ?? payload.title ?? payload.characterName ?? payload.factionName))
  const tag = sanitizeInline(asString(payload.tag ?? payload.roleType ?? payload.role ?? payload.type ?? payload.position))
  const tagline = sanitizeInline(asString(payload.tagline ?? payload.subtitle ?? payload.summary ?? payload.oneLine))
  const sections = (Array.isArray(payload.sections) ? payload.sections : [])
    .map(normalizeProfileSection)
    .filter((section): section is ProfileSection => Boolean(section))
  const diagram = normalizeProfileDiagram(payload.diagram)
  if (!name && sections.length === 0) return null
  return {
    name: name || fallbackName,
    ...(hasVisibleText(tag) ? { tag } : {}),
    ...(tagline ? { tagline } : {}),
    ...(diagram ? { diagram } : {}),
    sections,
  }
}

function tryParseJson(text: string): unknown | null {
  const start = text.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1)) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/**
 * 从 AI 原文中解析档案结构化数据。
 * 支持单个对象（keys.single）或数组（keys.list）。
 */
export function extractProfileDocuments(
  text: string,
  keys: ProfileDocumentKeys,
  fallbackName = "未命名",
): ProfileDocument[] {
  if (!text) return []
  const marker = keys.single
  const candidates: string[] = []
  const fencePattern = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi
  for (const match of text.matchAll(fencePattern)) {
    const block = match[1].trim()
    if (block.includes(marker) || block.startsWith("{")) candidates.push(block)
  }
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) candidates.push(trimmed)

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate)
    if (!parsed || !isRecord(parsed)) continue
    const listRaw = keys.list && Array.isArray(parsed[keys.list])
      ? (parsed[keys.list] as unknown[])
      : parsed[marker] !== undefined
        ? [parsed[marker]]
        : null
    if (!listRaw) continue
    const docs = listRaw
      .map((item) => normalizeProfileDocument(item, fallbackName))
      .filter((doc): doc is ProfileDocument => Boolean(doc))
    if (docs.length > 0) return docs
  }
  return []
}

// ---------------------------------------------------------------------------
// 多对象场景：挑出「本文件」对应的那一份档案
// ---------------------------------------------------------------------------

/** 挑选档案时可参考的线索（文件名 / 目标文件夹 / 本文件的 MD 正文）。 */
export interface ProfilePickHints {
  fileName?: string
  targetFolder?: string
  content?: string
}

/** 文件名前缀（势力-青云门.md → 青云门；角色-男主-林辰.md → 男主-林辰）。 */
const FILE_NAME_PREFIX =
  /^(?:势力|组织|门派|家族|阵营|角色|人物|队伍|团队|机构|集团|力量体系|能力体系|修炼体系|体系|功法|神通|金手指|系统|背景设定|世界观|地理设定|地点设定|地点|地图|道具|物品|伏笔|设定)\s*[-—–_:：\s]\s*/

function normalizeName(value: string): string {
  return value
    .replace(/[\s（）()【】\[\]「」“”"'`·・。.,，、:：\-—–_]/g, "")
    .toLowerCase()
}

/** 名字互相包含即视为匹配（「男主-林辰」与「林辰」应匹配）。 */
function nameMatches(candidate: string, target: string): boolean {
  const a = normalizeName(candidate)
  const b = normalizeName(target)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

/** 取正文最浅层标题作为档案名（去掉「势力：」前缀与括号徽章）。 */
function firstHeadingName(content: string): string {
  const { body } = stripFrontmatter(content ?? "")
  if (!body) return ""
  const headings = collectHeadings(body.split(/\r?\n/))
  if (headings.length === 0) return ""
  const rootLevel = Math.min(...headings.map((heading) => heading.level))
  const root = headings.find((heading) => heading.level === rootLevel)
  if (!root) return ""
  return splitNameAndTag(stripNumbering(root.text.replace(NAME_PREFIX, ""))).name
}

/** 从线索里提取候选名字（文件名 → 去前缀文件名 → 正文首标题）。 */
function candidateNames(hints: ProfilePickHints): string[] {
  const names: string[] = []
  const raw = (hints.fileName ?? "").replace(/\.(?:md|html)$/i, "").trim()
  if (raw) {
    names.push(raw)
    const stripped = raw.replace(FILE_NAME_PREFIX, "").trim()
    if (stripped && stripped !== raw) names.push(stripped)
  }
  const heading = firstHeadingName(hints.content ?? "")
  if (heading) names.push(heading)
  return names.filter(Boolean)
}

/**
 * per_item 场景（一次生成多个势力 / 地点 / 背景 …，拆成多个文件保存）挑选本文件对应的那份档案。
 *
 * - 0 份：返回 null（调用方回退 MD 解析）；
 * - 1 份：直接用（AI 通常只给一份且对应本文件）；
 * - 多份：按「文件名 → 去前缀文件名 → 正文首标题」与 docs[].name 匹配；
 *   匹配不到返回 null（回退 MD），**绝不张冠李戴**。
 *
 * 这一步很关键：多份时若直接回退 MD，AI 精心设计的结构化表格会被压成零散条目，
 * 卡片信息量大幅下降（势力卡的 组织架构/人员构成/经济来源 等表格尤其明显）。
 */
export function pickProfileDocument(
  docs: ProfileDocument[],
  hints: ProfilePickHints,
): ProfileDocument | null {
  if (docs.length === 0) return null
  if (docs.length === 1) return docs[0]
  const names = candidateNames(hints)
  for (const name of names) {
    const hit = docs.find((doc) => nameMatches(doc.name, name))
    if (hit) return hit
  }
  return null
}

// ---------------------------------------------------------------------------
// Markdown → 档案（兜底路径）
// ---------------------------------------------------------------------------

function stripFrontmatter(md: string): { frontmatter: string; body: string } {
  const match = md.match(/^\uFEFF?---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!match) return { frontmatter: "", body: md.trim() }
  return { frontmatter: match[1], body: md.slice(match[0].length).trim() }
}

function cleanInline(value: string): string {
  const paired = value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  // 不成对残留兜底：AI 常写 `**标签：** 正文`（冒号在加粗对内部），按「：」拆成
  // label/text 后各自只剩半个 `**`，上面的成对正则处理不了，会原样显示在卡片上。
  // 中文正文里孤立的星号/下划线串几乎不可能是正常内容，直接清除。
  const stripped = paired
    .replace(/\*{2,}/g, "")
    .replace(/_{2,}/g, "")
    .replace(/^\s*\*\s*/, "")
    .replace(/\s*\*\s*$/, "")
    .replace(/^\s*_\s*/, "")
    .replace(/\s*_\s*$/, "")
  return stripped
    .replace(/^#+\s*/, "")
    .replace(/^[-*+]\s+/, "") // 行首列表符（MD 兜底取首行做 tagline 时会带上）
    .trim()
}

interface HeadingLine {
  level: number
  text: string
  index: number
}

function collectHeadings(lines: string[]): HeadingLine[] {
  const headings: HeadingLine[] = []
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.*\S)\s*$/)
    if (match) headings.push({ level: match[1].length, text: cleanInline(match[2]), index })
  })
  return headings
}

function stripNumbering(heading: string): string {
  return heading.replace(/^\s*(?:\d+[.、)]|[一二三四五六七八九十]+[、.)])\s*/, "").trim() || heading
}

function isTableRow(line: string): boolean {
  return /^\|.*\|$/.test(line)
}

function splitCells(line: string): string[] {
  return line.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cleanInline(cell.replace(/\\\|/g, "|")).trim())
}

function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))
}

function parseKvOrList(block: string): ProfileSection | null {
  const items: ProfileKvItem[] = []
  let buffer: string[] = []
  const flush = () => {
    const text = cleanInline(buffer.join(" ")).trim()
    buffer = []
    if (!text) return
    const field = text.match(/^([^：:]{1,32})[：:]\s*(.+)$/)
    items.push(field ? { label: cleanInline(field[1]), text: cleanInline(field[2]) } : { text })
  }
  for (const line of block.split(/\r?\n/)) {
    const text = line.trim()
    if (!text) { flush(); continue }
    const item = text.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (item) {
      flush()
      buffer.push(item[1])
    } else if (/^[^：:]{1,32}[：:]\s*.+$/.test(text)) {
      flush()
      buffer.push(text)
    } else {
      buffer.push(text)
    }
  }
  flush()
  if (!items.length) return null
  return items.some(item => item.label)
    ? { kind: "kv", heading: "", items }
    : { kind: "list", heading: "", items: items.map(item => item.text) }
}

/** 保留分区内所有正文和表格，不能识别到一张表就丢掉其余文字。 */
function parseSection(heading: string, block: string): ProfileSection | null {
  const lines = block.split(/\r?\n/)
  const blocks: ProfileSection[] = []
  let prose: string[] = []
  const flush = () => {
    const parsed = parseKvOrList(prose.join("\n"))
    if (parsed) blocks.push(parsed)
    prose = []
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    const next = lines[index + 1]?.trim() ?? ""
    if (isTableRow(line) && isTableRow(next) && isTableSeparator(splitCells(next))) {
      flush()
      const head = splitCells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && isTableRow(lines[index].trim())) {
        rows.push(splitCells(lines[index].trim()))
        index++
      }
      index--
      blocks.push({ kind: "table", heading: "", head, rows })
    } else {
      prose.push(lines[index])
    }
  }
  flush()
  if (!blocks.length) return null
  return blocks.length === 1 ? { ...blocks[0], heading } : { kind: "mixed", heading, blocks }
}

/** 常见「设定名：」前缀（势力：青云门 / 力量体系：九转玄功 / 角色：林辰 …）。 */
const NAME_PREFIX =
  /^(?:势力|组织|门派|家族|阵营|角色|人物|队伍|团队|机构|集团|力量体系|能力体系|修炼体系|体系|功法|神通|金手指|系统|背景设定|世界观|地理设定|地点设定|地点|地图|道具|物品|设定)\s*[：:]\s*/
/** 常见分区名（用于判断最浅标题是「档案名」还是「分区名」）。 */
const DEFAULT_KNOWN_HEADS =
  /^(?:基本信息|角色定位|外在表现|内在分析|语言风格|关系网络|出场记录|状态追踪|写作使用规则|别名|性格特征|背景故事|人物动机|人物弧线|关键关系|标志性特征|经典语录|内部结构|外部关系|剧情功能|写作约束|核心定义|运行规则|规则体系|等级体系|能力|势力目标|资源|代表人物)/
/** 「类型 / 定位」类字段，用于在无徽章时从基本信息里补 tag。 */
const TAG_FIELD = /^(?:类型|角色类型|角色定位|定位|类别|分类|势力类型|组织类型|门派类型)$/

/** 从「青云门（正道魁首）」这类标题里拆出名字与徽章。 */
function splitNameAndTag(raw: string): { name: string; tag: string } {
  const paren = raw.match(/[（(]\s*([^）)]+)\s*[)）]/)
  const tag = paren?.[1]?.trim() ?? ""
  const name = raw.replace(/[（(][^）)]*[)）]/g, "").trim()
  return { name, tag }
}

/** 从 MD 正文解析档案（兜底：AI 只出 MD 时）。 */
export function profileDocumentFromMarkdown(md: string, fallbackName = "未命名"): ProfileDocument | null {
  const { frontmatter, body } = stripFrontmatter(md)
  if (!body) return null
  const fmName = cleanInline(frontmatter.match(/^\s*name\s*:\s*(.+)$/m)?.[1]?.trim() ?? "")
  const fmTag = cleanInline(
    frontmatter.match(/^\s*(?:role_type|tag|type)\s*:\s*(.+)$/m)?.[1]?.trim() ?? "",
  )

  const lines = body.split(/\r?\n/)
  const headings = collectHeadings(lines)

  let name = fmName
  let tag = fmTag
  let sectionLevelMin = 2
  let leadingStart = 0

  const h1 = headings.find((heading) => heading.level === 1)
  if (h1) {
    if (!name) name = stripNumbering(cleanInline(h1.text).replace(NAME_PREFIX, ""))
    sectionLevelMin = 2
    leadingStart = h1.index + 1
  } else if (headings.length > 0) {
    const rootLevel = Math.min(...headings.map((heading) => heading.level))
    const root = headings.find((heading) => heading.level === rootLevel)
    if (root && rootLevel >= 2 && !DEFAULT_KNOWN_HEADS.test(root.text)) {
      const split = splitNameAndTag(root.text.replace(NAME_PREFIX, ""))
      if (!name) name = stripNumbering(split.name)
      if (split.tag) tag = split.tag
      sectionLevelMin = rootLevel + 1
      leadingStart = root.index + 1
    } else {
      sectionLevelMin = rootLevel
      leadingStart = 0
    }
  }

  const firstSection = headings.find((heading) => heading.level >= sectionLevelMin)
  const leadingEnd = firstSection ? firstSection.index : lines.length
  const leading = lines.slice(leadingStart, leadingEnd).join("\n").trim()
  const tagline = leading ? cleanInline(leading.split(/\r?\n/)[0]).slice(0, 120) : ""

  const sectionHeadings = headings.filter((heading) => heading.level >= sectionLevelMin)
  const sections: ProfileSection[] = []
  // 页首只展示短摘要，完整导语另存为正文分区，不能因 120 字摘要上限丢失。
  if (firstSection && leading && cleanInline(leading) !== tagline) {
    const introduction = parseSection("设定导语", leading)
    if (introduction) sections.push(introduction)
  }
  sectionHeadings.forEach((heading, i) => {
    const end = i + 1 < sectionHeadings.length ? sectionHeadings[i + 1].index : lines.length
    const section = parseSection(stripNumbering(heading.text), lines.slice(heading.index + 1, end).join("\n"))
    if (section) sections.push(section)
  })

  if (sections.length === 0) {
    const fallback = parseKvOrList(body)
    if (!fallback) return null
    // MD 兜底出的是「无子标题的整篇内容」：分区标题沿用档案名，
    // 否则卡片上会出现毫无信息量的「分区 1」。
    if (!fallback.heading && name) fallback.heading = name
    sections.push(fallback)
  }

  // 无括号徽章时，从「基本信息」里的 类型/定位 字段补 tag
  if (!tag) {
    const basic = sections.find((section) => section.kind === "kv" && /基本信息|概览/.test(section.heading))
    if (basic && basic.kind === "kv") {
      tag = basic.items.find((item) => TAG_FIELD.test((item.label ?? "").trim()))?.text ?? ""
    }
  }

  return {
    name: name || fallbackName,
    ...(tag ? { tag } : {}),
    ...(tagline ? { tagline } : {}),
    sections,
  }
}

// ---------------------------------------------------------------------------
// HTML 渲染（占位符统一为 __PROFILE_*__）
// ---------------------------------------------------------------------------

export const PROFILE_PLACEHOLDERS = {
  eyebrow: "__PROFILE_EYEBROW__",
  name: "__PROFILE_NAME__",
  tag: "__PROFILE_ROLE__",
  chips: "__PROFILE_CHIPS__",
  tagline: "__PROFILE_TAGLINE__",
  overview: "__PROFILE_OVERVIEW__",
  sections: "__PROFILE_SECTIONS__",
  diagram: "__PROFILE_DIAGRAM__",
  title: "__PROFILE_TITLE__",
} as const

/**
 * 必填占位符 = 除图形、标题、分区导航以外的全部槽位。
 * `overview` 已随左侧栏一起退场（见 buildOverviewHtml 的说明），
 * 模板不再需要提供它；旧自定义模板留着也不会有占位符漏出（映射到空串）。
 */
const REQUIRED_PLACEHOLDERS = Object.values(PROFILE_PLACEHOLDERS).filter(
  value => value !== PROFILE_PLACEHOLDERS.diagram && value !== PROFILE_PLACEHOLDERS.title && value !== PROFILE_PLACEHOLDERS.overview,
)

function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function profileEscapeHtml(value: unknown): string {
  return escapeHtml(value)
}

function kvRow(label: string, value: string): string {
  const text = value.trim() || "—"
  return `<div class="kv"><span class="kk">${escapeHtml(label)}</span><span class="vv">${escapeHtml(text)}</span></div>`
}

function listBlock(items: string[]): string {
  return `<ul class="clist">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
}

/**
 * 短值阈值：值 ≤ 此长度视为「字段」（走双列紧凑行），超过则视为「条目段落」
 * （走「小标题 + 正文」条目块）。AI 输出的设定卡常把 100+ 字的段落塞进 kv 值里，
 * 侧栏标签 + 长段落的表单式排版正是「第一点、第二点」流水账观感的根源。
 */
const SHORT_VALUE_LIMIT = 44

/** 长段落条目块：小标题 + 正文（对齐卷纲 .who/.lrow 的视觉语言）。 */
function entryBlock(item: ProfileKvItem): string {
  const label = (item.label ?? "").trim()
  const head = label ? `<h4>${escapeHtml(label)}</h4>` : ""
  return `<div class="entry">${head}<p>${escapeHtml(item.text.trim() || "—")}</p></div>`
}

/**
 * kv 条目渲染：按「连续短值 / 连续长值」分组——
 * 短值组包进 .kgrid 迷你信息卡双列排布（信息密度），
 * 长值组包进 .entrylist 正文条目，保持顺序与可读行宽。
 */
function renderKvItems(items: ProfileKvItem[]): string {
  const groups: Array<{ long: boolean; items: ProfileKvItem[] }> = []
  for (const item of items) {
    const long = !item.label?.trim() || item.text.length > SHORT_VALUE_LIMIT
    const last = groups[groups.length - 1]
    if (last && last.long === long) last.items.push(item)
    else groups.push({ long, items: [item] })
  }
  return groups
    .map((group) =>
      group.long
        ? `<div class="entrylist">${group.items.map(entryBlock).join("")}</div>`
        : `<div class="kgrid">${group.items.map((item) => kvRow(item.label ?? "", item.text)).join("")}</div>`,
    )
    .join("")
}

function tableBlock(head: string[], rows: string[][]): string {
  // AI 输出的表格常出现「表头 4 列、某一行 5 列（或少了 1 列）」——不归一化会让整张表错位。
  // 这里按最大列数补齐，缺失的单元格留空。
  const headCells = Array.isArray(head) ? head : []
  const colCount = Math.max(headCells.length, ...rows.map((row) => row.length))
  if (colCount <= 0) return ""
  const pad = (cells: string[]): string[] =>
    Array.from({ length: colCount }, (_, index) => cells[index] ?? "")

  const headHtml = headCells.length
    ? `<thead><tr>${pad(headCells)
        .map((cell) => `<th class="mxh" scope="col">${escapeHtml(cell)}</th>`)
        .join("")}</tr></thead>`
    : ""
  const bodyHtml = rows
    .map(
      (row) =>
        `<tr>${pad(row)
          .map((cell, index) => `<td${index === 0 ? ' class="mxh"' : ""} data-label="${escapeHtml(headCells[index] || `第${index + 1}项`)}">${renderCell(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("")
  return `<div class="mxwrap"><table class="mx">${headHtml}<tbody>${bodyHtml}</tbody></table></div>`
}

/** 第二版按信息语义组织视觉，所有单元格原文仍在卡片和可展开源表中保留。 */
function semanticTable(section: Extract<ProfileSection, { kind: "table" }>): string | null {
  const heading = section.heading
  const style = /等级|阶梯|升级树/.test(heading) ? "ranks"
    : /历史|沿革|出场记录|成长节奏|使用史/.test(heading) ? "timeline"
    : /伏笔状态|线索链|埋设与回收|表层误导|回收日志/.test(heading) ? "threads"
    : /区域划分|重要地点|交通与通行|空间规则|可触发事件/.test(heading) ? "regions"
    : /经济来源|资源与消耗|资源与限制/.test(heading) ? "resources"
    : /关系网络|外部关系|组织架构|人员构成|派系/.test(heading) ? "roster" : null
  if (!style || !section.rows.length) return null
  const cards = section.rows.map((row, index) => {
    const fields = row.slice(1).map((cell, i) => `<div class="semantic-field"><dt>${escapeHtml(section.head?.[i + 1] || `第${i + 2}项`)}</dt><dd>${renderCell(cell)}</dd></div>`).join("")
    return `<article class="semantic-card"><header><span class="semantic-number">${String(index + 1).padStart(2, "0")}</span><h4>${escapeHtml(row[0] || "未命名条目")}</h4></header><dl>${fields}</dl></article>`
  }).join("")
  return `<div class="profile-${style} semantic-grid">${cards}</div><details class="profile-source-table"><summary>查看完整对照表（${section.rows.length} 条）</summary>${tableBlock(section.head, section.rows)}</details>`
}

function sectionBody(section: ProfileSection, editorial = false): string {
  if (section.kind === "mixed") return section.blocks.map(block => sectionBody({ ...block, heading: section.heading }, editorial)).join("\n")
  if (editorial && section.kind === "table") {
    const visual = semanticTable(section)
    if (visual) return visual
  }
  if (section.kind === "table") return section.rows.length ? tableBlock(section.head, section.rows) : `<p class="hint">未填</p>`
  if (section.kind === "list") return section.items.length ? listBlock(section.items) : `<p class="hint">未填</p>`
  if (section.items.length === 0) return `<p class="hint">未填</p>`
  return renderKvItems(section.items)
}

/** 分区规模标注（导航与卡片标题共用）。 */
function sectionCount(section: ProfileSection): string {
  if (section.kind === "mixed") return `${section.blocks.length} 组内容`
  return section.kind === "table" ? `${section.rows.length} 行` : `${section.items.length} 条`
}

/**
 * 按分区标题语义附加样式类，让专属模板能针对不同领域出彩
 * （例：力量体系的「等级阶梯」「代价矩阵」），而无需改动数据模型。
 */
export function profileSectionExtraClass(heading: string): string {
  const text = heading.trim()
  const classes: string[] = []
  if (/等级|阶|境界|段位|层级|梯/.test(text)) classes.push("ladder")
  if (/代价|消耗|限制|反制|约束|禁忌|风险|过期|隐患/.test(text)) classes.push("matrix")
  if (/关系|出场|外部|派系|成员|人物|人员|编制|架构|部门|职位|流派/.test(text)) classes.push("roster")
  if (/伏笔|线索|埋设|悬念/.test(text)) classes.push("threads")
  if (/回收|兑现/.test(text)) classes.push("payoff")
  if (/解锁|技能|面板|系统/.test(text)) classes.push("unlock")
  if (/区域|地理|地图|地域|分布|环境/.test(text)) classes.push("map")
  if (/地点|场景|密室|据点|坐标|场所|遗迹|秘境|空间|事件|资源|入口|出口/.test(text)) classes.push("place")
  if (/世界观|背景|时代|文化|历史|沿革|习俗|文明|信仰|传说|神话|社会|制度|规则|法则/.test(text)) classes.push("lore")
  return classes.length > 0 ? ` ${classes.join(" ")}` : ""
}

/** 常见状态/等级枚举 → 徽章配色（内联样式，模板无需额外 CSS）。 */
const STATUS_BADGES: Array<{ pattern: RegExp; tone: "ok" | "warn" | "danger" }> = [
  { pattern: /^(已回收|已兑现|已完成|已埋|已收|已解决|已埋伏)$/, tone: "ok" },
  { pattern: /^(推进中|进行中|待回收|未回收|未兑现|部分回收|部分兑现|埋设中)$/, tone: "warn" },
  { pattern: /^(已过期|未埋|未完成|已放弃|超期|断线)$/, tone: "danger" },
  { pattern: /^高$/, tone: "danger" },
  { pattern: /^中$/, tone: "warn" },
  { pattern: /^低$/, tone: "ok" },
]

const BADGE_TONES = {
  ok: { bg: "var(--ok-soft)", fg: "var(--ok)", bd: "var(--ok-border)" },
  warn: { bg: "var(--warn-soft)", fg: "var(--warn)", bd: "var(--he)" },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)", bd: "var(--danger-border)" },
} as const

/** 单元格渲染：命中状态枚举时套一个带内联样式的徽章，否则普通转义。 */
function renderCell(cell: string): string {
  const text = cell.trim()
  const badge = STATUS_BADGES.find((item) => item.pattern.test(text))
  if (!badge) return escapeHtml(cell)
  const tone = BADGE_TONES[badge.tone]
  return `<span style="display:inline-block;font-size:11px;line-height:1.5;border-radius:999px;padding:1px 9px;background:${tone.bg};color:${tone.fg};border:1px solid ${tone.bd}">${escapeHtml(text)}</span>`
}

function buildSectionsHtml(doc: ProfileDocument, editorial = false): string {
  if (doc.sections.length === 0) return `<p class="empty">未包含档案数据（sections 为空），请重新生成。</p>`
  return doc.sections.map((section, index) => {
    const wide = section.kind === "table" || section.kind === "mixed" ? " wide" : ""
    const extra = profileSectionExtraClass(section.heading)
    const anchor = `psec-${index + 1}`
    return `<section class="pcard${wide}${extra}" id="${anchor}"><details open><summary><h3><span class="no">${index + 1}</span>${escapeHtml(section.heading || `分区 ${index + 1}`)}<span class="pn">${sectionCount(section)}</span></h3></summary><div class="section-body">${sectionBody(section, editorial)}</div></details></section>`
  }).join("")
}

function buildChipsHtml(doc: ProfileDocument): string {
  const chips: string[] = []
  if (hasVisibleText(doc.tag)) chips.push(`<span class="chip"><b>${escapeHtml(doc.tag ?? "")}</b></span>`)
  chips.push(`<span class="chip"><b>${doc.sections.length}</b> 个分区 · 正文写作参考</span>`)
  return chips.join("")
}

/**
 * 用户明确要求删掉档案文档左侧的「分区导航」：
 * 十个分区的卡片本来就是一条从上到下、折叠展开的长条，左侧那栏既占 200px
 * 版面，又要额外维护一套 sticky 定位与窄屏折行规则，实际用不上。
 *
 * 因此 `overview` 槽位**保留但不再产出内容**：
 *   · 8 个模板里的 `<aside class="profile-rail">…</aside>` 已整块删除，
 *     版面改成单栏，不再有左栏；
 *   · 仍然映射占位符 → 空串，这样**用户自定义模板**（`.qmai/人物小传模板.html` 等）
 *     里若还留着 `__PROFILE_OVERVIEW__`，也不会把占位符原文漏到页面上；
 *   · `overview` 同时从 REQUIRED_PLACEHOLDERS 移除 —— 模板不必再提供这个槽位。
 *
 * 为什么不在这里塞一段 `<style>` 去隐藏左栏：那属于「藏起来」而不是「删掉」，
 * 与本次要求相反；模板已经真的没有这个元素了。
 */
function buildOverviewHtml(): string {
  return ""
}

/** 用模板渲染档案 HTML（纯静态，0 脚本）。 */
export function renderProfileDocumentHtml(
  doc: ProfileDocument,
  template: string,
  eyebrow: string,
): string {
  const editorial = template.includes('data-qmai-layout="editorial-v2"')
  // 徽章只在有可见文字时渲染：避免 tag 里是零宽字符 / 只有 `**` 时出现「空白胶囊」
  const tagHtml = hasVisibleText(doc.tag) ? `<span class="role">${escapeHtml(doc.tag ?? "")}</span>` : ""
  const placeholders: Record<string, string> = {
    [PROFILE_PLACEHOLDERS.eyebrow]: escapeHtml(eyebrow),
    [PROFILE_PLACEHOLDERS.name]: escapeHtml(doc.name || "未命名"),
    [PROFILE_PLACEHOLDERS.tag]: tagHtml,
    [PROFILE_PLACEHOLDERS.chips]: buildChipsHtml(doc),
    [PROFILE_PLACEHOLDERS.tagline]: hasVisibleText(doc.tagline) ? escapeHtml(doc.tagline ?? "") : "",
    [PROFILE_PLACEHOLDERS.overview]: buildOverviewHtml(),
    [PROFILE_PLACEHOLDERS.sections]: buildSectionsHtml(doc, editorial),
    [PROFILE_PLACEHOLDERS.diagram]: doc.diagram ? renderProfileDiagram(doc.diagram) : "",
    [PROFILE_PLACEHOLDERS.title]: escapeHtml(`${doc.name || "未命名"} · ${eyebrow}`),
  }
  return Object.entries(placeholders).reduce(
    (html, [placeholder, value]) => html.replace(placeholder, () => value),
    template,
  )
}

// ---------------------------------------------------------------------------
// 模板运行时（项目覆盖 → 程序 skills 目录 → 内置）
// ---------------------------------------------------------------------------

export interface ProfileTemplateRuntime {
  getTemplate: () => string
  resetForTest: () => void
  prime: (projectPath?: string | null) => Promise<void>
  ready: boolean
}

async function resolveRuntimeDirs(): Promise<string[]> {
  const dirs: string[] = []
  try { dirs.push(normalizePath(await getExecutableDir())) } catch { /* 非 Tauri 环境忽略 */ }
  try { dirs.push(normalizePath(await getResourceDir())) } catch { /* 同上 */ }
  return dirs
}

export function createProfileTemplateRuntime(input: {
  templateHtml: string
  /** 程序运行目录下的模板相对路径（便携版 / 安装版通用） */
  relativePaths: string[]
  /** 项目内可覆盖模板的相对路径 */
  projectOverride: string
}): ProfileTemplateRuntime {
  let activeTemplate: string | null = null
  return {
    ready: REQUIRED_PLACEHOLDERS.every((placeholder) => input.templateHtml.includes(placeholder)),
    getTemplate: () => activeTemplate ?? input.templateHtml,
    resetForTest: () => { activeTemplate = null },
    prime: async (projectPath?: string | null) => {
      const candidates: string[] = []
      if (projectPath?.trim()) candidates.push(`${normalizePath(projectPath)}/${input.projectOverride}`)
      for (const dir of await resolveRuntimeDirs()) {
        for (const relative of input.relativePaths) candidates.push(`${dir}/${relative}`)
      }
      for (const candidate of candidates) {
        try {
          if (!(await fileExists(candidate))) continue
          const content = await readFile(candidate)
          if (REQUIRED_PLACEHOLDERS.every((placeholder) => content.includes(placeholder))) {
            activeTemplate = content
            return
          }
        } catch { /* 单个候选失败继续 */ }
      }
      activeTemplate = null
    },
  }
}
