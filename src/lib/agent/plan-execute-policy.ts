import type { AiWorkflowMode } from "./workflow-mode"
import type { NovelTaskIntent } from "@/lib/novel/task-router"

const WRITING_INTENT_LIST: readonly NovelTaskIntent[] = [
  "write_chapter",
  "continue_chapter",
  "rewrite_chapter",
  "polish_chapter",
  "generate_outline",
]

export const WRITING_INTENTS = new Set<NovelTaskIntent>(WRITING_INTENT_LIST)

export function shouldRequirePlan(
  planExecuteEnabled: boolean,
  _mode: AiWorkflowMode,
  intent?: string | null,
): boolean {
  if (!planExecuteEnabled) return false
  return Boolean(intent && WRITING_INTENTS.has(intent as NovelTaskIntent))
}

export function buildPlanExecutePolicyPrompt(mode: AiWorkflowMode): string {
  const executablePlanFormat = [
    "计划必须是给用户确认的可执行计划，不要把工具流程说明当成计划。",
    "计划必须整体包裹在 `<!-- chapter_plan -->` 和 `<!-- /chapter_plan -->` 标记中。",
    "输出计划后必须暂停，等待用户确认后再进入正文或执行阶段。",
    "计划必须包含：任务目标、已读取依据、缺失资料、执行步骤、确认后动作。",
    "读取资料前先用 list_chapters、list_outlines、list_memories 确认可用文件；不要凭空编造章节、大纲或记忆条目名称。list_outlines 后按文件夹分流（优先）：关注 大纲（索引）、设定（硬约束）、章纲（本章主候选）、卷纲；旧 type 仅无标准文件夹时作兼容参考；对章纲/卷纲必须读正文确认对应该章后再写。",
    "如果资料缺失，必须在“缺失资料”里说明，并基于已读取内容继续制定可执行方案。",
  ].join("\n")

  if (mode === "fast") {
    return [
      "Plan Execute：当前已开启计划执行。",
      "快速模式：用户已主动开启计划执行，先给出最短可执行计划再直接执行。",
      "计划最多 3 条，只写将要读取和执行的关键步骤。",
      executablePlanFormat,
      "如果需要生成、续写、改写或润色章节，必须调用 run_chapter_workflow；未调用前禁止输出章节终稿。",
    ].join("\n")
  }

  if (mode === "strict") {
    return [
      "Plan Execute：当前已开启计划执行。",
      "严格模式：必须先计划，再执行，再执行后审查。",
      "计划必须简短，最多 5 条，只写将要读取和执行的关键步骤。",
      "执行后审查结果是否满足用户请求、项目设定和输出边界。",
      executablePlanFormat,
      "本轮是计划阶段：禁止输出章节正文，禁止调用 run_chapter_workflow。用户确认计划后才进入执行阶段，届时章节生成、续写、改写或润色必须调用 run_chapter_workflow。",
    ].join("\n")
  }

  return [
    "Plan Execute：当前已开启计划执行。",
    "标准模式：先创建轻量计划，再快速执行。",
    "计划最多 3 条，不能替代正文，不能把计划混入最终章节正文。",
    executablePlanFormat,
    "本轮是计划阶段：禁止输出章节正文，禁止调用 run_chapter_workflow。用户确认计划后才进入执行阶段，届时章节生成、续写、改写或润色必须调用 run_chapter_workflow。",
  ].join("\n")
}
