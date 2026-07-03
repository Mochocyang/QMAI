import type { AiWorkflowMode } from "./workflow-mode"

const WRITING_INTENTS = new Set([
  "write_chapter",
  "continue_chapter",
  "rewrite_chapter",
  "polish_chapter",
  "generate_outline",
])

export function shouldRequirePlan(
  planExecuteEnabled: boolean,
  _mode: AiWorkflowMode,
  intent?: string | null,
): boolean {
  if (!planExecuteEnabled) return false
  return Boolean(intent && WRITING_INTENTS.has(intent))
}

export function buildPlanExecutePolicyPrompt(mode: AiWorkflowMode): string {
  const executablePlanFormat = [
    "计划必须是给用户确认的可执行计划，不要把工具流程说明当成计划。",
    "计划必须包含：任务目标、已读取依据、缺失资料、执行步骤、确认后动作。",
    "读取资料前先用 list_chapters、list_outlines、list_memories 确认可用文件；不要凭空编造章节、大纲或记忆条目名称。",
    "如果资料缺失，必须在“缺失资料”里说明，并基于已读取内容继续制定可执行方案。",
  ].join("\n")

  if (mode === "fast") {
    return [
      "Plan Execute：当前已开启计划执行。",
      "快速模式：先创建轻量计划，再快速执行。",
      "计划最多 3 条，只写将要读取和执行的关键步骤。",
      executablePlanFormat,
      "如果需要生成、续写、改写或润色章节，优先调用 run_chapter_workflow。",
    ].join("\n")
  }

  if (mode === "strict") {
    return [
      "Plan Execute：当前已开启计划执行。",
      "严格模式：必须先计划，再执行，再执行后审查。",
      "计划必须简短，最多 5 条，只写将要读取和执行的关键步骤。",
      "执行后审查结果是否满足用户请求、项目设定和输出边界。",
      executablePlanFormat,
      "如果是章节生成、续写、改写或润色，必须优先调用 run_chapter_workflow。",
    ].join("\n")
  }

  return [
    "Plan Execute：当前已开启计划执行。",
    "标准模式：复杂写作任务先给出简短计划，再执行。",
    "计划最多 5 条，不能替代正文，不能把计划混入最终章节正文。",
    executablePlanFormat,
    "如果是章节生成、续写、改写或润色，优先调用 run_chapter_workflow。",
  ].join("\n")
}
