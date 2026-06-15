// library-store.ts
/**
 * 拆书作品库索引（feature/book-analysis-reuse）
 * 存于 {projectPath}/book-analysis/library.json
 */
import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import type { BookLibrary, BookLibraryEntry } from "./types"

const LIBRARY_FILE = "library.json"
const VERSION = 1

function libraryPath(projectPath: string): string {
  return normalizePath(joinPath(projectPath, "book-analysis", LIBRARY_FILE))
}

function emptyLibrary(): BookLibrary {
  return { version: VERSION, entries: [] }
}

export async function loadBookLibrary(projectPath: string): Promise<BookLibrary> {
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

export async function saveBookLibrary(projectPath: string, library: BookLibrary): Promise<void> {
  await createDirectory(normalizePath(joinPath(projectPath, "book-analysis")))
  await writeFile(libraryPath(projectPath), JSON.stringify(library, null, 2))
}

export async function upsertBookLibraryEntry(projectPath: string, entry: BookLibraryEntry): Promise<void> {
  const library = await loadBookLibrary(projectPath)
  const idx = library.entries.findIndex((e) => e.bookId === entry.bookId)
  if (idx >= 0) {
    library.entries[idx] = entry
  } else {
    library.entries.push(entry)
  }
  await saveBookLibrary(projectPath, library)
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
