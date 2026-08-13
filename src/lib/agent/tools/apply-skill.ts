import type { Tool } from "../types"
import { getAllDeAiSkills } from "@/lib/novel/de-ai-skill-library"
import type { DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"
import type { UserSkill } from "@/lib/novel/skill-library"
import { resolveSkillReference } from "@/lib/novel/skill-route-registry"

export function createApplySkillTool(
  getConfig: () => DeAiSkillConfig | null,
  getUserSkills?: () => UserSkill[] | null,
): Tool {
  const getAvailableSkills = () => {
    const config = getConfig()
    let deAiSkills: ReturnType<typeof getAllDeAiSkills> = []
    if (config) {
      try {
        deAiSkills = getAllDeAiSkills(config)
      } catch {
        // 某些宿主只加载通用 Skill，不提供去 AI 味技能库；工具仍可正常列出通用 Skill。
      }
    }
    return [
      ...(getUserSkills?.() ?? []),
      ...deAiSkills,
    ]
  }
  const availableNames = [...new Set(getAvailableSkills().map((skill) => skill.name))].sort()
  const availableNamesText = availableNames.length > 0
    ? `本轮可用名称：${availableNames.join("、")}。`
    : "本轮没有已加载的 Skill。"
  return {
    name: "apply_skill",
    description: `应用写作 Skill。仅支持 Skill ID、完整名称或受控 UI 别名，不支持模糊子串。${availableNamesText}`,
    category: "action",
    parameters: {
      skillName: { type: "string", description: `Skill 完整名称或受控 UI 别名。${availableNamesText}` },
      skillId: { type: "string", description: "Skill ID，可选，与 skillName 二选一" },
    },
    execute: async (params) => {
      const name = params.skillName as string | undefined
      const id = params.skillId as string | undefined
      const userSkills = getUserSkills?.() ?? []
      const userSkill = resolveSkillReference(userSkills, { id, name })
      if (userSkill) {
        return `Skill「${userSkill.name}」的写作模板:\n\n${userSkill.content}`
      }

      const config = getConfig()
      if (!config && userSkills.length === 0) return "错误：技能库配置未加载"

      const skill = config
        ? resolveSkillReference(getAllDeAiSkills(config), { id, name })
        : undefined
      if (!skill) return `错误：未找到 Skill「${name || id}」`
      return `Skill「${skill.name}」的写作模板:\n\n${skill.content}`
    },
  }
}
