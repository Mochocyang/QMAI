import type { Tool } from "../types"
import { readFile, writeFile, fileExists } from "@/commands/fs"
import { isLikelyChapterOutline, summarizeChapterOutlineQuality } from "@/lib/novel/outline-quality-check"

function isJsonContent(text: string): boolean {
  const trimmed = text.trim()
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
}

function convertJsonToMarkdown(jsonText: string): string {
  try {
    const parsed = JSON.parse(jsonText)
    // Start at depth 3 because nodeTitle already uses ## (depth 2)
    return jsonObjectToMarkdown(parsed, 3)
  } catch {
    return jsonText
  }
}

function jsonObjectToMarkdown(value: unknown, depth: number): string {
  const heading = (): string => "#".repeat(Math.min(depth, 5))
  const indent = (): string => "  ".repeat(Math.max(0, depth - 2))

  if (value === null || value === undefined) return "（空）"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)

  if (Array.isArray(value)) {
    if (value.length === 0) return "（空列表）"
    return value.map((item) => {
      if (typeof item === "object" && item !== null) {
        const keys = Object.keys(item as Record<string, unknown>)
        if (keys.length <= 2) {
          // Simple objects like {主角: "xxx", 反派: "xxx"} → bullet with colon
          return `${indent()}- ${Object.entries(item as Record<string, unknown>)
            .map(([k, v]) => `${k}：${jsonObjectToMarkdown(v, depth + 1)}`)
            .join("，")}`
        }
        return `${indent()}- ${jsonObjectToMarkdown(item, depth + 1)}`
      }
      return `${indent()}- ${jsonObjectToMarkdown(item, depth + 1)}`
    }).join("\n")
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 0) return "（空对象）"
    return keys.map((key) => {
      const val = obj[key]
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        // Nested object → heading + sub bullets
        return `${heading()} ${key}\n\n${Object.entries(val as Record<string, unknown>)
          .map(([sk, sv]) => `${indent()}- ${sk}：${jsonObjectToMarkdown(sv, depth + 1)}`)
          .join("\n")}`
      }
      return `${heading()} ${key}\n\n${jsonObjectToMarkdown(val, depth + 1)}`
    }).join("\n\n")
  }

  return String(value)
}

export function buildOutlineNodeWriteContent(nodeTitle: string, nodeContent: string): string {
  const trimmed = nodeContent.trim()
  // If content is already pure Markdown headings, preserve it
  if (/^#{1,6}\s+/.test(trimmed)) return `${trimmed}\n`
  // If content looks like JSON, convert to readable Markdown
  if (isJsonContent(trimmed)) {
    const markdown = convertJsonToMarkdown(trimmed)
    if (markdown !== trimmed) {
      return `## ${nodeTitle}\n\n${markdown}\n`
    }
  }
  return `## ${nodeTitle}\n\n${trimmed}\n`
}

/** 补全缺失的 .md；已有其它扩展名时原样返回，交由校验拒绝。 */
export function normalizeOutlineWriteTarget(outlineName: string): string {
  const normalized = outlineName.replace(/\\/g, "/").trim()
  if (!normalized) return normalized
  const segments = normalized.split("/")
  const fileName = segments[segments.length - 1] ?? ""
  if (!fileName || fileName === "." || fileName === "..") return normalized
  if (/\.md$/i.test(fileName)) {
    segments[segments.length - 1] = fileName.replace(/\.md$/i, ".md")
    return segments.join("/")
  }
  if (/\.[A-Za-z0-9]+$/.test(fileName)) return normalized
  segments[segments.length - 1] = `${fileName}.md`
  return segments.join("/")
}

export function validateOutlineWriteTarget(outlineName: string): string | null {
  const normalized = outlineName.replace(/\\/g, "/").trim()
  if (!normalized) return "大纲文件名称不能为空。"
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    return "大纲文件名称不能使用绝对路径。"
  }
  if (normalized.split("/").some((part) => part === "..")) {
    return "大纲文件名称不能包含上级目录。"
  }
  if (!normalized.toLowerCase().endsWith(".md")) {
    return "大纲文件名称必须是 Markdown 文件。"
  }
  return null
}

function resolveOutlineWriteParams(params: Record<string, unknown>): {
  outlineName: string
  nodeTitle: string
  nodeContent: string
  targetError: string | null
} {
  const outlineName = normalizeOutlineWriteTarget(String(params.outlineName ?? ""))
  params.outlineName = outlineName
  return {
    outlineName,
    nodeTitle: String(params.nodeTitle ?? ""),
    nodeContent: String(params.nodeContent ?? ""),
    targetError: validateOutlineWriteTarget(outlineName),
  }
}

function buildChapterOutlineQualityText(outlineName: string, content: string): string {
  if (!isLikelyChapterOutline(content, outlineName)) return ""
  const quality = summarizeChapterOutlineQuality(content)
  if (quality.valid && quality.warnings.length === 0) {
    return "\n\n章纲质量检查：通过。"
  }
  const lines = ["", "", "章纲质量检查："]
  if (quality.errors.length > 0) {
    lines.push("错误：")
    lines.push(...quality.errors.map((item) => `- ${item}`))
  }
  if (quality.warnings.length > 0) {
    lines.push("警告：")
    lines.push(...quality.warnings.map((item) => `- ${item}`))
  }
  return lines.join("\n")
}

export function createWriteOutlineNodeTool(outlinesDir: string): Tool {
  return {
    name: "write_outline_node",
    description: "写入或更新大纲节点内容。参数 outlineName 为大纲 Markdown 文件名（可省略 .md，系统会自动补全），nodeTitle 为节点标题，nodeContent 为节点内容。将追加或更新对应节点。",
    category: "write",
    permission: "confirm",
    parameters: {
      outlineName: { type: "string", description: "大纲文件名称（.md；省略扩展名时自动补全）", required: true },
      nodeTitle: { type: "string", description: "节点标题", required: true },
      nodeContent: { type: "string", description: "节点内容", required: true },
    },
    generatePreview: async (params) => {
      const { outlineName, nodeTitle, nodeContent, targetError } = resolveOutlineWriteParams(params)
      if (targetError) throw new Error(`无法写入大纲：${targetError}`)
      const path = `${outlinesDir}/${outlineName}`
      const newSection = buildOutlineNodeWriteContent(nodeTitle, nodeContent)
      try {
        if (await fileExists(path)) {
          const originalContent = await readFile(path)
          const modeText = originalContent.includes(`## ${nodeTitle}`)
            ? "目标文件已存在，确认后仍不会直接覆盖。请先在中间编辑区确认，或另存为新版本。"
            : "目标文件已存在，确认后仍不会直接追加。请先选择覆盖、另存为新版本或追加修改说明。"
          return `无法直接写入「${outlineName}」：${modeText}\n\n预览：\n${newSection}${buildChapterOutlineQualityText(outlineName, newSection)}`
        }
      } catch {}
      return `将写入大纲「${outlineName}」\n\n预览：\n${newSection}${buildChapterOutlineQualityText(outlineName, newSection)}`
    },
    execute: async (params) => {
      const { outlineName, nodeTitle, nodeContent, targetError } = resolveOutlineWriteParams(params)
      if (targetError) return `错误：${targetError}`
      const path = `${outlinesDir}/${outlineName}`
      const content = buildOutlineNodeWriteContent(nodeTitle, nodeContent)
      try {
        if (await fileExists(path)) {
          return `错误：「${outlineName}」已存在。请选择覆盖、另存为新版本或追加修改说明后再保存，系统不会静默覆盖已有章纲。`
        }
        await writeFile(path, content)
        const verified = await readFile(path)
        if (verified !== content) {
          return `已写入大纲节点「${nodeTitle}」到「${outlineName}」，警告：写入后读回验证失败，请手动检查文件内容。`
        }
        return `已写入大纲节点「${nodeTitle}」到「${outlineName}」，读回验证通过。`
      } catch (err) {
        return `错误：写入大纲失败 — ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
