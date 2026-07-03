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

        if (input.aiWorkflowMode && (input.aiWorkflowMode === "standard" || input.aiWorkflowMode === "strict")) {
          const isWritingTask = input.effectiveTaskRoute?.intent === "write_chapter" ||
            input.effectiveTaskRoute?.intent === "continue_chapter"
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
  if (mode === "strict") {
    return [
      "## 章节创作计划协议",
      "",
      "当前为严格模式。写下一章时，必须按以下流程执行：",
      "",
      "1. 先输出详细的章节创作计划。",
      "2. 计划内容必须包含：本章目标、核心冲突、出场人物与动机、关键事件顺序、情绪曲线、伏笔推进、结尾钩子。",
      "3. 计划必须包裹在 `<!-- chapter_plan -->` 和 `<!-- /chapter_plan -->` 标记中。",
      "4. 输出计划后暂停，等用户确认后再输出正文。",
      "5. 用户确认后，根据计划写正文，正文中不要混入计划内容。",
    ].join("\n")
  }
  return [
    "## 章节创作计划协议",
    "",
    "当前为标准模式。写下一章时，建议按以下流程：",
    "",
    "1. 先输出简短的章节创作计划。",
    "2. 计划内容包含：本章目标、核心冲突、关键事件、结尾钩子。",
    "3. 计划必须包裹在 `<!-- chapter_plan -->` 和 `<!-- /chapter_plan -->` 标记中。",
    "4. 输出计划后暂停，等用户确认后再输出正文。",
    "5. 用户确认后，根据计划写正文，正文中不要混入计划内容。",
  ].join("\n")
}
