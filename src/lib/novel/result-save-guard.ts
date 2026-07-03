import { buildResultProtocolTrace, type ResultProtocolTrace } from "./result-parser"

export interface ChapterSaveValidationResult {
  ok: boolean
  trace: ResultProtocolTrace
  message?: string
}

export function validateChapterBeforeSave(content: string): ChapterSaveValidationResult {
  const trace = buildResultProtocolTrace("chapter", content)
  if (trace.valid) {
    return { ok: true, trace }
  }

  const details = [
    ...trace.errors,
    ...trace.warnings,
  ].filter(Boolean).join("；")

  return {
    ok: false,
    trace,
    message: `章节结果校验未通过${details ? `：${details}` : ""}`,
  }
}
