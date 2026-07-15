import type { Tool } from "../types"
import { readMarkdownResource, type ReadTextFile } from "./read-markdown-resource"
import { listDirectory, readFile } from "@/commands/fs"

function deriveProjectPathFromOutlinesDir(outlinesDir: string): string | null {
  const normalized = outlinesDir.replace(/\\/g, "/").replace(/\/$/, "")
  const match = normalized.match(/^(.*)\/(?:wiki|QM)\/outlines$/i)
  return match?.[1] ?? null
}

function outlineSnapshotOrder(name: string): number {
  const match = name.match(/^outline-(\d+)\.snapshot\.md$/i)
  return match?.[1] ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER
}

async function readOutlineSnapshots(
  outlinesDir: string,
  readTextFile: ReadTextFile,
): Promise<string | null> {
  const projectPath = deriveProjectPathFromOutlinesDir(outlinesDir)
  if (!projectPath) return null

  const snapshotDir = `${projectPath}/.novel/snapshots`
  let files: Array<{ name: string; path: string }> = []
  try {
    const nodes = await listDirectory(snapshotDir)
    files = nodes
      .filter((node) => !node.is_dir && /^outline-\d+\.snapshot\.md$/i.test(node.name))
      .map((node) => ({ name: node.name, path: node.path }))
      .sort((a, b) => outlineSnapshotOrder(a.name) - outlineSnapshotOrder(b.name))
      .slice(0, 8)
  } catch {
    return null
  }

  if (files.length === 0) return null

  const sections: string[] = []
  for (const file of files) {
    try {
      const content = await readTextFile(file.path)
      if (content.trim()) {
        sections.push(`## ${file.name}\n\n${content}`)
      }
    } catch {
      // 单个快照读取失败不影响其他快照。
    }
  }

  if (sections.length === 0) return null
  return [
    "未找到 wiki/outlines 下的独立大纲文件，已读取大纲快照：",
    "",
    ...sections,
  ].join("\n")
}

export function createReadOutlineTool(
  outlinesDir: string,
  readTextFile: ReadTextFile = readFile,
): Tool {
  return {
    name: "read_outline",
    description: "读取指定大纲文件的完整内容。参数 path 为大纲文件的完整路径，或 name 为大纲名称。",
    category: "read",
    parameters: {
      name: { type: "string", description: "大纲名称" },
      path: { type: "string", description: "大纲文件完整路径（可选，与 name 二选一）" },
    },
    execute: async (params) => {
      const result = await readMarkdownResource(outlinesDir, params, "大纲", readTextFile)
      if (!result.startsWith("错误：无法读取大纲")) return result

      const name = typeof params.name === "string" ? params.name : ""
      const path = typeof params.path === "string" ? params.path : ""
      const broadOutlineRequest = /大纲|outline/i.test(`${name} ${path}`)
      if (!broadOutlineRequest) return result

      return (await readOutlineSnapshots(outlinesDir, readTextFile)) ?? result
    },
  }
}
