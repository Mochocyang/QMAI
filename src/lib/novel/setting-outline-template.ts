import { SETTING_PROFILE_SECTIONS } from "./setting-profile-contracts"
/**
 * 设定类大纲的**通用「设定卡片流」**渲染 + 分项规格表（方案 B：系统套模板）。
 *
 * 现状：8 类设定分项（人物小传 / 组织势力 / 力量体系 / 金手指 / 背景设定 / 地理设定 /
 * 伏笔计划 / 地点设定）**各自已有专属模板**（见 character-profile-template.ts、
 * faction-profile-template.ts、power-system-template.ts、golden-finger-template.ts、
 * background-setting-template.ts、geography-setting-template.ts、
 * foreshadowing-plan-template.ts、location-setting-template.ts）。
 * 本模块现在承担两件事：
 * 1. `SETTING_OUTLINE_SPECS` —— 供子类型推断（`resolveSettingSpecByTitle` /
 *    `resolveSettingSpecForRequest`）与提示词分支复用；
 * 2. **兜底渲染** —— 当 fileType=setting 未命中任何专属子类型时，用卡片流渲染。
 *
 * - 主路径：AI 在回复里附带一个 ```json 围栏（顶层 settingOutlineData），软件套
 *   技能目录下的 template.html 渲染出自包含 HTML 卡片流（无脚本，可在 sandbox iframe 内渲染）。
 * - 兜底路径：AI 未给结构化数据时，用 settingOutlineDataFromMarkdown 从 MD 正文
 *   标题/列表解析出同款结构。
 */

import templateHtml from "../../../skills/SkillHub/SheDingSkill/setting-cards/template.html?raw"
import { fileExists, getExecutableDir, getResourceDir, readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

/** 卡片内的一条：可带字段名（渲染成键值行）或纯文本（渲染成列表项）。 */
export interface SettingCardItem {
  label?: string
  text: string
}

export interface SettingCardSection {
  heading: string
  items: SettingCardItem[]
}

export interface SettingCard {
  /** 摘要行左侧徽标（如「男主」「门派」） */
  badge?: string
  title: string
  subtitle?: string
  tags?: string[]
  sections: SettingCardSection[]
}

export interface SettingOutlineData {
  eyebrow?: string
  title: string
  intro?: string
  chips?: string[]
  cards: SettingCard[]
}

/** 一个设定分项的展示规格（供 prompt 与兜底渲染共用）。 */
export interface SettingOutlineSpec {
  /** 与 OUTLINE_SECTION_GENERATION_CONFIGS.key 对应的稳定标识 */
  id: string
  /** 头部小标题 */
  eyebrow: string
  /** 默认文档标题 */
  title: string
  /** 匹配该分项的正文标题关键词 */
  titleMatches: string[]
  /** 建议分区（heading + 字段提示），用于引导 AI 输出结构化数据 */
  sections: Array<{ heading: string; hint: string }>
}

/** 8 类设定分项的规格表。 */
export const SETTING_OUTLINE_SPECS: SettingOutlineSpec[] = [
  {
    id: "characterBriefs",
    eyebrow: "人物小传 · 卡片流",
    title: "人物小传",
    titleMatches: ["人物小传", "人物", "角色"],
    sections: SETTING_PROFILE_SECTIONS.characterBriefs,
  },
  {
    id: "organizationsOutline",
    eyebrow: "组织势力 · 卡片流",
    title: "组织势力设定",
    titleMatches: ["组织", "势力", "阵营", "门派", "家族"],
    sections: SETTING_PROFILE_SECTIONS.organizationsOutline,
  },
  {
    id: "powerSystem",
    eyebrow: "力量体系 · 卡片流",
    title: "力量体系",
    titleMatches: ["力量体系", "能力体系", "修炼体系", "体系"],
    sections: SETTING_PROFILE_SECTIONS.powerSystem,
  },
  {
    id: "goldenFinger",
    eyebrow: "金手指设定 · 卡片流",
    title: "金手指设定",
    titleMatches: ["金手指", "系统", "外挂", "能力"],
    sections: SETTING_PROFILE_SECTIONS.goldenFinger,
  },
  {
    id: "backgroundSetting",
    eyebrow: "背景设定 · 卡片流",
    title: "背景设定",
    titleMatches: ["背景设定", "世界观", "时代", "背景"],
    sections: SETTING_PROFILE_SECTIONS.backgroundSetting,
  },
  {
    id: "geographySetting",
    eyebrow: "地理设定 · 卡片流",
    title: "地理设定",
    titleMatches: ["地理设定", "地理", "地图", "区域"],
    sections: SETTING_PROFILE_SECTIONS.geographySetting,
  },
  {
    id: "foreshadowingPlan",
    eyebrow: "伏笔计划 · 卡片流",
    title: "伏笔计划",
    titleMatches: ["伏笔"],
    sections: SETTING_PROFILE_SECTIONS.foreshadowingPlan,
  },
  {
    id: "locationsOutline",
    eyebrow: "地点设定 · 卡片流",
    title: "地点设定",
    titleMatches: ["地点"],
    sections: SETTING_PROFILE_SECTIONS.locationsOutline,
  },
]

/** fileType → 兜底使用的规格（用于 attach 时确定头部小标题）。 */
/** 通用兜底规格：fileType 无法细分到具体分项时使用，避免张冠李戴的 eyebrow。 */
const GENERIC_SETTING_SPEC: SettingOutlineSpec = {
  id: "generic-setting",
  eyebrow: "设定 · 卡片流",
  title: "设定",
  titleMatches: [],
  sections: [],
}
const GENERIC_OUTLINE_SPEC: SettingOutlineSpec = {
  id: "generic-outline",
  eyebrow: "大纲 · 卡片流",
  title: "大纲",
  titleMatches: [],
  sections: [],
}

/*
 * 卷纲/章纲/质量检查的**中性兜底规格**。
 *
 * 这三种类型各有专用渲染器（折叠树 / 17 节卡片流），但都必须依赖可解析的结构化 JSON；
 * 拿不到结构化数据时，旧行为是「干脆不出 HTML」——后果是保存框的「HTML 形式」永久置灰，
 * 用户根本无法保存 HTML 版本，而「从大纲继续生成章纲」这条路径恰恰必然落在这种情况。
 *
 * 兜底时**必须**用该类型自己的标题：若一律退化成「设定 · 卡片流」，一份章纲会被冠上
 * 「设定」的标题，等于用错误标签换取「有 HTML」，比没有更糟。
 */
const NEUTRAL_OUTLINE_SPECS: Record<string, SettingOutlineSpec> = {
  "chapter-outline": {
    id: "neutral-chapter-outline",
    eyebrow: "章纲 · 卡片流",
    title: "章纲",
    titleMatches: [],
    sections: [],
  },
  "volume-outline": {
    id: "neutral-volume-outline",
    eyebrow: "卷纲 · 卡片流",
    title: "卷纲",
    titleMatches: [],
    sections: [],
  },
  "quality-report": {
    id: "neutral-quality-report",
    eyebrow: "质量检查 · 卡片流",
    title: "质量检查",
    titleMatches: [],
    sections: [],
  },
}

/** 该大纲类型的中性兜底规格（不在表内的类型回落到按 fileType 取的通用规格）。 */
export function resolveNeutralOutlineSpec(fileType: string): SettingOutlineSpec {
  return NEUTRAL_OUTLINE_SPECS[fileType] ?? resolveSettingSpecByFileType(fileType)
}

const SETTING_SPEC_BY_FILE_TYPE: Record<string, string> = {
  character: "characterBriefs",
  organization: "organizationsOutline",
  foreshadowing: "foreshadowingPlan",
  setting: GENERIC_SETTING_SPEC.id,
  outline: GENERIC_OUTLINE_SPEC.id,
}

/** 这些 fileType 走设定卡片流渲染（卷纲/章纲有各自专用渲染）。 */
export function isSettingOutlineFileType(fileType: string): boolean {
  return Object.prototype.hasOwnProperty.call(SETTING_SPEC_BY_FILE_TYPE, fileType)
}

/** 按正文标题匹配分项规格（用于生成 prompt 时给出结构化分区要求）。 */
export function resolveSettingSpecByTitle(title: string): SettingOutlineSpec | null {
  const text = title.trim()
  if (!text) return null
  for (const spec of SETTING_OUTLINE_SPECS) {
    if (spec.titleMatches.some((keyword) => text.includes(keyword))) return spec
  }
  return null
}

function specById(id: string): SettingOutlineSpec | null {
  if (id === GENERIC_SETTING_SPEC.id) return GENERIC_SETTING_SPEC
  if (id === GENERIC_OUTLINE_SPEC.id) return GENERIC_OUTLINE_SPEC
  return SETTING_OUTLINE_SPECS.find((spec) => spec.id === id) ?? null
}

/** 按 fileType 取兜底规格（永远不会 null）。 */
export function resolveSettingSpecByFileType(fileType: string): SettingOutlineSpec {
  return specById(SETTING_SPEC_BY_FILE_TYPE[fileType] ?? GENERIC_SETTING_SPEC.id) ?? GENERIC_SETTING_SPEC
}

function firstHeading(content: string): string {
  const match = content.match(/^\s*#{1,6}\s+(.+?)\s*$/m)
  return match ? match[1].trim() : ""
}

/**
 * 综合推断某个保存请求应使用的分项规格：
 * 结构化数据标题 → 正文首个标题 → 文件名 → 目标文件夹 → fileType 兜底。
 * 因为 fileType 只区分 character/organization/foreshadowing/setting，
 * 力量体系/金手指/背景设定/地理设定/地点设定都落在 setting，必须靠上面这些线索细分。
 */
export function resolveSettingSpecForRequest(input: {
  fileType: string
  fileName?: string
  targetFolder?: string
  sourceIntent?: string
  content?: string
  dataTitle?: string
}): SettingOutlineSpec {
  const candidates = [
    input.dataTitle,
    firstHeading(input.content ?? ""),
    input.fileName?.replace(/\.md$/i, ""),
    input.sourceIntent,
    input.targetFolder,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const matched = resolveSettingSpecByTitle(candidate)
    if (matched) return matched
  }
  return resolveSettingSpecByFileType(input.fileType)
}

// ---------------------------------------------------------------------------
// 模板运行时（与卷纲/章纲同款三级回退：项目覆盖 → 程序 skills 目录 → 内置）
// ---------------------------------------------------------------------------

const EYEBROW_PLACEHOLDER = "__SETTING_EYEBROW__"
const TITLE_PLACEHOLDER = "__SETTING_TITLE__"
const INTRO_PLACEHOLDER = "__SETTING_INTRO__"
const CHIPS_PLACEHOLDER = "__SETTING_CHIPS__"
const OVERVIEW_PLACEHOLDER = "__SETTING_OVERVIEW__"
const NAV_PLACEHOLDER = "__SETTING_NAV__"
const CARDS_PLACEHOLDER = "__SETTING_CARDS__"
const REQUIRED_PLACEHOLDERS = [
  EYEBROW_PLACEHOLDER,
  TITLE_PLACEHOLDER,
  INTRO_PLACEHOLDER,
  CHIPS_PLACEHOLDER,
  OVERVIEW_PLACEHOLDER,
  NAV_PLACEHOLDER,
  CARDS_PLACEHOLDER,
]

/** 程序运行目录下的模板相对路径（便携版 / 安装版通用）。 */
const TEMPLATE_RELATIVE_PATHS = [
  "skills/SkillHub/SheDingSkill/setting-cards/template.html",
  "_up_/skills/SkillHub/SheDingSkill/setting-cards/template.html",
]

/** 项目内可覆盖模板的相对路径（用户在项目里改样式，改完立即生效）。 */
const PROJECT_OVERRIDE_RELATIVE_PATH = ".qmai/设定卡片流模板.html"

let activeTemplate: string | null = null

/** 取当前生效的模板内容（默认内置模板）。 */
export function getSettingOutlineTemplate(): string {
  return activeTemplate ?? templateHtml
}

/** 供测试重置运行时模板状态。 */
export function resetSettingOutlineTemplateForTest(): void {
  activeTemplate = null
}

async function resolveRuntimeDirs(): Promise<string[]> {
  const dirs: string[] = []
  try {
    dirs.push(normalizePath(await getExecutableDir()))
  } catch {
    // 非 Tauri 环境（浏览器/测试）没有可执行目录，忽略
  }
  try {
    dirs.push(normalizePath(await getResourceDir()))
  } catch {
    // 同上
  }
  return dirs
}

/**
 * 预加载运行时模板：优先项目目录覆盖，其次程序 skills 目录，最后回退内置模板。
 * 读取失败或内容缺少占位符时静默回退，不影响主流程。
 */
export async function primeSettingOutlineTemplate(projectPath?: string | null): Promise<void> {
  const candidates: string[] = []
  if (projectPath?.trim()) {
    candidates.push(`${normalizePath(projectPath)}/${PROJECT_OVERRIDE_RELATIVE_PATH}`)
  }
  for (const dir of await resolveRuntimeDirs()) {
    for (const relative of TEMPLATE_RELATIVE_PATHS) {
      candidates.push(`${dir}/${relative}`)
    }
  }

  for (const candidate of candidates) {
    try {
      if (!(await fileExists(candidate))) continue
      const content = await readFile(candidate)
      if (REQUIRED_PLACEHOLDERS.every((placeholder) => content.includes(placeholder))) {
        activeTemplate = content
        return
      }
    } catch {
      // 单个候选读取失败继续尝试下一个
    }
  }
  activeTemplate = null
}

/** 供测试使用：内置模板是否包含全部占位符。 */
export const SETTING_OUTLINE_TEMPLATE_READY = REQUIRED_PLACEHOLDERS.every((placeholder) =>
  templateHtml.includes(placeholder))

// ---------------------------------------------------------------------------
// 归一化 / 解析
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asString(value: unknown): string {
  // JSON 路径与 MD 路径做同样的行内清洗：AI 在 ```json 的字符串里也会写
  // `**加粗**`（甚至不成对的半个 `**`），不清会原样显示在卡片上。
  return typeof value === "string" ? cleanInlineMarkdown(value) : ""
}

function asStringArray(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => asString(item))
    .filter(Boolean)
}

function normalizeItem(raw: unknown): SettingCardItem | null {
  if (typeof raw === "string") {
    const text = cleanInlineMarkdown(raw)
    return text ? { text } : null
  }
  if (!isRecord(raw)) return null
  const label = asString(raw.label ?? raw.k ?? raw.name ?? raw.field)
  const text = asString(raw.text ?? raw.value ?? raw.v ?? raw.content)
  if (!label && !text) return null
  return { ...(label ? { label } : {}), text }
}

function normalizeSection(raw: unknown): SettingCardSection | null {
  if (!isRecord(raw)) return null
  const heading = asString(raw.heading ?? raw.title ?? raw.name)
  const rawItems = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.rows)
      ? raw.rows
      : []
  const items = rawItems.map(normalizeItem).filter((item): item is SettingCardItem => Boolean(item))
  if (!heading && items.length === 0) return null
  return { heading: heading || "说明", items }
}

function normalizeCard(raw: unknown): SettingCard | null {
  if (!isRecord(raw)) return null
  const title = asString(raw.title ?? raw.name)
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map(normalizeSection)
    .filter((section): section is SettingCardSection => Boolean(section))
  if (!title && sections.length === 0) return null
  const badge = asString(raw.badge ?? raw.tag ?? raw.role ?? raw.type)
  const subtitle = asString(raw.subtitle ?? raw.summary ?? raw.desc ?? raw.description)
  const tags = asStringArray(raw.tags)
  return {
    ...(badge ? { badge } : {}),
    title: title || "未命名",
    ...(subtitle ? { subtitle } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    sections,
  }
}

/** 归一化 AI 输出的设定结构化数据（容错：字段缺失取空、类型不符丢弃）。 */
export function normalizeSettingOutlineData(raw: unknown): SettingOutlineData | null {
  if (!isRecord(raw)) return null
  const payload = isRecord(raw.settingOutlineData) ? raw.settingOutlineData : raw
  const cards = (Array.isArray(payload.cards) ? payload.cards : [])
    .map(normalizeCard)
    .filter((card): card is SettingCard => Boolean(card))
  if (cards.length === 0) return null
  const eyebrow = asString(payload.eyebrow)
  const title = asString(payload.title)
  const intro = asString(payload.intro ?? payload.summary ?? payload.description)
  const chips = asStringArray(payload.chips)
  return {
    ...(eyebrow ? { eyebrow } : {}),
    title: title || "设定",
    ...(intro ? { intro } : {}),
    ...(chips.length > 0 ? { chips } : {}),
    cards,
  }
}

/** 从 AI 原文中解析 settingOutlineData（扫描所有 json 围栏 + 裸对象）。 */
export function extractSettingOutlineData(text: string): SettingOutlineData | null {
  if (!text) return null
  const candidates: string[] = []
  const fencePattern = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi
  for (const match of text.matchAll(fencePattern)) {
    const block = match[1].trim()
    if (block.includes("settingOutlineData") || block.startsWith("{")) candidates.push(block)
  }
  // 无围栏时尝试整个文本里的最后一个平衡对象
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) candidates.push(trimmed)

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate)
    if (!parsed) continue
    const data = normalizeSettingOutlineData(parsed)
    if (data) return data
  }
  return null
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

// ---------------------------------------------------------------------------
// Markdown → 结构化（兜底路径）
// ---------------------------------------------------------------------------

function stripFrontmatter(md: string): string {
  return md.replace(/^\uFEFF?---\s*\n[\s\S]*?\n---\s*\n?/, "").trim()
}

function cleanInlineMarkdown(value: string): string {
  const paired = value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  // 不成对残留兜底：AI 常写 `**标签：** 正文`（冒号在加粗对内部），拆开后各剩半个
  // `**`，成对正则处理不了，会原样显示在卡片上。中文正文里孤立的星号/下划线串
  // 几乎不可能是正常内容，直接清除。
  return paired
    .replace(/\*{2,}/g, "")
    .replace(/_{2,}/g, "")
    .replace(/^\s*\*\s*/, "")
    .replace(/\s*\*\s*$/, "")
    .replace(/^\s*_\s*/, "")
    .replace(/\s*_\s*$/, "")
    .replace(/^#+\s*/, "")
    .replace(/^[-*+]\s+/, "")
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
    if (match) headings.push({ level: match[1].length, text: cleanInlineMarkdown(match[2]), index })
  })
  return headings
}

/** 是否是 Markdown 表格行（以 | 开头结尾）。 */
function isTableRow(line: string): boolean {
  return /^\|.*\|$/.test(line)
}

function splitTableCells(line: string): string[] {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cleanInlineMarkdown(cell).trim())
}

function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))
}

/** 把一段文本切成条目：表格行 → 首列作 label、其余列拼成文本；列表项 → 文本；`字段：值` → 带 label 的条目；其余按空行分段。 */
function parseItems(block: string): SettingCardItem[] {
  const items: SettingCardItem[] = []
  const lines = block.split(/\r?\n/)
  let buffer: string[] = []
  let table: string[] = []

  const flush = () => {
    const text = cleanInlineMarkdown(buffer.join(" ")).trim()
    buffer = []
    if (!text) return
    const fieldMatch = text.match(/^([^：:]{1,16})[：:]\s*(.+)$/)
    if (fieldMatch && fieldMatch[2].trim()) {
      items.push({ label: fieldMatch[1].trim(), text: fieldMatch[2].trim() })
    } else {
      items.push({ text })
    }
  }

  const flushTable = () => {
    if (table.length === 0) return
    const rows = table.map(splitTableCells)
    table = []
    const first = rows[0]
    const hasHeader = !isTableSeparator(first)
    const head = hasHeader ? first : []
    const body = (hasHeader ? rows.slice(1) : rows).filter((cells) => !isTableSeparator(cells))
    for (const cells of body) {
      const label = cells[0] ?? ""
      const rest = cells
        .slice(1)
        .map((cell, index) => {
          const heading = head[index + 1]
          return heading ? `${heading}：${cell}` : cell
        })
        .filter(Boolean)
        .join(" · ")
      if (!label && !rest) continue
      if (!rest) items.push({ text: label })
      else items.push({ ...(label ? { label } : {}), text: rest })
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
      flushTable()
      continue
    }
    if (isTableRow(trimmed)) {
      flush()
      table.push(trimmed)
      continue
    }
    flushTable()
    const listMatch = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (listMatch) {
      flush()
      const text = cleanInlineMarkdown(listMatch[1]).trim()
      if (text) items.push({ text })
      continue
    }
    // 独立的「字段：值」行各自成条，避免与相邻字段被并成一段
    const fieldMatch = trimmed.match(/^([^：:]{1,16})[：:]\s*(.+)$/)
    if (fieldMatch && fieldMatch[2].trim()) {
      flush()
      items.push({ label: cleanInlineMarkdown(fieldMatch[1]).trim(), text: cleanInlineMarkdown(fieldMatch[2]).trim() })
      continue
    }
    buffer.push(trimmed)
  }
  flush()
  flushTable()
  return items
}

function buildSectionsFromLines(lines: string[], start: number, end: number): SettingCardSection[] {
  const slice = lines.slice(start, end)
  const headings = collectHeadings(slice)
  const sections: SettingCardSection[] = []

  const preamble = slice.slice(0, headings.length ? headings[0].index : slice.length).join("\n")
  const preambleItems = parseItems(preamble)

  if (headings.length === 0) {
    if (preambleItems.length > 0) sections.push({ heading: "说明", items: preambleItems })
    return sections
  }

  if (preambleItems.length > 0) sections.push({ heading: "概述", items: preambleItems })

  headings.forEach((heading, i) => {
    const from = heading.index + 1
    const to = i + 1 < headings.length ? headings[i + 1].index : slice.length
    const items = parseItems(slice.slice(from, to).join("\n"))
    if (items.length > 0) sections.push({ heading: heading.text || `分区 ${i + 1}`, items })
  })
  return sections
}

/**
 * 从 MD 正文解析出设定卡片数据（兜底路径）。
 * 以最浅的标题层级作为卡片分隔，次浅层级作为分区。
 */
export function settingOutlineDataFromMarkdown(md: string, spec?: SettingOutlineSpec | null): SettingOutlineData | null {
  const body = stripFrontmatter(md)
  if (!body) return null
  const lines = body.split(/\r?\n/)
  const headings = collectHeadings(lines)
  const fallbackSpec = spec ?? null
  const baseTitle = fallbackSpec?.title ?? "设定"

  if (headings.length === 0) {
    const items = parseItems(body)
    if (items.length === 0) return null
    return {
      title: baseTitle,
      cards: [{ title: baseTitle, sections: [{ heading: "说明", items }] }],
    }
  }

  const cardLevel = Math.min(...headings.map((heading) => heading.level))
  const cardHeadings = headings.filter((heading) => heading.level === cardLevel)

  const cards: SettingCard[] = []
  const leading = lines.slice(0, cardHeadings[0].index).join("\n")
  const leadingItems = parseItems(leading)
  if (leadingItems.length > 0) {
    cards.push({ title: baseTitle, sections: [{ heading: "概述", items: leadingItems }] })
  }

  cardHeadings.forEach((heading, i) => {
    const end = i + 1 < cardHeadings.length ? cardHeadings[i + 1].index : lines.length
    const sections = buildSectionsFromLines(lines, heading.index + 1, end)
    if (sections.length > 0) {
      cards.push({ title: heading.text || baseTitle, sections })
    }
  })

  if (cards.length === 0) return null
  return { title: baseTitle, cards }
}

// ---------------------------------------------------------------------------
// HTML 渲染
// ---------------------------------------------------------------------------

function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function panelSection(title: string, note: string, body: string): string {
  const noteHtml = note ? `<span class="pn">${escapeHtml(note)}</span>` : ""
  return `<section class="panel"><h2>${escapeHtml(title)}${noteHtml}</h2>${body}</section>`
}

function kvRow(label: string, value: string): string {
  const text = value.trim() || "—"
  return `<div class="kv"><span class="kk">${escapeHtml(label)}</span><span class="vv">${escapeHtml(text)}</span></div>`
}

function listBlock(items: string[]): string {
  if (items.length === 0) return `<p class="hint">未填</p>`
  return `<ul class="clist">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
}

function chipsHtml(chips: string[]): string {
  return chips
    .map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`)
    .join("")
}

function sectionBody(section: SettingCardSection): string {
  const items = section.items.filter((item) => (item.text ?? "").trim() || (item.label ?? "").trim())
  if (items.length === 0) return `<p class="hint">未填</p>`
  const hasLabel = items.some((item) => (item.label ?? "").trim())
  if (!hasLabel) return listBlock(items.map((item) => item.text))
  return items.map((item) => kvRow(item.label ?? "", item.text)).join("")
}

function cardHtml(card: SettingCard, index: number): string {
  const anchor = `setting-card-${index + 1}`
  const summary = [
    `<span class="cno">${escapeHtml(card.badge || String(index + 1))}</span>`,
    `<span class="ct">${escapeHtml(card.title || "未命名")}</span>`,
    ...(card.tags ?? []).map((tag) => `<span class="tag chap">${escapeHtml(tag)}</span>`),
    card.subtitle ? `<span class="cgoal">${escapeHtml(card.subtitle)}</span>` : "",
  ].filter(Boolean).join("")
  const body = card.sections
    .map((section) => `<div class="csec"><h4>${escapeHtml(section.heading)}</h4>${sectionBody(section)}</div>`)
    .join("")
  return `<details class="cc" id="${anchor}"${index === 0 ? " open" : ""}><summary>${summary}</summary><div class="cbody">${body}</div></details>`
}

function buildCardsHtml(data: SettingOutlineData): string {
  if (data.cards.length === 0) {
    return `<p class="empty">未包含设定数据（cards 为空），请重新生成。</p>`
  }
  return data.cards.map((card, index) => cardHtml(card, index)).join("")
}

function buildOverviewHtml(data: SettingOutlineData): string {
  const sectionCount = data.cards.reduce((sum, card) => sum + card.sections.length, 0)
  const itemCount = data.cards.reduce(
    (sum, card) => sum + card.sections.reduce((inner, section) => inner + section.items.length, 0),
    0,
  )
  const chips = [
    `<span class="chip"><b>${data.cards.length}</b> 张卡片</span>`,
    `<span class="chip"><b>${sectionCount}</b> 个分区</span>`,
    `<span class="chip"><b>${itemCount}</b> 条信息</span>`,
  ].join("")
  const rows = data.cards
    .map((card, index) =>
      kvRow(card.badge || `#${index + 1}`, `${card.title}${card.subtitle ? `　${card.subtitle}` : ""}`))
    .join("")
  return panelSection("总览", `${data.cards.length} 张卡片`, `<div class="chips">${chips}</div>${rows}`)
}

function buildNavHtml(data: SettingOutlineData): string {
  if (data.cards.length <= 1) return ""
  const links = data.cards
    .map((card, index) =>
      `<a class="navlink" href="#setting-card-${index + 1}"><b>${index + 1}</b>${escapeHtml(card.title || "未命名")}</a>`)
    .join("")
  return `<nav class="nav"><span class="navt">跳到卡片</span>${links}</nav>`
}

/** 用模板渲染设定卡片流 HTML（纯静态，0 脚本）。 */
export function renderSettingOutlineHtml(
  data: SettingOutlineData,
  template: string = getSettingOutlineTemplate(),
): string {
  const placeholders: Record<string, string> = {
    [EYEBROW_PLACEHOLDER]: escapeHtml(data.eyebrow || "设定卡片流"),
    [TITLE_PLACEHOLDER]: escapeHtml(data.title || "设定"),
    [INTRO_PLACEHOLDER]: escapeHtml(data.intro || ""),
    [CHIPS_PLACEHOLDER]: chipsHtml(data.chips ?? []),
    [OVERVIEW_PLACEHOLDER]: buildOverviewHtml(data),
    [NAV_PLACEHOLDER]: buildNavHtml(data),
    [CARDS_PLACEHOLDER]: buildCardsHtml(data),
  }
  // 用函数替换器，避免内容里的 $& / $1 等被当作替换模式
  return Object.entries(placeholders).reduce(
    (html, [placeholder, value]) => html.replace(placeholder, () => value),
    template,
  )
}

/** 合并兜底元信息（eyebrow/title）后渲染 HTML。 */
function renderWithSpec(data: SettingOutlineData, spec: SettingOutlineSpec): string {
  const withMeta: SettingOutlineData = {
    eyebrow: data.eyebrow || spec.eyebrow,
    title: data.title || spec.title,
    ...(data.intro ? { intro: data.intro } : {}),
    ...(data.chips ? { chips: data.chips } : {}),
    cards: data.cards,
  }
  return renderSettingOutlineHtml(withMeta)
}

/**
 * 用**指定规格**把 MD 正文渲染成卡片流 HTML；解析不出任何卡片时返回 null。
 *
 * 与 `renderSettingOutlineForContent` 的区别：那个自己推断规格，这个由调用方指定 ——
 * 兜底渲染需要「该大纲类型自己的标题」而不是推断出来的（推断结果可能是中性「设定」）。
 */
export function renderCardFlowForSpec(content: string, spec: SettingOutlineSpec): string | null {
  const data = settingOutlineDataFromMarkdown(content, spec)
  return data ? renderWithSpec(data, spec) : null
}

/**
 * 直接从 MD 正文生成设定卡片流 HTML（用于「人物小传」多 Agent 等只产出 MD 的路径）。
 * 无法解析出卡片时返回 null。
 */
export function renderSettingOutlineForContent(content: string, fileType: string): string | null {
  const spec = resolveSettingSpecForRequest({ fileType, content })
  const data = settingOutlineDataFromMarkdown(content, spec)
  return data ? renderWithSpec(data, spec) : null
}

/**
 * 给设定类保存请求补上 htmlContent：
 * - 单卡片场景优先用 AI 原文的 settingOutlineData（结构更干净）；
 * - 多卡片场景（per_item 批量，一个回复拆成多个文件）改用该文件自己的 MD 正文解析，
 *   避免每个文件都拿到整批卡片；
 * - 已有真正的 HTML 文档时保留原 HTML。非设定类请求原样返回。
 */
export function attachSettingOutlineHtml<
  T extends {
    fileType: string
    htmlContent?: string
    content: string
    fileName?: string
    targetFolder?: string
    sourceIntent?: string
  },
>(request: T, sourceText: string): T {
  if (!isSettingOutlineFileType(request.fileType)) return request
  const existing = request.htmlContent?.trim() ?? ""
  if (/<html[\s>]/i.test(existing)) return request

  const jsonData = extractSettingOutlineData(sourceText)
  const base = {
    fileType: request.fileType,
    fileName: request.fileName,
    targetFolder: request.targetFolder,
    sourceIntent: request.sourceIntent,
    content: request.content,
  }
  const mdSpec = resolveSettingSpecForRequest({ ...base, dataTitle: jsonData?.title })
  const mdData = settingOutlineDataFromMarkdown(request.content, mdSpec)
  const data = jsonData && jsonData.cards.length === 1
    ? jsonData
    : (mdData ?? jsonData)

  if (!data) return existing ? { ...request, htmlContent: undefined } : request
  const spec = resolveSettingSpecForRequest({ ...base, dataTitle: data.title })
  return { ...request, htmlContent: renderWithSpec(data, spec) }
}
