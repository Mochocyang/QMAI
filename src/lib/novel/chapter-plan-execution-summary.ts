const DEFAULT_PLAN_EXECUTION_SUMMARY_MAX_CHARS = 1800

const EXECUTION_KEYWORD_PATTERN =
  /维度[一二三四五六七]|^S\d+[\s:：.、．-]|本章目标|章节目标|场景|戏剧功能|信息流|伏笔|边界|禁忌|对话目标|爽点|期待点|开头|结尾|钩子|水文|冲突|人物|必须|禁止|不得|可自由|自由发挥|mustDo|mustAvoid|canon|timeline|cognition/i

const LOW_VALUE_LINE_PATTERN =
  /感谢确认|下面开始|下面才会|工具流程|计划来源|帮助模型理解|不属于正文|补充说明/i

const TRUNCATION_MARKER = "（计划执行摘要已截断，保留关键执行约束。）"

export function buildChapterPlanExecutionSummary(
  planContent: string,
  maxChars = DEFAULT_PLAN_EXECUTION_SUMMARY_MAX_CHARS,
): string {
  const normalized = planContent.trim()
  if (!normalized) return ""

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const executionLines = lines.filter(
    (line) => EXECUTION_KEYWORD_PATTERN.test(line) && !LOW_VALUE_LINE_PATTERN.test(line),
  )
  const header = "用户已确认的章节计划执行摘要："
  const sourceLines = executionLines.length > 0 ? executionLines : lines
  const summary = [
    header,
    `本章目标：${extractFirstValue(sourceLines, /本章目标|章节目标|维度[一二]/)}`,
    "场景序列：",
    ...extractSceneItems(sourceLines).map((scene, index) => `S${index + 1} ${scene}`),
    `必须执行：${joinValues(extractValues(sourceLines, /必须|mustDo|推进|完成|维度三|维度五/))}`,
    `禁止违背：${joinValues(extractValues(sourceLines, /禁止|不得|不能|避免|mustAvoid|边界|禁忌|canon|timeline|cognition|提前|维度六/))}`,
    `可自由发挥：${extractFirstValue(sourceLines, /可自由|自由发挥/) || "可补足环境、动作、心理、过渡和细节，但不得改变必须执行与禁止违背内容。"}`,
    `对话目标：${extractFirstValue(sourceLines, /对话目标/)}`,
    `伏笔动作：${joinValues(extractValues(sourceLines, /伏笔|埋设|回收/))}`,
    `结尾钩子：${extractFirstValue(sourceLines, /结尾|钩子|维度七/)}`,
  ]
    .filter((line) => line.trim())
    .join("\n")
  const summaryWithFallback = ensureSummaryQuality(summary, sourceLines)

  const omittedLowValueLines = executionLines.length > 0 && executionLines.length < lines.length
  const shouldMarkTruncated = omittedLowValueLines || summaryWithFallback.length > maxChars

  return capSummary(summaryWithFallback, maxChars, shouldMarkTruncated)
}

function extractValues(lines: string[], pattern: RegExp): string[] {
  return unique(lines.filter((line) => pattern.test(line)).map(cleanPlanLine).filter(Boolean))
}

function extractFirstValue(lines: string[], pattern: RegExp): string {
  return extractValues(lines, pattern)[0] ?? ""
}

function extractSceneItems(lines: string[]): string[] {
  const sceneIndex = lines.findIndex((line) => /场景序列|维度四/.test(line))
  if (sceneIndex < 0) return []

  const sceneContents: string[] = []
  const headerContent = cleanPlanLine(lines[sceneIndex])
  if (headerContent) sceneContents.push(headerContent)

  for (const line of lines.slice(sceneIndex + 1)) {
    if (/^维度[一二三五六七]/.test(line)) break
    if (/^S\d+[\s:：.、．-]/i.test(line)) {
      sceneContents.push(line)
    }
  }

  return unique(sceneContents.flatMap(parseSceneLine))
}

function parseSceneLine(line: string): string[] {
  const content = cleanPlanLine(line)
  const numbered = content
    .replace(/(?:^|[；;]\s*)(?:S)?(\d+)[.、．]\s*/gi, "\n")
    .split(/\n|[；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
  const items = numbered.length > 0 ? numbered : [content]
  return items
    .map((item) => item.replace(/^S\d+[\s:：.、．-]*/i, "").trim())
    .filter(Boolean)
}

function cleanPlanLine(line: string): string {
  return line
    .replace(/^[-*]\s*/, "")
    .replace(/^维度[一二三四五六七][^：:]*[：:]\s*/, "")
    .replace(/^(本章目标|章节目标|场景序列编排|场景序列|对话目标|结尾钩子|伏笔动作|边界与禁忌)[：:]\s*/, "")
    .trim()
}

function joinValues(values: string[]): string {
  return values.join("；")
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function capSummary(summary: string, maxChars: number, withMarker: boolean): string {
  if (!withMarker && summary.length <= maxChars) return summary.trim()
  const markerPart = `\n${TRUNCATION_MARKER}`
  const available = Math.max(80, maxChars - markerPart.length)
  if (summary.length <= available) return `${summary}${markerPart}`.trim()
  return `${summary.slice(0, available).trimEnd()}${markerPart}`.trim()
}

function ensureSummaryQuality(summary: string, sourceLines: string[]): string {
  const hasSceneId = /\nS\d+\s+\S/.test(summary)
  const hasForbidden = /禁止违背：\S/.test(summary)
  const hasEndingHook = /结尾钩子：\S/.test(summary)
  if (hasSceneId && hasForbidden && hasEndingHook) return summary

  const fallbackLines = sourceLines
    .filter((line) => /维度四|场景序列|维度六|边界|禁忌|禁止|不得|维度七|结尾|钩子/.test(line))
    .slice(0, 6)
  if (fallbackLines.length === 0) return summary

  return [
    summary,
    "",
    "原计划关键片段：",
    ...fallbackLines,
  ].join("\n")
}
