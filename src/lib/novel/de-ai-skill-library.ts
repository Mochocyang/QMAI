import { readFile, writeFile } from "@/commands/fs"
import { join } from "@tauri-apps/api/path"
import defaultDeAiSkill from "../../../skills/de-ai-writing/SKILL.md?raw"

export type DeAiSkillSource = "built-in" | "project" | "legacy"

export interface DeAiSkill {
  id: string
  name: string
  description: string
  templateId: string
  content: string
  source: DeAiSkillSource
  createdAt?: number
  updatedAt?: number
}

export interface DeAiSkillConfig {
  version: 1
  defaultSkillId: string
  disabledSkillIds: string[]
  projectSkills: DeAiSkill[]
  builtInSkillOverrides: DeAiSkill[]
}

export const DEFAULT_DE_AI_SKILL_ID = "built-in:comprehensive"

const baseSkill = defaultDeAiSkill.trim()

export const BUILT_IN_DE_AI_SKILLS: DeAiSkill[] = [
  {
    id: "built-in:comprehensive",
    name: "综合去AI味",
    description: "综合减少解释腔、模板句式和机械总结。",
    templateId: "comprehensive",
    content: baseSkill,
    source: "built-in",
  },
  {
    id: "built-in:reduce-explanation",
    name: "减少解释腔",
    description: "重点删掉动机解释、情绪总结和重复说明。",
    templateId: "reduce-explanation",
    content: `${baseSkill}\n\n## 本技能重点\n优先删减解释腔、总结腔、过度说明和直白动机解释。`,
    source: "built-in",
  },
  {
    id: "built-in:dialogue-natural",
    name: "对话口语化",
    description: "让人物对话更像真人说话，减少书面腔。",
    templateId: "dialogue-natural",
    content: `${baseSkill}\n\n## 本技能重点\n优先处理对话，让人物说半句话、停顿、回避、打断，并保留个人口癖。`,
    source: "built-in",
  },
  {
    id: "built-in:break-regularity",
    name: "打破工整句式",
    description: "打散整齐段落、排比句和模板化起承转合。",
    templateId: "break-regularity",
    content: `${baseSkill}\n\n## 本技能重点\n优先打破工整句式、固定段落长度、机械排比和连续相同主谓结构。`,
    source: "built-in",
  },
  {
    id: "built-in:literary-retain",
    name: "保留文艺感",
    description: "去除AI味时保留必要修辞、氛围和文学质感。",
    templateId: "literary-retain",
    content: `${baseSkill}\n\n## 本技能重点\n去除AI味时不要硬压缩到干瘪，保留必要意象、氛围、节奏和文艺表达。`,
    source: "built-in",
  },
]

const BUILT_IN_IDS = new Set(BUILT_IN_DE_AI_SKILLS.map((skill) => skill.id))

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (trimmed && !result.includes(trimmed)) {
      result.push(trimmed)
    }
  }
  return result
}

function normalizeProjectSkill(value: unknown): DeAiSkill | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<DeAiSkill>
  const id = typeof raw.id === "string" && (raw.id.startsWith("project:") || raw.id.startsWith("legacy:"))
    ? raw.id
    : `project:${Date.now()}`
  const name = typeof raw.name === "string" ? raw.name.trim() : ""
  const content = typeof raw.content === "string" ? raw.content.trim() : ""
  if (!name || !content) return null
  const source: DeAiSkillSource = raw.source === "legacy" ? "legacy" : "project"
  return {
    id,
    name,
    description: typeof raw.description === "string" ? raw.description : "",
    templateId: typeof raw.templateId === "string" ? raw.templateId : "custom",
    content,
    source,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  }
}

function normalizeBuiltInSkillOverride(value: unknown): DeAiSkill | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<DeAiSkill>
  const id = typeof raw.id === "string" && BUILT_IN_IDS.has(raw.id) ? raw.id : ""
  const base = BUILT_IN_DE_AI_SKILLS.find((skill) => skill.id === id)
  if (!base) return null
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : base.name
  const content = typeof raw.content === "string" && raw.content.trim() ? raw.content.trim() : base.content
  return {
    ...base,
    name,
    description: typeof raw.description === "string" ? raw.description : base.description,
    content,
    source: "built-in",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  }
}

export function normalizeDeAiSkillConfig(value: unknown): DeAiSkillConfig {
  const raw = value && typeof value === "object" ? value as Partial<DeAiSkillConfig> : {}
  const projectSkills = Array.isArray(raw.projectSkills)
    ? raw.projectSkills.map(normalizeProjectSkill).filter((skill): skill is DeAiSkill => Boolean(skill))
    : []
  const builtInSkillOverrides = Array.isArray(raw.builtInSkillOverrides)
    ? raw.builtInSkillOverrides
      .map(normalizeBuiltInSkillOverride)
      .filter((skill): skill is DeAiSkill => Boolean(skill))
      .filter((skill, index, skills) => skills.findIndex((item) => item.id === skill.id) === index)
    : []
  const disabledSkillIds = uniqueStrings(raw.disabledSkillIds)
  const knownIds = new Set([...BUILT_IN_IDS, ...projectSkills.map((skill) => skill.id)])
  const requestedDefault = typeof raw.defaultSkillId === "string" ? raw.defaultSkillId : DEFAULT_DE_AI_SKILL_ID
  const defaultSkillId = knownIds.has(requestedDefault) ? requestedDefault : DEFAULT_DE_AI_SKILL_ID
  return {
    version: 1,
    defaultSkillId,
    disabledSkillIds,
    projectSkills,
    builtInSkillOverrides,
  }
}

export function getAllDeAiSkills(config: DeAiSkillConfig): DeAiSkill[] {
  const overrides = new Map((config.builtInSkillOverrides ?? []).map((skill) => [skill.id, skill]))
  const builtInSkills = BUILT_IN_DE_AI_SKILLS.map((skill) => overrides.get(skill.id) ?? skill)
  return [...config.projectSkills, ...builtInSkills]
}

export function resolveAvailableDeAiSkills(config: DeAiSkillConfig): DeAiSkill[] {
  const disabled = new Set(config.disabledSkillIds)
  return getAllDeAiSkills(config).filter((skill) => !disabled.has(skill.id))
}

export function resolveEffectiveDeAiSkill(
  config: DeAiSkillConfig,
  selectedSkillId?: string | null,
): DeAiSkill | null {
  if (selectedSkillId === null) return null
  const available = resolveAvailableDeAiSkills(config)
  if (available.length === 0) return null
  const requested = selectedSkillId ?? config.defaultSkillId
  return available.find((skill) => skill.id === requested) ?? available[0]
}

export function isDeAiSkillModified(config: DeAiSkillConfig, skillId: string): boolean {
  const normalized = normalizeDeAiSkillConfig(config)
  if (skillId.startsWith("built-in:")) {
    return normalized.builtInSkillOverrides.some((skill) => skill.id === skillId)
  }
  const projectSkill = normalized.projectSkills.find((skill) => skill.id === skillId)
  if (!projectSkill) return false
  return typeof projectSkill.createdAt === "number"
    && typeof projectSkill.updatedAt === "number"
    && projectSkill.updatedAt > projectSkill.createdAt
}

export function createProjectDeAiSkillFromTemplate(
  config: DeAiSkillConfig,
  templateId: string,
  now = Date.now(),
): DeAiSkillConfig {
  const template = getAllDeAiSkills(config).find((skill) => skill.id === templateId) ?? BUILT_IN_DE_AI_SKILLS[0]
  const skill: DeAiSkill = {
    id: `project:${now}`,
    name: `${template.name}副本`,
    description: template.description,
    templateId: template.templateId,
    content: template.content,
    source: "project",
    createdAt: now,
    updatedAt: now,
  }
  return normalizeDeAiSkillConfig({
    ...config,
    defaultSkillId: skill.id,
    projectSkills: [skill, ...config.projectSkills],
  })
}

export function updateProjectDeAiSkill(
  config: DeAiSkillConfig,
  skillId: string,
  patch: Pick<Partial<DeAiSkill>, "name" | "description" | "content">,
  now = Date.now(),
): DeAiSkillConfig {
  return normalizeDeAiSkillConfig({
    ...config,
    projectSkills: config.projectSkills.map((skill) =>
      skill.id === skillId
        ? { ...skill, ...patch, source: "project", updatedAt: now }
        : skill,
    ),
  })
}

export function updateDeAiSkill(
  config: DeAiSkillConfig,
  skillId: string,
  patch: Pick<Partial<DeAiSkill>, "name" | "description" | "content">,
  now = Date.now(),
): DeAiSkillConfig {
  const normalized = normalizeDeAiSkillConfig(config)
  if (!skillId.startsWith("built-in:")) {
    return updateProjectDeAiSkill(normalized, skillId, patch, now)
  }
  const existingOverride = normalized.builtInSkillOverrides.find((skill) => skill.id === skillId)
  const current = getAllDeAiSkills(normalized).find((skill) => skill.id === skillId)
  if (!current || !BUILT_IN_IDS.has(skillId)) return normalized
  const override: DeAiSkill = {
    ...current,
    ...patch,
    id: skillId,
    source: "built-in",
    createdAt: existingOverride?.createdAt ?? now,
    updatedAt: now,
  }
  return normalizeDeAiSkillConfig({
    ...normalized,
    builtInSkillOverrides: [
      override,
      ...normalized.builtInSkillOverrides.filter((skill) => skill.id !== skillId),
    ],
  })
}

export function resetBuiltInDeAiSkill(config: DeAiSkillConfig, skillId: string): DeAiSkillConfig {
  const normalized = normalizeDeAiSkillConfig(config)
  if (!BUILT_IN_IDS.has(skillId)) return normalized
  return normalizeDeAiSkillConfig({
    ...normalized,
    builtInSkillOverrides: normalized.builtInSkillOverrides.filter((skill) => skill.id !== skillId),
  })
}

export function setDefaultDeAiSkill(config: DeAiSkillConfig, skillId: string): DeAiSkillConfig {
  return normalizeDeAiSkillConfig({ ...config, defaultSkillId: skillId })
}

export function setDeAiSkillEnabled(config: DeAiSkillConfig, skillId: string, enabled: boolean): DeAiSkillConfig {
  const disabledSkillIds = enabled
    ? config.disabledSkillIds.filter((id) => id !== skillId)
    : [...new Set([...config.disabledSkillIds, skillId])]
  const normalized = normalizeDeAiSkillConfig({ ...config, disabledSkillIds })
  if (normalized.defaultSkillId === skillId && !enabled) {
    const fallback = resolveAvailableDeAiSkills(normalized)[0]
    return normalizeDeAiSkillConfig({ ...normalized, defaultSkillId: fallback?.id ?? normalized.defaultSkillId })
  }
  return normalized
}

export function deleteProjectDeAiSkill(config: DeAiSkillConfig, skillId: string): DeAiSkillConfig {
  if (!skillId.startsWith("project:")) return config
  const projectSkills = config.projectSkills.filter((skill) => skill.id !== skillId)
  const next = normalizeDeAiSkillConfig({ ...config, projectSkills })
  if (next.defaultSkillId === skillId || !getAllDeAiSkills(next).some((skill) => skill.id === next.defaultSkillId)) {
    const fallback = resolveAvailableDeAiSkills(next)[0]
    return normalizeDeAiSkillConfig({ ...next, defaultSkillId: fallback?.id ?? DEFAULT_DE_AI_SKILL_ID })
  }
  return next
}

export async function loadDeAiSkillConfig(projectPath: string | null | undefined): Promise<DeAiSkillConfig> {
  if (!projectPath) return normalizeDeAiSkillConfig(null)
  try {
    const configPath = await join(projectPath, "de-ai-skills.json")
    const content = await readFile(configPath)
    return normalizeDeAiSkillConfig(JSON.parse(content))
  } catch {
    try {
      const legacyPath = await join(projectPath, "de-ai-skill.txt")
      const legacyContent = (await readFile(legacyPath)).trim()
      if (!legacyContent) return normalizeDeAiSkillConfig(null)
      const legacySkill: DeAiSkill = {
        id: "project:legacy-de-ai-skill",
        name: "旧版自定义去AI味 Skill",
        description: "从旧版 de-ai-skill.txt 读取的项目规则。",
        templateId: "legacy",
        content: legacyContent,
        source: "legacy",
      }
      return normalizeDeAiSkillConfig({
        defaultSkillId: legacySkill.id,
        projectSkills: [legacySkill],
      })
    } catch {
      return normalizeDeAiSkillConfig(null)
    }
  }
}

export async function saveDeAiSkillConfig(projectPath: string, config: DeAiSkillConfig): Promise<void> {
  const configPath = await join(projectPath, "de-ai-skills.json")
  await writeFile(configPath, JSON.stringify(normalizeDeAiSkillConfig(config), null, 2))
}
