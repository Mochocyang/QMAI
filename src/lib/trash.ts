import {
  copyDirectory,
  createDirectory,
  deleteFile,
  fileExists,
  listDirectory,
  readFile,
  writeFile,
} from "@/commands/fs"
import { isChapterPath, normalizePath } from "@/lib/path-utils"
import { makeChapterFileStem, makeSafeFileSlug } from "@/lib/wiki-filename"
import { useWritingStatsStore } from "@/stores/writing-stats-store"

export type TrashItemKind = "chapter" | "outline" | "page" | "file" | "history" | "skill" | "storymap"

/**
 * 伴生文件（大纲的 `.html` / `.json`）。
 *
 * 删除大纲只删 `.md` 会留下这两份残骸：AI 读大纲时是扫目录的，残留内容会被当成
 * 仍然有效的大纲读到（用户 2026-10-28 报的重大缺陷）。所以它们必须跟着一起进回收站，
 * 还原时再一起放回去 —— 只删不放会让用户在回收站里"还原"出一份缺 HTML 的大纲。
 */
export interface TrashCompanion {
  originalPath: string
  trashPath: string
}

export interface TrashItem {
  id: string
  name: string
  originalPath: string
  trashPath: string
  deletedAt: number
  expiresAt: number
  kind: TrashItemKind
  /** 随主文件一起进回收站的伴生文件（老条目没有这个字段）。 */
  companions?: TrashCompanion[]
}

/** 大纲 .md 可能带的伴生扩展名：保存时生成的 HTML，以及卷纲的结构化数据 JSON。 */
export const OUTLINE_COMPANION_EXTENSIONS = ["html", "json"] as const

interface RestoreTrashResult {
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

/** 判断路径是否为目录：list_directory 对目录成功（含空目录），对文件/不存在路径会失败 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    await listDirectory(path)
    return true
  } catch {
    return false
  }
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
  const isDir = await isDirectory(normalizedPath)
  // 目录条目不带扩展名；文件条目保留原扩展名（便于恢复/预览）
  const trashPath = isDir
    ? `${trashFilesDir(pp)}/${id}`
    : `${trashFilesDir(pp)}/${id}${getExtension(name)}`

  await ensureTrashDirs(pp)
  /** 伴生文件（仅对 .md 文件）：内容先搬进回收站，随后删原文件。 */
  const companions: TrashCompanion[] = []
  if (!isDir && /\.md$/i.test(name)) {
    const stem = normalizedPath.replace(/\.md$/i, "")
    for (const extension of OUTLINE_COMPANION_EXTENSIONS) {
      const companionPath = `${stem}.${extension}`
      if (!(await fileExists(companionPath))) continue
      const companionTrashPath = `${trashFilesDir(pp)}/${id}-companion.${extension}`
      try {
        await writeFile(companionTrashPath, await readFile(companionPath))
        await deleteFile(companionPath)
        companions.push({ originalPath: companionPath, trashPath: companionTrashPath })
      } catch (error) {
        // 伴生文件搬运失败不能拖住主文件的删除，但要留下痕迹方便排查
        console.warn("[trash] 伴生文件移入回收站失败:", companionPath, error)
      }
    }
  }

  if (isDir) {
    // 整目录移入回收站（copy_directory 复制目录内容到目标目录）
    try {
      await copyDirectory(normalizedPath, trashPath)
    } catch {
      // 目录可能已不存在（幽灵条目），静默继续
    }
  } else {
    // 尝试读取文件内容；如果文件不存在（损坏/幽灵条目），用空内容占位，
    // 确保删除操作不会因为读不到文件而失败
    let content: string
    try {
      content = await readFile(normalizedPath)
    } catch {
      content = ""
    }
    await writeFile(trashPath, content)
  }
  const item: TrashItem = {
    id,
    name,
    originalPath: normalizedPath,
    trashPath,
    deletedAt: now,
    expiresAt: now + TRASH_RETENTION_DAYS * DAY_MS,
    kind,
    ...(companions.length > 0 ? { companions } : {}),
  }
  const items = await readTrashItems(pp)
  await writeTrashItems(pp, [item, ...items])

  // 删除原路径（文件或目录），忽略不存在的情况（幽灵条目）
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
  const isDir = await isDirectory(item.trashPath)
  const content = isDir ? "" : await readFile(item.trashPath)
  void now
  const restoreTarget = await resolveRestorePath(item, content)
  const dir = getDirName(restoreTarget.path)
  if (dir) await createDirectory(dir)
  if (isDir) {
    // 目录：整目录复制回原位置（copy_directory 复制内容到目标目录）
    await copyDirectory(item.trashPath, restoreTarget.path)
  } else {
    await writeFile(restoreTarget.path, content)
  }
  /*
   * 伴生文件一起还原：改名还原时（restoreTarget.renamed）用同一套新文件名，
   * 保持 `.md` / `.html` / `.json` 三个文件的主名一致 —— 否则「大纲.md」配
   * 「大纲-2.html」，预览会找不到伴生 HTML。
   */
  if (item.companions?.length) {
    const restoredStem = restoreTarget.path.replace(/\.md$/i, "")
    for (const companion of item.companions) {
      const extension = getExtension(getBaseName(companion.originalPath))
      try {
        const target = restoreTarget.renamed
          ? `${restoredStem}.${extension}`
          : companion.originalPath
        // 目标位置已有同名伴生文件时不覆盖（用户可能已经重新生成了一份）
        if (!(await fileExists(target))) {
          await writeFile(target, await readFile(companion.trashPath))
        }
        await deleteFile(companion.trashPath)
      } catch (error) {
        console.warn("[trash] 伴生文件还原失败:", companion.originalPath, error)
      }
    }
  }
  // 还原到**改名后**的新路径时，把写作归属账本一起搬过去。
  // 不搬的话旧键成了孤儿、新路径从零打基线，用户此前手写的归属会静默消失
  // （自己敲了几百字 → 删掉 → 还原，那几百字就凭空不算了）。
  if (restoreTarget.renamed && isChapterPath(restoreTarget.path)) {
    useWritingStatsStore.getState().transferChapter(item.originalPath, restoreTarget.path)
  }
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
      await deleteTrashEntryFiles(item)
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

/** 删除回收站里的实体文件（主文件 + 伴生文件），永久删除与过期清理共用。 */
async function deleteTrashEntryFiles(item: TrashItem): Promise<void> {
  try { await deleteFile(item.trashPath) } catch { /* 文件可能已不存在 */ }
  for (const companion of item.companions ?? []) {
    try { await deleteFile(companion.trashPath) } catch { /* 可能已不存在 */ }
  }
}

export async function readTrashItemContent(item: TrashItem): Promise<string> {
  if (await isDirectory(item.trashPath)) return ""
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
  await deleteTrashEntryFiles(item)
  await writeTrashItems(pp, items.filter((candidate) => candidate.id !== itemId))
}

export async function permanentlyDeleteAllTrashItems(
  projectPath: string,
): Promise<number> {
  const pp = normalizePath(projectPath)
  const items = await readTrashItems(pp)
  for (const item of items) {
    await deleteTrashEntryFiles(item)
  }
  await writeTrashItems(pp, [])
  return items.length
}
