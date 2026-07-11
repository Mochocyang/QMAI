import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { ChapterPosition } from "./chapter-positioning"
import { parsePositionTableFromMarkdown } from "./chapter-positioning"

export function getChapterPositionsFromOutline(
  projectPath: string,
  volumeNumber: number,
): ChapterPosition[] {
  const searchLocations = [projectPath, join(projectPath, "outlines")]

  for (const dir of searchLocations) {
    try {
      const files = readdirSync(dir)
      const pattern = `卷纲_第${volumeNumber}卷`
      const matched = files.find((f) => f.startsWith(pattern) && f.endsWith(".md"))
      if (matched) {
        const content = readFileSync(join(dir, matched), "utf-8")
        return parsePositionTableFromMarkdown(content)
      }
    } catch {
      continue
    }
  }

  return []
}
