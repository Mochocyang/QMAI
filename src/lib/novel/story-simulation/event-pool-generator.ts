import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage } from "@/lib/llm-client"

export type EventStage = "setup" | "rising" | "climax" | "resolution"

export interface StagedEvent {
  id: string
  text: string
  stage: EventStage
}

export interface StagedEventPool {
  byStage: Record<EventStage, StagedEvent[]>
  all: StagedEvent[]
}

export interface EventPoolGeneratorInput {
  llmConfig: LlmConfig
  worldRules: string
  characters: string[]
}

const STAGE_ORDER: EventStage[] = ["setup", "rising", "climax", "resolution"]

export function getNodeStage(nodeIndex: number, totalNodes: number): EventStage {
  if (nodeIndex === 0) return "setup"
  if (nodeIndex === totalNodes - 1) return "resolution"
  if (nodeIndex >= Math.floor(totalNodes * 0.75)) return "climax"
  return "rising"
}

export function pickStagedEvent(
  pool: StagedEventPool,
  usedIds: Set<string>,
  nodeIndex: number,
  totalNodes: number,
): StagedEvent | null {
  const stage = getNodeStage(nodeIndex, totalNodes)
  const stageEvents = pool.byStage[stage]?.filter((e) => !usedIds.has(e.id)) ?? []

  if (stageEvents.length > 0) {
    const randomIdx = Math.floor(Math.random() * stageEvents.length)
    return stageEvents[randomIdx]
  }

  const globalAvailable = pool.all.filter((e) => !usedIds.has(e.id))
  if (globalAvailable.length > 0) {
    const randomIdx = Math.floor(Math.random() * globalAvailable.length)
    return globalAvailable[randomIdx]
  }

  return null
}

let eventIdCounter = 0

function nextEventId(): string {
  eventIdCounter++
  return `evt_${Date.now()}_${eventIdCounter}`
}

function createEmptyStagedPool(): StagedEventPool {
  return {
    byStage: { setup: [], rising: [], climax: [], resolution: [] },
    all: [],
  }
}

export function stringArrayToStagedPool(events: string[]): StagedEventPool {
  const pool = createEmptyStagedPool()
  const total = events.length
  if (total === 0) return pool

  for (let i = 0; i < total; i++) {
    const stage = getNodeStage(i, total)
    const event: StagedEvent = {
      id: nextEventId(),
      text: events[i],
      stage,
    }
    pool.byStage[stage].push(event)
    pool.all.push(event)
  }

  return pool
}

export async function generateDynamicEventPool(
  input: EventPoolGeneratorInput,
): Promise<StagedEventPool> {
  const { llmConfig, worldRules, characters } = input

  const systemPrompt = `你是一个专业的小说剧情事件设计师。请根据给定的世界观设定和角色，按四阶段分类生成24条贴合世界观的随机事件（每阶段6条）。

四阶段定义：
- setup（起）：故事开端，铺垫背景、引入角色、设定悬念
- rising（承）：剧情发展，矛盾升级，线索浮现
- climax（转）：高潮转折，冲突爆发，局势逆转
- resolution（合）：结局收尾，矛盾解决，余韵悠长

要求：
1. 生成恰好24条随机事件，每阶段6条
2. 每条事件都是一句话，简洁生动，能够推动剧情发展或增加戏剧张力
3. 事件必须贴合给定的世界观设定
4. 事件类型多样化：环境变化、意外发现、神秘来客、突发危机、线索浮现、情感波动等
5. 只输出 JSON 对象，不要任何其他解释、 Markdown 格式或前后缀文字

输出格式：
{
  "setup": ["事件1", "事件2", ...],
  "rising": ["事件1", "事件2", ...],
  "climax": ["事件1", "事件2", ...],
  "resolution": ["事件1", "事件2", ...]
}`

  const userPrompt = `世界观设定：
${worldRules}

主要角色：
${characters.join("、")}

请按四阶段生成24条贴合以上世界观和角色的随机事件（每阶段6条）。`

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]

  let result = ""
  let streamError: Error | null = null

  try {
    await streamChat(llmConfig, messages, {
      onToken: (token) => {
        result += token
      },
      onDone: () => {},
      onError: (err) => {
        streamError = err
      },
    })

    if (streamError) {
      console.error("[event-pool-generator] LLM 调用出错：", streamError)
      return createEmptyStagedPool()
    }

    const trimmed = result.trim()
    const parsed = JSON.parse(trimmed)

    if (
      parsed &&
      typeof parsed === "object" &&
      STAGE_ORDER.every((stage) => Array.isArray(parsed[stage]))
    ) {
      const pool = createEmptyStagedPool()

      for (const stage of STAGE_ORDER) {
        const stageEvents: string[] = parsed[stage]
        for (const text of stageEvents) {
          if (typeof text === "string") {
            const event: StagedEvent = {
              id: nextEventId(),
              text,
              stage,
            }
            pool.byStage[stage].push(event)
            pool.all.push(event)
          }
        }
      }

      if (pool.all.length === 0) {
        console.warn("[event-pool-generator] LLM 返回的事件池为空")
        return createEmptyStagedPool()
      }

      const minPerStage = Math.min(...STAGE_ORDER.map((s) => pool.byStage[s].length))
      if (minPerStage === 0) {
        console.warn("[event-pool-generator] 部分阶段事件为空，使用全局池填充")
        const allTexts = pool.all.map((e) => e.text)
        return stringArrayToStagedPool(allTexts)
      }

      return pool
    }

    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      console.warn("[event-pool-generator] LLM 返回字符串数组，自动转换为分阶段池")
      return stringArrayToStagedPool(parsed)
    }

    console.warn("[event-pool-generator] LLM 返回格式无法解析")
    return createEmptyStagedPool()
  } catch (err) {
    console.error("[event-pool-generator] 解析或调用失败：", err)
    return createEmptyStagedPool()
  }
}
