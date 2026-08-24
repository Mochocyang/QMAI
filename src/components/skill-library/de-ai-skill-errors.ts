import { isDeAiSkillConfigCorruptError } from "@/lib/novel/de-ai-skill-library"

const DE_AI_SKILL_CONFIG_CORRUPT_MESSAGE = "技能库配置文件损坏，请到技能库恢复配置"
const DE_AI_SKILL_LOAD_FAILED_MESSAGE = "读取去AI味技能失败"

export function getDeAiSkillLoadErrorMessage(error: unknown): string {
  return isDeAiSkillConfigCorruptError(error)
    ? DE_AI_SKILL_CONFIG_CORRUPT_MESSAGE
    : DE_AI_SKILL_LOAD_FAILED_MESSAGE
}
