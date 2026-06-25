/**
 * 读取指定 bookId 的拆书分析结果（optimize/dedupe-result-loader）
 * 用于 sidebar 打开作品 / 预检命中后打开现有结果，避免两边读盘逻辑重复。
 * 任何子目录（characters / skills）缺失时静默降级为 []。
 * 整个 metadata 读不到时返回 null。
 */
import { readFile, listDirectory } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import type {
  BookAnalysisResult,
  BookAnalysisMetadata,
  ExtractedCharacter,
  CharacterSkill,
  BookStyleProfile,
} from "./types"

/** 读取已提取的作品文风画像（feature/book-style-extraction），不存在时返回 null。 */
export async function loadStyleProfile(bookPath: string): Promise<BookStyleProfile | null> {
  try {
    const raw = await readFile(joinPath(bookPath, "style-profile.json"))
    return JSON.parse(raw) as BookStyleProfile
  } catch {
    return null
  }
}

export async function loadBookAnalysisResult(
  projectPath: string,
  bookId: string,
): Promise<BookAnalysisResult | null> {
  const bookPath = joinPath(projectPath, "book-analysis", bookId)
  let metadata: BookAnalysisMetadata
  try {
    const raw = await readFile(joinPath(bookPath, "metadata.json"))
    metadata = JSON.parse(raw) as BookAnalysisMetadata
  } catch (err) {
    console.warn(`[result-loader] 读取 metadata 失败: bookId=${bookId}`, err)
    return null
  }

  const characters: ExtractedCharacter[] = []
  try {
    const charactersDir = joinPath(bookPath, "characters")
    const files = await listDirectory(charactersDir)
    for (const f of files) {
      if (!f.is_dir && f.name.endsWith(".json")) {
        const content = await readFile(f.path)
        characters.push(JSON.parse(content))
      }
    }
  } catch {
    // 没有角色数据
  }

  const skills: CharacterSkill[] = []
  try {
    const skillsDir = joinPath(bookPath, "skills")
    const files = await listDirectory(skillsDir)
    for (const f of files) {
      if (!f.is_dir && f.name.endsWith(".md")) {
        const content = await readFile(f.path)
        const baseName = f.name.replace(/-skill\.md$/i, "").replace(/\.md$/i, "")
        const character = characters.find(
          (c) => c.name === baseName || f.name.includes(c.name),
        )
        skills.push({
          id: character ? `skill-${character.id}` : `skill-${baseName}`,
          characterId: character?.id ?? baseName,
          characterName: character?.name ?? baseName,
          skillContent: content,
          sourceBook: metadata.title,
          chapterRange: character
            ? [`${character.firstAppearance}`, `${character.lastAppearance}`]
            : [],
          createdAt: metadata.createdAt,
          filePath: f.path,
        })
      }
    }
  } catch {
    // 没有 Skills 数据
  }

  const styleProfile = (await loadStyleProfile(bookPath)) ?? undefined

  return { metadata, characters, skills, bookId, styleProfile }
}
