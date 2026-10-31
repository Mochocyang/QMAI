/**
 * 人物档案 → 表格 MD 的**单向投影**。
 *
 * 为什么单向：用户拍板的口径是「人物小传和技能库人物 skill 效果一模一样」。
 * 一旦这个文件可写回，同一角色就有两个可改的地方，必然对不上；
 * 而 SKILL.md 才是学习、注入、回退都在读的那份。
 * 所以这里只做「档案 → 文本」，永远不提供反向解析。
 *
 * 纯函数、零 IO：调用方负责写盘，也负责判断要不要覆盖（见 isGeneratedProjection）。
 */

export const PROJECTION_GENERATED_BY = "persona-skill"

export interface PersonaTableProjectionInput {
  characterName: string
  roleType: string
  personaId: string
  generatedAt: string
  /** 档案字段，顺序即表格行顺序。 */
  fields: Readonly<Record<string, string>>
  /** 引用这个角色的大纲文件名。写进 frontmatter，供「从人物小传反查来源大纲」使用。 */
  outlineRefs?: readonly string[]
}

/** 表格单元格里不能出现换行和裸竖线 —— 一个换行就把整张表拆散。 */
function toCell(value: string): string {
  return value.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim()
}

export function renderPersonaTableMarkdown(input: PersonaTableProjectionInput): string {
  const rows = Object.entries(input.fields)
    .map(([name, value]) => [name, toCell(value)] as const)
    .filter(([, value]) => value.length > 0)

  const lines: string[] = [
    "---",
    `generated-from: ${PROJECTION_GENERATED_BY}`,
    `persona-id: ${input.personaId}`,
    `generated-at: ${input.generatedAt}`,
  ]
  /*
   * 反向引用：这个角色被哪些大纲引用。
   * 用 JSON 数组而不是 `a.md, b.md` —— 文件名里出现逗号或引号时，
   * 逗号分隔会把一项撕成两项，YAML 引号规则又各不相同。JSON 是唯一不用解释的写法。
   *
   * 空引用不写这一行：没有引用的角色写个 `outline-refs: []`，
   * 读的人会以为「查过了，确实没有」，而实际是「从来没被任何大纲引用过」，
   * 两种状态混在一起没有价值。
   */
  const refs = input.outlineRefs ?? []
  if (refs.length > 0) lines.push(`outline-refs: ${JSON.stringify(refs)}`)
  lines.push(
    "---",
    "",
    `# ${input.characterName}`,
    "",
    "> 本文件由人物档案自动生成，修改请到「人物 Skill」里改；这里的手工修改会在下次生成时被覆盖。",
    "",
  )
  if (input.roleType) lines.push(`**定位**：${input.roleType}`, "")
  lines.push("| 字段 | 内容 |", "| --- | --- |", ...rows.map(([name, value]) => `| ${name} | ${value} |`), "")
  return lines.join("\n")
}

/**
 * 这个文件是不是我们生成的投影。
 *
 * 只有带标记的才允许覆盖。老项目里 `wiki/outlines/人物小传/*.md` 可能是用户手写的，
 * 把它当成投影覆盖掉，等于一次保存就吃掉用户的正文 —— 这是本功能最严重的可能事故。
 */
export function isGeneratedProjection(content: string): boolean {
  return new RegExp(`generated-from:\\s*${PROJECTION_GENERATED_BY}`).test(content)
}
