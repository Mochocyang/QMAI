import { readFile, writeFile, listDirectory, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import { listSnapshots, loadSnapshot } from "./chapter-ingest"
import { loadCharacterStates } from "./character-state"
import { loadForeshadowingTracker } from "./foreshadowing-tracker"
import { loadCognitionState } from "./character-cognition"
import type { FileNode } from "@/types/wiki"

export interface ExportOptions {
  projectPath: string
  exportPath: string
  includeChapters?: boolean
  includeSnapshots?: boolean
  includeMeta?: boolean
}

export interface ExportResult {
  success: boolean
  exportedPath: string
  chapterCount: number
  message: string
}

function flattenMdFiles(nodes: FileNode[]): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = []
  for (const node of nodes) {
    if (node.is_dir) {
      if (node.children) out.push(...flattenMdFiles(node.children))
      continue
    }
    if (node.name.endsWith(".md")) out.push({ name: node.name, path: node.path })
  }
  return out
}

export async function exportProject(options: ExportOptions): Promise<ExportResult> {
  const pp = normalizePath(options.projectPath)
  const {
    exportPath,
    includeChapters = true,
    includeSnapshots = true,
    includeMeta = true,
  } = options

  try {
    await createDirectory(exportPath)
    let chapterCount = 0

    if (includeChapters) {
      const chaptersDir = `${pp}/wiki/chapters`
      let files: { name: string; path: string }[] = []
      try {
        const tree = await listDirectory(chaptersDir)
        files = flattenMdFiles(tree)
      } catch {
        files = []
      }

      const chapters: { num: number; title: string; content: string }[] = []

      for (const file of files) {
        try {
          const raw = await readFile(file.path)
          const parsed = parseFrontmatter(raw)
          const fm = parsed.frontmatter as Record<string, unknown> | null
          const status = fm?.chapter_status as string | undefined
          if (status && status !== "final") continue
          const num = typeof fm?.chapter_number === "number" ? fm.chapter_number as number : 0
          const title = (typeof fm?.title === "string" ? fm.title : file.name.replace(/\.md$/, "")) as string
          const body = parsed.body.trim()
          chapters.push({ num, title, content: body })
          chapterCount++
        } catch {
          // skip unreadable files
        }
      }

      chapters.sort((a, b) => a.num - b.num)

      const mergedContent = chapters
        .map(c => `# ${c.title}\n\n${c.content}`)
        .join("\n\n---\n\n")
      await writeFile(`${exportPath}/complete-novel.md`, mergedContent)
    }

    if (includeSnapshots) {
      const snapshotsDir = `${exportPath}/snapshots`
      await createDirectory(snapshotsDir)
      try {
        const nums = await listSnapshots(pp)
        for (const num of nums) {
          const snap = await loadSnapshot(pp, num)
          if (snap) {
            await writeFile(
              `${snapshotsDir}/${String(num).padStart(3, "0")}.snapshot.json`,
              JSON.stringify(snap, null, 2),
            )
          }
        }
      } catch {
        // snapshots optional
      }
    }

    if (includeMeta) {
      const metaDir = `${exportPath}/meta`
      await createDirectory(metaDir)

      try {
        const chars = await loadCharacterStates(pp)
        await writeFile(`${metaDir}/character-states.json`, JSON.stringify(chars, null, 2))
      } catch {
        // optional
      }

      try {
        const foreshadows = await loadForeshadowingTracker(pp)
        await writeFile(`${metaDir}/foreshadowing-tracker.json`, JSON.stringify(foreshadows, null, 2))
      } catch {
        // optional
      }

      try {
        const cognition = await loadCognitionState(pp)
        if (cognition) {
          await writeFile(`${metaDir}/cognition-state.json`, JSON.stringify(cognition, null, 2))
        }
      } catch {
        // optional
      }
    }

    return {
      success: true,
      exportedPath: exportPath,
      chapterCount,
      message: `导出完成：${chapterCount} 个章节`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, exportedPath: exportPath, chapterCount: 0, message }
  }
}