import { normalizePath } from "@/lib/path-utils"
import type { CharacterSaveDraft } from "./character-save-extractor"
import { cleanNextStepArtifacts } from "./outline-next-step"
import { isLikelyChapterOutline } from "./outline-quality-check"
import { stripOutlineFrontmatter } from "./outline-markdown"
import { stripThoughtDumpFromText } from "@/lib/thought-dump"
import { attachVolumeOutlineHtml } from "./volume-outline-template"
import { attachChapterOutlineHtml } from "./chapter-outline-template"

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

/** 按 fileType 分派：卷纲 / 章纲各自补 htmlContent（非真正 HTML 时用结构化数据套模板渲染）。 */
export function attachOutlineHtml<
  T extends { fileType: string; htmlContent?: string; content: string },
>(request: T, text: string): T {
  if (request.fileType === "volume-outline") return attachVolumeOutlineHtml(request, text)
  if (request.fileType === "chapter-outline") return attachChapterOutlineHtml(request, text)
  return request
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
    .map((draft) => ({
      targetFolder: "人物小传",
      fileName: draft.fileName,
      fileType: "character",
      writeMode: "create",
      referencedSkills: ["JueseSkill/character-design"],
      sourceIntent,
      content: draft.content,
    }))
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
