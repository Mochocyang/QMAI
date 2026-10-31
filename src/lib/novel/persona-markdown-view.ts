/**
 * 把结构化字段渲染成 MD 文档（H2 方案「并排 / MD」的右侧那一半）。
 *
 * ── 为什么必须与 SKILL.md 同构 ──
 * MD 侧是可编辑的，改完要同步回表格，靠的是 `readPersonaDocumentFields` 反解。
 * 那个解析器认的是**每个字段一个 `## 段`**（`## 怎么说话` 下面接正文）。
 * 如果这里渲染成「一个大节 + 若干列表项」，反解会读到空字段 ——
 * 用户在 MD 里改了一句，表格却没变。所以输出形状照抄 SKILL.md。
 *
 * ── 空字段为什么收进末尾一行，而不是各写一个空标题 ──
 * 之前每个字段都写 `## 标题`，结果一个只填了五项的角色，MD 里会多出十几个
 * 空标题，正文被稀释得没法读（用户反馈「显得太空」）。
 * 现在：**有值的照常写段**，没填的在文末汇总成一行「还没填的字段：外貌、背景…」。
 * 信息一个不少（名字都在），但正文只留有内容的部分。
 *
 * 汇总行用 `## 还没填的字段` 这个**非已知字段**的标题：
 * 解析器会把它归入 extras 原样保留，不会被反解成某个字段的值，
 * 因此不会凭空往档案里写内容；而每次渲染都会重新生成，也不会累积。
 */
import { PERSONA_DOCUMENT_FIELDS } from "./persona-skill-types"

export interface PersonaMarkdownInput {
  characterName: string
  /**
   * 定位只用于在 MD 顶部写一行摘要。
   * 它不是 `PERSONA_DOCUMENT_FIELDS` 的成员（真源在 frontmatter 的 `role`），
   * 所以**不参与往返同步** —— 定位请在表格里改。
   */
  roleType?: string
  fields: Record<string, string>
}

/** 文末汇总区的标题。不在 PERSONA_DOCUMENT_FIELDS 里 —— 它只是给人看的索引。 */
const EMPTY_SECTION_HEADING = "还没填的字段"

export function renderPersonaMarkdown(input: PersonaMarkdownInput): string {
  const lines: string[] = [`# ${input.characterName} · 人物 Skill`, ""]

  const role = (input.roleType ?? "").trim()
  if (role) lines.push(`> 定位：${role}（在表格里修改；MD 不参与往返）`, "")

  // 顺序即文档顺序（档案在前、演技居中、动态在后），与写盘口径一致。
  const empty: string[] = []
  for (const name of PERSONA_DOCUMENT_FIELDS) {
    const value = (input.fields[name] ?? "").trim()
    if (!value) {
      empty.push(name)
      continue
    }
    lines.push(`## ${name}`, "", ...value.split("\n"), "")
  }

  // 备注不在 PERSONA_DOCUMENT_FIELDS 里（它只是给人看的），但同样是档案的一部分。
  const note = (input.fields["备注"] ?? "").trim()
  if (note) lines.push("## 备注", "", ...note.split("\n"), "")
  else empty.push("备注")

  if (empty.length > 0) {
    lines.push(`## ${EMPTY_SECTION_HEADING}`, "", `- ${empty.join("、")}`, "")
  }

  return lines.join("\n")
}
