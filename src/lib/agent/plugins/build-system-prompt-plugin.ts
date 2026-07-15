  import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
import { buildTaskDirective } from "@/lib/novel/task-router"
import { buildSelectedSkillsPrompt } from "./select-skills-plugin"
import { getWorkflowModeLabel, resolveAiWorkflowMode, type LegacyAiWorkflowMode } from "../workflow-mode"
import { WRITING_INTENTS } from "../plan-execute-policy"

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
        const rulesParts: string[] = []

        const base = baseSystemPrompt || (input.agentConfig as any)?.systemPrompt || ""
        if (base) {
          parts.push(base)
          rulesParts.push(base)
        }

        if (input.novelSystemPrompt) {
          parts.push(input.novelSystemPrompt)
        }

        const selectedSkillsPrompt = buildSelectedSkillsPrompt(input.selectedSkills)
        if (selectedSkillsPrompt) {
          parts.push(selectedSkillsPrompt)
          rulesParts.push(selectedSkillsPrompt)
        }

        if (input.planExecuteEnabled && input.aiWorkflowMode) {
          const routeForPlan = input.effectiveTaskRoute || input.taskRoute
          const isWritingTask = routeForPlan?.intent && WRITING_INTENTS.has(routeForPlan.intent)
          if (isWritingTask) {
            const planProtocol = buildChapterPlanProtocol(input.aiWorkflowMode)
            parts.push(planProtocol)
            rulesParts.push(planProtocol)
          }
        }

        if (route) {
          const taskDirective = buildDirective(route)
          if (taskDirective) {
            parts.push(taskDirective)
            rulesParts.push(taskDirective)
          }
        }

        const finalSystemPrompt = parts.join("\n\n")
        const finalSystemRulesPrompt = rulesParts.join("\n\n")
        return { finalSystemPrompt, finalSystemRulesPrompt }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
        return {}
      }
    },
  }
}

function buildChapterPlanProtocol(mode: LegacyAiWorkflowMode): string {
  // mode 仅用于在协议头标注当前工作流强度，不改变计划结构。
  const modeLabel = getWorkflowModeLabel(resolveAiWorkflowMode(mode))
  return [
    "## 章节主编策划协议（本章策划案）",
    "",
    `当前工作流强度：${modeLabel}模式，已开启 Plan Execute。写正文前先输出本章策划案供用户确认。`,
    "策划案面向用户阅读，要像主编给作者的执行计划：清楚、有取舍、能落地，不写工具流程，不写正文片段。",
    "",
    "输出规范：",
    "1. 计划必须整体包裹在 `<!-- chapter_plan -->` 和 `<!-- /chapter_plan -->` 标记中。",
    "2. 计划只供用户确认，正文生成必须等待用户确认后再开始。当前阶段禁用正文生成类工具，只能使用读取类工具收集资料。",
    "3. 计划必须基于会话上下文包；读取资料前先用 list_chapters、list_outlines、list_memories 确认可用文件名，绝不编造资料名称。",
    "4. 计划总长控制在 1200-1800字，避免堆砌分析维度；用结论和执行项表达。",
    "5. 场景必须用 S1/S2/S3 编号，后续正文会按编号执行。",
    "6. 不要使用旧版分析报告式编号标题。",
    "",
    "必须使用以下结构：",
    "",
    "### 1. 本章目标",
    "- 用 2-4 句话说明本章要完成的剧情推进、人物状态变化、读者期待和章末状态。",
    "- 写清这一章的核心问题：本章必须解决、推进或反转什么。",
    "",
    "### 2. 已知依据",
    "- 列出计划依据：上一章结尾、近期剧情、章节目标、人物状态、认知状态、时间线、canonRules、已读取大纲/记忆/章节。",
    "- 如果上下文缺失，明确写“缺失项”和“最小写作假设”，不得伪装成已读取。",
    "",
    "### 3. 执行边界",
    "- 必须执行：写漏即偏离的剧情结果、伏笔动作、人物变化和信息释放。",
    "- 禁止违背：写了即错误的设定、认知越界、时间线冲突、提前泄密和不符合角色动机的行为。",
    "- 可自由发挥：只允许补环境、动作、心理、过渡、对话细节和局部节奏。",
    "",
    "### 4. 分场景执行计划",
    "- 列出 2-4 个场景，统一写成 S1/S2/S3。",
    "- 每个场景必须包含：目的、冲突、转折、输出结果、验收标准。",
    "- 输出结果必须是正文完成后可检查的状态变化；验收标准必须能判断正文是否写漏。",
    "- 场景序列必须连成起承转合或起承转钩，不得只列一个场景。",
    "",
    "### 5. 信息流与伏笔",
    "- 信息流分成：本章揭示、继续隐藏、允许误导、埋设/推进/回收伏笔。",
    "- 写清读者会得到什么回报、留下什么新期待，以及哪些信息不能提前给出。",
    "- 对话后必须带来关系、认知、处境或信息状态变化。",
    "",
    "### 6. 验收标准",
    "- 列出 4-8 条可检查标准，覆盖：章节目标、每个 S 场景输出结果、信息流/伏笔、人物关系变化、章末状态。",
    "- 标准必须能用“正文里是否出现/是否完成/是否违背”判断，禁止写成空泛审美要求。",
    "",
    "### 7. 风险与兜底",
    "- 列出本章最容易写偏的风险：水文、解释腔、人物认知越界、提前泄密、场景断裂、钩子凭空出现。",
    "- 为每个风险给出兜底处理：正文写作时应该如何避免或如何轻量补救。",
    "- 写清章末必须出现的悬念、反转、未决动作或新威胁；钩子必须来自本章推进结果，不能凭空另起一条线。",
    "",
    "确认后动作：用户点击确认后，把整份计划作为 run_chapter_workflow 的 planBlueprint 参数传入，再进入正文生成，不再重复输出计划。",
    "输出计划后暂停，等用户确认后再进入正文。",
  ].join("\n")
}
