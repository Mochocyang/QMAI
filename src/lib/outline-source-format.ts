export type OutlineSourceFormat =
  | "color"
  | "underline"
  | "highlight"
  | "align"
  | "footnote"
  | "superscript"
  | "subscript"
  | "math"
  | "mermaid"

export interface OutlineSourcePayload {
  color?: string
  align?: "left" | "center" | "right"
  href?: string
  note?: string
  code?: string
}

export function applyOutlineSourceFormat(
  text: string,
  start: number,
  end: number,
  action: OutlineSourceFormat,
  payload: OutlineSourcePayload = {},
): { text: string; start: number; end: number } {
  const selected = text.slice(start, end)
  const fallback = selected.trim() || "文字"
  let inserted = fallback
  if (action === "color") {
    const color = /^#[0-9a-fA-F]{6}$/.test(payload.color ?? "") ? payload.color : "#b42318"
    inserted = `<span style="color:${color}">${fallback}</span>`
  } else if (action === "underline") inserted = `<u>${fallback}</u>`
  else if (action === "highlight") inserted = `==${fallback}==`
  else if (action === "align") inserted = `<p style="text-align:${payload.align ?? "left"}">${fallback}</p>`
  else if (action === "footnote") {
    const note = (payload.note ?? "备注").replace(/\s+/g, " ").trim() || "备注"
    const used = Array.from(text.matchAll(/\[\^(\d+)\]/g), (match) => Number(match[1]))
    const id = String(Math.max(0, ...used) + 1)
    inserted = `${fallback}[^${id}]\n\n[^${id}]: ${note}`
  } else if (action === "superscript") inserted = `<sup>${fallback}</sup>`
  else if (action === "subscript") inserted = `<sub>${fallback}</sub>`
  else if (action === "math") inserted = `$${fallback}$`
  else inserted = `\n\`\`\`mermaid\n${payload.code?.trim() || "graph TD\n  A[开始] --> B[结束]"}\n\`\`\`\n`
  const next = text.slice(0, start) + inserted + text.slice(end)
  return { text: next, start, end: start + inserted.length }
}

const COLOR = /^#[0-9a-fA-F]{6}$/
const ALIGN = /^(left|center|right)$/

export function outlineExtensionHtml(markdown: string): string {
  const withoutDanger = markdown
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
  return withoutDanger
    .replace(/<span style="color:(#[0-9a-fA-F]{6})">([\s\S]*?)<\/span>/g, (_match, color: string, body: string) =>
      COLOR.test(color) ? `⟨color:${color}⟩${body}⟨/color⟩` : body)
    .replace(/<u>([\s\S]*?)<\/u>/g, "⟨u⟩$1⟨/u⟩")
    .replace(/==([^=\n]+)==/g, "⟨mark⟩$1⟨/mark⟩")
    .replace(/<p style="text-align:(left|center|right)">([\s\S]*?)<\/p>/g, (_match, align: string, body: string) =>
      ALIGN.test(align) ? `⟨align:${align}⟩${body}⟨/align⟩` : body)
    .replace(/<sup>([\s\S]*?)<\/sup>/g, "⟨sup⟩$1⟨/sup⟩")
    .replace(/<sub>([\s\S]*?)<\/sub>/g, "⟨sub⟩$1⟨/sub⟩")
}

const TOKEN = /⟨(color:#[0-9a-fA-F]{6}|u|mark|align:(?:left|center|right)|sup|sub)⟩([\s\S]*?)⟨\/(color|u|mark|align|sup|sub)⟩/g

export function renderOutlineExtensionText(value: string): Array<string | { type: string; value: string; color?: string; align?: string }> {
  const nodes: Array<string | { type: string; value: string; color?: string; align?: string }> = []
  let cursor = 0
  for (const match of value.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(value.slice(cursor, index))
    const kind = match[1] ?? ""
    nodes.push({
      type: kind.startsWith("color:") ? "color" : kind.startsWith("align:") ? "align" : kind,
      value: match[2] ?? "",
      color: kind.startsWith("color:") ? kind.slice(6) : undefined,
      align: kind.startsWith("align:") ? kind.slice(6) : undefined,
    })
    cursor = index + match[0].length
  }
  if (cursor < value.length) nodes.push(value.slice(cursor))
  return nodes
}
