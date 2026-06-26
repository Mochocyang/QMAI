/**
 * 故事框架生成器
 *
 * 调用 LLM 分析已写内容（角色、章节概要、世界规则、力量体系、
 * 伏笔、时间线、灵魂文档）与用户思路，生成遵循"起承转合"四段式
 * 结构的故事框架。框架由 premise（核心前提）与若干 StoryNode 组成，
 * 节点之间以因果链串联。
 *
 * 设计原则：
 * - 只做生成，不读写文件（输入由调用方通过 ExtractionResult 传入）。
 * - JSON 解析健壮：兼容 ```json 代码块与裸 JSON，失败时返回合理的
 *   空框架，绝不抛出未捕获异常。
 */

import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import type {
  ExtractionResult,
  StoryFramework,
  StoryNode,
  SimulationMode,
} from "./types"
import { calcNodeCount } from "./types"

// ── 对外接口 ──

export interface FrameworkGenerationOptions {
  extraction: ExtractionResult
  mode: SimulationMode
  targetWords: number
  userIdea?: string
  llmConfig: LlmConfig
  onProgress?: (label: string) => void
}

/**
 * 生成故事框架。
 *
 * 流程：
 * 1. calcNodeCount(targetWords) 确定节点数量
 * 2. 基于提取结果构建提示词
 * 3. 调用 streamChat 收集完整响应
 * 4. 解析 JSON 为 StoryFramework
 * 5. 生成唯一 ID 与标题
 *
 * 任何环节失败均返回合理的空框架（premise 携带原因，nodes 为空）。
 */
export async function generateStoryFramework(
  options: FrameworkGenerationOptions,
): Promise<StoryFramework> {
  const { extraction, mode, targetWords, userIdea, llmConfig, onProgress } =
    options

  const nodeCount = calcNodeCount(targetWords)
  const sourceChapters = extraction.chapterContents.length

  onProgress?.("正在构建提示词...")
  const messages = buildMessages(extraction, mode, targetWords, nodeCount, userIdea)

  onProgress?.("正在调用模型生成故事框架...")
  const raw = await collectStream(llmConfig, messages)

  onProgress?.("正在解析框架...")
  const parsed = parseFrameworkJson(raw)
  if (!parsed) {
    return buildEmptyFramework(
      options,
      "模型未返回可解析的框架内容，请重试或更换模型。",
    )
  }

  const nodes = normalizeNodes(parsed.nodes, nodeCount)
  if (nodes.length === 0) {
    return buildEmptyFramework(
      options,
      "模型返回的框架不包含任何节点，请重试或调整目标字数。",
    )
  }

  const framework: StoryFramework = {
    id: `framework-${Date.now()}`,
    title: buildTitle(parsed.premise, userIdea),
    shortTitle: typeof parsed.shortTitle === 'string' && parsed.shortTitle.trim()
      ? parsed.shortTitle.trim().slice(0, 10)
      : buildShortTitle(parsed.premise, userIdea),
    premise: strOr(parsed.premise, ""),
    targetWords,
    simulationMode: mode,
    userIdea,
    sourceChapters,
    nodes,
    createdAt: new Date().toISOString(),
  }

  onProgress?.("故事框架生成完成")
  return framework
}

// ── 提示词构建 ──

function buildMessages(
  extraction: ExtractionResult,
  mode: SimulationMode,
  targetWords: number,
  nodeCount: number,
  userIdea?: string,
): ChatMessage[] {
  const systemPrompt = [
    '你是一位资深的故事架构师。请根据用户提供的已写内容与设定，生成一个遵循"起承转合"四段式结构的故事框架。',
    "",
    "要求：",
    "1. 根据目标字数，生成指定数量的关键节点，覆盖起、承、转、合四个阶段。",
    "2. 每个节点必须包含以下字段：",
    '   - phase：阶段标识，取值仅为 "起"、"承"、"转"、"合" 之一',
    "   - title：节点标题（简短有力）",
    "   - coreConflict：该节点的核心冲突",
    "   - involvedCharacters：涉及的角色名称数组",
    "   - goal：该节点要达成的叙事目标",
    '   - causeFromPrev：由上一节点导致的直接原因（第一个节点填"故事开端"）',
    "   - expectedOutcome：预期导致的结局或转折",
    "3. 节点之间必须有明确的因果链：后一节点的 causeFromPrev 应承接前一节点的 expectedOutcome。",
    "4. premise：用一两句话概括整个故事的核心前提。",
    "5. shortTitle：为这个故事框架取一个简短标题（4-8个字），用于侧边栏显示，如'指认风波'、'毒影疑云'。",
    "6. 只输出一个 JSON 对象，不要输出任何解释、注释或多余文字。",
    "",
    "输出格式（严格遵循）：",
    "{",
    '  "premise": "故事核心前提",',
    '  "shortTitle": "简短标题",',
    '  "nodes": [',
    "    {",
    '      "phase": "起",',
    '      "title": "...",',
    '      "coreConflict": "...",',
    '      "involvedCharacters": ["角色A", "角色B"],',
    '      "goal": "...",',
    '      "causeFromPrev": "故事开端",',
    '      "expectedOutcome": "..."',
    "    }",
    "  ]",
    "}",
  ].join("\n")

  const userPrompt = buildUserPrompt(
    extraction,
    mode,
    targetWords,
    nodeCount,
    userIdea,
  )

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]
}

function buildUserPrompt(
  extraction: ExtractionResult,
  mode: SimulationMode,
  targetWords: number,
  nodeCount: number,
  userIdea?: string,
): string {
  const sections: string[] = []

  sections.push(`# 生成任务`)
  sections.push(`目标字数：${targetWords}`)
  sections.push(`需要生成的节点数量：${nodeCount}`)
  sections.push(`仿真模式：${mode}`)
  if (userIdea) {
    sections.push(`用户思路：${userIdea}`)
  }

  // 角色信息
  sections.push("")
  sections.push("# 角色信息")
  if (extraction.characters.length === 0) {
    sections.push("（暂无已提取角色）")
  } else {
    for (const c of extraction.characters) {
      sections.push(`## ${c.name}`)
      if (c.profile) sections.push(`档案：${truncate(c.profile, 2000)}`)
      if (c.aura) sections.push(`光环：${JSON.stringify(c.aura)}`)
      if (c.cognition) {
        sections.push(
          `认知：知道[${c.cognition.knows.join("、")}]；不知道[${c.cognition.doesNotKnow.join("、")}]`,
        )
      }
      if (c.skillContent) sections.push(`技能：${truncate(c.skillContent, 1500)}`)
      if (c.soul) sections.push(`灵魂：${truncate(c.soul, 1500)}`)
    }
  }

  // 章节概要
  sections.push("")
  sections.push("# 已写章节概要")
  if (extraction.chapterContents.length === 0) {
    sections.push("（暂无已写章节）")
  } else {
    for (const ch of extraction.chapterContents) {
      const summary = ch.summary?.trim() || truncate(ch.content, 800)
      sections.push(`第${ch.chapterNumber}章《${ch.title}》：${summary}`)
    }
  }

  // 世界规则
  sections.push("")
  sections.push("# 世界规则")
  sections.push(extraction.worldRules?.trim() || "（未提取到世界规则）")

  // 力量体系
  sections.push("")
  sections.push("# 力量体系")
  sections.push(extraction.powerSystem?.trim() || "（未提取到力量体系）")

  // 伏笔
  sections.push("")
  sections.push("# 伏笔追踪")
  if (extraction.foreshadowing) {
    sections.push(JSON.stringify(extraction.foreshadowing))
  } else {
    sections.push("（暂无伏笔记录）")
  }

  // 时间线
  sections.push("")
  sections.push("# 时间线")
  if (extraction.timeline.length > 0) {
    sections.push(extraction.timeline.map((e, i) => `${i + 1}. ${e}`).join("\n"))
  } else {
    sections.push("（暂无时间线事件）")
  }

  // 灵魂文档
  sections.push("")
  sections.push("# 灵魂文档")
  sections.push(extraction.soulDoc?.trim() || "（未提取到灵魂文档）")

  sections.push("")
  sections.push(
    `请基于以上内容生成 ${nodeCount} 个节点的故事框架，严格按系统提示要求的 JSON 格式输出。`,
  )

  return sections.join("\n")
}

// ── 流式收集 ──

/**
 * 调用 streamChat 并累积完整文本响应。
 * 若流式过程中出错，抛出携带错误信息的 Error，由调用方决定回退策略。
 */
function collectStream(
  llmConfig: LlmConfig,
  messages: ChatMessage[],
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let response = ""
    streamChat(
      llmConfig,
      messages,
      {
        onToken: (token) => {
          response += token
        },
        onDone: () => {
          resolve(response)
        },
        onError: (err) => {
          reject(err)
        },
      },
    ).catch((err) => {
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

// ── JSON 解析 ──

interface ParsedFramework {
  premise?: unknown
  shortTitle?: unknown
  nodes?: unknown
}

/**
 * 从模型输出中提取框架 JSON。
 *
 * 兼容三种情况：
 * 1. ```json ... ``` 代码块包裹
 * 2. 裸 JSON 对象
 * 3. JSON 前后夹杂多余文字（取最外层 { ... }）
 *
 * 解析失败返回 null。
 */
function parseFrameworkJson(raw: string): ParsedFramework | null {
  const text = raw.trim()
  if (!text) return null

  // 1. 提取 ```json / ``` 代码块
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1].trim() : text

  // 2. 直接解析
  const direct = tryParse(candidate)
  if (direct) return direct

  // 3. 截取最外层 { ... }
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start !== -1 && end !== -1 && end > start) {
    const slice = candidate.slice(start, end + 1)
    const sliced = tryParse(slice)
    if (sliced) return sliced
  }

  return null
}

function tryParse(text: string): ParsedFramework | null {
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === "object") return obj as ParsedFramework
  } catch {
    // 忽略，交由外层回退
  }
  return null
}

// ── 节点归一化 ──

const VALID_PHASES: ReadonlySet<string> = new Set(["起", "承", "转", "合"])

/**
 * 将模型返回的节点数组归一化为合法的 StoryNode[]。
 *
 * - 截断到目标节点数量（允许少于目标，但不补齐空节点）。
 * - 校验 phase 取值，非法时按位置比例推导，保证起承转合分布合理。
 * - 缺失字段填充合理默认值。
 */
function normalizeNodes(raw: unknown, count: number): StoryNode[] {
  if (!Array.isArray(raw)) return []
  const list = raw.slice(0, count)
  const total = list.length
  const nodes: StoryNode[] = []
  for (let i = 0; i < total; i++) {
    const n = (list[i] ?? {}) as Record<string, unknown>
    nodes.push({
      index: i,
      phase: normalizePhase(n.phase, i, total),
      title: strOr(n.title, `节点 ${i + 1}`),
      coreConflict: strOr(n.coreConflict, ""),
      involvedCharacters: arrOr(n.involvedCharacters, []),
      goal: strOr(n.goal, ""),
      causeFromPrev: strOr(n.causeFromPrev, i === 0 ? "故事开端" : ""),
      expectedOutcome: strOr(n.expectedOutcome, ""),
    })
  }
  return nodes
}

function normalizePhase(
  value: unknown,
  index: number,
  total: number,
): StoryNode["phase"] {
  if (typeof value === "string" && VALID_PHASES.has(value)) {
    return value as StoryNode["phase"]
  }
  return derivePhase(index, total)
}

/**
 * 按节点位置比例推导阶段，保证起承转合四段分布。
 */
function derivePhase(index: number, total: number): StoryNode["phase"] {
  if (total <= 0) return "起"
  const ratio = index / total
  if (ratio < 0.25) return "起"
  if (ratio < 0.5) return "承"
  if (ratio < 0.75) return "转"
  return "合"
}

// ── 空框架回退 ──

function buildEmptyFramework(
  options: FrameworkGenerationOptions,
  reason: string,
): StoryFramework {
  return {
    id: `framework-${Date.now()}`,
    title: "故事框架（生成失败，已回退为空框架）",
    shortTitle: "生成失败",
    premise: reason,
    targetWords: options.targetWords,
    simulationMode: options.mode,
    userIdea: options.userIdea,
    sourceChapters: options.extraction.chapterContents.length,
    nodes: [],
    createdAt: new Date().toISOString(),
  }
}

// ── 工具函数 ──

function buildTitle(premise: unknown, userIdea?: string): string {
  if (userIdea) return truncate(userIdea, 30)
  if (typeof premise === "string" && premise.trim()) {
    return truncate(premise.trim(), 30)
  }
  return "故事框架"
}

function buildShortTitle(premise: unknown, userIdea?: string): string {
  const source = userIdea || (typeof premise === "string" ? premise : "")
  if (!source) return "故事框架"
  // 取前8个字符作为简短标题
  return source.trim().slice(0, 8)
}

function truncate(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

function strOr(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim()
  return fallback
}

/**
 * 将未知值归一化为字符串数组。
 * 支持：数组、以常见分隔符切分的字符串。
 */
function arrOr(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean)
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,，、;；\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return fallback
}
