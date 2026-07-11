import {
  validateOutlineSubAgentPlan,
  type OutlineSubAgentKind,
  type OutlineSubAgentPlan,
} from "./outline-multi-agent-orchestrator"

export interface DynamicOutlinePlannerSkill {
  name: string
  description: string
  stages: string[]
  kinds: string[]
}

export interface DynamicOutlinePlannerContext {
  userTask: string
  projectSummary: string
  existingModules: string[]
  missingModules: string[]
  skills: DynamicOutlinePlannerSkill[]
}

export type DynamicOutlinePlanParseResult =
  | { ok: true; plan: OutlineSubAgentPlan[] }
  | { ok: false; error: string }

export function buildDynamicOutlinePlannerPrompt(context: DynamicOutlinePlannerContext): string {
  return [
    "你是 AI 大纲多 Agent 动态规划器。只输出 JSON，不要输出解释。",
    "请根据任务、项目现状和全部可用 Skill 规划独立任务，而不是按固定类别机械分组。",
    "最多 12 个 Agent，最多同时运行 3 个 Agent。最终审查任务必须依赖需要审查的前置任务。",
    "每个任务包含 id、中文 name、dimension、skillNames、taskPrompt、dependencies、priority、finalReview。",
    "依赖失败后下游仍会继续，因此任务提示词必须能接受缺失维度风险。",
    "",
    `## 用户任务\n${context.userTask || "（未提供）"}`,
    `## 项目摘要\n${context.projectSummary || "（暂无摘要）"}`,
    `## 已有模块\n${formatList(context.existingModules)}`,
    `## 缺失模块\n${formatList(context.missingModules)}`,
    "## 全部可用 Skill",
    ...context.skills.map((skill) => [
      `- 名称：${skill.name}`,
      `  用途：${skill.description || "未说明"}`,
      `  阶段：${skill.stages.join(", ") || "未标注"}`,
      `  类型：${skill.kinds.join(", ") || "未标注"}`,
    ].join("\n")),
    "",
    "输出格式：",
    JSON.stringify({
      tasks: [{
        id: "character-relations",
        name: "人物关系 Agent",
        dimension: "人物关系",
        skillNames: ["人物设计"],
        taskPrompt: "结合项目摘要补齐人物关系",
        dependencies: [],
        priority: 90,
        finalReview: false,
      }],
    }, null, 2),
  ].join("\n")
}

export function parseDynamicOutlinePlan(
  text: string,
  availableSkillNames?: string[],
): DynamicOutlinePlanParseResult {
  const jsonText = extractJsonObject(text)
  if (!jsonText) return { ok: false, error: "规划器未返回 JSON 对象" }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (error) {
    return { ok: false, error: `规划 JSON 解析失败：${formatError(error)}` }
  }

  const root = asRecord(parsed)
  const tasks = Array.isArray(root?.tasks) ? root.tasks : Array.isArray(parsed) ? parsed : null
  if (!tasks) return { ok: false, error: "规划 JSON 缺少 tasks 数组" }

  const plan: OutlineSubAgentPlan[] = []
  for (let index = 0; index < tasks.length; index += 1) {
    const raw = asRecord(tasks[index])
    if (!raw) return { ok: false, error: `第 ${index + 1} 个任务不是对象` }
    const id = stringValue(raw.id)
    const name = stringValue(raw.name || raw.agent_name)
    const dimension = stringValue(raw.dimension || raw.work_dimension)
    const taskPrompt = stringValue(raw.taskPrompt || raw.task_prompt)
    const skillNames = stringArray(raw.skillNames || raw.skill_names)
    if (!id || !name || !dimension || !taskPrompt) {
      return { ok: false, error: `第 ${index + 1} 个任务缺少 id、name、dimension 或 taskPrompt` }
    }
    plan.push({
      id,
      name,
      kind: inferLegacyKind(dimension),
      dimension,
      skillNames,
      taskPrompt,
      dependencies: stringArray(raw.dependencies || raw.depends_on),
      priority: numberValue(raw.priority, tasks.length - index),
      finalReview: booleanValue(raw.finalReview ?? raw.final_review),
      writeToolsEnabled: false,
    })
  }

  if (availableSkillNames) {
    const available = new Set(availableSkillNames)
    const unknown = plan.flatMap((task) => task.skillNames).find((name) => !available.has(name))
    if (unknown) return { ok: false, error: `规划使用了不存在的 Skill：${unknown}` }
  }

  const validation = validateOutlineSubAgentPlan(plan)
  if (!validation.ok) return { ok: false, error: validation.errors.join("；") }
  return { ok: true, plan }
}

function formatList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- 无"
}

function extractJsonObject(text: string): string | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
  const start = cleaned.indexOf("{")
  const arrayStart = cleaned.indexOf("[")
  const effectiveStart = start < 0 ? arrayStart : arrayStart < 0 ? start : Math.min(start, arrayStart)
  if (effectiveStart < 0) return null
  const open = cleaned[effectiveStart]
  const close = open === "{" ? "}" : "]"
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = effectiveStart; index < cleaned.length; index += 1) {
    const char = cleaned[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return cleaned.slice(effectiveStart, index + 1)
    }
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : []
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true"
}

function inferLegacyKind(dimension: string): OutlineSubAgentKind {
  if (/人物|角色|关系/.test(dimension)) return "character"
  if (/伏笔|悬念/.test(dimension)) return "foreshadowing"
  if (/题材|主题|卖点/.test(dimension)) return "topic"
  if (/设定|世界|势力|地理|体系/.test(dimension)) return "setting"
  return "outline"
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
