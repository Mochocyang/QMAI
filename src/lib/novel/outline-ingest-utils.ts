import { fileExists } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

interface OutlineIngestIdentity {
  outlineName: string
  chapterNumber: number
  snapshotJsonPath: string
}

export function getOutlineIngestIdentity(projectPath: string, outlinePath: string): OutlineIngestIdentity {
  const normalizedOutlinePath = normalizePath(outlinePath)
  const fileName = normalizedOutlinePath.split("/").pop() ?? "outline"
  const outlineName = fileName.replace(/\.\w+$/, "")

  let hash = 0
  for (let i = 0; i < outlineName.length; i++) {
    hash = ((hash << 5) - hash + outlineName.charCodeAt(i)) | 0
  }
  const chapterNumber = -(Math.abs(hash % 999) + 1)
  const prefix = `outline-${String(Math.abs(chapterNumber)).padStart(3, "0")}`
  const snapshotJsonPath = `${normalizePath(projectPath)}/.novel/snapshots/${prefix}.snapshot.json`

  return { outlineName, chapterNumber, snapshotJsonPath }
}

export function getOutlineFileName(outlinePath: string): string {
  return outlinePath.split("/").pop()?.replace(/\.\w+$/, "") || "大纲"
}

export async function outlineSnapshotExists(projectPath: string, outlinePath: string): Promise<boolean> {
  const { snapshotJsonPath } = getOutlineIngestIdentity(projectPath, outlinePath)
  try {
    return await fileExists(snapshotJsonPath)
  } catch {
    return false
  }
}
