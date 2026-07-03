import type { DataSourceCategory } from "@/lib/novel/classification"
import type { NovelTaskIntent } from "@/lib/novel/task-router"
import type { AiWorkflowMode } from "../workflow-mode"
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
const STANDARD_WRITING_TOOLS = new Set([
  "read_chapter",
  "read_outline",
  "read_memory",
  "search_chapters",
  "load_context",
  "trim_context",
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

export interface SelectCapabilitiesInput {
  capabilities: AiCapability[]
  intent: NovelTaskIntent
  mode: AiWorkflowMode
  userMessage: string
  blockedSources?: DataSourceCategory[]
}

export function selectCapabilities(input: SelectCapabilitiesInput): SelectedCapabilityTrace[] {
  const blockedSources = new Set(input.blockedSources ?? [])
  const selected: SelectedCapabilityTrace[] = []

  for (const capability of input.capabilities) {
    if (!capability.modes.includes(input.mode)) continue
    const reason = selectionReason(capability, input, blockedSources)
    if (!reason) continue
    selected.push(toTrace(capability, reason))
  }

  return selected
}

function selectionReason(
  capability: AiCapability,
  input: SelectCapabilitiesInput,
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
    if (input.mode !== "fast" && capability.intents.includes("external_search") && input.intent === "setting_query") {
      return "task may require external information"
    }
    return null
  }

  if (capability.kind === "user_skill") {
    if (!capability.intents.includes(input.intent) && !capability.intents.includes("general")) return null
    if (input.mode === "fast") return "fast mode selected only preselected lightweight skills"
    if (input.mode === "strict") return "strict mode selected preselected skill"
    return "standard mode selected preselected skill"
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

  if (WRITING_INTENTS.has(input.intent)) {
    if (STANDARD_WRITING_TOOLS.has(name)) return "writing task capability"
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
  return /search|web|internet|online|external|latest|联网|搜索|查资料|外部|最新/.test(normalized)
}

function isKnowledgeGraphRequest(message: string, intent: NovelTaskIntent): boolean {
  const normalized = message.toLowerCase()
  if (/graphrag|knowledge\s*graph|graph|图谱|知识图谱|关系/.test(normalized)) return true
  return KNOWLEDGE_INTENTS.has(intent)
}
