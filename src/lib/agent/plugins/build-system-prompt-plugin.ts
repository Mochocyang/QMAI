  import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
  import { buildTaskDirective } from "@/lib/novel/task-router"
  import { buildSelectedSkillsPrompt } from "./select-skills-plugin"
  import type { AiWorkflowMode } from "../workflow-mode"

  export interface BuildSystemPromptPluginDeps {
  baseSystemPrompt?: string
  buildTaskDirectiveFn?: typeof buildTaskDirective
  onError?: (error: Error) => void
}

export function createBuildSystemPromptPlugin(deps: BuildSystemPromptPluginDeps = {}): PrePlugin {
  const { baseSystemPrompt, buildTaskDirectiveFn, onError } = deps

  return {
    name: "build_system_prompt",
    priority: 60,
    run: async (input: PrePluginInput): Promise<PrePluginOutput> => {
      if (!input.novelMode) return {}

      try {
        const buildDirective = buildTaskDirectiveFn || buildTaskDirective
        const route = input.effectiveTaskRoute || input.taskRoute

        const parts: string[] = []

        const base = baseSystemPrompt || (input.agentConfig as any)?.systemPrompt || ""
        if (base) parts.push(base)

        if (input.novelSystemPrompt) {
          parts.push(input.novelSystemPrompt)
        }

        const selectedSkillsPrompt = buildSelectedSkillsPrompt(input.selectedSkills)
        if (selectedSkillsPrompt) {
          parts.push(selectedSkillsPrompt)
        }

        if (input.planExecuteEnabled && input.aiWorkflowMode) {
          const routeForPlan = input.effectiveTaskRoute || input.taskRoute
          const isWritingTask = routeForPlan?.intent === "write_chapter" ||
            routeForPlan?.intent === "continue_chapter"
          if (isWritingTask) {
            parts.push(buildChapterPlanProtocol(input.aiWorkflowMode))
          }
        }

        if (route) {
          const taskDirective = buildDirective(route)
          if (taskDirective) {
            parts.push(taskDirective)
          }
        }

        const finalSystemPrompt = parts.join("\n\n")
        return { finalSystemPrompt }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
        return {}
      }
    },
  }
}

function buildChapterPlanProtocol(mode: AiWorkflowMode): string {
  const formatRules = [
    "计划必须包裹在 `<!-- chapter_plan -->` 和 `<!-- /chapter_plan -->` 标记中。",
    "计划只写给用户确认，不写正文，不写工具调用日志，不写旧工作流说明。",
    "计划必须按以下字段组织：",
    "- 任务目标：本次要生成/续写/改写什么。",
    "- 已读取依据：列出已经读到的章节、记忆、大纲或快照。",
    "- 缺失资料：列出未找到的大纲、章节或记忆；不要把缺失资料伪装成已读取。",
    "- 执行步骤：确认后如何写正文。",
    "- 确认后动作：用户点击确认后直接写正文，不再重复输出计划。",
    "读取资料前先用 list_chapters、list_outlines、list_memories 确认可用文件名；不要凭空编造文件名。",
  ].join("\n")

  if (mode === "fast") {
    return [
      "## 章节创作计划协议",
      "",
      "当前为快速模式，并已开启 Plan Execute。写下一章时，必须按以下流程执行：",
      "",
      "1. 先输出轻量章节创作计划，最多 3 条。",
      "2. 计划内容必须包含：本章目标、关键事件、结尾处理。",
      formatRules,
      "输出计划后暂停，等用户确认后再输出正文。",
    ].join("\n")
  }

  if (mode === "strict") {
    return [
      "## 章节创作计划协议",
      "",
      "当前为严格模式。写下一章时，必须按以下流程执行：",
      "",
      "1. 先输出详细的章节创作计划。",
      "2. 计划内容必须包含：本章目标、核心冲突、出场人物与动机、关键事件顺序、情绪曲线、伏笔推进、结尾钩子。",
      formatRules,
      "输出计划后暂停，等用户确认后再输出正文。",
    ].join("\n")
  }
  return [
    "## 章节创作计划协议",
    "",
    "当前为标准模式。写下一章时，建议按以下流程：",
    "",
    "1. 先输出简短的章节创作计划。",
    "2. 计划内容包含：本章目标、核心冲突、关键事件、结尾钩子。",
    formatRules,
    "输出计划后暂停，等用户确认后再输出正文。",
  ].join("\n")
}
