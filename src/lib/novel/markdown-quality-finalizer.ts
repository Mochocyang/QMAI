import {
  hasMarkdownContentChanged,
  inspectStructuredMarkdown,
  isStructuredMarkdownMaterial,
  isWholeDocumentMarkdownFence,
  repairStructuredMarkdownLocally,
  type MarkdownQualityInspection,
} from "./markdown-quality-pipeline"

interface MarkdownRepairMessage {
  role: "user"
  content: string
}

interface MarkdownAiRepairRequest {
  content: string
  maxTokens: number
}

interface FinalizeStructuredMarkdownOptions {
  enabled: boolean
  repairWithAi: (request: MarkdownAiRepairRequest) => Promise<string>
  onFailure: () => void
}

export const MARKDOWN_AI_REPAIR_MAX_INPUT_TOKENS = 3200
export const MARKDOWN_AI_REPAIR_PROMPT_TOKEN_OVERHEAD = 80
const MARKDOWN_AI_REPAIR_MIN_OUTPUT_TOKENS = 256
const MARKDOWN_AI_REPAIR_MAX_OUTPUT_TOKENS = 4096

export function estimateMarkdownRepairTokens(text: string): number {
  if (!text.trim()) return 0
  let tokens = 0
  const withoutEnglishWords = text.replace(
    /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?/g,
    (word) => {
      tokens += Math.max(1, Math.ceil(word.length / 5))
      return " ".repeat(word.length)
    },
  )
  for (const character of withoutEnglishWords) {
    if (character === "\n") {
      tokens += 1
      continue
    }
    if (/\s/u.test(character)) continue
    // CJK?emoji??? Unicode ????????? Unicode ?????
    tokens += 1
  }
  return tokens
}

export function planMarkdownAiRepair(content: string): {
  estimatedInputTokens: number
  maxOutputTokens: number
  shouldCallAi: boolean
} {
  const bodyTokens = estimateMarkdownRepairTokens(content)
  const estimatedInputTokens = bodyTokens + MARKDOWN_AI_REPAIR_PROMPT_TOKEN_OVERHEAD
  return {
    estimatedInputTokens,
    maxOutputTokens: Math.min(
      MARKDOWN_AI_REPAIR_MAX_OUTPUT_TOKENS,
      Math.max(
        MARKDOWN_AI_REPAIR_MIN_OUTPUT_TOKENS,
        Math.ceil(bodyTokens * 1.1) + 128,
      ),
    ),
    shouldCallAi: estimatedInputTokens <= MARKDOWN_AI_REPAIR_MAX_INPUT_TOKENS,
  }
}

export function buildMarkdownRepairRequestOverrides(maxTokens: number): {
  temperature: number
  max_tokens: number
} {
  return { temperature: 0, max_tokens: maxTokens }
}

interface MarkdownMessageParts {
  body: string
  protocol: string
}

function splitTrailingSaveProtocol(content: string): MarkdownMessageParts {
  const trimmedEnd = content.trimEnd()
  const match = /(```json[ \t]*(?:\r?\n)?([\s\S]*?)```)[ \t]*$/i.exec(trimmedEnd)
  if (!match || match.index === undefined) {
    return { body: content.replace(/\r\n?/g, "\n").trim(), protocol: "" }
  }

  try {
    const payload = JSON.parse(match[2]?.trim() ?? "") as Record<string, unknown>
    if (!("outlineSaveRequest" in payload) && !("outlineSaveRequests" in payload)) {
      return { body: content.replace(/\r\n?/g, "\n").trim(), protocol: "" }
    }
  } catch {
    return { body: content.replace(/\r\n?/g, "\n").trim(), protocol: "" }
  }

  return {
    body: trimmedEnd.slice(0, match.index).replace(/\r\n?/g, "\n").trim(),
    protocol: match[1] ?? "",
  }
}

function joinMessageParts(body: string, protocol: string): string {
  return protocol ? `${body.trim()}\n\n${protocol}` : body.trim()
}

export function buildMarkdownFormatRepairMessages(
  content: string,
): MarkdownRepairMessage[] {
  return [{
    role: "user",
    content: [
      "只修复下列正文的 Markdown 格式，不增删、改写或总结内容。",
      "规则：保留一级标题；** 必须成对；不要用代码围栏包裹全文；表格保留或补齐分隔行。",
      "只返回修复后的正文。",
      content,
    ].join("\n\n"),
  }]
}

export async function finalizeStructuredMarkdownMessage(
  messageContent: string,
  options: FinalizeStructuredMarkdownOptions,
): Promise<string> {
  if (!options.enabled) return messageContent

  const parts = splitTrailingSaveProtocol(messageContent)
  const originalBody = parts.body
  if (
    !isWholeDocumentMarkdownFence(originalBody)
    && !isStructuredMarkdownMaterial(originalBody)
  ) return messageContent

  const initialInspection = inspectStructuredMarkdown(originalBody)
  if (initialInspection.valid) return messageContent

  const localContent = repairStructuredMarkdownLocally(originalBody)
  const localInspection = inspectStructuredMarkdown(localContent)
  const localContentChanged = hasMarkdownContentChanged(originalBody, localContent)
  if (localInspection.valid && !localContentChanged) {
    return joinMessageParts(localContent, parts.protocol)
  }

  const candidates: Array<{
    content: string
    inspection: MarkdownQualityInspection
  }> = [{ content: originalBody, inspection: initialInspection }]
  if (!localContentChanged) {
    candidates.push({ content: localContent, inspection: localInspection })
  }

  const aiInput = localContentChanged ? originalBody : localContent
  const aiPlan = planMarkdownAiRepair(aiInput)
  if (!aiPlan.shouldCallAi) {
    const best = candidates.reduce((current, candidate) =>
      candidate.inspection.issues.length < current.inspection.issues.length
        ? candidate
        : current,
    )
    options.onFailure()
    return joinMessageParts(best.content, parts.protocol)
  }

  let aiContent = aiInput
  try {
    aiContent = (await options.repairWithAi({
      content: aiInput,
      maxTokens: aiPlan.maxOutputTokens,
    })).trim()
  } catch {
    // AI 格式修复失败时仍执行第三检，并保留已有完整候选。
  }

  const aiInspection = inspectStructuredMarkdown(aiContent)
  const aiContentChanged = hasMarkdownContentChanged(originalBody, aiContent)
  if (aiInspection.valid && !aiContentChanged) {
    return joinMessageParts(aiContent, parts.protocol)
  }
  if (!aiContentChanged) {
    candidates.push({ content: aiContent, inspection: aiInspection })
  }

  const best = candidates.reduce((current, candidate) =>
    candidate.inspection.issues.length < current.inspection.issues.length
      ? candidate
      : current,
  )
  options.onFailure()
  return joinMessageParts(best.content, parts.protocol)
}
