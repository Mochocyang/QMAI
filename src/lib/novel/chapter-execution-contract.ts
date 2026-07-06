import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"

export interface ChapterExecutionSceneStep {
  id: string
  title: string
  purpose: string
  conflict: string
  turn: string
  requiredOutcome: string
  acceptanceCriteria: string[]
}

export interface ChapterExecutionContract {
  objective: string
  knownContext: string[]
  assumptions: string[]
  sceneSteps: ChapterExecutionSceneStep[]
  mustDo: string[]
  mustAvoid: string[]
  dialogueGoals: string[]
  informationFlow: {
    reveal: string[]
    hide: string[]
    mislead: string[]
    foreshadow: string[]
  }
  finalHook: string
  freeSpace: string[]
}

export function createEmptyContract(): ChapterExecutionContract {
  return {
    objective: "",
    knownContext: [],
    assumptions: [],
    sceneSteps: [],
    mustDo: [],
    mustAvoid: [],
    dialogueGoals: [],
    informationFlow: {
      reveal: [],
      hide: [],
      mislead: [],
      foreshadow: [],
    },
    finalHook: "",
    freeSpace: [],
  }
}

export function buildChapterExecutionContractPrompt(planContent: string): string {
  return [
    "你是章节计划执行清单转换器。",
    "请把用户确认的主编策划案转换为 ChapterExecutionContract JSON。",
    "只输出 JSON，不输出 markdown 代码块、不解释、不写正文。",
    "",
    "JSON 字段要求：",
    "{",
    '  "objective": "本章执行目标",',
    '  "knownContext": ["已知上下文要点"],',
    '  "assumptions": ["缺失信息下的最小写作假设"],',
    '  "sceneSteps": [',
    '    {',
    '      "id": "S1",',
    '      "title": "场景名",',
    '      "purpose": "本场景目的",',
    '      "conflict": "本场景冲突",',
    '      "turn": "本场景转折",',
    '      "requiredOutcome": "完成后状态",',
    '      "acceptanceCriteria": ["可检查的验收标准"]',
    "    }",
    "  ],",
    '  "mustDo": ["必须执行项"],',
    '  "mustAvoid": ["禁止违背项"],',
    '  "dialogueGoals": ["对话攻防目标"],',
    '  "informationFlow": {',
    '    "reveal": ["本章释放的信息"],',
    '    "hide": ["本章继续隐藏的信息"],',
    '    "mislead": ["允许误导读者的信息"],',
    '    "foreshadow": ["需要埋下的伏笔"]',
    "  },",
    '  "finalHook": "章末钩子",',
    '  "freeSpace": ["可自由发挥范围"]',
    "}",
    "",
    "要求：",
    "1. sceneSteps 必须保留 S1/S2/S3 等执行顺序，不得合并、跳过或调换。",
    "2. acceptanceCriteria 必须写成可检查的完成标准。",
    "3. informationFlow 必须使用 reveal/hide/mislead/foreshadow 四组数组。",
    "4. 不要写章节成稿，不要复述无关解释。",
    "",
    "用户确认的主编策划案：",
    planContent.trim(),
  ].join("\n")
}

export async function runChapterExecutionContractBuild(
  llmConfig: LlmConfig,
  planContent: string,
  signal?: AbortSignal,
): Promise<ChapterExecutionContract> {
  if (!planContent.trim()) return createEmptyContract()

  let responseText = ""
  let streamError: Error | null = null

  await streamChat(
    llmConfig,
    [{ role: "user", content: buildChapterExecutionContractPrompt(planContent) }],
    {
      onToken: (token: string) => {
        responseText += token
      },
      onDone: () => {},
      onError: (error: Error) => {
        streamError = error
      },
    },
    signal,
  )

  if (streamError) throw streamError

  try {
    return parseChapterExecutionContractJson(responseText)
  } catch {
    return fallbackParseChapterExecutionContract(planContent)
  }
}

export function parseChapterExecutionContractJson(text: string): ChapterExecutionContract {
  const jsonText = extractJsonText(text)
  const parsed = JSON.parse(jsonText) as Record<string, unknown>
  return normalizeContract(parsed)
}

export function fallbackParseChapterExecutionContract(planContent: string): ChapterExecutionContract {
  const lines = planContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const contract = createEmptyContract()

  contract.objective = collectSectionText(lines, /本章目标|章节目标|目标/, /读者期待|章节推进|分场景策划|人物动机|信息流|结尾钩子|章末钩子|风险提醒/) || firstPlainLine(lines)
  contract.sceneSteps = parseSceneSteps(lines)
  contract.finalHook = collectSectionText(lines, /结尾钩子|章末钩子/, /风险提醒|必须避免|禁止/) || collectInlineValue(lines, /^(?:结尾钩子|章末钩子|钩子)[：:]\s*(.+)$/)
  contract.mustAvoid = unique([
    ...collectBulletSection(lines, /风险提醒|必须避免|禁止/),
    ...collectInlineValues(lines, /^(?:风险提醒|风险|必须避免|禁止|不得|不要)[：:]\s*(.+)$/),
  ])
  contract.mustDo = unique([
    ...collectBulletSection(lines, /必须完成|必须执行/),
    ...collectInlineValues(lines, /^(?:必须完成|必须执行|要做)[：:]\s*(.+)$/),
    ...contract.sceneSteps.map((step) => step.requiredOutcome).filter(Boolean),
    contract.finalHook,
  ].filter(Boolean))
  contract.freeSpace = ["可补足环境、动作、心理、过渡和细节，但不得改变必须执行、禁止违背和章末钩子。"]

  return contract
}

export function contractToTaskBriefText(contract: ChapterExecutionContract): string {
  const lines = [
    "## 写作任务书",
    "",
    `本章目标：${contract.objective || "按用户确认的章节策划案生成完整章节。"}`,
  ]

  if (contract.knownContext.length > 0) lines.push("", ...formatList("已知上下文", contract.knownContext))
  if (contract.assumptions.length > 0) lines.push("", ...formatList("执行假设", contract.assumptions))

  lines.push("", "## 执行顺序")
  for (const step of contract.sceneSteps) {
    lines.push(`### ${step.id || "S?"}：${step.title || "未命名场景"}`)
    if (step.purpose) lines.push(`目的：${step.purpose}`)
    if (step.conflict) lines.push(`冲突：${step.conflict}`)
    if (step.turn) lines.push(`转折：${step.turn}`)
    lines.push(`必须完成：${joinOrFallback(step.acceptanceCriteria, step.requiredOutcome || "完成本场景输出结果")}`)
    lines.push(`禁止违背：${joinOrFallback(contract.mustAvoid, "不得违背已知设定、人物认知和时间线")}`)
    lines.push(`完成后状态：${step.requiredOutcome || "场景状态发生明确变化"}`)
    lines.push("")
  }

  lines.push("## 全章硬约束")
  lines.push(`必须执行：${joinOrFallback(contract.mustDo, "完成本章目标和所有场景输出结果")}`)
  lines.push(`禁止违背：${joinOrFallback(contract.mustAvoid, "不得提前泄密、不得人物认知越界、不得只解释不行动")}`)
  if (contract.dialogueGoals.length > 0) lines.push(`对话目标：${contract.dialogueGoals.join("；")}`)

  const flowLines = formatInformationFlow(contract.informationFlow)
  if (flowLines.length > 0) lines.push("", "## 信息流", ...flowLines)

  lines.push("", "## 章末钩子")
  lines.push(contract.finalHook || "留下自然导向下一章的未解决问题。")
  lines.push("", "## 可自由发挥")
  lines.push(joinOrFallback(contract.freeSpace, "环境、动作、心理和过渡细节。"))

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function normalizeContract(parsed: Record<string, unknown>): ChapterExecutionContract {
  return {
    objective: asString(parsed.objective),
    knownContext: asStringArray(parsed.knownContext),
    assumptions: asStringArray(parsed.assumptions),
    sceneSteps: normalizeSceneSteps(parsed.sceneSteps),
    mustDo: asStringArray(parsed.mustDo),
    mustAvoid: asStringArray(parsed.mustAvoid),
    dialogueGoals: asStringArray(parsed.dialogueGoals),
    informationFlow: normalizeInformationFlow(parsed.informationFlow),
    finalHook: asString(parsed.finalHook),
    freeSpace: asStringArray(parsed.freeSpace),
  }
}

function normalizeSceneSteps(value: unknown): ChapterExecutionSceneStep[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      const record = isRecord(item) ? item : {}
      const requiredOutcome = asString(record.requiredOutcome) || asString(record.outputResult)
      return {
        id: asString(record.id) || `S${index + 1}`,
        title: asString(record.title),
        purpose: asString(record.purpose),
        conflict: asString(record.conflict),
        turn: asString(record.turn),
        requiredOutcome,
        acceptanceCriteria: asStringArray(record.acceptanceCriteria),
      }
    })
    .filter((step) => step.title || step.requiredOutcome || step.acceptanceCriteria.length > 0)
}

function normalizeInformationFlow(value: unknown): ChapterExecutionContract["informationFlow"] {
  if (isRecord(value)) {
    return {
      reveal: asStringArray(value.reveal),
      hide: asStringArray(value.hide),
      mislead: asStringArray(value.mislead),
      foreshadow: asStringArray(value.foreshadow),
    }
  }
  return {
    reveal: asStringArray(value),
    hide: [],
    mislead: [],
    foreshadow: [],
  }
}

function parseSceneSteps(lines: string[]): ChapterExecutionSceneStep[] {
  const scenes: ChapterExecutionSceneStep[] = []
  let current: ChapterExecutionSceneStep | null = null

  for (const line of lines) {
    const cleaned = cleanLine(line)
    const sceneMatch = /^(S\d+)[\s:：.、．-]*(.+)$/i.exec(cleaned)
    if (sceneMatch) {
      current = {
        id: sceneMatch[1].toUpperCase(),
        title: sceneMatch[2].trim(),
        purpose: "",
        conflict: "",
        turn: "",
        requiredOutcome: "",
        acceptanceCriteria: [],
      }
      scenes.push(current)
      continue
    }

    if (!current) continue
    assignSceneField(current, cleaned)
  }

  return scenes.map((scene) => ({
    ...scene,
    acceptanceCriteria: scene.acceptanceCriteria.length > 0
      ? scene.acceptanceCriteria
      : [scene.requiredOutcome].filter(Boolean),
  }))
}

function assignSceneField(scene: ChapterExecutionSceneStep, line: string): void {
  const field = /^(目的|冲突|转折|输出结果|验收标准)[：:]\s*(.+)$/.exec(line)
  if (!field) return
  const content = field[2].trim()
  if (field[1] === "目的") scene.purpose = content
  if (field[1] === "冲突") scene.conflict = content
  if (field[1] === "转折") scene.turn = content
  if (field[1] === "输出结果") scene.requiredOutcome = content
  if (field[1] === "验收标准") scene.acceptanceCriteria = splitList(content)
}

function extractJsonText(text: string): string {
  const trimmed = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenced) return fenced[1].trim()

  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

function collectSectionText(lines: string[], startPattern: RegExp, endPattern: RegExp): string {
  const start = lines.findIndex((line) => startPattern.test(line))
  if (start < 0) return ""
  const inline = lineValueAfterColon(lines[start])
  if (inline) return inline

  const values: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/.test(line)) {
      if (endPattern.test(line)) break
      break
    }
    if (/^S\d+[\s:：.、．-]/i.test(cleanLine(line))) break
    values.push(cleanLine(line))
  }
  return values.join(" ").trim()
}

function collectBulletSection(lines: string[], startPattern: RegExp): string[] {
  const start = lines.findIndex((line) => startPattern.test(line))
  if (start < 0) return []
  const values: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/.test(line)) break
    if (/^[-*]\s+/.test(line)) values.push(cleanLine(line))
  }
  return unique(values)
}

function collectInlineValue(lines: string[], pattern: RegExp): string {
  return collectInlineValues(lines, pattern)[0] ?? ""
}

function collectInlineValues(lines: string[], pattern: RegExp): string[] {
  return unique(lines.map((line) => pattern.exec(cleanLine(line))?.[1]?.trim() ?? "").filter(Boolean))
}

function firstPlainLine(lines: string[]): string {
  return lines.find((line) => !/^#{1,6}\s+/.test(line) && !/^S\d+[\s:：.、．-]/i.test(cleanLine(line)) && !/^[-*]\s+/.test(line)) ?? ""
}

function lineValueAfterColon(line: string): string {
  return /^[^：:]+[：:]\s*(.+)$/.exec(cleanLine(line))?.[1]?.trim() ?? ""
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return unique(value.map(asString).filter(Boolean))
  }
  if (typeof value === "string") {
    return splitList(value)
  }
  return []
}

function splitList(value: string): string[] {
  return unique(value.split(/\r?\n|[；;]/).map((item) => item.trim()).filter(Boolean))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function cleanLine(line: string): string {
  return line.replace(/^[-*]\s*/, "").trim()
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function joinOrFallback(values: string[], fallback: string): string {
  return values.filter(Boolean).join("；") || fallback
}

function formatList(title: string, values: string[]): string[] {
  return [`${title}：`, ...values.map((value) => `- ${value}`)]
}

function formatInformationFlow(flow: ChapterExecutionContract["informationFlow"]): string[] {
  return [
    flow.reveal.length > 0 ? `释放：${flow.reveal.join("；")}` : "",
    flow.hide.length > 0 ? `隐藏：${flow.hide.join("；")}` : "",
    flow.mislead.length > 0 ? `误导：${flow.mislead.join("；")}` : "",
    flow.foreshadow.length > 0 ? `伏笔：${flow.foreshadow.join("；")}` : "",
  ].filter(Boolean)
}
