import type { TraceWebSearch } from "./context-trace"
import type { TraceMcpCall } from "./mcp-trace"

export interface TaskBreakpoint {
  taskId: string
  taskGoal: string
  completedStages: string[]
  currentStage: string
  usedSkills: string[]
  usedTools: string[]
  searches: TraceWebSearch[]
  mcpCalls: TraceMcpCall[]
  createdAt: number
  updatedAt: number
}

export function createTaskBreakpoint(params: {
  taskId?: string
  taskGoal: string
  completedStages?: string[]
  currentStage: string
  usedSkills?: string[]
  usedTools?: string[]
  searches?: TraceWebSearch[]
  mcpCalls?: TraceMcpCall[]
}): TaskBreakpoint {
  const now = Date.now()
  return {
    taskId: params.taskId || `task_${now}_${Math.random().toString(36).slice(2, 8)}`,
    taskGoal: params.taskGoal,
    completedStages: params.completedStages || [],
    currentStage: params.currentStage,
    usedSkills: params.usedSkills || [],
    usedTools: params.usedTools || [],
    searches: params.searches || [],
    mcpCalls: params.mcpCalls || [],
    createdAt: now,
    updatedAt: now,
  }
}

export function updateBreakpointStage(
  bp: TaskBreakpoint,
  newStage: string,
  completedStage?: string
): TaskBreakpoint {
  return {
    ...bp,
    completedStages: completedStage
      ? [...bp.completedStages, completedStage]
      : bp.completedStages,
    currentStage: newStage,
    updatedAt: Date.now(),
  }
}

export async function saveTaskBreakpoint(
  projectPath: string,
  breakpoint: TaskBreakpoint
): Promise<void> {
  const { writeFileAtomic } = await import("@/commands/fs")
  const { normalizePath } = await import("@/lib/path-utils")
  const pp = normalizePath(projectPath)
  const filePath = `${pp}/.qm/breakpoint.json`
  await writeFileAtomic(filePath, JSON.stringify(breakpoint, null, 2))
}

export async function loadTaskBreakpoint(
  projectPath: string
): Promise<TaskBreakpoint | null> {
  try {
    const { readFile, fileExists } = await import("@/commands/fs")
    const { normalizePath } = await import("@/lib/path-utils")
    const pp = normalizePath(projectPath)
    const filePath = `${pp}/.qm/breakpoint.json`
    const exists = await fileExists(filePath)
    if (!exists) return null
    const content = await readFile(filePath)
    return JSON.parse(content) as TaskBreakpoint
  } catch {
    return null
  }
}

export async function clearTaskBreakpoint(
  projectPath: string
): Promise<void> {
  try {
    const { writeFileAtomic } = await import("@/commands/fs")
    const { normalizePath } = await import("@/lib/path-utils")
    const pp = normalizePath(projectPath)
    const filePath = `${pp}/.qm/breakpoint.json`
    await writeFileAtomic(filePath, JSON.stringify(null))
  } catch {
    // Ignore clear errors
  }
}

export function buildBreakpointResumePrompt(bp: TaskBreakpoint): string {
  return [
    "## 任务断点恢复",
    "",
    `原始用户请求：${bp.taskGoal}`,
    `已完成阶段：${bp.completedStages.length > 0 ? bp.completedStages.join(" → ") : "无"}`,
    `当前阶段：${bp.currentStage}`,
    `已使用的 Skill：${bp.usedSkills.length > 0 ? bp.usedSkills.join(", ") : "无"}`,
    bp.searches.length > 0 ? `已执行的搜索：${bp.searches.map((s) => s.query).join(", ")}` : "",
    bp.mcpCalls.length > 0 ? `已完成的 MCP 调用：${bp.mcpCalls.length} 次` : "",
    "",
    "请基于以上已完成的阶段继续执行，不要从头开始。",
  ]
    .filter(Boolean)
    .join("\n")
}
