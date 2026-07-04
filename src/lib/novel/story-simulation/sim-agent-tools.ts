import { ToolRegistry } from "@/lib/agent/registry"
import type { Tool } from "@/lib/agent/types"
import {
  decideRumorTruth,
  findMatchingRumor,
  getBlackboardVisibleEvents,
  recordBlackboardEvent,
  type SimulationBlackboard,
  verifyRumor,
} from "@/lib/novel/story-simulation/multi-agent-orchestrator"
import type { NovelAgent, TimelineEvent } from "@/lib/novel/story-simulation/types"
import { formatTimelineEvent } from "@/lib/novel/story-simulation/agent-profile-builder"

function formatEventsText(events: TimelineEvent[]): string {
  if (events.length === 0) {
    return "（暂无可见事件）"
  }
  return events.map((e) => `- ${formatTimelineEvent(e)}`).join("\n")
}

function buildIntrospectText(agent: NovelAgent): string {
  const lines: string[] = []

  lines.push("【内心审视】")
  lines.push(`当前目标：${agent.currentGoal}`)
  lines.push(`情绪状态：${agent.emotionalState}`)

  if (agent.personality.length > 0) {
    lines.push(`性格关键词：${agent.personality.join("、")}`)
  }
  if (agent.speakingStyle) {
    lines.push(`说话风格：${agent.speakingStyle}`)
  }

  if (agent.memory.sentiments.size > 0) {
    lines.push("")
    lines.push("【对他人的情感】")
    for (const [otherId, value] of agent.memory.sentiments.entries()) {
      if (otherId === agent.characterId) continue
      lines.push(`- 角色[${otherId}]：好感度 ${value}`)
    }
  }

  if (agent.memory.recentDecisions.length > 0) {
    lines.push("")
    lines.push("【最近的决策】")
    for (const d of agent.memory.recentDecisions.slice(-5)) {
      lines.push(`- ${d}`)
    }
  }

  if (agent.knowledgeScope.length > 0) {
    lines.push("")
    lines.push("【知道的信息】")
    lines.push(agent.knowledgeScope.join("；"))
  }

  return lines.join("\n")
}

function resolveAgentByName(
  targetName: string,
  blackboard: SimulationBlackboard,
): NovelAgent | undefined {
  for (const agent of blackboard.allAgents.values()) {
    if (agent.name === targetName || agent.characterId === targetName) {
      return agent
    }
  }
  return undefined
}

let inquireEventCounter = 0
function nextInquireEventId(): string {
  inquireEventCounter++
  return `inquire_${Date.now()}_${inquireEventCounter}`
}

export function createSimAgentTools(
  agent: NovelAgent,
  blackboard: SimulationBlackboard,
): ToolRegistry {
  const registry = new ToolRegistry()

  const recallTool: Tool = {
    name: "recall",
    description: "回忆历史上你亲眼所见的事件，帮助理解当前局势。",
    category: "read",
    parameters: {
      limit: {
        type: "integer",
        description: "最多回忆多少条事件（默认20条）",
        required: false,
      },
    },
    execute: async (params) => {
      const limit = typeof params.limit === "number" ? params.limit : 20
      const events = getBlackboardVisibleEvents(blackboard, agent.characterId, limit)
      return formatEventsText(events)
    },
  }

  const observeTool: Tool = {
    name: "observe",
    description: "观察当前轮次其他角色的公开行为和言论。",
    category: "read",
    parameters: {},
    execute: async () => {
      const currentRound = blackboard.roundPlans.length > 0
        ? blackboard.roundPlans[blackboard.roundPlans.length - 1].round
        : 0
      const currentRoundEvents = blackboard.publicEvents.filter(
        (e) => e.round === currentRound && e.actorId !== agent.characterId,
      )
      return formatEventsText(currentRoundEvents)
    },
  }

  const inquireTool: Tool = {
    name: "inquire",
    description: "向另一个角色提出问题，对方下一轮可以看到你的问题并可能回应。",
    category: "write",
    permission: "auto",
    parameters: {
      target: {
        type: "string",
        description: "目标角色的名字",
        required: true,
      },
      question: {
        type: "string",
        description: "你想问的问题内容",
        required: true,
      },
    },
    execute: async (params) => {
      const targetName = String(params.target ?? "")
      const question = String(params.question ?? "")
      if (!targetName || !question) {
        return "错误：必须指定 target 和 question 参数"
      }
      const target = resolveAgentByName(targetName, blackboard)
      const targetId = target?.characterId ?? targetName
      const targetDisplayName = target?.name ?? targetName

      const event: TimelineEvent = {
        id: nextInquireEventId(),
        round: blackboard.roundPlans.length > 0
          ? blackboard.roundPlans[blackboard.roundPlans.length - 1].round
          : 0,
        nodeIndex: 0,
        actorId: agent.characterId,
        actorName: agent.name,
        actionType: "speak",
        content: question,
        targetId,
        targetName: targetDisplayName,
        observableBy: [agent.characterId, targetId],
        impacts: [
          {
            characterId: targetId,
            type: "knowledge",
            detail: `${targetDisplayName}听到了${agent.name}的提问`,
          },
        ],
        timestamp: new Date().toISOString(),
      }
      recordBlackboardEvent(blackboard, event)
      return `已向 ${targetDisplayName} 提出问题：${question}`
    },
  }

  const introspectTool: Tool = {
    name: "introspect",
    description: "审视自己的内心状态：情绪、目标、性格、说话风格、对他人的情感等。",
    category: "read",
    parameters: {},
    execute: async () => {
      return buildIntrospectText(agent)
    },
  }

  const investigateTool: Tool = {
    name: "investigate",
    description: "调查验证你听到的某条传闻的真伪。传入传闻的内容描述。",
    category: "write",
    permission: "auto",
    parameters: {
      rumorDescription: {
        type: "string",
        description: "传闻的内容描述",
        required: true,
      },
    },
    execute: async (params) => {
      const rumorDescription = String(params.rumorDescription ?? "")
      if (!rumorDescription) {
        return "错误：必须指定 rumorDescription 参数"
      }
      const matchedRumor = findMatchingRumor(blackboard, agent.characterId, rumorDescription)
      if (!matchedRumor) {
        return "未找到匹配的传闻，请确认你描述的传闻内容是否准确。"
      }
      const result = decideRumorTruth(matchedRumor.distortion)
      return verifyRumor(blackboard, agent.characterId, matchedRumor.id, result)
    },
  }

  registry.register(recallTool)
  registry.register(observeTool)
  registry.register(inquireTool)
  registry.register(introspectTool)
  registry.register(investigateTool)

  return registry
}
