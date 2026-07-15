import type { ToolRegistry } from "../registry"
import type { AgentToolEvent, Tool } from "../types"
import type { LegacyAiWorkflowMode } from "@/lib/agent/workflow-mode"
import { createReadChapterTool } from "./read-chapter"
import { createReadOutlineTool } from "./read-outline"
import { createReadMemoryTool } from "./read-memory"
import { createReadDeductionTool } from "./read-deduction"
import { createReadChatHistoryTool } from "./read-chat-history"
import { createReadOutlineHistoryTool } from "./read-outline-history"
import { createSearchChaptersTool } from "./search-chapters"
import { createListChaptersTool } from "./list-chapters"
import { createListOutlinesTool } from "./list-outlines"
import { createListMemoriesTool } from "./list-memories"
import { createListDeductionsTool } from "./list-deductions"
import { createWriteChapterTool } from "./write-chapter"
import { createWriteOutlineNodeTool } from "./write-outline-node"
import { createWriteMemoryTool } from "./write-memory"
import { createApplySkillTool } from "./apply-skill"
  import { createWebSearchTool } from "./web-search"
  import { createReadWebPageTool } from "./read-web-page"
  import { createSummarizeSearchResultsTool } from "./summarize-search-results"
import { createRouteTaskTool } from "./route-task"
import { createLoadContextTool } from "./load-context"
import { createTrimContextTool } from "./trim-context"
import { createRunChapterWorkflowTool, type RunDeepChapterGeneration } from "./run-chapter-workflow"
import type { DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"
import type { UserSkill } from "@/lib/novel/skill-library"
import type { LlmConfig, SearchApiConfig } from "@/stores/wiki-store"
import type { TaskRouteResult } from "@/lib/novel/task-router"
import type { ContextPack } from "@/lib/novel/context-engine"

export interface VirtualToolContext {
  userMessage: string
  projectPath: string
  taskRoute?: TaskRouteResult
  contextPack?: ContextPack
  targetChars?: number
}

export interface ToolFactoryOptions {
  wikiPath: string
  getSkillConfig: () => DeAiSkillConfig | null
  getUserSkills?: () => UserSkill[] | null
  getSearchApiConfig?: () => SearchApiConfig | null
  getChatConversations: () => { id: string; title: string; messages: { role: string; content: string }[] }[]
  getOutlineConversations: () => { id: string; title: string; messages: { role: string; content: string }[] }[]
  virtualToolContext?: VirtualToolContext
  mcpTools?: Tool[]
  draftMode?: boolean
  projectPath?: string
  sourceConversationId?: string
  sourceMessageId?: string
  enabledToolNames?: string[]
  disabledTools?: string[]
  llmConfig?: LlmConfig
  aiWorkflowMode?: LegacyAiWorkflowMode
  runDeepChapterGeneration?: RunDeepChapterGeneration
  onToolEvent?: (event: AgentToolEvent) => void
  getPlanBlueprint?: () => string | undefined
  readTextFile?: (path: string) => Promise<string>
}

export function registerAllBuiltInTools(registry: ToolRegistry, options: ToolFactoryOptions): void {
  const chaptersDir = `${options.wikiPath}/chapters`
  const memoryDir = `${options.wikiPath}/memory`
  const outlinesDir = `${options.wikiPath}/outlines`
  const simDir = `${options.wikiPath}/../.qmai/simulations`
  const disabledTools = new Set(options.disabledTools ?? [])
  const enabledToolNames = options.enabledToolNames ? new Set(options.enabledToolNames) : null
  const shouldRegister = (name: string) =>
    !disabledTools.has(name) && (!enabledToolNames || enabledToolNames.has(name))

  if (shouldRegister("read_chapter")) registry.register(createReadChapterTool(chaptersDir, options.readTextFile))
  if (shouldRegister("read_outline")) registry.register(createReadOutlineTool(outlinesDir, options.readTextFile))
  if (shouldRegister("read_memory")) registry.register(createReadMemoryTool(memoryDir, options.readTextFile))
  if (shouldRegister("read_deduction")) registry.register(createReadDeductionTool(simDir, options.readTextFile))
  if (shouldRegister("read_chat_history")) registry.register(createReadChatHistoryTool(options.getChatConversations()))
  if (shouldRegister("read_outline_history")) registry.register(createReadOutlineHistoryTool(options.getOutlineConversations()))
  if (shouldRegister("search_chapters")) registry.register(createSearchChaptersTool(chaptersDir, options.readTextFile))
  if (shouldRegister("list_chapters")) registry.register(createListChaptersTool(chaptersDir))
  if (shouldRegister("list_outlines")) registry.register(createListOutlinesTool(outlinesDir))
  if (shouldRegister("list_memories")) registry.register(createListMemoriesTool(memoryDir))
  if (shouldRegister("list_deductions")) registry.register(createListDeductionsTool(simDir))
  if (shouldRegister("write_chapter")) {
    registry.register(createWriteChapterTool(chaptersDir, {
      draftMode: options.draftMode,
      projectPath: options.projectPath,
      sourceConversationId: options.sourceConversationId,
      sourceMessageId: options.sourceMessageId,
    }))
  }
  if (shouldRegister("write_outline_node")) registry.register(createWriteOutlineNodeTool(outlinesDir))
  if (shouldRegister("write_memory")) registry.register(createWriteMemoryTool(memoryDir))
  if (shouldRegister("apply_skill")) registry.register(createApplySkillTool(options.getSkillConfig, options.getUserSkills))
  if (shouldRegister("web_search")) registry.register(createWebSearchTool(options.getSearchApiConfig))
  if (shouldRegister("read_web_page")) registry.register(createReadWebPageTool())
  if (shouldRegister("summarize_search_results")) registry.register(createSummarizeSearchResultsTool())
  if (
    shouldRegister("run_chapter_workflow") &&
    options.projectPath &&
    options.llmConfig &&
    options.aiWorkflowMode &&
    options.runDeepChapterGeneration
  ) {
    registry.register(createRunChapterWorkflowTool({
      projectPath: options.projectPath,
      llmConfig: options.llmConfig,
      aiWorkflowMode: options.aiWorkflowMode,
      runDeepChapterGeneration: options.runDeepChapterGeneration,
      onToolEvent: options.onToolEvent,
      getPlanBlueprint: options.getPlanBlueprint,
    }))
  }
  for (const tool of options.mcpTools ?? []) {
    if (shouldRegister(tool.name)) registry.register(tool)
  }

  if (options.virtualToolContext) {
    const vtc = options.virtualToolContext
    if (shouldRegister("route_task")) registry.register(createRouteTaskTool(vtc.userMessage))
    if (vtc.taskRoute && shouldRegister("load_context")) {
      registry.register(createLoadContextTool(vtc.projectPath, vtc.userMessage, vtc.taskRoute))
    }
    if (vtc.contextPack && shouldRegister("trim_context")) {
      registry.register(createTrimContextTool(vtc.contextPack, vtc.targetChars ?? 8000))
    }
  }
}
