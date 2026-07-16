// library-store.ts
/**
 * 拆书作品库索引（feature/book-analysis-reuse）
 * 存于 {projectPath}/book-analysis/library.json
 */
import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import { hashNormalizedNovel } from "./batch-import-hash"
import type { BookLibrary, BookLibraryEntry } from "./types"

const LIBRARY_FILE = "library.json"
const VERSION = 1

function libraryPath(projectPath: string): string {
  return normalizePath(joinPath(projectPath, "book-analysis", LIBRARY_FILE))
}

function emptyLibrary(): BookLibrary {
  return { version: VERSION, entries: [] }
}

async function loadBookLibraryUnlocked(projectPath: string): Promise<BookLibrary> {
  try {
    const raw = await readFile(libraryPath(projectPath))
    if (!raw || !raw.trim()) return emptyLibrary()
    const parsed = JSON.parse(raw) as BookLibrary
    if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.entries)) {
      return emptyLibrary()
    }
    return parsed
  } catch (err) {
    console.warn("[library-store] load failed, fallback to empty:", err)
    return emptyLibrary()
  }
}

export async function loadBookLibrary(projectPath: string): Promise<BookLibrary> {
  return loadBookLibraryUnlocked(projectPath)
}

async function loadBookLibraryStrictUnlocked(projectPath: string): Promise<BookLibrary> {
  const path = libraryPath(projectPath)
  if (!(await fileExists(path))) return emptyLibrary()

  const parsed = JSON.parse(await readFile(path)) as unknown
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || (parsed as Partial<BookLibrary>).version !== VERSION
    || !Array.isArray((parsed as Partial<BookLibrary>).entries)
  ) {
    throw new Error("作品库索引数据无效")
  }
  return parsed as BookLibrary
}

async function saveBookLibraryUnlocked(
  projectPath: string,
  library: BookLibrary,
): Promise<void> {
  await createDirectory(normalizePath(joinPath(projectPath, "book-analysis")))
  await writeFileAtomic(libraryPath(projectPath), JSON.stringify(library, null, 2))
}

export async function saveBookLibrary(projectPath: string, library: BookLibrary): Promise<void> {
  await saveBookLibraryUnlocked(projectPath, library)
}

export async function upsertBookLibraryEntry(
  projectPath: string,
  entry: BookLibraryEntry,
): Promise<void> {
  await withProjectLock(normalizePath(projectPath), async () => {
    const library = await loadBookLibraryUnlocked(projectPath)
    const idx = library.entries.findIndex((e) => e.bookId === entry.bookId)
    if (idx >= 0) {
      library.entries[idx] = entry
    } else {
      library.entries.push(entry)
    }
    await saveBookLibraryUnlocked(projectPath, library)
  })
}

export async function removeBookLibraryEntry(
  projectPath: string,
  bookId: string,
): Promise<void> {
  await withProjectLock(normalizePath(projectPath), async () => {
    const library = await loadBookLibraryStrictUnlocked(projectPath)
    const entries = library.entries.filter((entry) => entry.bookId !== bookId)
    if (entries.length === library.entries.length) return
    await saveBookLibraryUnlocked(projectPath, { ...library, entries })
  })
}

export async function renameBookLibraryEntry(
  projectPath: string,
  bookId: string,
  rawTitle: string,
): Promise<BookLibraryEntry> {
  const title = rawTitle.trim()
  if (!title) throw new Error("作品名称不能为空")

  return withProjectLock(normalizePath(projectPath), async () => {
    const library = await loadBookLibraryStrictUnlocked(projectPath)
    const index = library.entries.findIndex((entry) => entry.bookId === bookId)
    if (index < 0) throw new Error("作品库中找不到该作品")
    if (library.entries.some((entry) => entry.bookId !== bookId && entry.title === title)) {
      throw new Error(`作品名称“${title}”已存在`)
    }

    const current = library.entries[index]
    if (current.title === title) return current

    const metadataPath = joinPath(projectPath, "book-analysis", bookId, "metadata.json")
    const metadataRaw = await readFile(metadataPath)
    const metadata = JSON.parse(metadataRaw) as unknown
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
      throw new Error("作品元数据无效")
    }

    const now = Date.now()
    const renamedEntry = { ...current, title, updatedAt: now }
    const renamedMetadata = { ...metadata, title, updatedAt: now }
    await writeFileAtomic(metadataPath, JSON.stringify(renamedMetadata, null, 2))
    try {
      const entries = [...library.entries]
      entries[index] = renamedEntry
      await saveBookLibraryUnlocked(projectPath, { ...library, entries })
    } catch (error) {
      try {
        await writeFileAtomic(metadataPath, metadataRaw)
      } catch (rollbackError) {
        console.error("作品重命名：回滚 metadata 失败", rollbackError)
      }
      throw error
    }
    return renamedEntry
  })
}
export async function findBookLibraryEntry(
  projectPath: string,
  sourcePath: string,
  contentHash: string,
): Promise<BookLibraryEntry | undefined> {
  const library = await loadBookLibrary(projectPath)
  const normalized = normalizePath(sourcePath)
  return library.entries.find(
    (e) => normalizePath(e.sourcePath) === normalized && e.contentHash === contentHash,
  )
}

export async function findBookLibraryEntryBySha256(
  projectPath: string,
  contentSha256: string,
): Promise<BookLibraryEntry | undefined> {
  return withProjectLock(normalizePath(projectPath), async () => {
    const library = await loadBookLibraryUnlocked(projectPath)
    let matched = library.entries.find((entry) => entry.contentSha256 === contentSha256)
    let changed = false

    for (const entry of library.entries) {
      if (entry.contentSha256 !== undefined) continue

      let sourceContent: string
      try {
        sourceContent = await readFile(entry.sourcePath)
      } catch {
        continue
      }

      const sourceSha256 = await hashNormalizedNovel(sourceContent)
      entry.contentSha256 = sourceSha256
      changed = true
      if (!matched && sourceSha256 === contentSha256) {
        matched = entry
      }
    }

    if (changed) {
      await saveBookLibraryUnlocked(projectPath, library)
    }
    return matched
  })
}
