import { readFile, writeFileAtomic, listDirectory } from "@/commands/fs"
import { join,} from "@tauri-apps/api/path"
import {
  normalizeUserSkill,
  type SkillCategory,
  type SkillKind,
  type SkillMode,
  type SkillStage,
  type UserSkill,
} from "@/lib/novel/skill-library"
import { DEFAULT_BUILTIN_WRITING_SKILLS, getBuiltinSkillIds } from "./skill-seed"
import {
  DEFAULT_SKILL_ROUTE_CATEGORIES,
  inferSkillRoute,
  SKILL_ROUTE_CATEGORY_IDS,
} from "./skill-route"

export const USER_SKILL_CONFIG_FILE = "writing-skills.json"

export interface UserSkillConfig {
  version: 1
  selectedSkillId: string | null
  disabledSkillIds: string[]
  skills: UserSkill[]
  categories: SkillCategory[]
}

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

function normalizeSkillCategory(value: unknown): SkillCategory | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<SkillCategory>
  if (typeof raw.id !== "string" || !raw.id.trim()) return null
  if (typeof raw.name !== "string" || !raw.name.trim()) return null
  return {
    id: raw.id.trim(),
    name: raw.name.trim(),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
  }
}

function normalizeWritingSkill(value: unknown): UserSkill | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<UserSkill>
  if (typeof raw.name !== "string" || !raw.name.trim()) return null
  const isLinked = raw.source === "linked"
  if (!isLinked) {
    if (typeof raw.content !== "string" || !raw.content.trim()) return null
  }
  return normalizeUserSkill({
    ...raw,
    source: raw.source === "built-in" ? "built-in" : raw.source === "linked" ? "linked" : "uploaded",
    content: typeof raw.content === "string" ? raw.content : "",
  })
}

function mergeDefaultSkillCategories(categories: SkillCategory[]): SkillCategory[] {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const merged = [...categories]
  for (const defaultCategory of DEFAULT_SKILL_ROUTE_CATEGORIES) {
    if (!byId.has(defaultCategory.id)) {
      merged.push(defaultCategory)
    }
  }
  return merged
}

function assignDefaultCategory(skill: UserSkill, categoryIds: Set<string>): UserSkill {
  if (skill.categoryId && categoryIds.has(skill.categoryId)) return skill
  const route = inferSkillRoute(skill)
  if (!route) return skill
  return {
    ...skill,
    categoryId: SKILL_ROUTE_CATEGORY_IDS[route],
  }
}

export function normalizeUserSkillConfig(value: unknown): UserSkillConfig {
  const raw = value && typeof value === "object" ? value as Partial<UserSkillConfig> : {}
  const skills = Array.isArray(raw.skills)
    ? raw.skills
      .map(normalizeWritingSkill)
      .filter((skill): skill is UserSkill => Boolean(skill))
      .filter((skill, index, all) => all.findIndex((item) => item.id === skill.id) === index)
    : []
  const categories = Array.isArray(raw.categories)
    ? raw.categories
      .map(normalizeSkillCategory)
      .filter((cat): cat is SkillCategory => Boolean(cat))
      .filter((cat, index, all) => all.findIndex((item) => item.id === cat.id) === index)
    : []
  const categoryIds = new Set(categories.map((cat) => cat.id))
  const normalizedSkills = skills.map((skill) => ({
    ...skill,
    categoryId: skill.categoryId && categoryIds.has(skill.categoryId) ? skill.categoryId : "",
  }))
  const skillIds = new Set(normalizedSkills.map((skill) => skill.id))
  const selectedSkillId = typeof raw.selectedSkillId === "string" && skillIds.has(raw.selectedSkillId)
    ? raw.selectedSkillId
    : normalizedSkills[0]?.id ?? null
  return {
    version: 1,
    selectedSkillId,
    disabledSkillIds: uniqueStrings(raw.disabledSkillIds),
    skills: normalizedSkills,
    categories,
  }
}

export function createBlankWritingSkill(config: UserSkillConfig, now = Date.now()): UserSkillConfig {
  const skill = normalizeUserSkill({
    id: `skill:${now}`,
    name: "新建写作 Skill",
    description: "",
    kind: ["structure", "planning"],
    stages: ["planning", "drafting"],
    modes: ["standard", "strict"],
    content: [
      "# 写作 Skill",
      "",
      "## 使用场景",
      "",
      "说明这个 Skill 适合哪些写作任务。",
      "",
      "## 执行规则",
      "",
      "写下具体规则，例如三次转折、四次信息冲击、章节结尾钩子等。",
      "",
      "## 输出要求",
      "",
      "只让 AI 将本 Skill 用于内部写作决策，不要在最终正文中解释 Skill。",
    ].join("\n"),
    source: "uploaded",
    createdAt: now,
    updatedAt: now,
  })
  return normalizeUserSkillConfig({
    ...config,
    selectedSkillId: skill.id,
    skills: [skill, ...config.skills],
  })
}

export function importWritingSkill(
  config: UserSkillConfig,
  params: { name: string; content: string; description?: string },
  now = Date.now(),
): UserSkillConfig {
  const { name, content, description } = params
  const trimmedName = name.trim()
  const trimmedContent = content.trim()
  if (!trimmedName || !trimmedContent) return config

  const skill = normalizeUserSkill({
    id: `skill:${now}`,
    name: trimmedName,
    description: description?.trim() ?? "",
    kind: ["style", "structure"],
    stages: ["planning", "drafting"],
    modes: ["standard", "strict"],
    content: trimmedContent,
    source: "uploaded",
    createdAt: now,
    updatedAt: now,
  })
  return normalizeUserSkillConfig({
    ...config,
    selectedSkillId: skill.id,
    skills: [skill, ...config.skills],
  })
}

function isFileByPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".json")
}

export async function loadLinkedSkillContent(skill: UserSkill): Promise<string> {
  if (skill.source !== "linked" || !skill.linkedPath) {
    return skill.content
  }

  const linkedPath = skill.linkedPath
  const isFile = isFileByPath(linkedPath)

  try {
    if (isFile) {
      return await readFile(linkedPath)
    }

    const skillMdPath = await join(linkedPath, "SKILL.md")
    let content = await readFile(skillMdPath)

    try {
      const docsPath = await join(linkedPath, "docs")
      const files = await listDirectory(docsPath)
      const mdFiles = files.filter((f) => f.name.toLowerCase().endsWith(".md") && !f.is_dir)
      if (mdFiles.length > 0) {
        const docContents: string[] = []
        for (const file of mdFiles) {
          const filePath = await join(docsPath, file.name)
          try {
            const docContent = await readFile(filePath)
            docContents.push(docContent)
          } catch {
          }
        }
        if (docContents.length > 0) {
          content += `\n---\n# 附加文档\n---\n\n${docContents.join("\n\n---\n\n")}`
        }
      }
    } catch {
    }

    return content
  } catch {
    return ""
  }
}

export async function loadAllLinkedSkillsContent(config: UserSkillConfig): Promise<UserSkillConfig> {
  const linkedSkills = config.skills.filter((s) => s.source === "linked")
  if (linkedSkills.length === 0) {
    return config
  }

  const contents = await Promise.all(
    linkedSkills.map((skill) => loadLinkedSkillContent(skill))
  )

  const contentMap = new Map<string, string>()
  linkedSkills.forEach((skill, index) => {
    contentMap.set(skill.id, contents[index])
  })

  const updatedSkills = config.skills.map((skill) => {
    const content = contentMap.get(skill.id)
    if (content !== undefined) {
      return { ...skill, content }
    }
    return skill
  })

  return {
    ...config,
    skills: updatedSkills,
  }
}

export function updateWritingSkill(
  config: UserSkillConfig,
  skillId: string,
  patch: Partial<Pick<UserSkill, "name" | "description" | "kind" | "stages" | "modes" | "content" | "priority" | "tags" | "categoryId">>,
  now = Date.now(),
): UserSkillConfig {
  return normalizeUserSkillConfig({
    ...config,
    skills: config.skills.map((skill) =>
      skill.id === skillId
        ? normalizeUserSkill({
          ...skill,
          ...patch,
          id: skill.id,
          source: skill.source,
          updatedAt: now,
        })
        : skill,
    ),
  })
}

export function touchSkillUsage(
  config: UserSkillConfig,
  skillId: string,
  now = Date.now(),
): UserSkillConfig {
  const skill = config.skills.find((s) => s.id === skillId)
  if (!skill || skill.source === "built-in") return config
  return normalizeUserSkillConfig({
    ...config,
    skills: config.skills.map((s) =>
      s.id === skillId
        ? normalizeUserSkill({ ...s, updatedAt: now })
        : s,
    ),
  })
}

export function setWritingSkillEnabled(
  config: UserSkillConfig,
  skillId: string,
  enabled: boolean,
): UserSkillConfig {
  const disabledSkillIds = enabled
    ? config.disabledSkillIds.filter((id) => id !== skillId)
    : [...new Set([...config.disabledSkillIds, skillId])]
  return normalizeUserSkillConfig({ ...config, disabledSkillIds })
}

export function deleteWritingSkill(config: UserSkillConfig, skillId: string): UserSkillConfig {
  const builtinIds = getBuiltinSkillIds()
  if (builtinIds.has(skillId)) return config
  const skills = config.skills.filter((skill) => skill.id !== skillId)
  return normalizeUserSkillConfig({
    ...config,
    selectedSkillId: config.selectedSkillId === skillId ? skills[0]?.id ?? null : config.selectedSkillId,
    disabledSkillIds: config.disabledSkillIds.filter((id) => id !== skillId),
    skills,
  })
}

export function createSkillCategory(
  config: UserSkillConfig,
  name: string,
  now = Date.now(),
): UserSkillConfig {
  const trimmedName = name.trim()
  if (!trimmedName) return config
  const category: SkillCategory = {
    id: `cat:${now}`,
    name: trimmedName,
    createdAt: now,
    updatedAt: now,
  }
  return normalizeUserSkillConfig({
    ...config,
    categories: [...config.categories, category],
  })
}

export function renameSkillCategory(
  config: UserSkillConfig,
  categoryId: string,
  newName: string,
  now = Date.now(),
): UserSkillConfig {
  const trimmedName = newName.trim()
  if (!trimmedName) return config
  return normalizeUserSkillConfig({
    ...config,
    categories: config.categories.map((cat) =>
      cat.id === categoryId
        ? { ...cat, name: trimmedName, updatedAt: now }
        : cat,
    ),
  })
}

export function deleteSkillCategory(
  config: UserSkillConfig,
  categoryId: string,
): UserSkillConfig {
  const skills = config.skills.map((skill) =>
    skill.categoryId === categoryId
      ? { ...skill, categoryId: "" }
      : skill,
  )
  return normalizeUserSkillConfig({
    ...config,
    skills,
    categories: config.categories.filter((cat) => cat.id !== categoryId),
  })
}

export function reorderSkillCategories(
  config: UserSkillConfig,
  fromIndex: number,
  toIndex: number,
): UserSkillConfig {
  const categories = [...config.categories]
  const [moved] = categories.splice(fromIndex, 1)
  categories.splice(toIndex, 0, moved)
  return normalizeUserSkillConfig({
    ...config,
    categories,
  })
}

export function moveSkillToCategory(
  config: UserSkillConfig,
  skillId: string,
  categoryId: string,
): UserSkillConfig {
  return normalizeUserSkillConfig({
    ...config,
    skills: config.skills.map((skill) =>
      skill.id === skillId
        ? { ...skill, categoryId }
        : skill,
    ),
  })
}

export function resolveEnabledWritingSkills(config: UserSkillConfig): UserSkill[] {
  const disabled = new Set(config.disabledSkillIds)
  return config.skills.filter((skill) => !disabled.has(skill.id))
}

export async function loadUserSkillConfig(projectPath: string | null | undefined): Promise<UserSkillConfig> {
  if (!projectPath) return ensureBuiltinSkills(normalizeUserSkillConfig(null))
  const configPath = await join(projectPath, USER_SKILL_CONFIG_FILE)
  try {
    const content = await readFile(configPath)
    return ensureBuiltinSkills(normalizeUserSkillConfig(JSON.parse(content)))
  } catch {
    return ensureBuiltinSkills(normalizeUserSkillConfig(null))
  }
}

export async function saveUserSkillConfig(projectPath: string, config: UserSkillConfig): Promise<void> {
  const configPath = await join(projectPath, USER_SKILL_CONFIG_FILE)
  await writeFileAtomic(configPath, JSON.stringify(normalizeUserSkillConfig(config), null, 2))
}

/**
 * Ensure built-in writing skills are always present.
 */
export function ensureBuiltinSkills(config: UserSkillConfig): UserSkillConfig {
  const categories = mergeDefaultSkillCategories(config.categories)
  const categoryIds = new Set(categories.map((category) => category.id))
  const existingBuiltinIds = new Set(
    config.skills.filter((s) => s.source === "built-in").map((s) => s.id)
  );
  const missing = DEFAULT_BUILTIN_WRITING_SKILLS
    .filter((s) => !existingBuiltinIds.has(s.id))
    .map((skill) => assignDefaultCategory(skill, categoryIds));
  const skills = [...missing, ...config.skills].map((skill) =>
    skill.source === "built-in" ? assignDefaultCategory(skill, categoryIds) : skill
  );
  return normalizeUserSkillConfig({
    ...config,
    skills,
    categories,
  });
}

export function exportSkillToJson(skill: UserSkill): string {
  const data = {
    "qmai-skill": true,
    version: 1,
    name: skill.name,
    description: skill.description,
    kind: skill.kind,
    stages: skill.stages,
    modes: skill.modes,
    content: skill.content,
    priority: skill.priority,
    tags: skill.tags,
  }
  return JSON.stringify(data, null, 2)
}

export function importSkillFromJson(jsonStr: string): UserSkill | null {
  try {
    const parsed = JSON.parse(jsonStr)
    if (!parsed || typeof parsed !== "object") return null
    const raw = parsed as Record<string, unknown>
    if (typeof raw.name !== "string" || !raw.name.trim()) return null
    if (typeof raw.content !== "string" || !raw.content.trim()) return null
    const now = Date.now()
    return normalizeUserSkill({
      id: `skill:${now}`,
      name: raw.name,
      description: typeof raw.description === "string" ? raw.description : "",
      kind: Array.isArray(raw.kind) ? raw.kind : undefined,
      stages: Array.isArray(raw.stages) ? raw.stages : undefined,
      modes: Array.isArray(raw.modes) ? raw.modes : undefined,
      content: raw.content,
      source: "uploaded",
      priority: typeof raw.priority === "number" ? raw.priority : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags : undefined,
      createdAt: now,
      updatedAt: now,
    })
  } catch {
    return null
  }
}

export const WRITING_SKILL_KIND_OPTIONS: SkillKind[] = [
  "style",
  "structure",
  "planning",
  "review",
  "rewrite",
  "output",
  "knowledge",
]

export const WRITING_SKILL_STAGE_OPTIONS: SkillStage[] = [
  "planning",
  "drafting",
  "review",
  "rewrite",
  "output",
]

export const WRITING_SKILL_MODE_OPTIONS: SkillMode[] = ["fast", "standard", "strict"]

