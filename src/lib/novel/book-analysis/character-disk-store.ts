/**
 * 把单个角色持久化到 book-analysis/{bookId}/characters/{id}.json
 * （optimize/persist-reextract）
 * 失败抛出（让上层 toast），避免静默丢失数据。
 */
import { writeFile, createDirectory } from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import type { ExtractedCharacter } from "./types"

export async function persistCharacterToDisk(
  bookPath: string,
  character: ExtractedCharacter,
): Promise<void> {
  const charactersDir = normalizePath(joinPath(bookPath, "characters"))
  await createDirectory(charactersDir)
  const filePath = normalizePath(joinPath(charactersDir, `${character.id}.json`))
  await writeFile(filePath, JSON.stringify(character, null, 2))
}
