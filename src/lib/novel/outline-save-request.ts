import { normalizePath } from "@/lib/path-utils"
import type { CharacterSaveDraft } from "./character-save-extractor"

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
}

export interface OutlineSaveRequestParseResult {
  requests: OutlineSaveRequest[]
  errors: string[]
}

export interface OutlineSaveRequestSaveResult {
  saved: Array<{
    path: string
    fileName: string
    writeMode: OutlineSaveRequestWriteMode
  }>
  skipped: string[]
  errors: string[]
}

export interface OutlineSaveRequestFs {
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

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = []
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi
  for (const match of text.matchAll(fencePattern)) {
    candidates.push(match[1].trim())
  }

  const trimmed = text.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed)
  }
  return Array.from(new Set(candidates))
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
  const content = String(raw.content ?? "").trim()

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
    },
    errors: [],
  }
}

function collectRawRequests(payload: Record<string, unknown>): unknown[] {
  if (payload.outlineSaveRequest !== undefined) return [payload.outlineSaveRequest]
  if (Array.isArray(payload.outlineSaveRequests)) return payload.outlineSaveRequests
  return []
}

export function extractBodyContent(text: string): string {
  return text
    .replace(/```(?:json)?\s*[\s\S]*?```/gi, "")
    .replace(/```[\s\S]*?```/g, "")
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

function fillContentFromText(requests: OutlineSaveRequest[], text: string): OutlineSaveRequest[] {
  const body = extractBodyContent(text)
  if (!body) return requests

  if (requests.length === 1) {
    return requests.map((r) => ({ ...r, content: body }))
  }

  const sections = splitBodyByH1(body)
  if (sections.length >= requests.length) {
    return requests.map((r, i) => ({ ...r, content: sections[i] || body }))
  }

  return requests.map((r) => ({ ...r, content: body }))
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

  const filled = fillContentFromText(requests, text)
  const stillEmpty = filled.filter((r) => !r.content)
  if (stillEmpty.length > 0) {
    stillEmpty.forEach((_, i) => {
      errors.push(`第 ${i + 1} 个保存请求缺少 content，且无法从正文中提取。`)
    })
  }

  return { requests: filled, errors }
}

export function formatOutlineSaveParseFeedback(errors: string[]): string {
  const uniqueErrors = Array.from(new Set(errors.filter(Boolean)))
  if (uniqueErrors.length === 0) return ""
  const preview = uniqueErrors.slice(0, 4).join("；")
  const remaining = uniqueErrors.length > 4 ? `；另有 ${uniqueErrors.length - 4} 项未列出` : ""
  return [
    `自动保存失败：${preview}${remaining}。`,
    "请让 AI 重新输出 outlineSaveRequest，必须包含 targetFolder、fileName、fileType、writeMode、referencedSkills、sourceIntent。",
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
    autoSaveable: requests.filter((request) => request.fileType !== "character"),
    confirmRequired: requests.filter((request) => request.fileType === "character"),
  }
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function buildSaveContent(request: OutlineSaveRequest): string {
  const skillLine = request.referencedSkills.map((skill) => `  - "${escapeYamlString(skill)}"`).join("\n")
  const frontmatter = [
    "---",
    "type: outline",
    `outline_type: ${request.fileType}`,
    `source_intent: "${escapeYamlString(request.sourceIntent)}"`,
    "referenced_skills:",
    skillLine || "  []",
    "---",
    "",
  ].join("\n")
  return `${frontmatter}${request.content.trim()}\n`
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
} & OutlineSaveRequestFs): Promise<OutlineSaveRequestSaveResult> {
  const outlineRoot = normalizePath(input.outlineRoot).replace(/\/+$/, "")
  const result: OutlineSaveRequestSaveResult = { saved: [], skipped: [], errors: [] }

  for (const request of input.requests) {
    const targetDir = `${outlineRoot}/${request.targetFolder}`
    await input.createDirectory(targetDir)

    if (request.writeMode === "replace" || request.writeMode === "patch") {
      result.skipped.push(`已跳过 ${request.fileName}：${request.writeMode} 需要用户明确确认。`)
      continue
    }

    if (request.writeMode === "append") {
      const targetPath = `${targetDir}/${request.fileName}`
      if (!input.readFile) {
        result.skipped.push(`已跳过 ${request.fileName}：当前环境缺少追加读取能力。`)
        continue
      }
      const original = await input.fileExists(targetPath) ? await input.readFile(targetPath) : ""
      await input.writeFile(targetPath, `${original.replace(/\s*$/, "\n\n")}${request.content.trim()}\n`)
      result.saved.push({ path: targetPath, fileName: request.fileName, writeMode: request.writeMode })
      continue
    }

    const target = await resolveUniquePath(input, targetDir, request.fileName)
    await input.writeFile(target.path, buildSaveContent({ ...request, fileName: target.fileName }))
    result.saved.push({ path: target.path, fileName: target.fileName, writeMode: request.writeMode })
  }

  return result
}
