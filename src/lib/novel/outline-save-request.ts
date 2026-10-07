import { normalizePath } from "@/lib/path-utils"
import type { CharacterSaveDraft } from "./character-save-extractor"
import { cleanNextStepArtifacts } from "./outline-next-step"
import { isLikelyChapterOutline } from "./outline-quality-check"
import { stripOutlineFrontmatter } from "./outline-markdown"
import { stripThoughtDumpFromText } from "@/lib/thought-dump"
import { attachVolumeOutlineHtml } from "./volume-outline-template"
import { attachChapterOutlineHtml } from "./chapter-outline-template"
import { attachCharacterProfileHtml, renderCharacterProfileForContent } from "./character-profile-template"
import { attachFactionProfileHtml } from "./faction-profile-template"
import { attachPowerSystemHtml } from "./power-system-template"
import { attachGoldenFingerHtml } from "./golden-finger-template"
import { attachGeographyProfileHtml } from "./geography-setting-template"
import { attachLocationProfileHtml } from "./location-setting-template"
import { attachBackgroundProfileHtml } from "./background-setting-template"
import { attachForeshadowingProfileHtml } from "./foreshadowing-plan-template"
import {
  attachSettingOutlineHtml,
  extractSettingOutlineData,
  isSettingOutlineFileType,
  renderCardFlowForSpec,
  resolveNeutralOutlineSpec,
  resolveSettingSpecForRequest,
} from "./setting-outline-template"

export type OutlineSaveRequestFileType =
  | "outline"
  | "volume-outline"
  | "chapter-outline"
  | "character"
  | "setting"
  | "foreshadowing"
  | "organization"
  | "quality-report"

export type OutlineSaveRequestWriteMode = "create" | "append" | "replace" | "patch"

export interface OutlineSaveRequest {
  targetFolder: string
  fileName: string
  fileType: OutlineSaveRequestFileType
  writeMode: OutlineSaveRequestWriteMode
  referencedSkills: string[]
  sourceIntent: string
  content: string
  /** 可选：自包含 HTML 版本（如卷纲折叠树），保存时落盘为同名 .html 文件 */
  htmlContent?: string
  /** 可选：结构化数据（如卷纲 volumeOutlineData 的 JSON），保存时落盘为同名 .json 伴生文件，供章纲等后续环节做交叉校验 */
  structuredData?: string
}

interface OutlineSaveRequestParseResult {
  requests: OutlineSaveRequest[]
  errors: string[]
}

interface OutlineSaveRequestSaveResult {
  saved: Array<{
    path: string
    fileName: string
    writeMode: OutlineSaveRequestWriteMode
  }>
  skipped: string[]
  errors: string[]
}

interface OutlineSaveRequestFs {
  createDirectory: (path: string) => Promise<void>
  fileExists: (path: string) => Promise<boolean>
  writeFile: (path: string, content: string) => Promise<void>
  readFile?: (path: string) => Promise<string>
}

const ALLOWED_FILE_TYPES = new Set<OutlineSaveRequestFileType>([
  "outline",
  "volume-outline",
  "chapter-outline",
  "character",
  "setting",
  "foreshadowing",
  "organization",
  "quality-report",
])

const ALLOWED_WRITE_MODES = new Set<OutlineSaveRequestWriteMode>([
  "create",
  "append",
  "replace",
  "patch",
])

const FILE_TYPE_ALIASES: Record<string, OutlineSaveRequestFileType> = {
  "大纲": "outline",
  "卷纲": "volume-outline",
  "章纲": "chapter-outline",
  "人物小传": "character",
  "人物": "character",
  "角色": "character",
  "设定": "setting",
  "伏笔": "foreshadowing",
  "组织": "organization",
  "势力": "organization",
  "质量检查": "quality-report",
}

const WRITE_MODE_ALIASES: Record<string, OutlineSaveRequestWriteMode> = {
  "overwrite": "create",
  "write": "create",
  "save": "create",
  "new": "create",
  "override": "replace",
}

function normalizeFileTypeAlias(value: string): string {
  const trimmed = value.trim()
  if (ALLOWED_FILE_TYPES.has(trimmed as OutlineSaveRequestFileType)) return trimmed
  return FILE_TYPE_ALIASES[trimmed] ?? trimmed
}

function normalizeWriteModeAlias(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (ALLOWED_WRITE_MODES.has(trimmed as OutlineSaveRequestWriteMode)) return trimmed
  return WRITE_MODE_ALIASES[trimmed] ?? trimmed
}

function stripAbsoluteToRelativeFolder(value: string): string {
  const normalized = normalizePath(value).trim()
  if (!normalized) return normalized
  if (!normalized.startsWith("/") && !normalized.startsWith("\\") && !/^[a-zA-Z]:[\\/]/.test(normalized)) {
    return normalized
  }
  const marker = "wiki/outlines/"
  const markerIndex = normalized.toLowerCase().indexOf(marker)
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length)
  }
  const parts = normalized.split("/").filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : normalized
}

/** 提取 AI 原文中的 ```html 围栏内容（仅匹配 html 语言标记的围栏） */
export function extractHtmlBlocks(text: string): string[] {
  const blocks: string[] = []
  // 必须显式带 html 语言标记，否则会误抓 ```json 等其它围栏
  const fencePattern = /```html[ \t]*\r?\n([\s\S]*?)```/gi
  for (const match of text.matchAll(fencePattern)) {
    const block = match[1].trim()
    if (block) blocks.push(block)
  }
  return blocks
}

/**
 * 按 fileType 分派补 htmlContent（非真正 HTML 时用结构化数据套模板渲染）：
 * - 独立类型直接分派：卷纲 → 折叠树；章纲 → 卡片流；人物小传 → 角色卡；
 *   组织势力 → 势力卡；伏笔计划 → 伏笔台账；
 * - setting / outline：先判定子类型（`attachSettingFamilyHtml`），命中专属模板的走专属渲染
 *   （角色卡 / 势力卡 / 体系卡 / 能力卡 / 背景卡 / 地理卡 / 地点卡 / 伏笔台账）；
 * - 其余 → 通用「设定卡片流」。
 *
 * **出口保证**：分派之后若仍然没有 HTML，一律用请求自己的 MD 兜底渲染一份卡片流。
 * 见下方 `renderOutlineFallbackHtml` 的说明 —— 这个保证是本文件的调用方（保存确认框）
 * 能提供「HTML 形式」选项的前提。
 */
export function attachOutlineHtml<
  T extends {
    fileType: string
    htmlContent?: string
    content: string
    fileName?: string
    targetFolder?: string
    sourceIntent?: string
  },
>(request: T, text: string): T {
  const attached = dispatchOutlineHtml(request, text)
  if (attached.htmlContent?.trim()) return attached
  /*
   * 最终保证：**任何**大纲类型都不允许「有正文却没有 HTML」。
   *
   * 保存确认框的「HTML 形式（.html）」是否可勾选，完全取决于请求里有没有 htmlContent
   * （`outline-save-confirm-dialog.tsx` 的 hasHtmlContent）。缺了它，用户看到的是
   * 一个永久置灰的勾选框 + 「本轮未生成 HTML 版本，无法保存 HTML。」——无处可点。
   *
   * 而卷纲/章纲的专用渲染器依赖可解析的结构化 JSON，拿不到时旧实现是「干脆不出 HTML」，
   * 于是「AI 只给了 MD」「结构化数据不完整被放行保存」这些**常见**情况都会永久失去 HTML 选项。
   * 把保证放在这个唯一出口，而不是给每种类型各补一条分支：ALLOWED_FILE_TYPES 有 8 个成员，
   * 逐个补意味着「以后新增类型时又要记得补一处」，漏一处就重新出现置灰的保存框。
   */
  const fallback = renderOutlineFallbackHtml({
    fileType: attached.fileType,
    content: attached.content,
    fileName: attached.fileName,
    targetFolder: attached.targetFolder,
    sourceIntent: attached.sourceIntent,
  })
  return fallback ? ({ ...attached, htmlContent: fallback } as T) : attached
}

/** 各类型自己的渲染器分派；返回的请求可能仍不带 HTML（由 attachOutlineHtml 兜底）。 */
function dispatchOutlineHtml<
  T extends {
    fileType: string
    htmlContent?: string
    content: string
    fileName?: string
    targetFolder?: string
    sourceIntent?: string
  },
>(request: T, text: string): T {
  if (request.fileType === "volume-outline") return attachVolumeOutlineHtml(request, text)
  if (request.fileType === "chapter-outline") return attachChapterOutlineHtml(request, text)
  if (request.fileType === "character") return attachCharacterProfileHtml(request, text)
  if (request.fileType === "organization") return attachFactionProfileHtml(request, text)
  if (request.fileType === "foreshadowing") return attachForeshadowingProfileHtml(request, text)
  return attachSettingFamilyHtml(request, text)
}

/**
 * 兜底渲染：分派后仍没有 HTML 时，用请求**自己的 MD 正文**渲染一份卡片流。
 *
 * 两级选择：
 * 1. 先按「正文标题 → 文件名 → sourceIntent → 文件夹」嗅探**专属分项**。命中就用它 ——
 *    这正是原 `borrowSettingFamilyHtml` 的意图：被判错类型的文档（例如「全版本力量体系总纲」
 *    因正文提到「第 N 章」被误判为章纲）应当显示它**真正的样子**，而不是章纲的样子。
 * 2. 嗅不到具体分项时，用该大纲类型**自己的中性规格**（章纲 / 卷纲 / 质量检查），
 *    而不是一律退化成「设定 · 卡片流」。
 */
function renderOutlineFallbackHtml(request: {
  fileType: string
  content: string
  fileName?: string
  targetFolder?: string
  sourceIntent?: string
}): string | null {
  const text = request.content?.trim()
  if (!text) return null
  /*
   * 注意这里用的是设定家族的**专用渲染器**（体系卡 / 势力卡 / 背景卡 …），
   * 不是 `renderCardFlowForSpec` 的通用卡片流 —— 两者标题不同（「力量体系 · 体系卡」对「力量体系 · 卡片流」）。
   * 走 attachSettingFamilyHtml 与旧实现完全一致，保证被判错类型的文档渲染结果不变。
   */
  const borrowed = borrowSpecificSettingHtml(request, text)
  if (borrowed) return borrowed
  return renderCardFlowForSpec(text, resolveNeutralOutlineSpec(request.fileType))
}

/**
 * 只有当「标题 → 文件名 → sourceIntent → 文件夹」嗅探到**具体**设定分项时才借用设定家族的渲染结果；
 * 嗅不到（落到中性 generic-setting）时返回 null，交给调用方用该大纲类型自己的规格兜底。
 *
 * 这个区分是必须的：若不加判断地借用，一份章纲会被 `attachSettingOutlineHtml` 渲染成
 * 「设定 · 卡片流」——等于用错误标签换取「有 HTML」。
 */
function borrowSpecificSettingHtml(
  request: {
    fileType: string
    htmlContent?: string
    content: string
    fileName?: string
    targetFolder?: string
    sourceIntent?: string
  },
  text: string,
): string | null {
  const spec = resolveSettingSpecForRequest({
    fileType: "setting",
    fileName: request.fileName,
    targetFolder: request.targetFolder,
    sourceIntent: request.sourceIntent,
    content: text,
  })
  if (!SETTING_FAMILY_RENDERERS[spec.id]) return null
  const chained = attachSettingFamilyHtml({ ...request, fileType: "setting" }, text)
  return chained.htmlContent?.trim() ? chained.htmlContent : null
}

/**
 * setting / outline 家族分派：多种类型共用 fileType=`setting`，
 * 必须先按「JSON 标题 → 正文标题 → 文件名 → sourceIntent → 文件夹」判定子类型，
 * 命中专属模板的走专属渲染，其余走通用「设定卡片流」。
 *
 * 规格 id → 渲染器。**数据驱动**，避免新增分项时忘记在此加分支而悄悄退化成通用卡片流。
 */
const SETTING_FAMILY_RENDERERS: Record<
  string,
  <T extends { fileType: string; htmlContent?: string; content: string }>(request: T, text: string) => T
> = {
  characterBriefs: attachCharacterProfileHtml,
  organizationsOutline: attachFactionProfileHtml,
  powerSystem: attachPowerSystemHtml,
  goldenFinger: attachGoldenFingerHtml,
  backgroundSetting: attachBackgroundProfileHtml,
  geographySetting: attachGeographyProfileHtml,
  foreshadowingPlan: attachForeshadowingProfileHtml,
  locationsOutline: attachLocationProfileHtml,
}

function attachSettingFamilyHtml<
  T extends {
    fileType: string
    htmlContent?: string
    content: string
    fileName?: string
    targetFolder?: string
    sourceIntent?: string
  },
>(request: T, text: string): T {
  if (!isSettingOutlineFileType(request.fileType)) return request
  const existing = request.htmlContent?.trim() ?? ""
  if (!/<html[\s>]/i.test(existing)) {
    const spec = resolveSettingSpecForRequest({
      fileType: request.fileType,
      fileName: request.fileName,
      targetFolder: request.targetFolder,
      sourceIntent: request.sourceIntent,
      content: request.content,
      dataTitle: extractSettingOutlineData(text)?.title,
    })
    const renderer = SETTING_FAMILY_RENDERERS[spec.id]
    if (renderer) return renderer(request, text)
  }
  return attachSettingOutlineHtml(request, text)
}

/** 由「文件夹 + 文件名」推断大纲类型（用于给历史 / 外部写入的 .md 补渲染）。 */
function inferOutlineFileTypeFromPath(folder: string, fileName: string): OutlineSaveRequestFileType {
  const hint = `${folder} ${fileName.replace(/\.md$/i, "")}`
  if (/卷纲|分卷/.test(hint)) return "volume-outline"
  if (/章纲|细纲/.test(hint)) return "chapter-outline"
  if (/人物|角色/.test(hint)) return "character"
  if (/组织|势力|阵营|门派|家族/.test(hint)) return "organization"
  if (/伏笔/.test(hint)) return "foreshadowing"
  if (/质量|检查/.test(hint)) return "quality-report"
  // 其余交给 setting 家族按「标题 → 文件名 → 文件夹」细分
  return "setting"
}

/**
 * 按路径与正文即时渲染大纲 HTML。
 *
 * 用于**磁盘上还没有伴生 `.html`** 的大纲文件（旧版本生成的、外部写入的、或示例/导入的文件），
 * 让预览也能提供 HTML 视图（新保存的文件仍以落盘的 `.html` 为准）。
 *
 * 只对**能明确归入某个专属卡片类型**的文件渲染（组织势力 / 人物小传 / 力量体系 / 金手指 /
 * 地理 / 地点 / 背景 / 伏笔），避免给「总纲」「写作通则」这类普通大纲套上不相干的卡片。
 * 卷纲/章纲依赖结构化 JSON，缺 JSON 时也返回 null（调用方回退为纯 MD 视图）。
 */
export function renderOutlineHtmlForPath(path: string, content: string): string | null {
  const text = content?.trim()
  if (!text) return null
  const segments = normalizePath(path).split("/").filter(Boolean)
  const fileName = segments[segments.length - 1] ?? ""
  if (!/\.md$/i.test(fileName)) return null
  const folder = segments.length >= 2 ? segments[segments.length - 2] : ""
  const fileType = inferOutlineFileTypeFromPath(folder, fileName)
  if (!isSettingOutlineFileType(fileType)) return null
  const spec = resolveSettingSpecForRequest({
    fileType,
    fileName,
    targetFolder: folder,
    sourceIntent: folder,
    content: text,
  })
  // 未能归入专属分项（generic-*）时不渲染，保留纯 MD 体验
  if (!SETTING_FAMILY_RENDERERS[spec.id]) return null
  const request: OutlineSaveRequest = {
    targetFolder: folder,
    fileName,
    fileType,
    writeMode: "create",
    referencedSkills: [],
    sourceIntent: folder,
    content: text,
  }
  return attachOutlineHtml(request, text).htmlContent ?? null
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{")
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === "\"") inString = false
      continue
    }
    if (character === "\"") inString = true
    else if (character === "{") depth += 1
    else if (character === "}") {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1).trim()
    }
  }
  return null
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = []
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi
  for (const match of text.matchAll(fencePattern)) {
    candidates.push(match[1].trim())
  }

  const lastFence = text.lastIndexOf("```")
  if (lastFence >= 0) {
    const afterOpen = text.slice(lastFence + 3)
    if (!afterOpen.includes("```")) {
      const unclosed = afterOpen.replace(/^(?:json)?\s*/i, "").trim()
      if (/outlineSaveRequests?/i.test(unclosed)) {
        candidates.push(extractBalancedJsonObject(unclosed) ?? unclosed)
      }
    }
  }

  const trimmed = text.trim()
  if (trimmed.startsWith("{") && (trimmed.endsWith("}") || /outlineSaveRequests?/i.test(trimmed))) {
    candidates.push(extractBalancedJsonObject(trimmed) ?? trimmed)
  }

  const lastBrace = text.lastIndexOf("{")
  if (lastBrace >= 0) {
    const tail = text.slice(lastBrace)
    if (/outlineSaveRequests?/i.test(tail)) {
      candidates.push(extractBalancedJsonObject(tail) ?? tail)
    }
  }

  return Array.from(new Set(candidates.filter(Boolean)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validateRelativePath(value: string, label: string, allowSlash: boolean): string | null {
  const normalized = normalizePath(value).trim()
  if (!normalized) return `${label}不能为空。`
  if (normalized.startsWith("/") || normalized.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(normalized)) {
    return `${label}不能使用绝对路径。`
  }
  if (normalized.split("/").some((part) => part === "..")) {
    return `${label}不能包含上级目录。`
  }
  if (!allowSlash && normalized.includes("/")) {
    return `${label}不能包含路径分隔符。`
  }
  return null
}

function normalizeRequest(raw: unknown, index: number): {
  request: OutlineSaveRequest | null
  errors: string[]
} {
  if (!isRecord(raw)) {
    return { request: null, errors: [`第 ${index + 1} 个保存请求必须是对象。`] }
  }

  const errors: string[] = []
  const targetFolder = stripAbsoluteToRelativeFolder(String(raw.targetFolder ?? "").trim())
  const fileName = String(raw.fileName ?? "").trim()
  const fileType = normalizeFileTypeAlias(String(raw.fileType ?? "")) as OutlineSaveRequestFileType
  const writeMode = normalizeWriteModeAlias(String(raw.writeMode ?? "")) as OutlineSaveRequestWriteMode
  const rawContent = String(raw.content ?? "").trim()
  const content = stripThoughtDumpFromText(rawContent).trim()
  const htmlContent = typeof raw.htmlContent === "string" ? raw.htmlContent.trim() : ""

  for (const [field, value] of Object.entries({
    targetFolder,
    fileName,
    fileType,
    writeMode,
  })) {
    if (!value) errors.push(`第 ${index + 1} 个保存请求缺少 ${field}。`)
  }

  const folderError = validateRelativePath(targetFolder, "目标文件夹", true)
  if (folderError) errors.push(folderError)
  const fileError = validateRelativePath(fileName, "文件名", false)
  if (fileError) errors.push(fileError)
  if (fileName && !fileName.toLowerCase().endsWith(".md")) {
    errors.push("文件名必须是 Markdown 文件。")
  }
  if (fileType && !ALLOWED_FILE_TYPES.has(fileType)) {
    errors.push(`不支持的大纲文件类型：${fileType}。`)
  }
  if (writeMode && !ALLOWED_WRITE_MODES.has(writeMode)) {
    errors.push(`不支持的写入模式：${writeMode}。`)
  }
  if (rawContent && !content) {
    errors.push(`第 ${index + 1} 个保存请求的 content 仅包含模型思考过程。`)
  }

  if (errors.length > 0) return { request: null, errors }

  return {
    request: {
      targetFolder: normalizePath(targetFolder),
      fileName: normalizePath(fileName),
      fileType,
      writeMode,
      referencedSkills: Array.isArray(raw.referencedSkills)
        ? raw.referencedSkills.filter((item): item is string => typeof item === "string")
        : [],
      sourceIntent: String(raw.sourceIntent ?? "").trim(),
      content,
      ...(htmlContent ? { htmlContent } : {}),
    },
    errors: [],
  }
}

function collectRawRequests(payload: Record<string, unknown>): unknown[] {
  if (payload.outlineSaveRequest !== undefined) return [payload.outlineSaveRequest]
  if (Array.isArray(payload.outlineSaveRequests)) return payload.outlineSaveRequests
  return []
}

function isOutlineSaveProtocolJson(inner: string): boolean {
  const trimmed = inner.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false
  try {
    const payload = JSON.parse(trimmed) as unknown
    if (!isRecord(payload)) return false
    return "outlineSaveRequest" in payload || "outlineSaveRequests" in payload
  } catch {
    return /outlineSaveRequests?/i.test(trimmed)
  }
}

/**
 * 从 AI 回复中提取可保存的大纲正文：
 * - 展开 markdown/md 围栏与无语言标记的正文围栏
 * - 删除 json 协议块（及无语言标记但内容为 outlineSaveRequest 的围栏）
 * - 保留其它语言代码围栏原样
 */
export function extractBodyContent(text: string): string {
  return text
    .replace(
      /```([a-zA-Z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g,
      (full, lang: string, inner: string) => {
        const language = (lang || "").trim().toLowerCase()
        if (language === "json") return ""
        if (language === "markdown" || language === "md") return inner.trim()
        if (language === "html") return ""
        if (!language) {
          return isOutlineSaveProtocolJson(inner) ? "" : inner.trim()
        }
        return full
      },
    )
    .trim()
}

function splitBodyByH1(body: string): string[] {
  const lines = body.split(/\r?\n/)
  const sections: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^#\s+/.test(line.trim()) && current.length > 0) {
      sections.push(current.join("\n").trim())
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) {
    sections.push(current.join("\n").trim())
  }
  return sections.filter(Boolean)
}

/** 章纲必须具备结构字段，避免「下一步推荐/确认摘要」因偶含「章纲」二字被误放行 */
function hasChapterOutlineStructure(content: string, fileName: string): boolean {
  if (!isLikelyChapterOutline(content, fileName)) return false
  return /本章目标|核心事件|场景顺序|章尾钩子|章首钩子/.test(content)
}

function fillContentFromText(requests: OutlineSaveRequest[], text: string): OutlineSaveRequest[] {
  const body = cleanNextStepArtifacts(extractBodyContent(text))
  if (!body) return requests

  const fillOne = (request: OutlineSaveRequest, content: string): OutlineSaveRequest =>
    request.content.trim() ? request : { ...request, content }

  if (requests.length === 1) {
    return requests.map((request) => fillOne(request, body))
  }

  const sections = splitBodyByH1(body)
  if (sections.length >= requests.length) {
    return requests.map((request, i) => fillOne(request, sections[i] || ""))
  }

  // 多文件且无法按一级标题拆分时，禁止用同一份正文填满所有请求
  return requests
}

export function parseOutlineSaveRequests(text: string): OutlineSaveRequestParseResult {
  const requests: OutlineSaveRequest[] = []
  const errors: string[] = []

  for (const candidate of extractJsonCandidates(text)) {
    let payload: unknown
    try {
      payload = JSON.parse(candidate)
    } catch {
      continue
    }
    if (!isRecord(payload)) continue
    const rawRequests = collectRawRequests(payload)
    rawRequests.forEach((raw, index) => {
      const normalized = normalizeRequest(raw, index)
      if (normalized.request) requests.push(normalized.request)
      errors.push(...normalized.errors)
    })
  }

  const htmlBlocks = extractHtmlBlocks(text)
  const filled = fillContentFromText(requests, text)
  const usable: OutlineSaveRequest[] = []
  filled.forEach((request, index) => {
    if (!request.content.trim()) {
      errors.push(`第 ${index + 1} 个保存请求缺少 content，且无法从正文中提取。`)
      return
    }
    if (
      request.fileType === "chapter-outline"
      && !hasChapterOutlineStructure(request.content, request.fileName)
    ) {
      errors.push(
        `第 ${index + 1} 个保存请求「${request.fileName}」内容不像章纲（缺少本章目标/核心事件等），已拒绝写入。`,
      )
      return
    }
    usable.push(
      attachOutlineHtml(
        request.htmlContent
          ? request
          : request.fileType === "volume-outline" && htmlBlocks[0]
            ? { ...request, htmlContent: htmlBlocks[0] }
            : request,
        text,
      ),
    )
  })

  return { requests: usable, errors }
}

export function formatOutlineSaveParseFeedback(errors: string[]): string {
  const uniqueErrors = Array.from(new Set(errors.filter(Boolean)))
  if (uniqueErrors.length === 0) return ""
  const preview = uniqueErrors.slice(0, 4).join("；")
  const remaining = uniqueErrors.length > 4 ? `；另有 ${uniqueErrors.length - 4} 项未列出` : ""
  return [
    `保存请求解析失败：${preview}${remaining}。`,
    "请让 AI 重新输出 outlineSaveRequest，必须包含 targetFolder、fileName、fileType、writeMode、referencedSkills、sourceIntent、content。",
    "当前内容不会写入文件。",
  ].join("")
}

export function characterDraftsToSaveRequests(
  drafts: CharacterSaveDraft[],
  sourceIntent: string,
): OutlineSaveRequest[] {
  return drafts
    .filter((draft) => draft.selected)
    .map((draft) => {
      // 优先用草稿上已挂好的角色卡 HTML（来自 characterProfileData）；否则从该草稿 MD 兜底渲染
      const htmlContent = draft.htmlContent?.trim() || renderCharacterProfileForContent(draft.content)
      /*
       * 过一遍 attachOutlineHtml，让**同一个出口保证**也覆盖人物小传：
       * 人物确认框的 HTML 勾选框在 mode==="character" 时是无条件可用的，
       * 所以草稿解析不出结构化档案时若没有 HTML，用户会勾上「HTML 形式」却拿不到 .html —— 静默失败。
       */
      return attachOutlineHtml(
        {
          targetFolder: "人物小传",
          fileName: draft.fileName,
          fileType: "character" as const,
          writeMode: "create" as const,
          referencedSkills: ["JueseSkill/character-design"],
          sourceIntent,
          content: draft.content,
          ...(htmlContent ? { htmlContent } : {}),
        },
        "",
      )
    })
}

export function splitConfirmRequiredSaveRequests(requests: OutlineSaveRequest[]): {
  autoSaveable: OutlineSaveRequest[]
  confirmRequired: OutlineSaveRequest[]
} {
  return {
    // 所有大纲类型均需用户确认后写入，禁止静默落盘
    autoSaveable: [],
    confirmRequired: [...requests],
  }
}

/** 按 targetFolder+fileName 去重合并；同名时以 incoming 覆盖。保留 existing 顺序，新增项追加在末尾。 */
export function mergeOutlineSaveRequests(
  existing: OutlineSaveRequest[],
  incoming: OutlineSaveRequest[],
): OutlineSaveRequest[] {
  const keyOf = (request: OutlineSaveRequest) => `${request.targetFolder}\0${request.fileName}`
  const byKey = new Map<string, OutlineSaveRequest>()
  for (const request of existing) byKey.set(keyOf(request), request)
  for (const request of incoming) byKey.set(keyOf(request), request)

  const merged: OutlineSaveRequest[] = []
  const seen = new Set<string>()
  for (const request of existing) {
    const key = keyOf(request)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(byKey.get(key)!)
  }
  for (const request of incoming) {
    const key = keyOf(request)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(byKey.get(key)!)
  }
  return merged
}

function buildSaveContent(request: OutlineSaveRequest): string {
  return stripOutlineFrontmatter(request.content)
}

async function resolveUniquePath(
  fs: Pick<OutlineSaveRequestFs, "fileExists">,
  targetDir: string,
  fileName: string,
): Promise<{ path: string; fileName: string }> {
  const first = `${targetDir}/${fileName}`
  if (!(await fs.fileExists(first))) return { path: first, fileName }

  const extensionIndex = fileName.lastIndexOf(".")
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ""
  for (let index = 2; index <= 99; index++) {
    const candidateName = `${stem}-${index}${extension}`
    const candidatePath = `${targetDir}/${candidateName}`
    if (!(await fs.fileExists(candidatePath))) {
      return { path: candidatePath, fileName: candidateName }
    }
  }
  const fallbackName = `${stem}-${Date.now()}${extension}`
  return { path: `${targetDir}/${fallbackName}`, fileName: fallbackName }
}

export async function saveOutlineSaveRequests(input: {
  outlineRoot: string
  requests: OutlineSaveRequest[]
  confirmed?: boolean
  /** 保存格式选择：md 默认 true；html 仅当请求含 htmlContent 且此处为 true 时写入伴生 .html */
  formats?: { md: boolean; html: boolean }
} & OutlineSaveRequestFs): Promise<OutlineSaveRequestSaveResult> {
  const outlineRoot = normalizePath(input.outlineRoot).replace(/\/+$/, "")
  const result: OutlineSaveRequestSaveResult = { saved: [], skipped: [], errors: [] }
  const formats = input.formats ?? { md: true, html: true }

  for (const request of input.requests) {
    const targetDir = `${outlineRoot}/${request.targetFolder}`
    await input.createDirectory(targetDir)

    if (request.writeMode === "replace" || request.writeMode === "patch") {
      if (!input.confirmed) {
        result.skipped.push(`已跳过 ${request.fileName}：${request.writeMode} 需要用户明确确认。`)
        continue
      }
      await writeRequestFormats(input, targetDir, request.fileName, request, formats, result)
      continue
    }

    if (request.writeMode === "append") {
      const targetPath = `${targetDir}/${request.fileName}`
      if (input.confirmed) {
        if (formats.md) {
          await input.writeFile(targetPath, buildSaveContent(request))
          result.saved.push({ path: targetPath, fileName: request.fileName, writeMode: request.writeMode })
        }
        if (request.htmlContent && formats.html) {
          const htmlFileName = request.fileName.replace(/\.md$/i, ".html")
          const htmlPath = `${targetDir}/${htmlFileName}`
          await input.writeFile(htmlPath, request.htmlContent)
          result.saved.push({ path: htmlPath, fileName: htmlFileName, writeMode: request.writeMode })
        }
        continue
      }
      if (!input.readFile) {
        result.skipped.push(`已跳过 ${request.fileName}：当前环境缺少追加读取能力。`)
        continue
      }
      const original = await input.fileExists(targetPath) ? await input.readFile(targetPath) : ""
      await input.writeFile(targetPath, `${stripOutlineFrontmatter(original).replace(/\s*$/, "\n\n")}${stripOutlineFrontmatter(request.content).trim()}\n`)
      result.saved.push({ path: targetPath, fileName: request.fileName, writeMode: request.writeMode })
      continue
    }

    const target = await resolveUniquePath(input, targetDir, request.fileName)
    await writeRequestFormats(input, targetDir, target.fileName, request, formats, result)
  }

  return result
}

async function writeRequestFormats(
  fs: Pick<OutlineSaveRequestFs, "writeFile">,
  targetDir: string,
  mdFileName: string,
  request: OutlineSaveRequest,
  formats: { md: boolean; html: boolean },
  result: OutlineSaveRequestSaveResult,
): Promise<void> {
  const mdPath = `${targetDir}/${mdFileName}`
  if (formats.md) {
    await fs.writeFile(mdPath, buildSaveContent({ ...request, fileName: mdFileName }))
    result.saved.push({ path: mdPath, fileName: mdFileName, writeMode: request.writeMode })
  }
  if (request.htmlContent && formats.html) {
    const htmlFileName = mdFileName.replace(/\.md$/i, ".html")
    const htmlPath = `${targetDir}/${htmlFileName}`
    await fs.writeFile(htmlPath, request.htmlContent)
    result.saved.push({ path: htmlPath, fileName: htmlFileName, writeMode: request.writeMode })
  }
  // 卷纲的结构化数据落盘为伴生 .json，供章纲做「卷纲↔章纲」交叉校验（与 HTML 同开关）
  if (request.fileType === "volume-outline" && request.structuredData && formats.html) {
    const jsonFileName = mdFileName.replace(/\.md$/i, ".json")
    const jsonPath = `${targetDir}/${jsonFileName}`
    await fs.writeFile(jsonPath, request.structuredData)
    result.saved.push({ path: jsonPath, fileName: jsonFileName, writeMode: request.writeMode })
  }
}
