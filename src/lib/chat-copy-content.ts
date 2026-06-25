import { parseAgentResponse } from "@/lib/novel/agent-parser"
import { cleanGeneratedChapterContentForSave } from "@/lib/novel/chapter-content-cleanup"

function stripHiddenAssistantBlocks(content: string): string {
  return content
    .replace(/<!--.*?-->/gs, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "")
    .trim()
}

function isChapterEditPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase()
  return normalized.startsWith("wiki/chapters/") && normalized.endsWith(".md")
}

export function getCopyableAssistantContent(content: string): string {
  const parsed = parseAgentResponse(content)
  const chapterEditReplacements = parsed.edits
    .filter((edit) => isChapterEditPath(edit.filePath) && edit.replace.trim())
    .map((edit) => cleanGeneratedChapterContentForSave(edit.replace).trim())
    .filter(Boolean)

  if (chapterEditReplacements.length > 0) {
    return chapterEditReplacements.join("\n\n").trim()
  }

  return stripHiddenAssistantBlocks(parsed.textContent || content)
}
