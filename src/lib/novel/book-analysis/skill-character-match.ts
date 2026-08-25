/**
 * Skill 文件 ↔ 角色 的确定性匹配（fix/skill-match）
 *
 * 背景：旧逻辑含「文件名包含角色名」的宽松子串匹配，短名角色会抢走
 * 长名角色的 Skill（如角色「韩」抢先匹配到「韩立-skill.md」），导致
 * 角色面板显示「未生成」、「加入自定义灵魂库」按钮置灰。
 *
 * 匹配链（确定性优先级，逐级回退）：
 *   1. 文件名（去掉 -skill.md / .md）与角色名精确相等
 *   2. 与 safeFileName（非法字符替换为 _）相等
 *   3. 与别名（原名 / safe 名）相等
 *   4. 与 Skill frontmatter 的 name 字段相等（原名 / safe 名 / 别名）
 */
import type { ExtractedCharacter } from "./types"

function safeSkillFileName(value: string): string {
  return value.replace(/[^一-龥a-zA-Z0-9]/g, "_")
}

function skillBaseName(fileName: string): string {
  return fileName.replace(/-skill\.md$/i, "").replace(/\.md$/i, "")
}

function parseFrontmatterName(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  const nameMatch = match[1].match(/^name:\s*(.+?)\s*$/m)
  return nameMatch ? nameMatch[1].trim() : null
}

function matchesName(character: ExtractedCharacter, name: string): boolean {
  if (character.name === name || safeSkillFileName(character.name) === name) return true
  return character.aliases.some((alias) => alias === name || safeSkillFileName(alias) === name)
}

export function findCharacterForSkillFile(
  fileName: string,
  skillContent: string,
  characters: ExtractedCharacter[],
): ExtractedCharacter | undefined {
  const baseName = skillBaseName(fileName)
  const byBase = characters.find((character) => matchesName(character, baseName))
  if (byBase) return byBase
  const frontmatterName = parseFrontmatterName(skillContent)
  if (!frontmatterName) return undefined
  return characters.find((character) => matchesName(character, frontmatterName))
}
