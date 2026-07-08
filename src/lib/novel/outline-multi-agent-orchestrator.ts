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
  skillNames: string[]
  taskPrompt: string
  writeToolsEnabled: false
}

export interface OutlineMultiAgentPlanInput {
  preferredSkillNames: string[]
  taskPrompt: string
  maxConcurrency?: number
}

export interface OutlineMultiAgentRunInput {
  plan: OutlineSubAgentPlan[]
  maxConcurrency?: number
  failureFallbackThreshold?: number
  runSubAgent: (plan: OutlineSubAgentPlan) => Promise<string>
  runSingleAgentFallback: () => Promise<string>
  mergeResults: (results: OutlineSubAgentResult[]) => Promise<string>
}

export interface OutlineMultiAgentRunResult {
  mode: "multi-agent" | "single-agent-fallback"
  finalText: string
  successfulAgents: string[]
  failedAgents: string[]
  fallbackReason?: string
  failureDetails?: string[]
}

const KIND_ORDER: OutlineSubAgentKind[] = [
  "outline",
  "topic",
  "character",
  "setting",
  "foreshadowing",
]

export function planOutlineSubAgents(input: OutlineMultiAgentPlanInput): OutlineSubAgentPlan[] {
  const grouped = new Map<OutlineSubAgentKind, string[]>()
  for (const name of input.preferredSkillNames) {
    const kind = inferSubAgentKind(name)
    const current = grouped.get(kind) ?? []
    current.push(name)
    grouped.set(kind, current)
  }

  return KIND_ORDER
    .filter((kind) => grouped.has(kind))
    .map((kind) => ({
      id: `${kind}-agent`,
      name: subAgentName(kind),
      kind,
      skillNames: grouped.get(kind) ?? [],
      taskPrompt: buildSubAgentTaskPrompt(kind, input.taskPrompt, grouped.get(kind) ?? []),
      writeToolsEnabled: false,
    }))
}

export async function runOutlineMultiAgentWorkflow(
  input: OutlineMultiAgentRunInput,
): Promise<OutlineMultiAgentRunResult> {
  if (input.plan.length === 0) {
    const finalText = await input.runSingleAgentFallback()
    return {
      mode: "single-agent-fallback",
      finalText,
      successfulAgents: [],
      failedAgents: [],
      fallbackReason: "没有可执行的子 Agent 计划。",
      failureDetails: [],
    }
  }

  const maxConcurrency = Math.max(1, input.maxConcurrency ?? 3)
  const settled = await runWithConcurrency(input.plan, maxConcurrency, async (plan) => {
    const raw = await input.runSubAgent(plan)
    const parsed = coerceOutlineSubAgentResult(raw, {
      agentId: plan.id,
      agentName: plan.name,
      usedSkills: plan.skillNames,
      stage: plan.kind,
    })
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.value
  })

  const successful = settled
    .filter((item): item is PromiseFulfilledResult<OutlineSubAgentResult> => item.status === "fulfilled")
    .map((item) => item.value)
  const failures = settled
    .map((item, index) => ({ item, plan: input.plan[index] }))
    .filter(({ item }) => item.status === "rejected")
    .map(({ item, plan }) => ({
      agentId: plan.id,
      detail: `${plan.name}：${item.status === "rejected" ? formatError(item.reason) : "执行失败"}`,
    }))
  const failedAgents = failures.map((item) => item.agentId)
  const failureDetails = failures.map((item) => item.detail)

  const threshold = input.failureFallbackThreshold ?? 0.5
  if (failedAgents.length / input.plan.length >= threshold) {
    const finalText = await input.runSingleAgentFallback()
    return {
      mode: "single-agent-fallback",
      finalText,
      successfulAgents: successful.map((item) => item.agentId),
      failedAgents,
      fallbackReason: `多 Agent 失败数量超过阈值：${failedAgents.length}/${input.plan.length}`,
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
    const finalText = await input.runSingleAgentFallback()
    return {
      mode: "single-agent-fallback",
      finalText,
      successfulAgents: successful.map((item) => item.agentId),
      failedAgents,
      fallbackReason: `合并 Agent 失败：${error instanceof Error ? error.message : String(error)}`,
      failureDetails: [...failureDetails, `合并 Agent：${formatError(error)}`],
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let nextIndex = 0

  async function runNext(): Promise<void> {
    const index = nextIndex
    nextIndex += 1
    if (index >= items.length) return
    try {
      results[index] = { status: "fulfilled", value: await worker(items[index]) }
    } catch (reason) {
      results[index] = { status: "rejected", reason }
    }
    await runNext()
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length) }, () => runNext()))
  return results
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
    "输出必须是一个 JSON 对象，不要输出 Markdown 代码围栏，不要输出解释说明。",
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
