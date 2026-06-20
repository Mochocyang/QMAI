import { listDirectory, readFile } from "@/commands/fs"
import { loadCharacterAuraStore } from "@/lib/novel/character-aura"
import { loadWritingStyleStore, type WritingStylePreset } from "@/lib/novel/writing-style-store"
import { joinPath, normalizePath } from "@/lib/path-utils"
import type {
  BookAnalysisMetadata,
  BookAnalysisResult,
  BookStyleProfile,
  CharacterSkill,
  ExtractedCharacter,
} from "./types"

export type BookStyleStatus = "missing" | "available" | "enabled"

export interface BookAnalysisLibraryBook {
  id: string
  path: string
  metadata: BookAnalysisMetadata
  characters: ExtractedCharacter[]
  skills: CharacterSkill[]
  styleProfile?: BookStyleProfile
  styleStatus: BookStyleStatus
  boundAurasCount: number
}

export interface BookAnalysisAuraBindingSummary {
  characterName: string
  auraId: string
  auraName: string
}

export interface BookAnalysisLibraryState {
  books: BookAnalysisLibraryBook[]
  enabledStyle: WritingStylePreset | null
  bindings: BookAnalysisAuraBindingSummary[]
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path)) as T
  } catch {
    return null
  }
}

async function loadCharacters(bookPath: string): Promise<ExtractedCharacter[]> {
  try {
    const files = await listDirectory(joinPath(bookPath, "characters"))
    const characters: ExtractedCharacter[] = []
    for (const file of files) {
      if (!file.is_dir && file.name.endsWith(".json")) {
        const character = await readJson<ExtractedCharacter>(file.path)
        if (character) characters.push(character)
      }
    }
    return characters
  } catch {
    return []
  }
}

async function loadSkills(
  bookPath: string,
  metadata: BookAnalysisMetadata,
  characters: ExtractedCharacter[],
): Promise<CharacterSkill[]> {
  try {
    const files = await listDirectory(joinPath(bookPath, "skills"))
    const skills: CharacterSkill[] = []
    for (const file of files) {
      if (!file.is_dir && file.name.endsWith(".md")) {
        const content = await readFile(file.path)
        const baseName = file.name.replace(/-skill\.md$/i, "").replace(/\.md$/i, "")
        // 匹配策略：1) 精确名称匹配 2) 文件名包含角色名 3) safeFileName 转换后匹配
        const character = characters.find((item) => {
          if (item.name === baseName) return true
          if (file.name.includes(item.name)) return true
          // skill-generator 使用 safeFileName = name.replace(/[^一-龥a-zA-Z0-9]/g, "_")
          const safeName = item.name.replace(/[^一-龥a-zA-Z0-9]/g, "_")
          if (safeName === baseName) return true
          return false
        })
        skills.push({
          id: character ? `skill-${character.id}` : `skill-${baseName}`,
          characterId: character?.id ?? baseName,
          characterName: character?.name ?? baseName,
          skillContent: content,
          sourceBook: metadata.title,
          chapterRange: character ? [`${character.firstAppearance}`, `${character.lastAppearance}`] : [],
          createdAt: metadata.createdAt,
          filePath: file.path,
        })
      }
    }
    return skills
  } catch {
    return []
  }
}

function getBoundAurasCount(
  title: string,
  bindings: BookAnalysisAuraBindingSummary[],
  auraById: Map<string, { sourceNote: string }>,
): number {
  return bindings.filter((binding) => auraById.get(binding.auraId)?.sourceNote.includes(`《${title}》`)).length
}

export async function loadBookAnalysisLibraryState(projectPath: string): Promise<BookAnalysisLibraryState> {
  const normalizedProjectPath = normalizePath(projectPath)
  const writingStyleStore = await loadWritingStyleStore(normalizedProjectPath)
  const enabledStyle = writingStyleStore.styles.find((style) => style.id === writingStyleStore.enabledStyleId) ?? null
  const auraStore = await loadCharacterAuraStore(normalizedProjectPath)
  const auraById = new Map(auraStore.customAuras.map((aura) => [aura.id, aura]))
  const bindings = auraStore.bindings.map((binding) => ({
    ...binding,
    auraName: auraById.get(binding.auraId)?.name ?? "",
  }))

  let entries: Array<{ name: string; path: string; is_dir: boolean }> = []
  try {
    entries = await listDirectory(joinPath(normalizedProjectPath, "book-analysis"))
  } catch {
    entries = []
  }

  const books: BookAnalysisLibraryBook[] = []
  for (const entry of entries) {
    if (!entry.is_dir || !entry.name.startsWith("book-")) continue
    const metadata = await readJson<BookAnalysisMetadata>(joinPath(entry.path, "metadata.json"))
    if (!metadata) continue
    const characters = await loadCharacters(entry.path)
    const skills = await loadSkills(entry.path, metadata, characters)
    const styleProfile = await readJson<BookStyleProfile>(joinPath(entry.path, "style-profile.json"))
    const styleStatus: BookStyleStatus =
      enabledStyle?.sourceBook === metadata.title ? "enabled" : styleProfile ? "available" : "missing"

    books.push({
      id: entry.name,
      path: entry.path,
      metadata,
      characters,
      skills,
      styleProfile: styleProfile ?? undefined,
      styleStatus,
      boundAurasCount: getBoundAurasCount(metadata.title, bindings, auraById),
    })
  }

  books.sort((a, b) => b.metadata.updatedAt - a.metadata.updatedAt)
  return { books, enabledStyle, bindings }
}

export function toBookAnalysisResult(book: BookAnalysisLibraryBook): BookAnalysisResult {
  return {
    metadata: book.metadata,
    characters: book.characters,
    skills: book.skills,
    bookId: book.id,
    styleProfile: book.styleProfile,
  }
}
