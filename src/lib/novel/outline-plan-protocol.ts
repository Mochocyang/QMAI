import { DEFAULT_OUTLINE_FOLDERS } from "./outline-workbench"
import type { OutlinePlanElementSpec } from "./outline-plan-elements"

export const OUTLINE_PLAN_MARKER_OPEN = "<!-- outline_plan -->"
export const OUTLINE_PLAN_MARKER_CLOSE = "<!-- /outline_plan -->"
/** 自定义输入项固定 id，卡片据此渲染手动输入框。 */
export const OUTLINE_PLAN_CUSTOM_OPTION_ID = "CUSTOM"
export const OUTLINE_PLAN_CUSTOM_OPTION_LABEL = "其它（我来补充描述）"
/** 每个追问必须提供的真实选项数量下限。 */
export const OUTLINE_PLAN_MIN_OPTIONS = 3
/** 单轮兜底追问的问题数量上限，避免一次铺满整张卡片。 */
export const OUTLINE_PLAN_MAX_FALLBACK_QUESTIONS = 4

export type OutlinePlanStatus = "needs_input" | "ready"
export type OutlinePlanElementSource = "user" | "project" | "inferred"

export interface OutlinePlanOption {
  id: string
  label: string
  description: string
}

export interface OutlinePlanQuestion {
  id: string
  key: string
  question: string
  multiple: boolean
  options: OutlinePlanOption[]
}

export interface OutlinePlanElementState {
  key: string
  value: string
  source: OutlinePlanElementSource
  satisfied: boolean
}

export interface OutlinePlanStep {
  id: string
  title: string
  detail: string
}

export interface OutlinePlanFile {
  targetFolder: string
  fileName: string
  fileType: string
  writeMode: string
  elements: string[]
}

export interface OutlinePlanBlueprint {
  summary: string
  steps: OutlinePlanStep[]
  files: OutlinePlanFile[]
  order: string
  risks: string[]
  openQuestions: string[]
}

export interface OutlinePlanProtocol {
  status: OutlinePlanStatus
  module: string
  elements: OutlinePlanElementState[]
  missing: string[]
  questions: OutlinePlanQuestion[]
  plan?: OutlinePlanBlueprint
}

export type OutlinePlanParseOutcome =
  | { kind: "none" }
  | { kind: "valid"; protocol: OutlinePlanProtocol }
  | { kind: "invalid"; error: string }

export type OutlinePlanValidation =
  | { kind: "invalid"; error: string }
  | { kind: "ready"; protocol: OutlinePlanProtocol }
  | { kind: "needs_input"; protocol: OutlinePlanProtocol; downgraded: boolean }

export interface OutlinePlanAnswer {
  key: string
  label: string
  question: string
  value: string
}

/** 计划模式两个协议轮次；执行腿仍复用既有 generation 阶段。 */
export type OutlinePlanPhase = "element_check" | "plan_proposal"
/** 卡片已被使用过的标记，重载后据此置灰，防重复提交。 */
export type OutlinePlanDecision = "confirmed" | "cancelled" | "answered"

const OPEN_PATTERN = /<!--\s*outline_plan\s*-->/i
const CLOSE_PATTERN = /<!--\s*\/outline_plan\s*-->/i
const ELEMENT_SOURCES: OutlinePlanElementSource[] = ["user", "project", "inferred"]

function extractLeadingJsonObject(text: string): { json: string; remainder: string } | null {
  const start = text.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
    } else if (character === "{") {
      depth += 1
    } else if (character === "}") {
      depth -= 1
      if (depth === 0) {
        return { json: text.slice(start, index + 1), remainder: text.slice(index + 1) }
      }
    }
  }
  return null
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : []
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeOptions(raw: unknown): OutlinePlanOption[] {
  const options = Array.isArray(raw)
    ? raw
      .filter(isPlainObject)
      .map((item, index) => ({
        id: String(item.id ?? "").trim() || String.fromCharCode(65 + index),
        label: String(item.label ?? "").trim(),
        description: String(item.description ?? "").trim(),
      }))
      .filter((option) => option.label)
    : []
  const withoutCustom = options.filter(
    (option) => option.id.toUpperCase() !== OUTLINE_PLAN_CUSTOM_OPTION_ID,
  )
  const custom = options.find(
    (option) => option.id.toUpperCase() === OUTLINE_PLAN_CUSTOM_OPTION_ID,
  )
  return [
    ...withoutCustom,
    {
      id: OUTLINE_PLAN_CUSTOM_OPTION_ID,
      label: custom?.label || OUTLINE_PLAN_CUSTOM_OPTION_LABEL,
      description: custom?.description ?? "",
    },
  ]
}

function normalizeQuestions(raw: unknown): OutlinePlanQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isPlainObject)
    .map((item, index) => ({
      id: String(item.id ?? "").trim() || `q${index + 1}`,
      key: String(item.key ?? "").trim(),
      question: String(item.question ?? "").trim(),
      multiple: item.multiple === true,
      options: normalizeOptions(item.options),
    }))
    .filter((question) => question.question)
}

function normalizeElements(raw: unknown): OutlinePlanElementState[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isPlainObject)
    .map((item) => {
      const source = String(item.source ?? "inferred").trim() as OutlinePlanElementSource
      const value = String(item.value ?? "").trim()
      return {
        key: String(item.key ?? "").trim(),
        value,
        source: ELEMENT_SOURCES.includes(source) ? source : "inferred",
        satisfied: item.satisfied === true && value !== "",
      }
    })
    .filter((element) => element.key)
}

function normalizePlan(raw: unknown): OutlinePlanBlueprint | undefined {
  if (!isPlainObject(raw)) return undefined
  const steps = Array.isArray(raw.steps)
    ? raw.steps
      .filter(isPlainObject)
      .map((item, index) => ({
        id: String(item.id ?? "").trim() || `s${index + 1}`,
        title: String(item.title ?? "").trim(),
        detail: String(item.detail ?? "").trim(),
      }))
      .filter((step) => step.title)
    : []
  const files = Array.isArray(raw.files)
    ? raw.files
      .filter(isPlainObject)
      .map((item) => ({
        targetFolder: String(item.targetFolder ?? "").trim(),
        fileName: String(item.fileName ?? "").trim(),
        fileType: String(item.fileType ?? "").trim(),
        writeMode: String(item.writeMode ?? "").trim(),
        elements: toStringArray(item.elements),
      }))
      .filter((file) => file.fileName)
    : []
  return {
    summary: String(raw.summary ?? "").trim(),
    steps,
    files,
    order: String(raw.order ?? "").trim(),
    risks: toStringArray(raw.risks),
    openQuestions: toStringArray(raw.openQuestions),
  }
}

/**
 * 解析 outline_plan 协议块。
 *
 * 与 intent_clarity 对称：支持未闭合标记兜底（流式截断），
 * 并在解析阶段就把每个追问补上自定义输入项。
 */
export function parseOutlinePlanProtocol(text: string): OutlinePlanParseOutcome {
  const openMatch = OPEN_PATTERN.exec(text)
  if (!openMatch) return { kind: "none" }

  const afterOpen = text.slice(openMatch.index + openMatch[0].length)
  const closeMatch = CLOSE_PATTERN.exec(afterOpen)
  const unclosedPayload = closeMatch ? null : extractLeadingJsonObject(afterOpen)
  const payloadText = closeMatch
    ? afterOpen.slice(0, closeMatch.index).trim()
    : unclosedPayload?.json
  if (!payloadText) {
    return { kind: "invalid", error: "计划协议 JSON 不完整或缺失" }
  }
  if (!closeMatch && unclosedPayload?.remainder.trim()) {
    return { kind: "invalid", error: "计划协议缺少闭合标记且 JSON 后仍有额外内容" }
  }

  let payload: unknown
  try {
    payload = JSON.parse(payloadText)
  } catch {
    return { kind: "invalid", error: "计划协议 JSON 无法解析" }
  }
  if (!isPlainObject(payload)) {
    return { kind: "invalid", error: "计划协议必须是 JSON 对象" }
  }

  const status = String(payload.status ?? "").trim()
  if (status !== "needs_input" && status !== "ready") {
    return { kind: "invalid", error: "计划协议缺少有效的 status 字段" }
  }

  return {
    kind: "valid",
    protocol: {
      status,
      module: String(payload.module ?? "").trim() || "大纲",
      elements: normalizeElements(payload.elements),
      missing: toStringArray(payload.missing),
      questions: normalizeQuestions(payload.questions),
      plan: normalizePlan(payload.plan),
    },
  }
}

function countRealOptions(question: OutlinePlanQuestion): number {
  return question.options.filter(
    (option) => option.id.toUpperCase() !== OUTLINE_PLAN_CUSTOM_OPTION_ID,
  ).length
}

/** 找出必填要素里尚未满足的部分。 */
export function findUnsatisfiedOutlinePlanElements(
  protocol: OutlinePlanProtocol,
  required: OutlinePlanElementSpec[],
): OutlinePlanElementSpec[] {
  return required.filter((spec) => {
    if (!spec.required) return false
    const matched = protocol.elements.find(
      (element) => element.key === spec.key || element.key === spec.label,
    )
    return !matched?.satisfied
  })
}

/** 按缺失要素生成兜底追问，每问至少 3 个真实选项 + 自定义输入项。 */
export function buildFallbackClarifyQuestions(
  specs: OutlinePlanElementSpec[],
): OutlinePlanQuestion[] {
  return specs.slice(0, OUTLINE_PLAN_MAX_FALLBACK_QUESTIONS).map((spec) => ({
    id: `auto-${spec.key}`,
    key: spec.key,
    question: `请确认「${spec.label}」：${spec.hint}`,
    multiple: false,
    options: normalizeOptions(
      spec.fallbackOptions.map((label, index) => ({
        id: String.fromCharCode(65 + index),
        label,
        description: "",
      })),
    ),
  }))
}

/**
 * 计划协议的代码闸门。
 *
 * 1. needs_input 时每问真实选项少于 3 个判为非法，不放行。
 * 2. ready 时缺少步骤或文件清单判为非法。
 * 3. ready 但必填要素没齐，强制降级为 needs_input 并按缺口生成追问。
 */
export function validateOutlinePlanProtocol(
  protocol: OutlinePlanProtocol,
  required: OutlinePlanElementSpec[],
): OutlinePlanValidation {
  if (protocol.status === "needs_input") {
    if (protocol.questions.length === 0) {
      return { kind: "invalid", error: "计划协议标记为需要补充信息，但没有给出任何追问" }
    }
    const thin = protocol.questions.find(
      (question) => countRealOptions(question) < OUTLINE_PLAN_MIN_OPTIONS,
    )
    if (thin) {
      return {
        kind: "invalid",
        error: `追问「${thin.question}」的可选项少于 ${OUTLINE_PLAN_MIN_OPTIONS} 个，无法进入问答`,
      }
    }
    return { kind: "needs_input", protocol, downgraded: false }
  }

  const plan = protocol.plan
  if (!plan || plan.steps.length === 0) {
    return { kind: "invalid", error: "计划协议标记为可执行，但缺少生成步骤" }
  }
  if (plan.files.length === 0) {
    return { kind: "invalid", error: "计划协议标记为可执行，但缺少待写文件清单" }
  }

  const unsatisfied = findUnsatisfiedOutlinePlanElements(protocol, required)
  if (unsatisfied.length > 0) {
    return {
      kind: "needs_input",
      downgraded: true,
      protocol: {
        ...protocol,
        status: "needs_input",
        missing: unsatisfied.map((spec) => spec.label),
        questions: buildFallbackClarifyQuestions(unsatisfied),
        plan: undefined,
      },
    }
  }

  return { kind: "ready", protocol }
}

function formatElementChecklist(required: OutlinePlanElementSpec[]): string[] {
  return required.map((spec) => {
    const flag = spec.required ? "必填" : "可选"
    return `- ${spec.key}（${spec.label}，${flag}）：${spec.hint}`
  })
}

/** 计划模式的系统规则；替代标准模式的意图清晰度分析段。 */
export function buildOutlinePlanPhaseSystemRules(
  module: string,
  required: OutlinePlanElementSpec[],
): string {
  const folderNames = DEFAULT_OUTLINE_FOLDERS.map((folder) => folder.name).join("、")
  return [
    "## 本轮阶段：计划模式要素盘点",
    `本轮目标模块：${module || "大纲"}。本轮禁止生成大纲正文，禁止调用保存工具，禁止输出 intent_clarity。`,
    "1. 先调用 list_outlines、list_chapters、list_memories 确认可用资料，再用 read_outline、read_chapter 读取相关正文。",
    "2. 逐项盘点下面的要素清单：项目里已经写明的标 source 为 project 且 satisfied 为 true，用户已经说明的标 user，只有你自己推断的标 inferred 且 satisfied 必须为 false。",
    "3. 只要还有必填要素没满足，status 必须是 needs_input，只输出追问，不要输出 plan。",
    `4. 每个追问必须给出至少 ${OUTLINE_PLAN_MIN_OPTIONS} 个具体可选项（选项要来自已读取资料或题材惯例，不要写空泛的“其它”），系统会自动追加自定义输入项。`,
    "5. 必填要素全部满足时，status 才能是 ready，并给出 plan：生成步骤、待写文件清单、生成顺序、风险和遗留问题。",
    `6. plan.files 的 targetFolder 只能用这些文件夹名：${folderNames}；fileType 只能用 outline、volume-outline、chapter-outline、character、setting、foreshadowing、organization、quality-report。`,
    "7. 已经存在的文件必须用 append、patch 或 replace，只有新建文件才能用 create。",
    "## 要素清单",
    ...formatElementChecklist(required),
    "## 输出格式（必须严格遵守）",
    OUTLINE_PLAN_MARKER_OPEN,
    '{"status":"needs_input|ready","module":"模块名","elements":[{"key":"要素key","value":"已确认内容","source":"user|project|inferred","satisfied":true}],"missing":["缺失要素"],"questions":[{"id":"q1","key":"要素key","question":"追问","multiple":false,"options":[{"id":"A","label":"选项","description":"说明"}]}],"plan":{"summary":"","steps":[{"id":"s1","title":"","detail":""}],"files":[{"targetFolder":"","fileName":"","fileType":"","writeMode":"","elements":[]}],"order":"","risks":[],"openQuestions":[]}}',
    OUTLINE_PLAN_MARKER_CLOSE,
    "开闭标记必须成对出现，JSON 必须完整可解析。最终回复只输出这一个协议块，不要输出其它正文。",
  ].join("\n")
}

/** 计划模式首轮要素盘点的 user prompt。 */
export function buildOutlinePlanElementCheckPrompt(input: {
  module: string
  requestHint: string
  originalRequest?: string
}): string {
  return [
    `请对以下大纲请求做计划模式要素盘点：「${input.module}」`,
    input.originalRequest?.trim() ? `用户原话：${input.originalRequest.trim()}` : "",
    "",
    "## 本模块内容要求",
    input.requestHint,
    "",
    "先读取项目已有资料，判断要素齐备情况，再按 outline_plan 协议输出结果。",
    "要素没齐就只追问，不要生成正文；齐了就给出生成计划等我确认。",
  ]
    .filter(Boolean)
    .join("\n")
}

function formatCollectedElements(elements: OutlinePlanElementState[]): string[] {
  return elements
    .filter((element) => element.satisfied && element.value)
    .map((element) => `- ${element.key}：${element.value}（来源：${element.source}）`)
}

/** 用户回答追问后的内部 user prompt；累计要素随对话历史传递，不依赖内存状态。 */
export function buildOutlinePlanClarifyAnswerPrompt(input: {
  module: string
  answers: OutlinePlanAnswer[]
  collected: OutlinePlanElementState[]
}): string {
  const collected = formatCollectedElements(input.collected)
  return [
    `我已补充「${input.module}」的缺失要素，请继续计划模式要素盘点。`,
    "",
    "## 本次补充",
    ...input.answers.map((answer) => `- ${answer.label || answer.key}：${answer.value}`),
    ...(collected.length
      ? ["", "## 之前已确认的要素", ...collected]
      : []),
    "",
    "请把本次补充并入 elements（source 标为 user，satisfied 标为 true），重新判断是否还有必填要素缺失。",
    "仍有缺失就继续按 outline_plan 协议追问；已经齐备就输出 status 为 ready 的生成计划。",
  ].join("\n")
}

/** 把计划渲染成 Markdown，供卡片展示、用户编辑和确认后回传模型。 */
export function formatOutlinePlanMarkdown(plan: OutlinePlanBlueprint): string {
  const lines: string[] = []
  if (plan.summary) lines.push(`## 方案概要`, plan.summary, "")
  if (plan.steps.length) {
    lines.push("## 生成步骤")
    plan.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.title}${step.detail ? `：${step.detail}` : ""}`)
    })
    lines.push("")
  }
  if (plan.files.length) {
    lines.push("## 待写文件")
    for (const file of plan.files) {
      const location = [file.targetFolder, file.fileName].filter(Boolean).join("/")
      const meta = [file.fileType, file.writeMode].filter(Boolean).join("、")
      lines.push(`- ${location}${meta ? `（${meta}）` : ""}`)
    }
    lines.push("")
  }
  if (plan.order) lines.push("## 生成顺序", plan.order, "")
  if (plan.risks.length) {
    lines.push("## 风险", ...plan.risks.map((risk) => `- ${risk}`), "")
  }
  if (plan.openQuestions.length) {
    lines.push("## 遗留问题", ...plan.openQuestions.map((item) => `- ${item}`), "")
  }
  return lines.join("\n").trim()
}

/** 用户确认计划后的执行 prompt；执行腿复用既有 generation 阶段。 */
export function buildOutlinePlanExecutionPrompt(input: {
  module: string
  planText: string
  elements: OutlinePlanElementState[]
}): string {
  const collected = formatCollectedElements(input.elements)
  return [
    `生成计划已确认，现在进入「${input.module}」的正文生成阶段。`,
    "请严格按下面这份已确认的计划生成可保存的大纲正文，不要改写计划，不要再次输出计划或追问，不要再次等待确认。",
    `禁止再输出 ${OUTLINE_PLAN_MARKER_OPEN} 协议块。生成完成后按 AI 大纲输出协议在末尾附加 outlineSaveRequest 或 outlineSaveRequests JSON 块。`,
    ...(collected.length ? ["", "## 已确认要素", ...collected] : []),
    "",
    "=== 已确认的生成计划 ===",
    input.planText.trim(),
  ].join("\n")
}

/** 会话落盘后的形状校验，结构不完整的计划数据一律丢弃。 */
export function isOutlinePlanProtocol(value: unknown): value is OutlinePlanProtocol {
  if (!isPlainObject(value)) return false
  if (value.status !== "needs_input" && value.status !== "ready") return false
  if (typeof value.module !== "string" || !value.module.trim()) return false
  if (!Array.isArray(value.elements) || !Array.isArray(value.questions)) return false
  if (!Array.isArray(value.missing)) return false
  if (!value.elements.every((element) => isPlainObject(element) && typeof element.key === "string")) {
    return false
  }
  if (!value.questions.every((question) => (
    isPlainObject(question)
    && typeof question.question === "string"
    && Array.isArray(question.options)
    && question.options.every((option) => isPlainObject(option) && typeof option.label === "string")
  ))) {
    return false
  }
  if (value.plan !== undefined) {
    if (!isPlainObject(value.plan)) return false
    if (!Array.isArray(value.plan.steps) || !Array.isArray(value.plan.files)) return false
  }
  return true
}

/** 剥掉 outline_plan 协议标记，与 stripStructuredMarkers 对 intent_clarity 的处理对称。 */
export function stripOutlinePlanMarkers(text: string): string {
  return text
    .replace(/<!--\s*outline_plan\s*-->[\s\S]*?<!--\s*\/outline_plan\s*-->/gi, "")
    .replace(/<!--\s*outline_plan\s*-->[\s\S]*$/gi, "")
    .replace(/<!--\s*\/outline_plan\s*-->/gi, "")
}
