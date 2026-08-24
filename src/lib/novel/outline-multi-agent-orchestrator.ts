import {
  coerceOutlineSubAgentResult,
  type OutlineSubAgentResult,
} from "./outline-result-protocol"

export type OutlineSubAgentKind =
  | "outline"
  | "topic"
  | "character"
  | "setting"
  | "foreshadowing"

export interface OutlineSubAgentPlan {
  id: string
  name: string
  kind: OutlineSubAgentKind
  dimension?: string
  skillNames: string[]
  taskPrompt: string
  dependencies?: string[]
  priority?: number
  finalReview?: boolean
  writeToolsEnabled: false
}

interface OutlineMultiAgentPlanInput {
  preferredSkillNames: string[]
  taskPrompt: string
  maxConcurrency?: number
}

type OutlineSubAgentExecutionStatus =
  | "waiting"
  | "ready"
  | "running"
  | "retrying"
  | "completed"
  | "failed"

interface OutlineSubAgentStatusEvent {
  agentId: string
  status: OutlineSubAgentExecutionStatus
  attempt: number
  error?: string
}

interface OutlineMultiAgentRunInput {
  plan: OutlineSubAgentPlan[]
  maxConcurrency?: number
  runSubAgent: (plan: OutlineSubAgentPlan) => Promise<string>
  runSingleAgentFallback: () => Promise<string>
  mergeResults: (results: OutlineSubAgentResult[]) => Promise<string>
  onStatusChange?: (event: OutlineSubAgentStatusEvent) => void
}

interface OutlineMultiAgentRunResult {
  mode: "multi-agent" | "single-agent-fallback"
  finalText: string
  successfulAgents: string[]
  failedAgents: string[]
  fallbackReason?: string
  failureDetails?: string[]
}

interface OutlinePlanValidationResult {
  ok: boolean
  errors: string[]
}

const KIND_ORDER: OutlineSubAgentKind[] = [
  "outline",
  "topic",
  "character",
  "setting",
  "foreshadowing",
]

const MAX_AGENT_TASKS = 5
const DEFAULT_MAX_CONCURRENCY = 3

export function isSimpleOutlineTask(task: string): boolean {
  const value = task.trim()
  return value.length <= 40
    && /修改|调整|改短|改长|润色|改名|补一句|删除|替换/.test(value)
    && !/完整|全本|长篇|重做|重新生成|世界观|人物关系|多线|多卷/.test(value)
}

export function planOutlineSubAgents(input: OutlineMultiAgentPlanInput): OutlineSubAgentPlan[] {
  if (isSimpleOutlineTask(input.taskPrompt)) {
    return [{
      id: "outline-agent",
      name: subAgentName("outline"),
      kind: "outline",
      dimension: "局部调整",
      skillNames: input.preferredSkillNames.slice(0, 2),
      taskPrompt: buildSubAgentTaskPrompt("outline", input.taskPrompt, input.preferredSkillNames.slice(0, 2)),
      dependencies: [],
      priority: 1,
      finalReview: false,
      writeToolsEnabled: false,
    }]
  }
  const grouped = new Map<OutlineSubAgentKind, string[]>()
  for (const name of input.preferredSkillNames) {
    const kind = inferSubAgentKind(name)
    const current = grouped.get(kind) ?? []
    current.push(name)
    grouped.set(kind, current)
  }

  return KIND_ORDER
    .filter((kind) => grouped.has(kind))
    .map((kind, index) => ({
      id: `${kind}-agent`,
      name: subAgentName(kind),
      kind,
      dimension: subAgentName(kind).replace(/ Agent$/, ""),
      skillNames: grouped.get(kind) ?? [],
      taskPrompt: buildSubAgentTaskPrompt(kind, input.taskPrompt, grouped.get(kind) ?? []),
      dependencies: [],
      priority: KIND_ORDER.length - index,
      finalReview: false,
      writeToolsEnabled: false,
    }))
}

export function validateOutlineSubAgentPlan(plan: OutlineSubAgentPlan[]): OutlinePlanValidationResult {
  const errors: string[] = []
  if (plan.length === 0) errors.push("任务图不能为空")
  if (plan.length > MAX_AGENT_TASKS) errors.push(`任务数量不能超过 ${MAX_AGENT_TASKS}`)

  const ids = new Set<string>()
  for (const task of plan) {
    if (!task.id.trim()) errors.push("Agent ID 不能为空")
    if (ids.has(task.id)) errors.push(`Agent ID 重复：${task.id}`)
    ids.add(task.id)
  }

  for (const task of plan) {
    for (const dependency of task.dependencies ?? []) {
      if (dependency === task.id) errors.push(`Agent 不能依赖自身：${task.id}`)
      else if (!ids.has(dependency)) errors.push(`依赖不存在：${task.id} -> ${dependency}`)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(plan.map((task) => [task.id, task]))
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    const cyclic = (byId.get(id)?.dependencies ?? []).some((dependency) => byId.has(dependency) && visit(dependency))
    visiting.delete(id)
    visited.add(id)
    return cyclic
  }
  if (plan.some((task) => visit(task.id))) errors.push("任务依赖存在循环")

  return { ok: errors.length === 0, errors }
}

export async function runOutlineMultiAgentWorkflow(
  input: OutlineMultiAgentRunInput,
): Promise<OutlineMultiAgentRunResult> {
  const validation = validateOutlineSubAgentPlan(input.plan)
  if (!validation.ok) {
    const finalText = await input.runSingleAgentFallback()
    return {
      mode: "single-agent-fallback",
      finalText,
      successfulAgents: [],
      failedAgents: [],
      fallbackReason: `多 Agent 规划失败：${validation.errors.join("；")}`,
      failureDetails: validation.errors,
    }
  }

  const maxConcurrency = Math.min(DEFAULT_MAX_CONCURRENCY, Math.max(1, input.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY))
  const outcomes = await runDependencyGraph(input.plan, maxConcurrency, input)
  const successful = input.plan
    .map((task) => outcomes.get(task.id)?.result)
    .filter((result): result is OutlineSubAgentResult => Boolean(result))
  const failures = input.plan
    .map((task) => ({ task, error: outcomes.get(task.id)?.error }))
    .filter((item): item is { task: OutlineSubAgentPlan; error: string } => Boolean(item.error))
  const failedAgents = failures.map(({ task }) => task.id)
  const failureDetails = failures.map(({ task, error }) => `${task.name}：${error}`)

  if (successful.length === 0) {
    const finalText = await input.runSingleAgentFallback()
    return {
      mode: "single-agent-fallback",
      finalText,
      successfulAgents: [],
      failedAgents,
      fallbackReason: "多 Agent 没有任何成功结果，已降级为单 Agent。",
      failureDetails,
    }
  }

  try {
    const finalText = await input.mergeResults(successful)
    return {
      mode: "multi-agent",
      finalText,
      successfulAgents: successful.map((item) => item.agentId),
      failedAgents,
      failureDetails,
    }
  } catch (error) {
    const detail = formatError(error)
    const finalText = await input.runSingleAgentFallback()
    return {
      mode: "single-agent-fallback",
      finalText,
      successfulAgents: successful.map((item) => item.agentId),
      failedAgents,
      fallbackReason: `合并 Agent 失败：${detail}`,
      failureDetails: [...failureDetails, `合并 Agent：${detail}`],
    }
  }
}

interface AgentOutcome {
  result?: OutlineSubAgentResult
  error?: string
}

async function runDependencyGraph(
  plan: OutlineSubAgentPlan[],
  maxConcurrency: number,
  input: OutlineMultiAgentRunInput,
  initialOutcomes: Map<string, AgentOutcome> = new Map(),
): Promise<Map<string, AgentOutcome>> {
  const outcomes = new Map<string, AgentOutcome>(initialOutcomes)
  const running = new Map<string, Promise<void>>()
  const order = new Map(plan.map((task, index) => [task.id, index]))
  const pending = new Set(plan.map((task) => task.id))

  const sortedReady = () => plan
    .filter((task) => pending.has(task.id))
    .filter((task) => (task.dependencies ?? []).every((id) => outcomes.has(id)))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

  while (pending.size > 0 || running.size > 0) {
    for (const task of sortedReady()) {
      if (running.size >= maxConcurrency) break
      pending.delete(task.id)
      input.onStatusChange?.({ agentId: task.id, status: "ready", attempt: 0 })
      const promise = executeWithRetry(task, outcomes, input)
        .then((outcome) => { outcomes.set(task.id, outcome) })
        .finally(() => { running.delete(task.id) })
      running.set(task.id, promise)
    }
    if (running.size > 0) {
      await Promise.race(running.values())
      continue
    }
    if (pending.size > 0) {
      for (const id of pending) {
        const task = plan.find((item) => item.id === id)
        const missing = (task?.dependencies ?? []).filter((dependency) => !outcomes.has(dependency))
        const error = `依赖未满足：${missing.join("、") || "未知依赖"}`
        outcomes.set(id, { error })
        input.onStatusChange?.({ agentId: id, status: "failed", attempt: 0, error })
      }
      pending.clear()
    }
  }

  return outcomes
}

async function executeWithRetry(
  task: OutlineSubAgentPlan,
  outcomes: Map<string, AgentOutcome>,
  input: OutlineMultiAgentRunInput,
): Promise<AgentOutcome> {
  const dependencyFailures = (task.dependencies ?? [])
    .map((id) => ({ id, outcome: outcomes.get(id) }))
    .filter(({ outcome }) => outcome?.error)
  const dependencyResults = (task.dependencies ?? [])
    .map((id) => ({ id, outcome: outcomes.get(id) }))
    .filter((item): item is { id: string; outcome: AgentOutcome & { result: OutlineSubAgentResult } } => Boolean(item.outcome?.result))
  const dependencyContext = [
    ...(dependencyResults.length > 0 ? [
      "## 上游依赖结论",
      ...dependencyResults.map(({ id, outcome }) => {
        const dependencyTask = input.plan.find((item) => item.id === id)
        const result = outcome.result
        return [
          `### ${dependencyTask?.dimension || dependencyTask?.name || id}`,
          `结论：${result.summary}`,
          result.constraints.length > 0 ? `约束：${result.constraints.join("；")}` : "",
          result.contentMarkdown,
        ].filter(Boolean).join("\n")
      }),
    ] : []),
    ...(dependencyFailures.length > 0 ? [
      "## 缺失依赖风险",
      ...dependencyFailures.map(({ id, outcome }) => {
        const dependencyTask = input.plan.find((item) => item.id === id)
        return `- ${dependencyTask?.dimension || dependencyTask?.name || id}：${outcome?.error}`
      }),
    ] : []),
  ]
  const runnableTask: OutlineSubAgentPlan = dependencyContext.length > 0
    ? { ...task, taskPrompt: [task.taskPrompt, "", ...dependencyContext].join("\n") }
    : task

  let lastError = "执行失败"
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    input.onStatusChange?.({
      agentId: task.id,
      status: attempt === 1 ? "running" : "retrying",
      attempt,
      error: attempt === 1 ? undefined : lastError,
    })
    try {
      const raw = await input.runSubAgent(runnableTask)
      const parsed = coerceOutlineSubAgentResult(raw, {
        agentId: task.id,
        agentName: task.name,
        usedSkills: task.skillNames,
        stage: task.dimension || task.kind,
      })
      if (!parsed.ok) throw new Error(parsed.error)
      input.onStatusChange?.({ agentId: task.id, status: "completed", attempt })
      return { result: parsed.value }
    } catch (error) {
      lastError = formatError(error)
    }
  }
  input.onStatusChange?.({ agentId: task.id, status: "failed", attempt: 2, error: lastError })
  return { error: lastError }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatWritebackItems(items: OutlineSubAgentResult["writebackItems"]): string {
  if (items.length === 0) return ""
  return [
    "## 写回项",
    ...items.map((item) => [
      `### ${item.name || item.type || "未命名写回"}`,
      item.type ? `类型：${item.type}` : "",
      item.targetFolder ? `目标：${item.targetFolder}` : "",
      item.content,
    ].filter(Boolean).join("\n")),
  ].join("\n")
}

function buildSubAgentMergeSection(result: OutlineSubAgentResult): string {
  return [
    `## ${result.agentName}`,
    `摘要：${result.summary}`,
    `置信度：${result.confidence}`,
    result.constraints.length > 0 ? `约束：${result.constraints.join("；")}` : "",
    result.risks.length > 0 ? `冲突与风险：${result.risks.join("；")}` : "冲突与风险：无",
    result.questions.length > 0 ? `待确认问题：${result.questions.join("；")}` : "",
    formatWritebackItems(result.writebackItems),
    result.contentMarkdown,
  ].filter(Boolean).join("\n")
}

export const DEFAULT_OUTLINE_SUBAGENT_MERGE_MAX_CHARS = 48_000

export function buildBoundedSubAgentMergePayload(results: OutlineSubAgentResult[], maxChars = DEFAULT_OUTLINE_SUBAGENT_MERGE_MAX_CHARS): string {
  if (results.length === 0) return ""
  const sections = results.map((result) => buildSubAgentMergeSection(result))
  const payload = sections.join("\n\n")
  if (!Number.isFinite(maxChars) || maxChars <= 0) return payload
  if (payload.length <= maxChars) return payload

  const kept: string[] = []
  let used = 0
  for (const section of sections) {
    const extra = kept.length > 0 ? 2 : 0
    if (kept.length > 0 && used + extra + section.length > maxChars) break
    kept.push(section)
    used += extra + section.length
  }
  return kept.join("\n\n")
}

function inferSubAgentKind(skillName: string): OutlineSubAgentKind {
  if (/outline|story-|goal|protagonist|worldbuilding-outline/i.test(skillName)) return "outline"
  if (/male-|female-|rule-|zhihu|family|farming|western|entertainment/i.test(skillName)) return "topic"
  if (/character|relationship|supporting-cast/i.test(skillName)) return "character"
  if (/foreshadow|suspense/i.test(skillName)) return "foreshadowing"
  return "setting"
}

function subAgentName(kind: OutlineSubAgentKind): string {
  const names: Record<OutlineSubAgentKind, string> = {
    outline: "大纲 Agent",
    topic: "题材 Agent",
    character: "角色 Agent",
    setting: "设定 Agent",
    foreshadowing: "伏笔 Agent",
  }
  return names[kind]
}

function buildSubAgentTaskPrompt(
  kind: OutlineSubAgentKind,
  taskPrompt: string,
  skillNames: string[],
): string {
  return [
    `你是${subAgentName(kind)}。`,
    "请只处理自己负责的维度，不要写入文件。",
    `原始任务：${taskPrompt}`,
    `本 Agent 使用 Skill：${skillNames.join("、")}`,
    "输出必须是一个 JSON 对象，不要输出 Markdown 代码围栏或解释说明。",
    "JSON 字段模板：",
    JSON.stringify({
      agent_id: `${kind}-agent`,
      agent_name: subAgentName(kind),
      stage: kind,
      used_skills: skillNames,
      confidence: 0.8,
      summary: "一句话总结本 Agent 结论",
      content_markdown: "## 本 Agent 负责内容\n这里写可合并的大纲内容",
      constraints: [],
      writeback_items: [],
      risks: [],
      questions: [],
    }, null, 2),
  ].join("\n")
}

interface OutlineMultiAgentResumeInput {
  /** 上一次运行的完整 plan */
  plan: OutlineSubAgentPlan[]
  /** 已成功 Agent 的结果（跳过不重试） */
  completedResults: OutlineSubAgentResult[]
  /** 上次运行中失败的 Agent ID 列表 */
  failedAgentIds: string[]
  maxConcurrency?: number
  runSubAgent: (plan: OutlineSubAgentPlan) => Promise<string>
  mergeResults: (results: OutlineSubAgentResult[]) => Promise<string>
  onStatusChange?: (event: OutlineSubAgentStatusEvent) => void
}

/**
 * 仅重试失败 Agent，已成功 Agent 的结果直接复用。
 * 最终合并 completedResults + 新成功的失败 Agent 结果。
 */
export async function resumeOutlineMultiAgentWorkflow(
  input: OutlineMultiAgentResumeInput,
): Promise<OutlineMultiAgentRunResult> {
  const failedPlan = input.plan.filter((task) =>
    input.failedAgentIds.includes(task.id),
  )

  if (failedPlan.length === 0) {
    // 没有失败 Agent，直接合并已有结果
    try {
      const finalText = await input.mergeResults(input.completedResults)
      return {
        mode: "multi-agent",
        finalText,
        successfulAgents: input.completedResults.map((item) => item.agentId),
        failedAgents: [],
        failureDetails: [],
      }
    } catch (error) {
      const detail = formatError(error)
      return {
        mode: "single-agent-fallback",
        finalText: "",
        successfulAgents: input.completedResults.map((item) => item.agentId),
        failedAgents: [],
        fallbackReason: `合并 Agent 失败：${detail}`,
        failureDetails: [`合并 Agent：${detail}`],
      }
    }
  }

  const maxConcurrency = Math.min(
    DEFAULT_MAX_CONCURRENCY,
    Math.max(1, input.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY),
  )

  // 仅执行失败 Agent
  const resumeInput: OutlineMultiAgentRunInput = {
    plan: input.plan,
    maxConcurrency,
    runSubAgent: input.runSubAgent,
    runSingleAgentFallback: async () => "",
    mergeResults: input.mergeResults,
    onStatusChange: input.onStatusChange,
  }

  const completedOutcomes = new Map<string, AgentOutcome>(
    input.completedResults.map((result) => [result.agentId, { result }]),
  )
  const outcomes = await runDependencyGraph(failedPlan, maxConcurrency, resumeInput, completedOutcomes)

  // 收集本次重试的结果
  const retriedSuccessful = failedPlan
    .map((task) => outcomes.get(task.id)?.result)
    .filter((result): result is OutlineSubAgentResult => Boolean(result))

  const retriedFailures = failedPlan
    .map((task) => ({ task, error: outcomes.get(task.id)?.error }))
    .filter((item): item is { task: OutlineSubAgentPlan; error: string } => Boolean(item.error))

  const allSuccessful = [...input.completedResults, ...retriedSuccessful]
  const stillFailedAgents = retriedFailures.map(({ task }) => task.id)
  const failureDetails = retriedFailures.map(({ task, error }) => `${task.name}：${error}`)

  if (allSuccessful.length === 0) {
    return {
      mode: "single-agent-fallback",
      finalText: "",
      successfulAgents: [],
      failedAgents: stillFailedAgents,
      fallbackReason: "续传后仍无成功结果。",
      failureDetails,
    }
  }

  try {
    const finalText = await input.mergeResults(allSuccessful)
    return {
      mode: "multi-agent",
      finalText,
      successfulAgents: allSuccessful.map((item) => item.agentId),
      failedAgents: stillFailedAgents,
      failureDetails,
    }
  } catch (error) {
    const detail = formatError(error)
    return {
      mode: "single-agent-fallback",
      finalText: "",
      successfulAgents: allSuccessful.map((item) => item.agentId),
      failedAgents: stillFailedAgents,
      fallbackReason: `合并 Agent 失败：${detail}`,
      failureDetails: [...failureDetails, `合并 Agent：${detail}`],
    }
  }
}
