import {
  getAllDeAiSkills,
  isDeAiSkillModified,
  type DeAiSkillConfig,
  type DeAiSkillSource,
} from "@/lib/novel/de-ai-skill-library"
import {
  SKILL_KIND_LABELS,
  SKILL_STAGE_LABELS,
  type SkillKind,
  type SkillMode,
  type SkillStage,
} from "@/lib/novel/skill-library"
import type { UserSkillConfig } from "@/lib/novel/user-skill-store"

export type UnifiedSkillLibrary = "writing" | "de-ai"
export type UnifiedSkillSource = DeAiSkillSource | "built-in" | "project" | "uploaded" | "linked"
export type UnifiedSkillStatusFilter = "enabled" | "disabled"

export interface UnifiedSkillEntry {
  id: string
  skillId: string
  library: UnifiedSkillLibrary
  name: string
  description: string
  content: string
  kind: SkillKind[]
  stages: SkillStage[]
  modes: SkillMode[]
  enabled: boolean
  source: UnifiedSkillSource
  modified: boolean
  defaultSkill: boolean
  category: string
  status: "启用" | "停用"
  searchText: string
}

export interface UnifiedSkillFilter {
  query?: string
  library?: UnifiedSkillLibrary
  category?: string
  status?: UnifiedSkillStatusFilter
  mode?: SkillMode
  stage?: SkillStage
  kind?: SkillKind
}

const DE_AI_KIND: SkillKind[] = ["style", "rewrite"]
const DE_AI_STAGES: SkillStage[] = ["rewrite", "output"]
const DE_AI_MODES: SkillMode[] = ["fast", "standard", "strict"]

function createSearchText(values: Array<string | string[] | undefined>): string {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLocaleLowerCase()
}

function getWritingSkillCategory(kind: SkillKind[], stages: SkillStage[]): string {
  const preferredKind = kind.find((item) => item === "review" || item === "output" || item === "knowledge")
    ?? kind[0]
  if (preferredKind) return SKILL_KIND_LABELS[preferredKind]
  const preferredStage = stages[0]
  return preferredStage ? SKILL_STAGE_LABELS[preferredStage] : "写作"
}

export function buildUnifiedSkillEntries(
  deAiConfig: DeAiSkillConfig,
  writingConfig: UserSkillConfig,
): UnifiedSkillEntry[] {
  const disabledDeAiIds = new Set(deAiConfig.disabledSkillIds)
  const disabledWritingIds = new Set(writingConfig.disabledSkillIds)

  const deAiEntries = getAllDeAiSkills(deAiConfig).map((skill): UnifiedSkillEntry => {
    const enabled = !disabledDeAiIds.has(skill.id)
    const category = "去AI味"
    const status = enabled ? "启用" : "停用"
    return {
      id: `de-ai:${skill.id}`,
      skillId: skill.id,
      library: "de-ai",
      name: skill.name,
      description: skill.description,
      content: skill.content,
      kind: DE_AI_KIND,
      stages: DE_AI_STAGES,
      modes: DE_AI_MODES,
      enabled,
      source: skill.source,
      modified: isDeAiSkillModified(deAiConfig, skill.id),
      defaultSkill: deAiConfig.defaultSkillId === skill.id,
      category,
      status,
      searchText: createSearchText([
        skill.name,
        skill.description,
        skill.content,
        category,
        status,
        DE_AI_KIND,
        DE_AI_STAGES,
        DE_AI_MODES,
      ]),
    }
  })

  const writingEntries = writingConfig.skills.map((skill): UnifiedSkillEntry => {
    const enabled = !disabledWritingIds.has(skill.id)
    const category = getWritingSkillCategory(skill.kind, skill.stages)
    const status = enabled ? "启用" : "停用"
    return {
      id: `writing:${skill.id}`,
      skillId: skill.id,
      library: "writing",
      name: skill.name,
      description: skill.description,
      content: skill.content,
      kind: skill.kind,
      stages: skill.stages,
      modes: skill.modes,
      enabled,
      source: skill.source,
      modified: skill.source !== "built-in" && typeof skill.updatedAt === "number" && skill.updatedAt > (skill.createdAt ?? 0),
      defaultSkill: writingConfig.selectedSkillId === skill.id,
      category,
      status,
      searchText: createSearchText([
        skill.name,
        skill.description,
        skill.content,
        category,
        status,
        skill.kind,
        skill.stages,
        skill.modes,
      ]),
    }
  })

  return [...writingEntries, ...deAiEntries]
}

export function filterUnifiedSkillEntries(
  entries: UnifiedSkillEntry[],
  filter: UnifiedSkillFilter,
): UnifiedSkillEntry[] {
  const query = filter.query?.trim().toLocaleLowerCase()
  return entries.filter((entry) => {
    if (query && !entry.searchText.includes(query)) return false
    if (filter.library && entry.library !== filter.library) return false
    if (filter.category && entry.category !== filter.category) return false
    if (filter.status === "enabled" && !entry.enabled) return false
    if (filter.status === "disabled" && entry.enabled) return false
    if (filter.mode && !entry.modes.includes(filter.mode)) return false
    if (filter.stage && !entry.stages.includes(filter.stage)) return false
    if (filter.kind && !entry.kind.includes(filter.kind)) return false
    return true
  })
}

export function getUnifiedSkillCategory(entry: UnifiedSkillEntry): string {
  return entry.category
}

export function getUnifiedSkillStatus(entry: UnifiedSkillEntry): "启用" | "停用" {
  return entry.enabled ? "启用" : "停用"
}
