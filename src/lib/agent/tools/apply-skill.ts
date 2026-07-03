import type { Tool } from "../types"
import { getAllDeAiSkills } from "@/lib/novel/de-ai-skill-library"
import type { DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"
import type { UserSkill } from "@/lib/novel/skill-library"

export function createApplySkillTool(
  getConfig: () => DeAiSkillConfig | null,
  getUserSkills?: () => UserSkill[] | null,
): Tool {
  return {
    name: "apply_skill",
    description: "应用写作 Skill。参数 skillName 为技能名称，或 skillId 为技能 ID。返回 Skill 的 prompt 模板内容，AI 可据此调整写作流程或输出风格。",
    category: "action",
    parameters: {
      skillName: { type: "string", description: "Skill 名称，例如「三翻四抖」或「去AI味」" },
      skillId: { type: "string", description: "Skill ID，可选，与 skillName 二选一" },
    },
    execute: async (params) => {
      const name = params.skillName as string | undefined
      const id = params.skillId as string | undefined
      const userSkill = getUserSkills?.()?.find((skill) => matchesSkill(skill, id, name))
      if (userSkill) {
        return `Skill「${userSkill.name}」的写作模板:\n\n${userSkill.content}`
      }

      const config = getConfig()
      if (!config) return "错误：技能库配置未加载"

      const skill = getAllDeAiSkills(config).find((item) => matchesSkill(item, id, name))
      if (!skill) return `错误：未找到 Skill「${name || id}」`
      return `Skill「${skill.name}」的写作模板:\n\n${skill.content}`
    },
  }
}

function matchesSkill(skill: { id: string; name: string }, id?: string, name?: string): boolean {
  return Boolean((id && skill.id === id) || (name && skill.name.includes(name)))
}
