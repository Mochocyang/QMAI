import { streamChat } from "@/lib/llm-client"
import {
  OUTLINE_PLAN_MARKER_CLOSE,
  OUTLINE_PLAN_MARKER_OPEN,
  buildFallbackClarifyQuestions,
  parseOutlinePlanProtocol,
  validateOutlinePlanProtocol,
  type OutlinePlanProtocol,
  type OutlinePlanValidation,
} from "./outline-plan-protocol"
import type { OutlinePlanElementSpec } from "./outline-plan-elements"
import { repairJsonProtocolWithAi } from "./discuss-protocol-shared"

/**
 * 计划模式（要素盘点 / 方案提案）的容错轮。
 *
 * 用户口径与共创一致（2026-10-21）：模型已经写出的内容不能因为"协议不够完整"整轮作废。
 * 计划协议原本只有一条硬失败路径（"计划协议不满足计划模式要求，尚未开始生成"），
 * 这里补上同样的「先补一次 → 仍不行就降级成追问」：
 *
 * - 缺步骤/文件清单、追问选项不足、JSON 损坏 → 都先让模型按缺口补一轮；
 * - 仍不合格 → **降级成 needs_input**（把已解析的追问，或按必填要素自动生成的兜底追问
 *   交给用户拍板），阶段机器照常推进，正文与判断全部保留；
 * - 连协议都拿不到（回复太短/转写也失败）→ 才返回错误，由调用方保留正文。
 */
const PLAN_REPAIR_MAX_TOKENS = 2_400
const PLAN_TOPUP_MAX_TOKENS = 2_400

interface PlanProtocolOptions {
  module: string
  required: OutlinePlanElementSpec[]
  llmConfig: Parameters<typeof streamChat>[0]
  signal: AbortSignal
  stream?: typeof streamChat
}

function formatChecklist(required: OutlinePlanElementSpec[]): string[] {
  if (!required.length) return []
  return [
    "## 本轮必填要素",
    ...required.map((spec) => `- ${spec.label}（${spec.required ? "必填" : "可选"}）：${spec.hint}`),
  ]
}

/** 「补协议」：回复里没有 outline_plan（或 JSON 坏了），把它已表达的计划转写成协议。 */
export function buildOutlinePlanRepairMessages(input: {
  content: string
  module: string
  required: OutlinePlanElementSpec[]
}): Array<{ role: "user"; content: string }> {
  const scope = input.module || "大纲"
  return [{
    role: "user",
    content: [
      `下面是对「${scope}」的一轮计划模式回复，但缺少可用的 outline_plan 协议块，系统无法据此推进。`,
      "请只做一件事：读完这段回复，把它已经给出的判断、要素与计划转写成协议块。",
      "硬性要求：",
      "- 不要重写或扩写正文；只提炼回复里**已经出现**的内容。",
      "- 如果回复里还没到可执行阶段，就用 status=needs_input，并把还需要作者确认的点写成追问。",
      "- 只输出协议块本身（开标记、JSON、闭标记），不要复述原回复。",
      ...formatChecklist(input.required),
      "协议格式（严格遵守）：",
      OUTLINE_PLAN_MARKER_OPEN,
      '{"status":"needs_input|ready","module":"模块名","elements":[{"key":"要素key","value":"已确认内容","source":"user|project|inferred","satisfied":true}],"missing":[],"questions":[{"id":"q1","key":"要素key","question":"要确认什么","multiple":false,"options":[{"id":"A","label":"方案","description":"说明"}]}],"plan":{"summary":"计划摘要","steps":[{"id":"s1","title":"步骤","detail":"做什么"}],"files":[{"targetFolder":"wiki/outlines","fileName":"文件名.md","fileType":"markdown","writeMode":"create","elements":["要素key"]}],"order":"执行顺序","risks":[],"openQuestions":[]}}',
      OUTLINE_PLAN_MARKER_CLOSE,
      "开闭标记必须成对出现，JSON 必须完整可解析。",
      "",
      "## 需要补协议的回复",
      input.content,
    ].join("\n"),
  }]
}

/** 「补齐」：协议解析出来了但没过闸门，只修不合格项。 */
export function buildOutlinePlanTopUpMessages(input: {
  module: string
  error: string
  protocol: OutlinePlanProtocol | null
  required: OutlinePlanElementSpec[]
  content?: string
}): Array<{ role: "user"; content: string }> {
  const scope = input.module || "大纲"
  const payload = input.protocol ? JSON.stringify(input.protocol) : ""
  return [{
    role: "user",
    content: [
      `下面这份「${scope}」的 outline_plan 协议没有通过完整性检查：${input.error}`,
      "请只修不合格的地方，凑齐要求后重新输出**完整**协议块。",
      "硬性要求：",
      "- 已经给出的要素、追问、步骤与文件清单原样保留，不要重写计划思路。",
      "- 缺生成步骤：按已写的判断补 2-5 个可执行步骤（每步一句话说清做什么）。",
      "- 缺待写文件清单：按模块补出要写哪些文件（目录、文件名、类型、写入方式）。",
      "- 追问的可选项不足 3 个：按该问题补足 3 个具体方案（系统会再追加自定义输入项）。",
      "- 必填要素没确认：写进 questions（每个问题 3 个选项），不要假装已满足。",
      "- 只输出协议块本身（开标记、JSON、闭标记），不要复述原回复。",
      ...formatChecklist(input.required),
      "协议格式：",
      OUTLINE_PLAN_MARKER_OPEN,
      '{"status":"needs_input|ready","module":"模块名","elements":[],"missing":[],"questions":[{"id":"q1","key":"要素key","question":"要确认什么","multiple":false,"options":[{"id":"A","label":"方案","description":"说明"}]}],"plan":{"summary":"","steps":[],"files":[],"order":"","risks":[],"openQuestions":[]}}',
      OUTLINE_PLAN_MARKER_CLOSE,
      "开闭标记必须成对出现，JSON 必须完整可解析。",
      "",
      input.protocol ? "## 待修的协议" : "## 上一轮回复（协议块缺失或无法解析，请据此重建）",
      payload || (input.content ?? ""),
    ].join("\n"),
  }]
}

export async function repairOutlinePlanProtocolWithAi(
  options: PlanProtocolOptions & { content: string; maxTokens?: number },
): Promise<string> {
  return repairJsonProtocolWithAi({
    messages: buildOutlinePlanRepairMessages({ content: options.content, module: options.module, required: options.required }),
    maxTokens: options.maxTokens ?? PLAN_REPAIR_MAX_TOKENS,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  })
}

export async function topUpOutlinePlanProtocolWithAi(
  options: PlanProtocolOptions & { protocol: OutlinePlanProtocol | null; error: string; content?: string; maxTokens?: number },
): Promise<string> {
  return repairJsonProtocolWithAi({
    messages: buildOutlinePlanTopUpMessages({
      module: options.module,
      error: options.error,
      protocol: options.protocol,
      required: options.required,
      content: options.content,
    }),
    maxTokens: options.maxTokens ?? PLAN_TOPUP_MAX_TOKENS,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  })
}

export interface OutlinePlanGateResult {
  validation: OutlinePlanValidation
  /** 降级放行时的说明（空串表示无需提示）。 */
  notice: string
}

/**
 * 把「协议解析出来了但不过闸门」的协议降级成可答的追问。
 *
 * 优先用模型自己给出的追问（只要有一问的可选项够用），否则按必填要素生成兜底追问。
 * 两者都凑不出来（没有必填要素、也没有像样的追问）才返回 null —— 那种情况连"问用户"
 * 都问不出东西，只能交给调用方报错。
 */
export function degradeOutlinePlanToQuestions(
  protocol: OutlinePlanProtocol,
  required: OutlinePlanElementSpec[],
): OutlinePlanValidation | null {
  const usableQuestions = protocol.questions.filter(
    (question) => question.options.filter((option) => option.id.toUpperCase() !== "CUSTOM").length >= 3,
  )
  if (usableQuestions.length > 0) {
    return {
      kind: "needs_input",
      downgraded: true,
      protocol: { ...protocol, status: "needs_input", plan: undefined, questions: usableQuestions },
    }
  }
  if (required.length > 0) {
    return {
      kind: "needs_input",
      downgraded: true,
      protocol: {
        ...protocol,
        status: "needs_input",
        plan: undefined,
        missing: required.map((spec) => spec.label),
        questions: buildFallbackClarifyQuestions(required),
      },
    }
  }
  return null
}

interface ResolveOutlinePlanProtocolOptions extends PlanProtocolOptions {
  text: string
  /** 可注入，便于测试。 */
  repair?: typeof repairOutlinePlanProtocolWithAi
  topUp?: typeof topUpOutlinePlanProtocolWithAi
}

export async function resolveOutlinePlanProtocol(
  options: ResolveOutlinePlanProtocolOptions,
): Promise<OutlinePlanGateResult> {
  const repair = options.repair ?? repairOutlinePlanProtocolWithAi
  const topUp = options.topUp ?? topUpOutlinePlanProtocolWithAi
  const shared = {
    module: options.module,
    required: options.required,
    llmConfig: options.llmConfig,
    signal: options.signal,
    stream: options.stream,
  }

  const inspect = (text: string):
    | { ok: true; validation: OutlinePlanValidation }
    | { ok: false; protocol: OutlinePlanProtocol | null; reason: string } => {
    const outcome = parseOutlinePlanProtocol(text)
    if (outcome.kind === "none") return { ok: false, protocol: null, reason: "模型未返回 outline_plan 协议块" }
    if (outcome.kind === "invalid") return { ok: false, protocol: null, reason: outcome.error }
    const validation = validateOutlinePlanProtocol(outcome.protocol, options.required)
    if (validation.kind === "invalid") return { ok: false, protocol: outcome.protocol, reason: validation.error }
    return { ok: true, validation }
  }

  const first = inspect(options.text)
  if (first.ok) return { validation: first.validation, notice: "" }

  const degrade = (protocol: OutlinePlanProtocol, reason: string): OutlinePlanGateResult | null => {
    const validation = degradeOutlinePlanToQuestions(protocol, options.required)
    return validation ? { validation, notice: `已按现有内容展示（${reason}）。` } : null
  }

  // 1) 完全没有协议：先转写一次；转写不出来再让「补齐」据原文重建一次。
  if (!first.protocol) {
    if (options.text.trim().length < 80) {
      return { validation: { kind: "invalid", error: first.reason }, notice: "" }
    }
    const repairedText = await repair({ content: options.text, ...shared }).catch((error) => {
      console.warn("计划协议补全失败，按原结果继续：", error instanceof Error ? error.message : error)
      return ""
    })
    const repaired = repairedText ? inspect(repairedText) : null
    if (repaired?.ok) return { validation: repaired.validation, notice: "" }
    if (repaired && repaired.protocol) {
      const degraded = degrade(repaired.protocol, repaired.reason)
      if (degraded) return degraded
    }
    const rebuilt = await topUp({
      protocol: null,
      error: first.reason,
      content: options.text,
      ...shared,
    }).catch(() => "")
    if (rebuilt) {
      const afterRebuild = inspect(rebuilt)
      if (afterRebuild.ok) return { validation: afterRebuild.validation, notice: "" }
    }
    return { validation: { kind: "invalid", error: first.reason }, notice: "" }
  }

  // 2) 有协议但不过闸门：补齐一次；仍不行就降级成追问。
  const topped = await topUp({
    protocol: first.protocol,
    error: first.reason,
    content: options.text,
    ...shared,
  }).catch((error) => {
    console.warn("计划协议补齐失败，按现有内容继续：", error instanceof Error ? error.message : error)
    return ""
  })
  if (topped) {
    const afterTopUp = inspect(topped)
    if (afterTopUp.ok) return { validation: afterTopUp.validation, notice: "" }
  }
  const degraded = degrade(first.protocol, first.reason)
  if (degraded) return degraded
  return { validation: { kind: "invalid", error: first.reason }, notice: "" }
}
