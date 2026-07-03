import type { AiWorkflowMode } from "@/lib/agent/workflow-mode"

export type SkillKind =
  | "style"
  | "structure"
  | "planning"
  | "review"
  | "rewrite"
  | "output"
  | "knowledge"

export type SkillStage =
  | "planning"
  | "drafting"
  | "review"
  | "rewrite"
  | "output"

export type SkillMode = AiWorkflowMode

export interface UserSkill {
  id: string
  name: string
  description: string
  kind: SkillKind[]
  stages: SkillStage[]
  modes: SkillMode[]
  content: string
  source: "built-in" | "project" | "uploaded"
  createdAt?: number
  updatedAt?: number
}

export interface SkillFilter {
  mode?: SkillMode
  stage?: SkillStage
  kind?: SkillKind
}

export const SKILL_KIND_LABELS: Record<SkillKind, string> = {
  style: "风格",
  structure: "结构",
  planning: "计划",
  review: "审稿",
  rewrite: "改写",
  output: "输出",
  knowledge: "知识",
}

export const SKILL_STAGE_LABELS: Record<SkillStage, string> = {
  planning: "计划",
  drafting: "正文",
  review: "审稿",
  rewrite: "改写",
  output: "输出",
}

export const SKILL_MODE_LABELS: Record<SkillMode, string> = {
  fast: "快速",
  standard: "标准",
  strict: "严格",
}

const VALID_KINDS = new Set<SkillKind>([
  "style",
  "structure",
  "planning",
  "review",
  "rewrite",
  "output",
  "knowledge",
])

const VALID_STAGES = new Set<SkillStage>([
  "planning",
  "drafting",
  "review",
  "rewrite",
  "output",
])

const VALID_MODES = new Set<SkillMode>(["fast", "standard", "strict"])

function uniqueValid<T extends string>(values: unknown, valid: Set<T>, fallback: T[]): T[] {
  if (!Array.isArray(values)) return fallback
  const result: T[] = []
  for (const value of values) {
    if (typeof value !== "string") continue
    if (!valid.has(value as T)) continue
    if (!result.includes(value as T)) result.push(value as T)
  }
  return result.length > 0 ? result : fallback
}

export function normalizeUserSkill(value: Partial<UserSkill>): UserSkill {
  const source = value.source === "built-in" || value.source === "uploaded" ? value.source : "project"
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : `project:${Date.now()}`,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "未命名 Skill",
    description: typeof value.description === "string" ? value.description.trim() : "",
    kind: uniqueValid(value.kind, VALID_KINDS, ["style"]),
    stages: uniqueValid(value.stages, VALID_STAGES, ["rewrite", "output"]),
    modes: uniqueValid(value.modes, VALID_MODES, ["standard", "strict"]),
    content: typeof value.content === "string" ? value.content.trim() : "",
    source,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : undefined,
  }
}

export function filterUserSkills(skills: UserSkill[], filter: SkillFilter): UserSkill[] {
  return skills.filter((skill) => {
    if (filter.mode && !skill.modes.includes(filter.mode)) return false
    if (filter.stage && !skill.stages.includes(filter.stage)) return false
    if (filter.kind && !skill.kind.includes(filter.kind)) return false
    return true
  })
}
