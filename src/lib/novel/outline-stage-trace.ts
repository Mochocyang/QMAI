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
const INTENT_CLARITY_PATTERN = /<!--\s*intent_clarity\s*-->[\s\S]*?<!--\s*\/intent_clarity\s*-->/i
const THINKING_PATTERN = /<(think|thinking)>([\s\S]*?)<\/\1>/i

function hasIntentClarity(content: string): boolean {
  return INTENT_CLARITY_PATTERN.test(content)
}

function hasThinking(content: string): boolean {
  return THINKING_PATTERN.test(content)
}

function hasGenerationStarted(content: string): boolean {
  const withoutThinking = content.replace(THINKING_PATTERN, "")
  const withoutClarity = withoutThinking.replace(INTENT_CLARITY_PATTERN, "")
  return withoutClarity.trim().length > 0
}

export function buildOutlineStages(input: OutlineStageInput): OutlineStage[] {
  const { toolCalls, content, isStreaming } = input

  const hasRoute = toolCalls.some((c) => ROUTE_TOOLS.has(c.name))
  const hasSkill = toolCalls.some((c) => SKILL_TOOLS.has(c.name))
  const hasRead = toolCalls.some((c) => LIST_TOOLS.has(c.name) || READ_TOOLS.has(c.name))
  const hasWrite = toolCalls.some((c) => WRITE_TOOLS.has(c.name))
  const hasClarity = hasIntentClarity(content)
  const hasThinkingBlock = hasThinking(content)
  const hasOutput = hasGenerationStarted(content)

  const activations = [hasRoute, hasClarity, hasSkill, hasRead, hasWrite, hasThinkingBlock, hasOutput]

  const stageDefs: Array<Omit<OutlineStage, "status">> = [
    { kind: "intent", title: "任务理解", summary: "", details: [] },
    { kind: "scope", title: "范围分析", summary: "", details: [] },
    { kind: "skill", title: "技能选择", summary: "", details: [] },
    { kind: "context", title: "上下文准备", summary: "", details: [] },
    { kind: "tool", title: "工具调用", summary: "", details: [] },
    { kind: "thinking", title: "思考与角色", summary: "", details: [] },
    { kind: "generation", title: "生成与校验", summary: "", details: [] },
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
