import { parseAgentResponse } from "@/lib/novel/agent-parser"
import { cleanGeneratedChapterContentForSave } from "@/lib/novel/chapter-content-cleanup"

const WORKFLOW_FINAL_CONTENT_MARKER = "最终正文："
const ASSISTANT_ERROR_SUFFIX_RE = /(?:^|\n{1,2})出错：[\s\S]*$/

export type CopyableToolCall = {
  name: string
  result?: string
  status?: string
}

function stripHiddenAssistantBlocks(content: string): string {
  let result = content
    .replace(/<!--.*?-->/gs, "")

  // 1. 移除完整的 <think>...</think> 或 <thinking>...</thinking> 块
  result = result.replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")

  // 2. 移除未闭合的开头思考块（有 <think> 但没有 </think>）
  result = result.replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "")

  // 3. 移除只有结尾标签的情况：如果内容开头到第一个 </think> 之间没有 <think> 开头标签，
  //    说明思考内容直接输出在了正文前面，需要一并移除
  const firstCloseIndex = result.search(/<\/think(?:ing)?>/i)
  if (firstCloseIndex >= 0) {
    const beforeClose = result.slice(0, firstCloseIndex)
    if (!/<think(?:ing)?>/i.test(beforeClose)) {
      // 前面没有开头标签，把开头到第一个结尾标签都删掉
      result = result.replace(/^[\s\S]*?<\/think(?:ing)?>\s*/i, "")
    }
  }

  return result.trim()
}

function isChapterEditPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase()
  return normalized.startsWith("wiki/chapters/") && normalized.endsWith(".md")
}

function stripAssistantErrorSuffix(content: string): string {
  return content.replace(ASSISTANT_ERROR_SUFFIX_RE, "").trim()
}

/** 从 run_chapter_workflow 工具结果中提取「最终正文」段。 */
export function extractWorkflowFinalContent(result: string | undefined): string {
  if (!result?.trim()) return ""
  const markerIndex = result.lastIndexOf(WORKFLOW_FINAL_CONTENT_MARKER)
  if (markerIndex < 0) return ""
  return result.slice(markerIndex + WORKFLOW_FINAL_CONTENT_MARKER.length).replace(/^\n+/, "").trim()
}

/** 从已完成的章节工作流工具调用中取最新一份最终正文。 */
export function extractChapterBodyFromToolCalls(
  toolCalls: CopyableToolCall[] | undefined,
): string {
  if (!toolCalls?.length) return ""
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const call = toolCalls[i]
    if (call.name !== "run_chapter_workflow") continue
    if (call.status === "error" || call.status === "cancelled") continue
    const body = extractWorkflowFinalContent(call.result)
    if (body) return body
  }
  return ""
}

export function getCopyableAssistantContent(
  content: string,
  options?: { toolCalls?: CopyableToolCall[] },
): string {
  const parsed = parseAgentResponse(content)
  const chapterEditReplacements = parsed.edits
    .filter((edit) => isChapterEditPath(edit.filePath) && edit.replace.trim())
    .map((edit) => cleanGeneratedChapterContentForSave(edit.replace).trim())
    .filter(Boolean)

  if (chapterEditReplacements.length > 0) {
    return chapterEditReplacements.join("\n\n").trim()
  }

  const fromContent = stripAssistantErrorSuffix(
    stripHiddenAssistantBlocks(parsed.textContent || content),
  )
  if (fromContent) {
    return fromContent
  }

  const fromWorkflow = extractChapterBodyFromToolCalls(options?.toolCalls)
  if (fromWorkflow) return fromWorkflow

  return ""
}
