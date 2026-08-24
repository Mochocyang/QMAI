import type { DataSourceCategory } from "@/lib/novel/classification"
import type { NovelTaskIntent } from "@/lib/novel/task-router"
import { resolveAiWorkflowMode, type AiWorkflowMode } from "../workflow-mode"
import type { AiCapability, SelectedCapabilityTrace } from "./types"

const WRITING_INTENTS = new Set<NovelTaskIntent>([
  "write_chapter",
  "continue_chapter",
  "rewrite_chapter",
  "polish_chapter",
])

const REVIEW_INTENTS = new Set<NovelTaskIntent>(["review_chapter", "lint_chapter"])

const KNOWLEDGE_INTENTS = new Set<NovelTaskIntent>([
  "character_query",
  "foreshadowing_query",
  "timeline_query",
  "setting_query",
])

const FAST_WRITING_TOOLS = new Set(["read_chapter", "read_outline", "load_context", "trim_context"])
const STANDARD_WRITING_TOOLS = new Set(["read_chapter", "read_outline", "load_context", "trim_context", "run_chapter_workflow"])
const STRICT_WRITING_TOOLS = new Set([
  "read_chapter",
  "read_outline",
  "read_memory",
  "search_chapters",
  "load_context",
  "trim_context",
  "run_chapter_workflow",
  "write_chapter",
  "apply_skill",
])
const STRICT_EXTRA_TOOLS = new Set([
  "read_deduction",
  "read_chat_history",
  "read_outline_history",
  "list_chapters",
  "list_outlines",
  "list_memories",
  "list_deductions",
])

const ENTITY_QUERY_INTENTS = new Set<NovelTaskIntent>(["character_query", "setting_query"])

interface SelectCapabilitiesInput {
  capabilities: AiCapability[]
  intent: NovelTaskIntent
  mode: AiWorkflowMode
  userMessage: string
  blockedSources?: DataSourceCategory[]
  /** 本地实体表为空，或用户消息未命中任何本地实体名 */
  localEntityMiss?: boolean
}

export function selectCapabilities(input: SelectCapabilitiesInput): SelectedCapabilityTrace[] {
  const blockedSources = new Set(input.blockedSources ?? [])
  const selected: SelectedCapabilityTrace[] = []
  const resolvedInput = { ...input, mode: resolveAiWorkflowMode(input.mode) }

  for (const capability of input.capabilities) {
    if (!capability.modes.includes(resolvedInput.mode)) continue
    const reason = selectionReason(capability, resolvedInput, blockedSources)
    if (!reason) continue
    selected.push(toTrace(capability, reason))
  }

  return selected
}

function selectionReason(
  capability: AiCapability,
  input: SelectCapabilitiesInput & { mode: AiWorkflowMode },
  blockedSources: Set<DataSourceCategory>,
): string | null {
  if (capability.kind === "mcp_tool") {
    if (blockedSources.has("graph")) return null
    if (input.mode !== "strict") return null
    if (!isKnowledgeGraphRequest(input.userMessage, input.intent)) return null
    return "strict mode knowledge task can use future MCP placeholder"
  }

  if (capability.kind === "web_search") {
    if (isExplicitSearchRequest(input.userMessage)) {
      return "user explicitly requested external search"
    }
    if (
      input.mode !== "fast"
      && input.localEntityMiss === true
      && ENTITY_QUERY_INTENTS.has(input.intent)
      && capability.intents.includes("external_search")
    ) {
      return "local entity miss may require external search"
    }
    return null
  }

  if (capability.kind === "user_skill") {
    if (!capability.intents.includes(input.intent) && !capability.intents.includes("general")) return null
    if (input.mode === "fast") return null
    if (input.mode === "standard") return "standard mode selected lightweight skill"
    if (input.mode === "strict") return "strict mode selected preselected skill"
    return null
  }

  if (capability.kind === "built_in_tool") {
    return builtInToolReason(capability, input)
  }

  return null
}

function builtInToolReason(capability: AiCapability, input: SelectCapabilitiesInput): string | null {
  const name = capability.toolName
  if (!name) return null

  if (input.mode === "fast" && WRITING_INTENTS.has(input.intent)) {
    return FAST_WRITING_TOOLS.has(name) ? "fast mode minimal writing context" : null
  }

  if (input.mode === "standard" && WRITING_INTENTS.has(input.intent)) {
    return STANDARD_WRITING_TOOLS.has(name) ? "standard mode lightweight writing workflow" : null
  }

  if (WRITING_INTENTS.has(input.intent)) {
    if (STRICT_WRITING_TOOLS.has(name)) return "writing task capability"
    if (input.mode === "strict" && STRICT_EXTRA_TOOLS.has(name)) return "strict mode extended writing context"
    return null
  }

  if (input.intent === "generate_outline") {
    if (name === "read_outline" || name === "load_context" || name === "trim_context" || name === "write_outline_node") {
      return "outline task capability"
    }
    return null
  }

  if (REVIEW_INTENTS.has(input.intent) || KNOWLEDGE_INTENTS.has(input.intent) || input.intent === "search_plot") {
    if (name.startsWith("read_") || name.startsWith("list_") || name === "search_chapters" || name === "load_context" || name === "trim_context") {
      return "query and review task capability"
    }
  }

  if (input.intent === "extract_memory") {
    if (name === "read_chapter" || name === "write_memory" || name === "load_context" || name === "trim_context") {
      return "memory extraction capability"
    }
  }

  return null
}

function toTrace(capability: AiCapability, reason: string): SelectedCapabilityTrace {
  return {
    id: capability.id,
    name: capability.name,
    kind: capability.kind,
    permission: capability.permission,
    source: capability.source,
    reason,
    toolName: capability.toolName,
    skillId: capability.skillId,
  }
}

function isExplicitSearchRequest(message: string): boolean {
  const normalized = message.toLowerCase()
  return /search|web|internet|online|external|latest|联网|搜索|搜一下|查一下|查找|查资料|网页|外部|外部资料|最新/.test(normalized)
}

function isKnowledgeGraphRequest(message: string, intent: NovelTaskIntent): boolean {
  const normalized = message.toLowerCase()
  if (/graphrag|knowledge\s*graph|graph|图谱|知识图谱|关系/.test(normalized)) return true
  return KNOWLEDGE_INTENTS.has(intent)
}
