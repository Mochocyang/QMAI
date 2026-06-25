import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface CharacterState {
  characterName: string
  currentLocation: string
  status: string
  equipment: string[]
  abilities: string[]
  relationships: Record<string, string>
  lastUpdatedChapter: number
  lastUpdatedAt: string
}

export interface CharacterStateStore {
  characters: CharacterState[]
  lastUpdated: string
}

export function createEmptyCharacterStateStore(): CharacterStateStore {
  return { characters: [], lastUpdated: new Date().toISOString() }
}

export async function saveCharacterStates(
  projectPath: string,
  store: CharacterStateStore,
): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.novel`)
  await writeFile(
    `${pp}/.novel/character-states.json`,
    JSON.stringify(store, null, 2),
  )
}

export async function loadCharacterStates(
  projectPath: string,
): Promise<CharacterStateStore> {
  const pp = normalizePath(projectPath)
  try {
    const raw = await readFile(`${pp}/.novel/character-states.json`)
    return JSON.parse(raw)
  } catch {
    return createEmptyCharacterStateStore()
  }
}

export function characterStatesToContextText(store: CharacterStateStore): string {
  if (store.characters.length === 0) return ""
  return store.characters
    .map(
      (c) =>
        `- ${c.characterName}：位于${c.currentLocation}，状态：${c.status}，装备：${c.equipment.join("、") || "无"}，能力：${c.abilities.join("、") || "无"}`,
    )
    .join("\n")
}