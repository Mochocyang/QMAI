import { readFile, writeFile } from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import type { RecognizedCharacter } from "./types"

const RECOGNIZED_CHARACTERS_FILE = "recognized-characters.json"

export async function loadRecognizedCharacters(bookPath: string): Promise<RecognizedCharacter[]> {
  try {
    const raw = await readFile(normalizePath(joinPath(bookPath, RECOGNIZED_CHARACTERS_FILE)))
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as RecognizedCharacter[] : []
  } catch {
    return []
  }
}

export async function saveRecognizedCharacters(
  bookPath: string,
  characters: RecognizedCharacter[],
): Promise<void> {
  await writeFile(
    normalizePath(joinPath(bookPath, RECOGNIZED_CHARACTERS_FILE)),
    JSON.stringify(characters, null, 2),
  )
}
