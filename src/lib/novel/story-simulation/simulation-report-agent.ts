import type { ChatMessage } from "@/lib/llm-client"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type {
  CharacterAnalysis,
  SimulationEvent,
  SimulationMode,
  SimulationReport,
  StoryBranch,
  StoryFramework,
} from "@/lib/novel/story-simulation/types"

// ── 对外接口 ──

interface ReportGenerationOptions {
  events: SimulationEvent[]
  framework: StoryFramework
  mode: SimulationMode
  llmConfig: LlmConfig
  onProgress?: (label: string) => void
  signal?: AbortSignal
}

// ── 内部辅助：将 streamChat 的流式回调收拢为一个完整字符串 ──

async function collectStream(
  config: LlmConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  let result = ""
  let streamError: Error | null = null

  await streamChat(
    config,
    messages,
    {
      onToken: (token) => {
        result += token
      },
      onDone: () => {},
      onError: (err) => {
        streamError = err
      },
    },
    signal,
  )

  if (streamError) throw streamError
  return result
}

// ── 内部辅助：从 LLM 文本中提取 JSON（支持裸 JSON 与代码块） ──

function extractJson(text: string): string | null {
  const trimmed = text.trim()

  // 直接解析
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    // 继续
  }

  // 从 markdown 代码块中提取
  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  if (codeBlockMatch) {
    const candidate = codeBlockMatch[1].trim()
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // 继续
    }
  }

  // 从文本中查找第一个 JSON 对象
  const objMatch = /\{[\s\S]*\}/.exec(trimmed)
  if (objMatch) {
    const candidate = objMatch[0]
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // 继续
    }
  }

  return null
}

// ── 内部辅助：将单个事件序列化为文本行 ──

function formatEvent(event: SimulationEvent): string {
  const time = event.timestamp

  switch (event.type) {
    case "node-start": {
      const node = event.node
      if (!node) return `[${time}] 节点开始（节点信息缺失）`
      return `[${time}] 节点开始：第 ${node.index + 1} 个节点「${node.title}」（${node.phase}），核心冲突：${node.coreConflict}，目标：${node.goal}`
    }
    case "node-complete": {
      const node = event.node
      if (!node) return `[${time}] 节点完成（节点信息缺失）`
      return `[${time}] 节点完成：第 ${node.index + 1} 个节点「${node.title}」`
    }
    case "agent-action": {
      const { agent, action, round, node, stateChanges } = event
      const name = agent ? agent.name : "未知角色"
      const nodeTitle = node ? node.title : ""
      const roundLabel = round !== undefined ? `第 ${round + 1} 轮` : ""

      let actionDesc = ""
      if (action) {
        switch (action.type) {
          case "speak":
            actionDesc = action.target
              ? `对 ${action.target} 说：「${action.content}」`
              : `自言自语：「${action.content}」`
            break
          case "act":
            actionDesc = `行动：${action.content}`
            break
          case "react":
            actionDesc = `对 ${action.target} 做出反应：${action.content}`
            break
          case "decide":
            actionDesc = `做出决定：${action.content}`
            break
          case "investigate":
            actionDesc = `调查：${action.content}`
            break
          case "conflict":
            actionDesc = `与 ${action.target} 发生冲突：${action.content}`
            break
          case "cooperate":
            actionDesc = `与 ${action.target} 合作：${action.content}`
            break
          case "withhold":
            actionDesc = `隐瞒信息：${action.content}`
            break
        }
      }

      const changes =
        stateChanges && stateChanges.length > 0
          ? `；状态变更：${stateChanges.join("，")}`
          : ""

      return `[${time}] 角色行为：${name}（节点「${nodeTitle}」${roundLabel}）${actionDesc}${changes}`
    }
    default:
      return `[${time}] 未知事件`
  }
}

function serializeEvents(events: SimulationEvent[]): string {
  return events.map(formatEvent).join("\n")
}

// ── 内部辅助：构建系统提示词 ──

function buildSystemPrompt(framework: StoryFramework, mode: SimulationMode): string {
  return [
    "你是一位资深的小说推演分析师。请基于仿真引擎产出的角色行为与节点事件记录，生成一份结构化的推演报告。",
    "",
    `当前故事框架：「${framework.title}」，前提：${framework.premise}`,
    `仿真模式：${mode}`,
    "",
    "请严格按以下 JSON 结构输出报告，不要输出任何其他文字：",
    "{",
    '  "characterAnalyses": [',
    "    {",
    '      "characterId": "角色ID",',
    '      "name": "角色名",',
    '      "behaviors": [',
    '        { "node": "所属节点标题", "action": "行为概述", "motivation": "动机说明" }',
    "      ],",
    '      "stateChanges": ["状态变更描述"],',
    '      "consistencyScore": 0到100的整数，人设一致性评分',
    "    }",
    "  ],",
    '  "branches": [',
    "    {",
    '      "title": "走向标题",',
    '      "summary": "走向摘要",',
    '      "keyEvents": ["关键事件"],',
    '      "probability": "high | medium | low",',
    '      "pros": "优势",',
    '      "cons": "不足",',
    '      "recommendation": true或false，是否推荐',
    "    }",
    "  ],",
    '  "recommendation": "综合推荐建议"',
    "}",
    "",
    "要求：",
    "1. characterAnalyses：对每个出场角色分析其行为与动机，并给出 0-100 的人设一致性评分。",
    "2. branches：给出 2-3 条可能的剧情走向，每条包含标题、摘要、关键事件、发生概率(高/中/低)、优势、不足、是否推荐。",
    "3. recommendation：给出综合推荐建议。",
    "4. 只输出 JSON 对象，不要包含 markdown 代码块标记或任何解释性文字。",
  ].join("\n")
}

// ── 内部辅助：构建用户提示词 ──

function buildUserPrompt(framework: StoryFramework, events: SimulationEvent[]): string {
  const nodeLines = framework.nodes
    .map(
      (n) =>
        `- 节点 ${n.index + 1}「${n.phase}」${n.title}：核心冲突「${n.coreConflict}」，目标「${n.goal}」`,
    )
    .join("\n")

  const parts: string[] = [
    "【故事框架】",
    `标题：${framework.title}`,
    `前提：${framework.premise}`,
    `目标字数：${framework.targetWords}`,
    `来源章节数：${framework.sourceChapters}`,
  ]
  if (framework.userIdea) {
    parts.push(`用户构想：${framework.userIdea}`)
  }
  parts.push("故事节点：")
  parts.push(nodeLines)
  parts.push("")
  parts.push("【仿真事件记录】")
  parts.push(serializeEvents(events))
  parts.push("")
  parts.push("请根据以上仿真记录，生成结构化推演报告（只输出 JSON）。")

  return parts.join("\n")
}

// ── 内部辅助：解析报告字段（健壮：字段缺失或类型不符时回退为安全默认值） ──

function clampScore(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  const rounded = Math.round(n)
  if (rounded < 0) return 0
  if (rounded > 100) return 100
  return rounded
}

function parseBoolean(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw
  if (typeof raw === "number") return raw !== 0
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
  return v === "true" || v === "1" || v === "yes" || v === "是" || v === "推荐"
}

function parseProbability(raw: unknown): "high" | "medium" | "low" {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
  if (v === "high" || v === "高") return "high"
  if (v === "low" || v === "低") return "low"
  return "medium"
}

function parseCharacterAnalyses(raw: unknown): CharacterAnalysis[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>
    const behaviorsRaw = Array.isArray(obj.behaviors) ? obj.behaviors : []
    return {
      characterId: String(obj.characterId ?? ""),
      name: String(obj.name ?? ""),
      behaviors: behaviorsRaw.map((b) => {
        const bo = (b ?? {}) as Record<string, unknown>
        return {
          node: String(bo.node ?? ""),
          action: String(bo.action ?? ""),
          motivation: String(bo.motivation ?? ""),
        }
      }),
      stateChanges: Array.isArray(obj.stateChanges)
        ? obj.stateChanges.map((s) => String(s))
        : [],
      consistencyScore: clampScore(obj.consistencyScore),
    }
  })
}

function parseBranches(raw: unknown): StoryBranch[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>
    return {
      title: String(obj.title ?? ""),
      summary: String(obj.summary ?? ""),
      keyEvents: Array.isArray(obj.keyEvents)
        ? obj.keyEvents.map((e) => String(e))
        : [],
      probability: parseProbability(obj.probability),
      pros: String(obj.pros ?? ""),
      cons: String(obj.cons ?? ""),
      recommendation: parseBoolean(obj.recommendation),
    }
  })
}

function parseRecommendation(raw: unknown): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) return "模型未提供综合推荐建议"
    // 如果是 JSON 字符串，尝试解析提取文本
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed)
        if (typeof parsed === "string") return parsed.trim() || "模型未提供综合推荐建议"
        if (typeof parsed === "object" && parsed !== null) {
          // 尝试提取常见的文本字段
          const obj = parsed as Record<string, unknown>
          if (typeof obj.text === "string") return obj.text.trim() || "模型未提供综合推荐建议"
          if (typeof obj.content === "string") return obj.content.trim() || "模型未提供综合推荐建议"
          if (typeof obj.recommendation === "string") return obj.recommendation.trim() || "模型未提供综合推荐建议"
          if (typeof obj.summary === "string") return obj.summary.trim() || "模型未提供综合推荐建议"
          // 是数组则拼接内容
          if (Array.isArray(parsed)) {
            return parsed.map((item) => {
              if (typeof item === "string") return item
              if (typeof item === "object" && item !== null) {
                const o = item as Record<string, unknown>
                return String(o.text || o.content || o.recommendation || JSON.stringify(item))
              }
              return String(item)
            }).filter(Boolean).join("；") || "模型未提供综合推荐建议"
          }
          // 退而求其次：把对象值拼接
          return Object.values(parsed).map((v) =>
            typeof v === "string" ? v : Array.isArray(v) ? v.join("、") : "",
          ).filter(Boolean).join("；") || "模型未提供综合推荐建议"
        }
      } catch {
        // 解析失败，返回原字符串
      }
    }
    return trimmed
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === "string") return item
      if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>
        return String(o.text || o.content || o.recommendation || JSON.stringify(item))
      }
      return String(item)
    }).filter(Boolean).join("；") || "模型未提供综合推荐建议"
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>
    if (typeof obj.text === "string") return obj.text.trim() || "模型未提供综合推荐建议"
    if (typeof obj.content === "string") return obj.content.trim() || "模型未提供综合推荐建议"
    if (typeof obj.recommendation === "string") return obj.recommendation.trim() || "模型未提供综合推荐建议"
    if (typeof obj.summary === "string") return obj.summary.trim() || "模型未提供综合推荐建议"
    return Object.values(obj).map((v) =>
      typeof v === "string" ? v : Array.isArray(v) ? v.join("、") : "",
    ).filter(Boolean).join("；") || "模型未提供综合推荐建议"
  }
  return "模型未提供综合推荐建议"
}

// ── 主入口：生成推演报告 ──

export async function generateSimulationReport(
  options: ReportGenerationOptions,
): Promise<SimulationReport> {
  const { events, framework, mode, llmConfig, onProgress, signal } = options
  const createdAt = new Date().toISOString()

  onProgress?.("正在构建推演提示词")
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(framework, mode) },
    { role: "user", content: buildUserPrompt(framework, events) },
  ]

  onProgress?.("正在调用模型生成推演报告")
  const rawResponse = await collectStream(llmConfig, messages, signal)

  onProgress?.("正在解析推演报告")
  const jsonText = extractJson(rawResponse)

  // 降级报告：无法解析出 JSON 时，用空数组 + 原始文本作为 recommendation
  if (!jsonText) {
    return {
      frameworkId: framework.id,
      mode,
      characterAnalyses: [],
      branches: [],
      recommendation: rawResponse.trim() || "模型未返回可解析的推演报告",
      createdAt,
    }
  }

  try {
    const data = JSON.parse(jsonText) as Record<string, unknown>
    const characterAnalyses = parseCharacterAnalyses(data.characterAnalyses)
    const branches = parseBranches(data.branches)
    const recommendation = parseRecommendation(data.recommendation)

    return {
      frameworkId: framework.id,
      mode,
      characterAnalyses,
      branches,
      recommendation,
      createdAt,
    }
  } catch {
    // 解析异常时同样降级：保留原始文本，避免中断调用方流程
    return {
      frameworkId: framework.id,
      mode,
      characterAnalyses: [],
      branches: [],
      recommendation: rawResponse.trim() || "模型返回的推演报告无法解析",
      createdAt,
    }
  }
}
