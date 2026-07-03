import { readFile, writeFileAtomic } from "@/commands/fs"
import { join } from "@tauri-apps/api/path"
import {
  normalizeUserSkill,
  type SkillKind,
  type SkillMode,
  type SkillStage,
  type UserSkill,
} from "@/lib/novel/skill-library"
import { DEFAULT_BUILTIN_WRITING_SKILLS, getBuiltinSkillIds } from "./skill-seed"

export const USER_SKILL_CONFIG_FILE = "writing-skills.json"

export interface UserSkillConfig {
  version: 1
  selectedSkillId: string | null
  disabledSkillIds: string[]
  skills: UserSkill[]
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

function normalizeWritingSkill(value: unknown): UserSkill | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<UserSkill>
  if (typeof raw.name !== "string" || !raw.name.trim()) return null
  if (typeof raw.content !== "string" || !raw.content.trim()) return null
  return normalizeUserSkill({
    ...raw,
    source: raw.source === "built-in" ? "built-in" : "uploaded",
  })
}

export function normalizeUserSkillConfig(value: unknown): UserSkillConfig {
  const raw = value && typeof value === "object" ? value as Partial<UserSkillConfig> : {}
  const skills = Array.isArray(raw.skills)
    ? raw.skills
      .map(normalizeWritingSkill)
      .filter((skill): skill is UserSkill => Boolean(skill))
      .filter((skill, index, all) => all.findIndex((item) => item.id === skill.id) === index)
    : []
  const skillIds = new Set(skills.map((skill) => skill.id))
  const selectedSkillId = typeof raw.selectedSkillId === "string" && skillIds.has(raw.selectedSkillId)
    ? raw.selectedSkillId
    : skills[0]?.id ?? null
  return {
    version: 1,
    selectedSkillId,
    disabledSkillIds: uniqueStrings(raw.disabledSkillIds),
    skills,
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

export function updateWritingSkill(
  config: UserSkillConfig,
  skillId: string,
  patch: Partial<Pick<UserSkill, "name" | "description" | "kind" | "stages" | "modes" | "content">>,
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
          source: "uploaded",
          updatedAt: now,
        })
        : skill,
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
  const existingBuiltinIds = new Set(
    config.skills.filter((s) => s.source === "built-in").map((s) => s.id)
  );
  const missing = DEFAULT_BUILTIN_WRITING_SKILLS.filter((s) => !existingBuiltinIds.has(s.id));
  if (missing.length === 0) return config;
  return normalizeUserSkillConfig({
    ...config,
    skills: [...missing, ...config.skills],
  });
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

