import { stripThoughtDumpFromText } from "@/lib/thought-dump"

/**
 * corpus-stat skill asks the model to check style docs first. Some models
 * write that checklist into the returned body.
 */
const STYLE_DOC_PROCESS_PREFIX_RE = /^(?:先核对(?:工作区)?是否有风格文档[，,]再按规则逐句处理正文。\s*)+/

/**
 * Gemini may stream its thought summary as ordinary text instead of a
 * structured `thought` part. Filter the completed payload, where the full
 * thought block can be recognized reliably, before exposing a de-AI result.
 */
export function filterDeAiOutput(content: string): string {
  return stripThoughtDumpFromText(content).trim().replace(STYLE_DOC_PROCESS_PREFIX_RE, "").trim()
}
