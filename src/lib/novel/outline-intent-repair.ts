import { streamChat } from "@/lib/llm-client"
import {
  parseIntentClarityProtocol,
  type IntentClarityParseOutcome,
} from "./outline-intent-clarity"
import { repairJsonProtocolWithAi } from "./discuss-protocol-shared"

/**
 * 意图分析（intent_clarity）的「补一次」容错。
 *
 * 与共创 / 计划不同，意图分析的结果决定"要不要追问、追问给哪些选项、能不能直接开写"，
 * 所以**不做**任何伪造降级：转写不出来就如实报错，只是不再把整轮回复一起吞掉
 * （气泡改为展示剥掉标记后的正文，见 outline-chat-panel 的 renderedMarkdownContent）。
 *
 * 但"先补一次"的成本只有一次 1.6k 输出的调用，远比让用户把前面几轮问答重来便宜。
 */
const INTENT_REPAIR_MAX_TOKENS = 1_200

const INTENT_MARKER_OPEN = "<!-- intent_clarity -->"
const INTENT_MARKER_CLOSE = "<!-- /intent_clarity -->"

/** 回复里没有可用的意图协议时，把这轮判断转写成一个 intent_clarity 块。 */
export function buildIntentClarityRepairMessages(input: {
  content: string
  module: string
}): Array<{ role: "user"; content: string }> {
  const scope = input.module || "大纲"
  return [{
    role: "user",
    content: [
      `下面是对「${scope}」的一轮意图分析回复，但它缺少可用的 intent_clarity 协议块，系统无法据此决定下一步。`,
      "请只做一件事：读完这段回复，把它已经给出的判断转写成协议块。",
      "硬性要求：",
      "- 不要重写、扩写或继续规划；只提炼回复里**已经出现**的判断。",
      "- 如果回复认为需求已经足够明确（可以直接开写），用 clarity=clear。",
      "- 如果还需要作者确认，用 clarity=needs_input，并把要问的问题写进 question 与 options（每题 2-4 个选项）。",
      "- 拿不准时选 needs_input —— 多问一句比猜错方向省得多。",
      "- 只输出协议块本身（开标记、JSON、闭标记），不要复述原回复。",
      "协议格式（严格遵守）：",
      INTENT_MARKER_OPEN,
      '{"clarity":"clear|needs_input","module":"模块名","analysis":"判断依据","detectedScope":"要写的范围","missingItems":["还缺什么"],"question":"要问作者的问题","options":[{"id":"A","label":"选项","description":"说明"}]}',
      INTENT_MARKER_CLOSE,
      "开闭标记必须成对出现，JSON 必须完整可解析。",
      "",
      "## 需要补协议的回复",
      input.content,
    ].join("\n"),
  }]
}

export async function repairIntentClarityProtocolWithAi(options: {
  content: string
  module: string
  llmConfig: Parameters<typeof streamChat>[0]
  signal: AbortSignal
  maxTokens?: number
  stream?: typeof streamChat
}): Promise<string> {
  return repairJsonProtocolWithAi({
    messages: buildIntentClarityRepairMessages({ content: options.content, module: options.module }),
    maxTokens: options.maxTokens ?? INTENT_REPAIR_MAX_TOKENS,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  })
}

export interface IntentClarityGateResult {
  outcome: IntentClarityParseOutcome
  /** 是否真的发起过修复轮（供日志/诊断用）。 */
  repaired: boolean
}

interface ResolveIntentClarityProtocolOptions {
  text: string
  module: string
  llmConfig: Parameters<typeof streamChat>[0]
  signal: AbortSignal
  stream?: typeof streamChat
  repair?: typeof repairIntentClarityProtocolWithAi
}

/**
 * 先解析；不合格就补一轮再解析。补不出来时把**原始结果**返回给调用方
 * （调用方据此报错，但正文仍会保留，不再把气泡清空）。
 */
export async function resolveIntentClarityProtocol(
  options: ResolveIntentClarityProtocolOptions,
): Promise<IntentClarityGateResult> {
  const repair = options.repair ?? repairIntentClarityProtocolWithAi
  const first = parseIntentClarityProtocol(options.text)
  if (first.kind === "valid") return { outcome: first, repaired: false }
  if (options.text.trim().length < 80) return { outcome: first, repaired: false }

  const repairedText = await repair({
    content: options.text,
    module: options.module,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  }).catch((error) => {
    console.warn("意图分析补协议失败，按原结果继续：", error instanceof Error ? error.message : error)
    return ""
  })
  if (!repairedText) return { outcome: first, repaired: true }
  const second = parseIntentClarityProtocol(repairedText)
  return { outcome: second.kind === "valid" ? second : first, repaired: true }
}
