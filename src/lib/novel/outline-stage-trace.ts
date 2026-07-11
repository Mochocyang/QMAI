import type { ToolCallRecord } from "@/lib/agent/tool-events"

export type OutlineStageKind =
  | "intent"
  | "scope"
  | "skill"
  | "context"
  | "tool"
  | "thinking"
  | "generation"

export type OutlineStageStatus = "hidden" | "active" | "done"

export interface OutlineStage {
  kind: OutlineStageKind
  title: string
  status: OutlineStageStatus
  summary: string
  details: string[]
  thinkingContent?: string
  thinkingStreaming?: boolean
  startedAt?: number
  finishedAt?: number
}

export interface OutlineStageInput {
  toolCalls: ToolCallRecord[]
  content: string
  isStreaming: boolean
}

const LIST_TOOLS = new Set(["list_chapters", "list_outlines", "list_memories", "list_deductions"])
const READ_TOOLS = new Set(["read_chapter", "read_outline", "read_memory", "read_deduction", "read_chat_history"])
const SKILL_TOOLS = new Set(["apply_skill"])
const ROUTE_TOOLS = new Set(["route_task"])
const WRITE_TOOLS = new Set(["write_outline_node", "write_chapter_outline"])
const INTENT_CLARITY_PATTERN = /<!--\s*intent_clarity\s*-->([\s\S]*?)<!--\s*\/intent_clarity\s*-->/i
const THINKING_PATTERN = /<(think|thinking)>/i

function hasIntentClarity(content: string): boolean {
  return INTENT_CLARITY_PATTERN.test(content)
}

function hasThinking(content: string): boolean {
  return THINKING_PATTERN.test(content)
}

export function extractThinkingContent(content: string): { text: string; streaming: boolean } {
  if (!content) return { text: "", streaming: false }

  const parts: string[] = []
  let streaming = false
  const pattern = /<(think|thinking)>([\s\S]*?)(?:<\/\1>|$)/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const text = match[2].trim()
    if (text) parts.push(text)
    if (!match[0].toLowerCase().endsWith(`</${match[1].toLowerCase()}>`)) {
      streaming = true
    }
    if (match.index === pattern.lastIndex) {
      pattern.lastIndex++
    }
  }

  return { text: parts.join("\n\n"), streaming }
}

function hasGenerationStarted(content: string): boolean {
  if (!content) return false
  let idx = 0
  while (idx < content.length) {
    const thinkStart = content.indexOf("<thinking", idx)
    if (thinkStart === -1) {
      const clarityStart = content.indexOf("<!-- intent_clarity", idx)
      if (clarityStart === -1) {
        return content.slice(idx).trim().length > 0
      }
      if (clarityStart > idx && content.slice(idx, clarityStart).trim().length > 0) {
        return true
      }
      const clarityEnd = content.indexOf("<!-- /intent_clarity -->", clarityStart)
      idx = clarityEnd >= 0 ? clarityEnd + 24 : clarityStart + 1
      continue
    }
    if (thinkStart > idx && content.slice(idx, thinkStart).trim().length > 0) {
      return true
    }
    const thinkEnd = content.indexOf("</thinking>", thinkStart)
    if (thinkEnd === -1) {
      return false
    }
    idx = thinkEnd + 11
  }
  return false
}

export function buildOutlineStages(input: OutlineStageInput): OutlineStage[] {
  const { toolCalls, content, isStreaming } = input

  const routeCalls = toolCalls.filter((c) => ROUTE_TOOLS.has(c.name))
  const skillCalls = toolCalls.filter((c) => SKILL_TOOLS.has(c.name))
  const readCalls = toolCalls.filter((c) => LIST_TOOLS.has(c.name) || READ_TOOLS.has(c.name))
  const writeCalls = toolCalls.filter((c) => WRITE_TOOLS.has(c.name))
  const hasRoute = routeCalls.length > 0
  const hasSkill = skillCalls.length > 0
  const hasRead = readCalls.length > 0
  const hasWrite = writeCalls.length > 0
  const hasClarity = hasIntentClarity(content)
  const hasThinkingBlock = hasThinking(content)
  const hasOutput = hasGenerationStarted(content)
  const thinkingExtract = extractThinkingContent(content)

  const activations = [hasRoute, hasClarity, hasSkill, hasRead, hasWrite, hasThinkingBlock, hasOutput]

  let clarityModule = ""
  let clarityAnalysis = ""
  const clarityMatch = content.match(INTENT_CLARITY_PATTERN)
  if (clarityMatch) {
    try {
      const payload = JSON.parse(clarityMatch[1].trim())
      clarityModule = String(payload.module ?? "")
      clarityAnalysis = String(payload.analysis ?? "")
    } catch {}
  }

  const summaries: string[] = [
    hasRoute ? `路由到${routeCalls.map(c => c.name).join("、")}` : "",
    hasClarity ? (clarityModule ? `${clarityModule}：${clarityAnalysis || "范围已明确"}` : "范围分析完成") : "",
    hasSkill ? `已加载${skillCalls.map(c => c.name).join("、")}` : "",
    hasRead ? `读取了${readCalls.length}个资料` : "",
    hasWrite ? `调用${writeCalls.length}个写入工具` : "",
    hasThinkingBlock ? "角色与情节推理中" : "",
    hasOutput ? "内容生成完成" : "",
  ]

  const detailsList: string[][] = [
    hasRoute ? routeCalls.map((c) => `${c.name}（${c.status}）`) : [],
    hasClarity ? [clarityModule, clarityAnalysis].filter(Boolean) : [],
    hasSkill ? skillCalls.map((c) => `${c.name}（${c.status}）`) : [],
    hasRead ? readCalls.map((c) => `${c.name}（${c.status}）`) : [],
    hasWrite ? writeCalls.map((c) => `${c.name}（${c.status}）`) : [],
    [],
    [],
  ]

  const stageDefs: Array<Omit<OutlineStage, "status">> = [
    { kind: "intent", title: "任务理解", summary: summaries[0], details: detailsList[0] },
    { kind: "scope", title: "范围分析", summary: summaries[1], details: detailsList[1] },
    { kind: "skill", title: "技能选择", summary: summaries[2], details: detailsList[2] },
    { kind: "context", title: "上下文准备", summary: summaries[3], details: detailsList[3] },
    { kind: "tool", title: "工具调用", summary: summaries[4], details: detailsList[4] },
    {
      kind: "thinking",
      title: "思考与角色",
      summary: summaries[5],
      details: detailsList[5],
      thinkingContent: thinkingExtract.text || undefined,
      thinkingStreaming: thinkingExtract.streaming || undefined,
    },
    { kind: "generation", title: "生成与校验", summary: summaries[6], details: detailsList[6] },
  ]

  let lastActiveIndex = -1
  for (let i = activations.length - 1; i >= 0; i--) {
    if (activations[i]) {
      lastActiveIndex = i
      break
    }
  }

  return stageDefs.map((def, index) => {
    const activated = activations[index]
    let status: OutlineStageStatus = "hidden"

    if (activated) {
      if (!isStreaming || index < lastActiveIndex) {
        status = "done"
      } else {
        status = "active"
      }
    }

    if (activated && !isStreaming) {
      status = "done"
    }

    return { ...def, status }
  })
}
