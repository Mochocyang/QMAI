import type { UserSkill } from "@/lib/novel/skill-library"
import type { AiCapability, CapabilityIntent, CapabilityKind, CapabilityPermission } from "./types"
import type { AiWorkflowMode } from "../workflow-mode"

const ALL_MODES: AiWorkflowMode[] = ["fast", "standard", "strict"]

const WRITING_INTENTS: CapabilityIntent[] = [
  "write_chapter",
  "continue_chapter",
  "rewrite_chapter",
  "polish_chapter",
]

const REVIEW_INTENTS: CapabilityIntent[] = ["review_chapter", "lint_chapter"]

const QUERY_INTENTS: CapabilityIntent[] = [
  "search_plot",
  "character_query",
  "foreshadowing_query",
  "timeline_query",
  "setting_query",
]

const READ_TOOL_INTENTS: CapabilityIntent[] = [
  ...WRITING_INTENTS,
  ...REVIEW_INTENTS,
  ...QUERY_INTENTS,
  "generate_outline",
  "extract_memory",
  "general",
]

const TOOL_LABELS: Record<string, string> = {
  read_chapter: "Read Chapter",
  read_outline: "Read Outline",
  read_memory: "Read Memory",
  read_deduction: "Read Deduction",
  read_chat_history: "Read Chat History",
  read_outline_history: "Read Outline History",
  search_chapters: "Search Chapters",
  list_chapters: "List Chapters",
  list_outlines: "List Outlines",
  list_memories: "List Memories",
  list_deductions: "List Deductions",
  write_chapter: "Write Chapter",
  write_outline_node: "Write Outline Node",
  write_memory: "Write Memory",
  apply_skill: "Apply Skill",
  web_search: "External Search",
  read_web_page: "Read Web Page",
  route_task: "Route Task",
  load_context: "Load Context",
  trim_context: "Trim Context",
  run_chapter_workflow: "Chapter Workflow",
}

export interface BuildAvailableCapabilitiesOptions {
  toolNames?: string[]
  selectedSkills?: UserSkill[]
  mcpCapabilities?: AiCapability[]
}

export function buildAvailableCapabilities(options: BuildAvailableCapabilitiesOptions): AiCapability[] {
  return [
    ...buildBuiltInToolCapabilities(options.toolNames ?? []),
    ...buildUserSkillCapabilities(options.selectedSkills ?? []),
    ...(options.mcpCapabilities ?? []),
  ]
}

export function buildBuiltInToolCapabilities(toolNames: string[]): AiCapability[] {
  return toolNames.map((toolName) => createToolCapability(toolName))
}

export function buildUserSkillCapabilities(skills: UserSkill[]): AiCapability[] {
  return skills.map((skill) => ({
    id: `skill:${skill.id}`,
    name: skill.name,
    kind: "user_skill",
    permission: "auto",
    modes: [...skill.modes],
    intents: skillIntents(skill),
    skillId: skill.id,
    source: skill.source,
  }))
}

function createToolCapability(toolName: string): AiCapability {
  const kind: CapabilityKind = toolName === "web_search" || toolName === "read_web_page"
    ? "web_search"
    : "built_in_tool"
  const permission: CapabilityPermission = toolName.startsWith("write_") ? "confirm" : "auto"

  return {
    id: `tool:${toolName}`,
    name: TOOL_LABELS[toolName] ?? toolName,
    kind,
    permission,
    modes: ALL_MODES,
    intents: toolIntents(toolName),
    toolName,
    source: "built-in",
  }
}

function toolIntents(toolName: string): CapabilityIntent[] {
  if (toolName === "web_search" || toolName === "read_web_page") {
    return ["external_search", ...QUERY_INTENTS, "general"]
  }
  if (toolName === "write_chapter") return WRITING_INTENTS
  if (toolName === "run_chapter_workflow") return WRITING_INTENTS
  if (toolName === "write_outline_node") return ["generate_outline"]
  if (toolName === "write_memory") return ["extract_memory"]
  if (toolName === "apply_skill") return [...WRITING_INTENTS, ...REVIEW_INTENTS, "generate_outline"]
  if (toolName === "route_task" || toolName === "load_context" || toolName === "trim_context") {
    return READ_TOOL_INTENTS
  }
  return READ_TOOL_INTENTS
}

function skillIntents(skill: UserSkill): CapabilityIntent[] {
  const intents = new Set<CapabilityIntent>()
  if (skill.kind.some((kind) => kind === "structure" || kind === "planning" || kind === "output")) {
    WRITING_INTENTS.forEach((intent) => intents.add(intent))
    intents.add("generate_outline")
  }
  if (skill.kind.some((kind) => kind === "review" || kind === "knowledge")) {
    REVIEW_INTENTS.forEach((intent) => intents.add(intent))
    QUERY_INTENTS.forEach((intent) => intents.add(intent))
  }
  if (skill.kind.includes("style") || skill.kind.includes("rewrite")) {
    intents.add("polish_chapter")
    intents.add("rewrite_chapter")
  }
  if (intents.size === 0) intents.add("general")
  return Array.from(intents)
}
