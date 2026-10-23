/**
 * 人物 Skill 的「档案」读写：把 SKILL.md 拆成结构化分区，并支持按表单改回 Markdown。
 *
 * 为什么单独一个模块而不是塞进 learning：这份文件是**纯文本变换**，零 IO、零 LLM，
 * 界面（表单编辑）与学习（AI 合并）两侧都要用。放进 learning 会把 Tauri 那串依赖
 * 拖进只想渲染一张档案卡的组件。
 *
 * SKILL.md 的形状（唯一权威）：
 *
 * ```
 * ---
 * character: 林清越
 * role: 男主
 * ...
 * ---
 *
 * # 林清越 · 人物 Skill
 *
 * ## 性别
 *
 * ## 势力组织
 * ...
 * ## 怎么说话
 * ...
 * ## 补充（截至第 12 章）   ← 手改档案的 AI 追加段，不属于任何字段
 * ```
 */
import {
  PERSONA_DOCUMENT_FIELDS,
  PERSONA_PROFILE_FIELDS,
  PERSONA_SUPPLEMENT_HEADING,
} from "./persona-skill-types"

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

export interface PersonaSkillDocumentBlock {
  /** 分区标题（`## ` 之后的部分）；文档开头的自由正文用空串。 */
  heading: string
  body: string
}

export interface ParsedPersonaSkillDocument {
  /** 含首尾 `---` 的 frontmatter 原文（没有则为空串）。 */
  frontmatter: string
  /** `# 标题` 那一行的标题文本（没有则为空串）。 */
  title: string
  /** 文档里正文标题以外的自由段落（H1 之前的内容），原样保留。 */
  preamble: string
  /** 已知字段 → 正文。同一字段出现多次时按出现顺序拼起来。 */
  fields: Record<string, string>
  /** 不属于已知字段的分区（含「补充」段），按原顺序保留。 */
  extras: PersonaSkillDocumentBlock[]
}

const KNOWN_FIELDS = new Set<string>(PERSONA_DOCUMENT_FIELDS)

export function isPersonaProfileField(name: string): boolean {
  return (PERSONA_PROFILE_FIELDS as readonly string[]).includes(name)
}

/**
 * 拆文档。**不丢弃任何内容**：认不出的分区进 `extras`，原样保留 ——
 * 用户可能在原文里手写过「## 口头禅速查」这种自定义段，重建表单时把它抹掉
 * 是不可接受的（而它恰恰是用户最容易被气走的那个 bug）。
 */
export function splitPersonaSkillDocument(markdown: string): ParsedPersonaSkillDocument {
  const text = markdown.replace(/\r\n/g, "\n")
  const frontmatterMatch = text.match(FRONTMATTER)
  const frontmatter = frontmatterMatch ? frontmatterMatch[0] : ""
  const rest = frontmatter ? text.slice(frontmatter.length) : text

  const fields: Record<string, string> = {}
  const extras: PersonaSkillDocumentBlock[] = []
  const preamble: string[] = []
  let title = ""
  let current: PersonaSkillDocumentBlock | null = null

  const flush = () => {
    if (!current) return
    const body = current.body.trim()
    if (current.heading && KNOWN_FIELDS.has(current.heading)) {
      if (!body) return
      const previous = fields[current.heading]
      fields[current.heading] = previous ? `${previous}\n${body}` : body
      return
    }
    if (!current.heading && !body) return
    extras.push({ heading: current.heading, body })
  }

  for (const line of rest.split("\n")) {
    const h2 = line.match(/^##\s+(.+?)\s*$/)
    if (h2) {
      flush()
      current = { heading: h2[1].trim(), body: "" }
      continue
    }
    const h1 = line.match(/^#\s+(.+?)\s*$/)
    if (h1) {
      flush()
      current = null
      if (!title) title = h1[1].trim()
      continue
    }
    if (current) {
      current.body += `${line}\n`
      continue
    }
    preamble.push(line)
  }
  flush()

  return { frontmatter, title, preamble: preamble.join("\n").trim(), fields, extras }
}

/** 只取已知字段（档案 + 演技），供界面表单回填。 */
export function readPersonaDocumentFields(markdown: string): Record<string, string> {
  const parsed = splitPersonaSkillDocument(markdown)
  const fields: Record<string, string> = {}
  for (const name of PERSONA_DOCUMENT_FIELDS) {
    const value = (parsed.fields[name] ?? "").trim()
    if (value) fields[name] = value
  }
  return fields
}

/**
 * 用表单值重建文档：已知字段按 {@link PERSONA_DOCUMENT_FIELDS} 的顺序重排，
 * frontmatter / H1 / 自定义分区 / 「补充」段原样保留。
 *
 * 合并语义（少一条都会出事）：
 * - **键不存在** = 调用方没打算动这一格，保留原文档里的值；
 * - **键存在但值为空** = 用户把这一格清空了，整段删除。
 *
 * 不能把「没传」当成「清空」：按页签分块保存、或将来只提交改过的字段时，
 * 未提交的那些段会被静默删掉。而空值按「整段删除」处理，是为了不写出
 * 「## 性别\n\n（空）」这种把「没看出来」和「确实没有」混在一起的空标题。
 */
export function applyPersonaProfileEdits(
  markdown: string,
  fields: Record<string, string>,
): string {
  const parsed = splitPersonaSkillDocument(markdown)
  const merged: Record<string, string> = { ...parsed.fields, ...fields }
  // 逐块拼、块间只插一个空行。不能用 `\n{3,}` 全局折叠：
  // 那会把用户在「备注」里写的分段空行一起吃掉（正文里的空行是有意义的）。
  const out: string[] = []
  const pushBlock = (lines: string[]) => {
    const body = lines.join("\n").trim()
    if (!body) return
    if (out.length > 0) out.push("")
    out.push(body)
  }

  const head: string[] = []
  if (parsed.frontmatter.trim()) head.push(parsed.frontmatter.trimEnd())
  if (parsed.title) head.push(`# ${parsed.title}`)
  if (parsed.preamble) head.push(parsed.preamble)
  pushBlock(head)

  for (const name of PERSONA_DOCUMENT_FIELDS) {
    const value = (merged[name] ?? "").trim()
    if (!value) continue
    pushBlock([`## ${name}`, "", value])
  }
  for (const extra of parsed.extras) {
    if (!extra.heading) {
      pushBlock([extra.body])
      continue
    }
    pushBlock([`## ${extra.heading}`, "", extra.body])
  }

  return `${out.join("\n").trimEnd()}\n`
}

export interface PersonaRelationLine {
  /** 关系另一端的人名。 */
  name: string
  /** 关系（对手 / 师父 / 未婚妻…）。 */
  relation: string
  /** 括注里的性质（权力斗争 / 利益 / 情感…），没有则为空串。 */
  nature: string
}

/**
 * 把「关系网」字段拆成一行一条。
 *
 * 模型写的形状很杂，实测至少有这三种：
 * `陆云飞：竞争对手（权力斗争）` / `- 陆云飞：竞争对手` / `陆云飞 - 师兄`。
 * 解析不出来的行**不丢**：整行当成人名+关系的粗文本交回界面，
 * 让用户自己看得到、改得动。只有空行会被跳过。
 */
export function parsePersonaRelations(text: string): PersonaRelationLine[] {
  const lines: PersonaRelationLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*·]\s*/, "")
    if (!line) continue
    const colon = line.search(/[：:]/)
    let name = ""
    let rest = ""
    if (colon > 0) {
      name = line.slice(0, colon).trim()
      rest = line.slice(colon + 1).trim()
    } else {
      const dash = line.search(/\s+[-—–]\s+/)
      if (dash > 0) {
        name = line.slice(0, dash).trim()
        rest = line.slice(dash).replace(/^\s*[-—–]\s*/, "").trim()
      }
    }
    if (!name) {
      lines.push({ name: line, relation: "", nature: "" })
      continue
    }
    const natureMatch = rest.match(/[（(]([^）)]*)[）)]/)
    lines.push({
      name,
      relation: rest.replace(/[（(][^）)]*[）)]/g, "").trim(),
      nature: natureMatch ? natureMatch[1].trim() : "",
    })
  }
  return lines
}

/** 「## 补充（截至第 N 章）」这类段：档案页把它单独作为「AI 追加观察」展示。 */
export function readPersonaSupplement(markdown: string): string {
  const parsed = splitPersonaSkillDocument(markdown)
  return parsed.extras
    .filter((block) => block.heading.startsWith(PERSONA_SUPPLEMENT_HEADING))
    .map((block) => block.body.trim())
    .filter(Boolean)
    .join("\n\n")
}
