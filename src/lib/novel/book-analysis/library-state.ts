import { listDirectory, readFile } from "@/commands/fs"
import { loadCharacterAuraStore } from "@/lib/novel/character-aura"
import { loadWritingStyleStore, type WritingStylePreset } from "@/lib/novel/writing-style-store"
import { joinPath, normalizePath } from "@/lib/path-utils"
import { isSameBookAnalysisCharacterAura } from "./aura-match"
import { loadRecognizedCharacters } from "./recognized-character-store"
import { findCharacterForSkillFile } from "./skill-character-match"
import type {
  BookAnalysisMetadata,
  BookAnalysisResult,
  BookStyleProfile,
  CharacterSkill,
  ExtractedCharacter,
  RecognizedCharacter,
} from "./types"
import type { AnalysisEvidenceSnippet, BookAnalysisModuleManifest } from "./analysis-pipeline-types"

export type BookStyleStatus = "missing" | "available" | "enabled"

export interface BookAnalysisLibraryBook {
  id: string
  path: string
  metadata: BookAnalysisMetadata
  recognizedCharacters: RecognizedCharacter[]
  characters: ExtractedCharacter[]
  skills: CharacterSkill[]
  styleProfile?: BookStyleProfile
  styleStatus: BookStyleStatus
  boundAurasCount: number
  addedAuraCharacterIds: string[]
  analysisManifest?: BookAnalysisModuleManifest
  evidence: AnalysisEvidenceSnippet[]
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
        // 匹配策略（fix/skill-match，确定性优先级）：
        // 文件名精确名 → safeFileName → 别名 → Skill frontmatter 的 name 字段。
        // 移除旧的「文件名包含角色名」宽松子串匹配，避免短名角色抢走长名角色的 Skill。
        const character = findCharacterForSkillFile(file.name, content, characters)
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

function getAddedAuraCharacterIds(
  title: string,
  characters: ExtractedCharacter[],
  customAuras: Awaited<ReturnType<typeof loadCharacterAuraStore>>["customAuras"],
): string[] {
  return characters
    .filter((character) =>
      customAuras.some((aura) => isSameBookAnalysisCharacterAura(aura, title, character.name)),
    )
    .map((character) => character.id)
}

function recognizedFromExtractedCharacters(
  bookPath: string,
  characters: ExtractedCharacter[],
): RecognizedCharacter[] {
  return characters.map((character) => ({
    id: character.id,
    name: character.name,
    aliases: character.aliases ?? [],
    appearances: character.appearanceCount,
    chapterIndices: [Math.max(0, character.firstAppearance - 1)],
    importanceScore: character.importance,
    category:
      character.category === "protagonist"
        ? "主角"
        : character.category === "supporting"
          ? "配角"
          : "次要",
    sourceBook: bookPath,
  }))
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
    const storedRecognizedCharacters = await loadRecognizedCharacters(entry.path)
    const recognizedCharacters = storedRecognizedCharacters.length > 0
      ? storedRecognizedCharacters
      : recognizedFromExtractedCharacters(entry.path, characters)
    const skills = await loadSkills(entry.path, metadata, characters)
    const styleProfile = await readJson<BookStyleProfile>(joinPath(entry.path, "style-profile.json"))
    const analysisManifest = await readJson<BookAnalysisModuleManifest>(joinPath(entry.path, "analysis", "manifest.json"))
    const evidenceCollection = await readJson<{ snippets?: AnalysisEvidenceSnippet[] }>(joinPath(entry.path, "analysis", "evidence.json"))
    const styleStatus: BookStyleStatus =
      enabledStyle?.sourceBook === metadata.title ? "enabled" : styleProfile ? "available" : "missing"

    books.push({
      id: entry.name,
      path: entry.path,
      metadata,
      recognizedCharacters,
      characters,
      skills,
      styleProfile: styleProfile ?? undefined,
      styleStatus,
      boundAurasCount: getBoundAurasCount(metadata.title, bindings, auraById),
      addedAuraCharacterIds: getAddedAuraCharacterIds(metadata.title, characters, auraStore.customAuras),
      analysisManifest: analysisManifest ?? undefined,
      evidence: Array.isArray(evidenceCollection?.snippets) ? evidenceCollection.snippets : [],
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
