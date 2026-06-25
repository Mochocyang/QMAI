import { readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export const SOUL_DOC_FILENAME = "soul.md"

export async function readSoulDoc(projectPath: string): Promise<string> {
  const pp = normalizePath(projectPath)
  try {
    return await readFile(`${pp}/${SOUL_DOC_FILENAME}`)
  } catch {
    return ""
  }
}

export async function writeSoulDoc(projectPath: string, content: string): Promise<void> {
  const pp = normalizePath(projectPath)
  await writeFileAtomic(`${pp}/${SOUL_DOC_FILENAME}`, content)
}