import { stripThoughtDumpFromText } from "@/lib/thought-dump"

/**
 * Gemini may stream its thought summary as ordinary text instead of a
 * structured `thought` part. Filter the completed payload, where the full
 * thought block can be recognized reliably, before exposing a de-AI result.
 */
export function filterDeAiOutput(content: string): string {
  return stripThoughtDumpFromText(content).trim()
}
