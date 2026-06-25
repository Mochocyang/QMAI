import { createDirectory, deleteFile, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { makeChapterFileStem, makeSafeFileSlug } from "@/lib/wiki-filename"

export type TrashItemKind = "chapter" | "outline" | "page" | "file" | "history"

export interface TrashItem {
  id: string
  name: string
  originalPath: string
  trashPath: string
  deletedAt: number
  expiresAt: number
  kind: TrashItemKind
}

export interface RestoreTrashResult {
  item: TrashItem
  restoredPath: string
  renamed: boolean
}

const TRASH_RETENTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

function trashRoot(projectPath: string): string {
  return `${normalizePath(projectPath)}/.trash`
}

function trashFilesDir(projectPath: string): string {
  return `${trashRoot(projectPath)}/files`
}

function trashIndexPath(projectPath: string): string {
  return `${trashRoot(projectPath)}/items.json`
}

function formatDateTime(value: number): string {
  const date = new Date(value)
  const pad = (input: number) => String(input).padStart(2, "0")
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("")
}

function getBaseName(path: string): string {
  const normalized = normalizePath(path)
  return normalized.slice(normalized.lastIndexOf("/") + 1)
}

function getDirName(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf("/")
  return index >= 0 ? normalized.slice(0, index) : ""
}

function getExtension(name: string): string {
  const index = name.lastIndexOf(".")
  return index > 0 ? name.slice(index) : ""
}

function getStem(name: string): string {
  const extension = getExtension(name)
  return extension ? name.slice(0, -extension.length) : name
}

function makeTrashId(now: number): string {
  return `${formatDateTime(now)}-${Math.random().toString(36).slice(2, 8)}`
}

function extractFrontmatterString(content: string, field: string): string | null {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = content.match(new RegExp(`^${escapedField}:\\s*["']?(.+?)["']?\\s*$`, "m"))
  return match?.[1]?.trim() || null
}

function extractRestoreTitle(content: string, fallbackName: string): string {
  return (
    extractFrontmatterString(content, "title") ??
    content.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
    getStem(fallbackName)
  )
}

function extractRestoreChapterNumber(content: string): number | null {
  const raw = extractFrontmatterString(content, "chapter_number")
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function makeRestoreConflictStem(item: TrashItem, content: string): string {
  const title = extractRestoreTitle(content, item.name)
  if (item.kind === "chapter") {
    return makeChapterFileStem(title, extractRestoreChapterNumber(content))
  }
  if (item.kind === "outline") {
    return makeSafeFileSlug(title, getStem(item.name))
  }
  return getStem(item.name)
}

function parseTrashItems(raw: string): TrashItem[] {
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((item): item is TrashItem => {
    return Boolean(
      item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.originalPath === "string" &&
        typeof item.trashPath === "string" &&
        typeof item.deletedAt === "number" &&
        typeof item.expiresAt === "number" &&
        typeof item.kind === "string",
    )
  })
}

async function readTrashItems(projectPath: string): Promise<TrashItem[]> {
  try {
    return parseTrashItems(await readFile(trashIndexPath(projectPath)))
  } catch {
    return []
  }
}

async function writeTrashItems(projectPath: string, items: TrashItem[]): Promise<void> {
  await createDirectory(trashRoot(projectPath))
  await writeFile(trashIndexPath(projectPath), JSON.stringify(items, null, 2))
}

async function ensureTrashDirs(projectPath: string): Promise<void> {
  await createDirectory(trashRoot(projectPath))
  await createDirectory(trashFilesDir(projectPath))
}

export async function listTrashItems(projectPath: string): Promise<TrashItem[]> {
  const items = await readTrashItems(projectPath)
  return items.sort((a, b) => b.deletedAt - a.deletedAt)
}

export async function moveFileToTrash(
  projectPath: string,
  filePath: string,
  kind: TrashItemKind,
  now = Date.now(),
): Promise<TrashItem> {
  const pp = normalizePath(projectPath)
  const normalizedPath = normalizePath(filePath)
  const name = getBaseName(normalizedPath)
  const id = makeTrashId(now)
  const trashPath = `${trashFilesDir(pp)}/${id}${getExtension(name)}`

  // 尝试读取文件内容；如果文件不存在（损坏/幽灵条目），用空内容占位，
  // 确保删除操作不会因为读不到文件而失败
  let content: string
  try {
    content = await readFile(normalizedPath)
  } catch {
    content = ""
  }

  await ensureTrashDirs(pp)
  await writeFile(trashPath, content)
  const item: TrashItem = {
    id,
    name,
    originalPath: normalizedPath,
    trashPath,
    deletedAt: now,
    expiresAt: now + TRASH_RETENTION_DAYS * DAY_MS,
    kind,
  }
  const items = await readTrashItems(pp)
  await writeTrashItems(pp, [item, ...items])

  // 删除原文件，忽略不存在的情况（幽灵条目）
  try {
    await deleteFile(normalizedPath)
  } catch {
    // 文件可能已经不存在，静默继续
  }

  return item
}

async function resolveRestorePath(item: TrashItem, content: string): Promise<{ path: string; renamed: boolean }> {
  const originalPath = item.originalPath
  const normalized = normalizePath(originalPath)
  if (!(await fileExists(normalized))) {
    return { path: normalized, renamed: false }
  }
  const dir = getDirName(normalized)
  const name = getBaseName(normalized)
  const extension = getExtension(name)
  const stem = makeRestoreConflictStem(item, content)
  const candidate = `${dir}/${stem}${extension}`
  if (!(await fileExists(candidate))) {
    return { path: candidate, renamed: true }
  }
  let index = 2
  while (true) {
    const next = `${dir}/${stem}-${index}${extension}`
    if (!(await fileExists(next))) return { path: next, renamed: true }
    index++
  }
}

export async function restoreTrashItem(
  projectPath: string,
  itemId: string,
  now = Date.now(),
): Promise<RestoreTrashResult> {
  const pp = normalizePath(projectPath)
  const items = await readTrashItems(pp)
  const item = items.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error("回收站项目不存在")
  const content = await readFile(item.trashPath)
  void now
  const restoreTarget = await resolveRestorePath(item, content)
  const dir = getDirName(restoreTarget.path)
  if (dir) await createDirectory(dir)
  await writeFile(restoreTarget.path, content)
  await deleteFile(item.trashPath)
  await writeTrashItems(pp, items.filter((candidate) => candidate.id !== itemId))
  return {
    item,
    restoredPath: restoreTarget.path,
    renamed: restoreTarget.renamed,
  }
}

export async function cleanupExpiredTrashItems(
  projectPath: string,
  now = Date.now(),
): Promise<{ deletedCount: number }> {
  const pp = normalizePath(projectPath)
  const items = await readTrashItems(pp)
  const active: TrashItem[] = []
  let deletedCount = 0
  for (const item of items) {
    if (item.expiresAt <= now) {
      try {
        await deleteFile(item.trashPath)
      } catch {}
      deletedCount++
    } else {
      active.push(item)
    }
  }
  if (deletedCount > 0) {
    await writeTrashItems(pp, active)
  }
  return { deletedCount }
}

export function getTrashDaysRemaining(item: TrashItem, now = Date.now()): number {
  return Math.max(0, Math.ceil((item.expiresAt - now) / DAY_MS))
}

export async function readTrashItemContent(item: TrashItem): Promise<string> {
  return await readFile(item.trashPath)
}

export async function permanentlyDeleteTrashItem(
  projectPath: string,
  itemId: string,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const items = await readTrashItems(pp)
  const item = items.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error("回收站项目不存在")
  try { await deleteFile(item.trashPath) } catch { /* file may already be gone */ }
  await writeTrashItems(pp, items.filter((candidate) => candidate.id !== itemId))
}

export async function permanentlyDeleteAllTrashItems(
  projectPath: string,
): Promise<number> {
  const pp = normalizePath(projectPath)
  const items = await readTrashItems(pp)
  for (const item of items) {
    try { await deleteFile(item.trashPath) } catch { /* ignore */ }
  }
  await writeTrashItems(pp, [])
  return items.length
}
