import type { Tool } from "../types"
import { readMarkdownResource } from "./read-markdown-resource"
import { readFile } from "@/commands/fs"

const MEMORY_ALIAS_FILES: Array<{ fileName: string; label: string; patterns: RegExp[] }> = [
  {
    fileName: "character-states.md",
    label: "人物状态记忆",
    patterns: [/人物状态/, /角色状态/, /character[-_\s]?states?/i],
  },
  {
    fileName: "foreshadowing-tracker.md",
    label: "伏笔追踪记忆",
    patterns: [/伏笔/, /线索/, /foreshadow/i],
  },
  {
    fileName: "character-cognition.md",
    label: "人物认知记忆",
    patterns: [/人物认知/, /角色认知/, /认知状态/, /cognition/i],
  },
  {
    fileName: "timeline.md",
    label: "时间线记忆",
    patterns: [/时间线/, /timeline/i],
  },
  {
    fileName: "canon-facts.md",
    label: "事实设定记忆",
    patterns: [/事实/, /设定/, /canon/i],
  },
  {
    fileName: "conflicts.md",
    label: "冲突记忆",
    patterns: [/冲突/, /矛盾/, /conflicts?/i],
  },
  {
    fileName: "chapter-snapshots.md",
    label: "章节快照记忆",
    patterns: [/章节快照/, /章节摘要/, /chapter[-_\s]?snapshots?/i],
  },
]

function resolveMemoryAliasFiles(name: string): Array<{ fileName: string; label: string }> {
  const matches = MEMORY_ALIAS_FILES.filter((entry) =>
    entry.patterns.some((pattern) => pattern.test(name)),
  ).map(({ fileName, label }) => ({ fileName, label }))
  const seen = new Set<string>()
  return matches.filter((entry) => {
    if (seen.has(entry.fileName)) return false
    seen.add(entry.fileName)
    return true
  })
}

async function readMemoryAliases(memoryDir: string, name: string): Promise<string | null> {
  const aliasFiles = resolveMemoryAliasFiles(name)
  if (aliasFiles.length === 0) return null

  const sections: string[] = []
  for (const alias of aliasFiles) {
    try {
      const content = await readFile(`${memoryDir}/${alias.fileName}`)
      if (content.trim()) {
        sections.push(`## ${alias.label}\n\n${content}`)
      }
    } catch {
      // 缺失的结构化记忆文件交给通用读取兜底处理。
    }
  }

  if (sections.length === 0) return null
  return `已读取记忆条目「${name}」对应的结构化记忆：\n\n${sections.join("\n\n---\n\n")}`
}

export function createReadMemoryTool(memoryDir: string): Tool {
  return {
    name: "read_memory",
    description: "读取记忆库中的指定条目内容。参数 name 为记忆条目名称，或 path 为完整文件路径。",
    category: "read",
    parameters: {
      name: { type: "string", description: "记忆条目名称" },
      path: { type: "string", description: "记忆文件的完整路径（可选，与 name 二选一）" },
    },
    execute: async (params) => {
      const hasExplicitPath = typeof params.path === "string" && params.path.trim()
      const name = typeof params.name === "string" ? params.name.trim() : ""
      if (!hasExplicitPath && name) {
        const aliasResult = await readMemoryAliases(memoryDir, name)
        if (aliasResult) return aliasResult
      }
      return readMarkdownResource(memoryDir, params, "记忆条目")
    },
  }
}
