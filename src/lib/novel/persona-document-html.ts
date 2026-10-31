/**
 * 人物档案 → 文档型 HTML（用于 MD 视图）。
 *
 * ── 为什么不用 Markdown 渲染 ──
 * 大纲（卷纲 / 章纲）在「HTML」模式下的观感是**文档**：正文居中限宽、
 * 衬线标题、字段名加粗后接正文、首行有缩进。人物档案直接用 Markdown 渲染时
 * 是另一套排版（h1/h2 特别大、没有居中列），两种视图放在同一个应用里不一致
 * （用户实测反馈）。
 *
 * 所以这里按大纲文档的样式产出一份自包含 HTML：结构与排版都对齐，
 * 表格里改一个字，右侧文档立刻跟着变。
 *
 * ── 为什么自带 <style> ──
 * 大纲 HTML 由生成器产出、自带样式；人物的这份没有生成器，就把同样的排版
 * 内联进来，保证在 iframe 里渲染结果一致，不受宿主页面样式影响。
 */
import { PERSONA_DOCUMENT_FIELDS } from "./persona-skill-types"

export interface PersonaDocumentInput {
  characterName: string
  roleType?: string
  fields: Record<string, string>
}

/** 转义，避免角色名或字段内容里的尖括号把文档结构冲掉。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const DOCUMENT_STYLE = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 30px 44px 48px;
    background: #fcfdfb;
    color: #273c35;
    font: 15px/1.95 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .doc { max-width: 880px; margin: 0 auto; }
  h1 {
    margin: 0 0 4px;
    font-family: "Songti SC", Georgia, "Times New Roman", serif;
    font-size: 1.375rem;
    font-weight: 600;
    letter-spacing: .04em;
    text-align: center;
  }
  .role {
    margin: 0 0 28px;
    color: #5d6e64;
    font-size: .8125rem;
    text-align: center;
  }
  h2 {
    margin: 26px 0 10px;
    font-family: "Songti SC", Georgia, "Times New Roman", serif;
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: .06em;
  }
  h2:first-of-type { margin-top: 0; }
  h2::after {
    content: "";
    display: block;
    width: 100%;
    height: 1px;
    margin-top: 6px;
    background: #dfe6da;
  }
  /* 字段行：整块左侧缩进，字段名加粗，与卷纲的「卷定位： …」同款 */
  .row {
    margin: 0 0 10px;
    padding-left: 1.6em;
  }
  .row > b {
    font-weight: 600;
    margin-right: .35em;
  }
  .row > span { white-space: pre-wrap; }
  .empty-note {
    margin: 26px 0 0;
    padding-top: 12px;
    border-top: 1px dashed #dfe6da;
    color: #5d6e64;
    font-size: .8125rem;
    line-height: 1.8;
  }
`

export function renderPersonaDocumentHtml(input: PersonaDocumentInput): string {
  const rows: string[] = []
  const empty: string[] = []

  for (const name of PERSONA_DOCUMENT_FIELDS) {
    const value = (input.fields[name] ?? "").trim()
    if (!value) {
      empty.push(name)
      continue
    }
    rows.push(
      `<p class="row"><b>${escapeHtml(name)}：</b><span>${escapeHtml(value)}</span></p>`,
    )
  }

  const note = (input.fields["备注"] ?? "").trim()
  if (note) {
    rows.push(`<p class="row"><b>备注：</b><span>${escapeHtml(note)}</span></p>`)
  } else {
    empty.push("备注")
  }

  const role = (input.roleType ?? "").trim()
  const emptyBlock =
    empty.length > 0
      ? `<p class="empty-note">还没填的字段：${escapeHtml(empty.join("、"))}</p>`
      : ""

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>${DOCUMENT_STYLE}</style>
</head>
<body>
<div class="doc">
<h1>${escapeHtml(input.characterName)} · 人物 Skill</h1>
${role ? `<p class="role">${escapeHtml(role)}</p>` : ""}
${rows.join("\n")}
${emptyBlock}
</div>
</body>
</html>`
}
