import type { AiWorkflowMode } from "../workflow-mode"
import type { NovelTaskIntent } from "@/lib/novel/task-router"

export type CapabilityKind =
  | "built_in_tool"
  | "user_skill"
  | "web_search"
  | "mcp_tool"

export type CapabilityPermission = "auto" | "confirm"

export type CapabilityIntent = NovelTaskIntent | "external_search" | "general"

export type CapabilitySource = "built-in" | "project" | "uploaded" | "mcp"

export interface AiCapability {
  id: string
  name: string
  kind: CapabilityKind
  permission: CapabilityPermission
  modes: AiWorkflowMode[]
  intents: CapabilityIntent[]
  toolName?: string
  skillId?: string
  source?: CapabilitySource
}

export interface SelectedCapabilityTrace {
  id: string
  name: string
  kind: CapabilityKind
  permission: CapabilityPermission
  source?: CapabilitySource | string
  reason: string
  toolName?: string
  skillId?: string
}
