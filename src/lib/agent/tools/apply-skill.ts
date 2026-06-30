import type { Tool } from "../types"
import { getAllDeAiSkills } from "@/lib/novel/de-ai-skill-library"
import type { DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"

export function createApplySkillTool(getConfig: () => DeAiSkillConfig | null): Tool {
  return {
    name: "apply_skill",
    description: "应用去AI味写作技能模板。参数 skillName 为技能名称，或 skillId 为技能 ID。返回技能的 prompt 模板内容，AI 可据此调整写作风格。",
    category: "action",
    parameters: {
      skillName: { type: "string", description: "技能名称（如「去AI味」）" },
      skillId: { type: "string", description: "技能 ID（可选，与 skillName 二选一）" },
    },
    execute: async (params) => {
      const config = getConfig()
      if (!config) return "错误：技能库配置未加载"
      const skills = getAllDeAiSkills(config)
      const name = params.skillName as string | undefined
      const id = params.skillId as string | undefined
      const skill = skills.find((s) => (id && s.id === id) || (name && s.name.includes(name)))
      if (!skill) return `错误：未找到技能「${name || id}」`
      return `技能「${skill.name}」的写作模板:\n\n${skill.content}`
    },
  }
}
