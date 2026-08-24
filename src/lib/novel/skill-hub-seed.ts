import { normalizeUserSkill, type SkillKind, type SkillStage, type UserSkill } from "./skill-library"
import { SKILL_ROUTE_CATEGORY_IDS } from "./skill-route"
import { validateSkillRouteRegistry } from "./skill-route-registry"

const skillHubModules = import.meta.glob("../../../skills/SkillHub/**/SKILL.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>

function parseSkillFrontmatter(content: string): {
  name: string
  description: string
} | null {
  const match = content.match(/^\uFEFF?---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!match) return null
  const yaml = match[1]
  const name = yaml.match(/^name:\s*(.+?)\s*$/m)?.[1]?.trim()
  const description = yaml.match(/^description:\s*(.+?)\s*$/m)?.[1]?.trim()
  if (!name || !description) return null
  return { name, description }
}

function getSkillHubFolder(path: string): string {
  return path.replace(/\\/g, "/").match(/SkillHub\/([^/]+)\//)?.[1] ?? ""
}

function getSkillRouteCategory(path: string, name: string): string {
  const folder = getSkillHubFolder(path)
  if (folder === "DagangSkill") return SKILL_ROUTE_CATEGORY_IDS.outline
  if (folder === "ZhanggangSkill") return SKILL_ROUTE_CATEGORY_IDS.outline
  if (folder === "QualitySkill") return SKILL_ROUTE_CATEGORY_IDS.outline
  if (folder === "TicaiSkill") return SKILL_ROUTE_CATEGORY_IDS.topic
  if (folder === "JueseSkill") return SKILL_ROUTE_CATEGORY_IDS.character
  if (folder === "ZhengwenSkill") return SKILL_ROUTE_CATEGORY_IDS.writing
  if (folder === "SheDingSkill") {
    if (name.includes("world-rules")) return SKILL_ROUTE_CATEGORY_IDS.worldbuilding
    if (name.includes("faction")) return SKILL_ROUTE_CATEGORY_IDS.faction
    if (name.includes("foreshadowing")) return SKILL_ROUTE_CATEGORY_IDS.foreshadowing
    if (name.includes("map")) return SKILL_ROUTE_CATEGORY_IDS.map
    return SKILL_ROUTE_CATEGORY_IDS.setting
  }
  return ""
}

function getSkillShape(path: string): {
  kind: SkillKind[]
  stages: SkillStage[]
  priority: number
} {
  const folder = getSkillHubFolder(path)
  if (folder === "DagangSkill") {
    return { kind: ["planning", "structure"], stages: ["planning", "output"], priority: 12 }
  }
  if (folder === "ZhanggangSkill") {
    return { kind: ["planning", "structure"], stages: ["planning", "output"], priority: 14 }
  }
  if (folder === "TicaiSkill") {
    return { kind: ["knowledge", "planning"], stages: ["planning"], priority: 18 }
  }
  if (folder === "QualitySkill") {
    return { kind: ["planning", "output"], stages: ["planning", "output"], priority: 16 }
  }
  if (folder === "ZhengwenSkill") {
    return { kind: ["style", "output"], stages: ["drafting", "output"], priority: 28 }
  }
  return { kind: ["knowledge", "structure"], stages: ["planning"], priority: 24 }
}

export const DEFAULT_SKILL_HUB_SKILLS: UserSkill[] = Object.entries(skillHubModules)
  .map(([path, content]) => {
    const parsed = parseSkillFrontmatter(content)
    if (!parsed) return null
    const shape = getSkillShape(path)
    return normalizeUserSkill({
      id: `skillhub:${parsed.name}`,
      name: parsed.name,
      description: parsed.description,
      kind: shape.kind,
      stages: shape.stages,
      modes: ["standard", "strict"],
      content,
      source: "built-in",
      priority: shape.priority,
      tags: [getSkillHubFolder(path), parsed.name],
      categoryId: getSkillRouteCategory(path, parsed.name),
    })
  })
  .filter((skill): skill is UserSkill => Boolean(skill))
  .sort((left, right) => left.id.localeCompare(right.id))

const SKILL_ROUTE_REGISTRY_MISSING_NAMES = validateSkillRouteRegistry(
  DEFAULT_SKILL_HUB_SKILLS.map((skill) => skill.name),
)

if (SKILL_ROUTE_REGISTRY_MISSING_NAMES.length > 0) {
  console.error("Skill 路由注册表包含不存在的 SkillHub 名称：", SKILL_ROUTE_REGISTRY_MISSING_NAMES)
}
