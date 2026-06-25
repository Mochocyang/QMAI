import { createDirectory, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

function formatBackupTimestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("")
}

export async function backupChapterFile(input: {
  projectPath: string
  chapterPath: string
  chapterNumber: number | null
  content: string
  now?: Date
}): Promise<string> {
  const backupDir = `${normalizePath(input.projectPath)}/.qmai/chapter-backups`
  const stamp = formatBackupTimestamp(input.now ?? new Date())
  const prefix = input.chapterNumber && input.chapterNumber > 0
    ? `chapter-${String(input.chapterNumber).padStart(3, "0")}`
    : "chapter-unknown"
  const backupPath = `${backupDir}/${prefix}-${stamp}.md`

  await createDirectory(backupDir)
  await writeFile(backupPath, input.content)
  return backupPath
}
