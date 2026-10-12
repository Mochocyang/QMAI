import type { AgentConfig, AgentMessage, AgentRunCallbacks } from "@/lib/agent/types"
import { isFunctionCallingEnabled } from "@/lib/agent/config"
import { AgentRunner, ModelDoesNotSupportToolsError } from "@/lib/agent/runner"
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
import { createReportTools } from "./report-tools"
import { verifyEvidence, type EvidenceAudit } from "./report-evidence"

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

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim()))
    .filter((item) => item.length > 0)
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
      stateChanges: parseStringArray(obj.stateChanges),
      consistencyScore: clampScore(obj.consistencyScore),
      evidence: parseStringArray(obj.evidence),
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
      keyEvents: parseStringArray(obj.keyEvents),
      probability: parseProbability(obj.probability),
      pros: String(obj.pros ?? ""),
      cons: String(obj.cons ?? ""),
      recommendation: parseBoolean(obj.recommendation),
      evidence: parseStringArray(obj.evidence),
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

// ── 取证化（P1-7）：ReAct 提示词与工具轮次 ──

/** 报告取证允许的最大工具轮次。比角色决策（3）多一点，因为要先查证再下结论。 */
const REPORT_MAX_TOOL_ROUNDS = 4

/**
 * 必须至少调用一次的工具。
 *
 * 交给 `AgentRunner` 的 required-tools gate 强制：模型若想不给证据就直接交卷，
 * 会被拒绝并要求续轮。这比只在提示词里写「请先查证」可靠得多 —— 后者全靠模型自觉。
 */
const REPORT_REQUIRED_TOOLS = ["query_events", "character_timeline"]

/**
 * 取证版系统提示词。
 *
 * 与 `buildSystemPrompt` 的差别不只是多了一句「可以用工具」：它把**引用原话**
 * 变成报告结构的一部分（`evidence` 字段），并要求每条结论都能指回原话。
 * 写进结构里才能被校验 —— 见 `verifyEvidence`。
 */
function buildReactSystemPrompt(framework: StoryFramework, mode: SimulationMode): string {
  return [
    "你是一位资深的小说推演分析师。你要基于仿真引擎产出的角色行为，写一份结构化的推演报告。",
    "",
    `当前故事框架：「${framework.title}」，前提：${framework.premise}`,
    `仿真模式：${mode}`,
    "",
    "【工作方式：先取证，再下结论】",
    "你手上有只读的取证工具，事件记录不会被整份塞给你，你必须自己查：",
    "- list_nodes：确认本次推演有哪些节点",
    "- report_stats：看整体规模（多少条记录、每个角色各多少条）",
    "- query_events：按角色/节点/关键词检索事件，返回角色原话",
    "- character_timeline：按顺序看某个角色的全部行为与原话",
    "",
    `在写结论之前，至少调用 query_events 与 character_timeline 各一次，总共不少于 3 次工具调用。`,
    "不要凭印象写报告：凡是你没有查到的内容，就不要写进去。",
    "",
    "【硬性要求：逐字引用原话】",
    "每条角色分析、每条剧情走向都必须给出 evidence 字段，内容是**从工具结果里逐字照抄**的角色原话。",
    "原话一字不改地复制，不要改写、不要润色、不要拼接两条不同的话。",
    "没有原话支撑的结论就不要写；宁可少写，也不要编造引文 —— 引文会被逐一核对。",
    "",
    "【输出格式】",
    "取证完成后，只输出下面这个 JSON 对象，不要输出任何其他文字、不要用 markdown 代码块：",
    "{",
    '  "characterAnalyses": [',
    "    {",
    '      "characterId": "角色ID",',
    '      "name": "角色名",',
    '      "behaviors": [',
    '        { "node": "所属节点标题", "action": "行为概述", "motivation": "动机说明" }',
    "      ],",
    '      "stateChanges": ["状态变更描述"],',
    '      "consistencyScore": 0到100的整数，人设一致性评分,',
    '      "evidence": ["逐字照抄的角色原话", "..."]',
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
    '      "recommendation": true或false，是否推荐,',
    '      "evidence": ["逐字照抄的角色原话", "..."]',
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

/** 取证版的用户消息：不再整份倾倒事件，只给任务与范围提示。 */
function buildReactUserPrompt(framework: StoryFramework): string {
  const nodeLines = framework.nodes
    .map((n) => `- 节点${n.index + 1}「${n.phase}」${n.title}：目标「${n.goal}」`)
    .join("\n")

  return [
    "请为下面这次推演写报告。先用工具查证事件记录，再输出 JSON。",
    "",
    "【故事框架】",
    `标题：${framework.title}`,
    `前提：${framework.premise}`,
    `目标字数：${framework.targetWords}`,
    "故事节点：",
    nodeLines,
    "",
    "【开始取证】",
    "建议顺序：先 list_nodes 确认范围，再用 report_stats 看规模，然后针对每个主要角色用 character_timeline 取原话。",
    "写 conclusion 时，evidence 必须是从工具结果里逐字照抄的原话。",
  ].join("\n")
}

/**
 * 尝试工具取证路径。返回 null 表示这条路走不通（模型不支持工具、被中止、
 * 或没产出文本），调用方应回退到单次调用。
 */
async function generateWithTools(
  options: ReportGenerationOptions,
): Promise<{ text: string; toolCalls: number } | null> {
  const { events, framework, mode, llmConfig, signal } = options

  const registry = createReportTools(events, framework.nodes)
  const systemPrompt = buildReactSystemPrompt(framework, mode)

  const config: AgentConfig = {
    maxRounds: REPORT_MAX_TOOL_ROUNDS,
    tools: registry.list(),
    systemPrompt,
    llmConfig,
    requiredToolsOnce: REPORT_REQUIRED_TOOLS,
  }

  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildReactUserPrompt(framework) },
  ]

  let streamed = ""
  const callbacks: AgentRunCallbacks = {
    onText: (chunk) => {
      streamed += chunk
    },
    onToolCall: () => {},
    onToolResult: () => {},
    onToolError: () => {},
    onDone: () => {},
    // 工具不支持时由 AgentRunner 抛错，这里不吞
    onError: () => {},
  }

  const runner = new AgentRunner()

  try {
    const record = await runner.run(config, registry, messages, callbacks, signal)
    const text = (record.finalText || streamed).trim()
    if (!text) return null
    return { text, toolCalls: record.toolCalls?.length ?? 0 }
  } catch (err) {
    if (signal?.aborted) throw err
    if (err instanceof ModelDoesNotSupportToolsError) {
      // 当前模型不支持工具调用：静默回退，这是预期内的能力差异而非故障
      return null
    }
    // 工具路径的其它失败也不该让报告整体失败：回退到单次调用
    console.warn("报告取证路径失败，回退到单次调用:", err)
    return null
  }
}

// ── 取证审计：把全报告的引文逐条核对 ──

/**
 * 汇总并核对报告里的全部引文。
 *
 * 逐条核对而不是抽查：审计的价值就在于「未通过的原文也能看到」，抽查会把
 * 编造的引文漏过去。角色分析与剧情走向的引文合并统计（都指向同一个证据池）。
 */
function auditReportEvidence(
  characterAnalyses: CharacterAnalysis[],
  branches: StoryBranch[],
  events: SimulationEvent[],
  toolCalls: number,
): EvidenceAudit & { toolCalls: number } {
  const quotes: string[] = [
    ...characterAnalyses.flatMap((c) => c.evidence ?? []),
    ...branches.flatMap((b) => b.evidence ?? []),
  ]

  return { ...verifyEvidence(quotes, events), toolCalls }
}

// ── 主入口：生成推演报告 ──

export async function generateSimulationReport(
  options: ReportGenerationOptions,
): Promise<SimulationReport> {
  const { events, framework, mode, llmConfig, onProgress, signal } = options
  const createdAt = new Date().toISOString()

  // ① 优先走取证路径：先查证再写结论，报告里的引文可被核对
  let rawResponse: string | null = null
  let toolCalls = 0

  if (isFunctionCallingEnabled(llmConfig)) {
    onProgress?.("正在取证：检索事件记录与角色原话")
    const viaTools = await generateWithTools(options)
    if (viaTools) {
      rawResponse = viaTools.text
      toolCalls = viaTools.toolCalls
    }
  }

  // ② 回退：单次调用（模型不支持工具、工具路径失败、或功能开关关闭）
  if (rawResponse === null) {
    onProgress?.("正在构建推演提示词")
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(framework, mode) },
      { role: "user", content: buildUserPrompt(framework, events) },
    ]

    onProgress?.("正在调用模型生成推演报告")
    rawResponse = await collectStream(llmConfig, messages, signal)
  }

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
      evidenceAudit: { total: 0, verified: 0, unverified: [], toolCalls },
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
      evidenceAudit: auditReportEvidence(characterAnalyses, branches, events, toolCalls),
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
      evidenceAudit: { total: 0, verified: 0, unverified: [], toolCalls },
    }
  }
}
