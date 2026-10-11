/**
 * 评估"字号改为 rem 后，容器尺寸仍是 px"导致的溢出风险。
 *
 * 逻辑：字号会随根字号放大，但若同一组件的容器高度/宽度是固定 px，
 * 放大到 150% 时文字就会被裁切或撑破布局。
 * 本脚本找出：
 *   - 固定高度（height / max-height）为 px 的规则，且其选择器与文本相关
 *   - 固定行高为 px 的规则（必须与字号同步改）
 *   - 单行截断（white-space:nowrap + overflow:hidden）且高度固定者 ← 最危险
 * 输出按风险排序，作为设计文档的依据。
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const FILES = [
  "src/components/novel/book-analysis-workbench.css",
  "src/components/uitest/models/model-settings.css",
  "src/components/uitest/ui-test-ai.css",
  "src/components/uitest/ui-test-editor.css",
  "src/components/uitest/ui-test-shelf.css",
  "src/components/uitest/ui-test-tools.css",
  "src/components/uitest/ui-test.css",
]

/** 把 CSS 按顶层规则粗切，得到 {selector, body} 列表（足够本用途）。 */
function splitRules(css) {
  // 去掉注释，避免注释里的花括号干扰
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "")
  const rules = []
  let depth = 0
  let start = 0
  let selectorStart = 0
  let currentSelector = ""
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (ch === "{") {
      if (depth === 0) currentSelector = clean.slice(selectorStart, i).trim()
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0) {
        rules.push({ selector: currentSelector, body: clean.slice(start, i + 1) })
        selectorStart = i + 1
      }
    } else if (ch === ";" && depth === 0) {
      selectorStart = i + 1
    }
  }
  return rules
}

const findings = []

for (const rel of FILES) {
  const abs = join(process.cwd(), rel)
  let css
  try { css = readFileSync(abs, "utf8") } catch { continue }
  const lines = css.split(/\r?\n/)

  for (const rule of splitRules(css)) {
    // 找该规则在原文中的行号
    const idx = css.indexOf(rule.selector)
    const lineNo = idx >= 0 ? css.slice(0, idx).split(/\r?\n/).length : 0

    const h = rule.body.match(/(?:^|[;{\s])(?:max-|min-)?height:\s*([\d.]+)px/)
    const w = rule.body.match(/(?:^|[;{\s])(?:max-|min-)?width:\s*([\d.]+)px/)
    const fs = rule.body.match(/font-size:\s*([\d.]+)px/)
    const lh = rule.body.match(/line-height:\s*([\d.]+)px/)
    const nowrap = /white-space:\s*nowrap/.test(rule.body)
    const clip = /overflow:\s*hidden/.test(rule.body)
    const ellipsis = /text-overflow:\s*ellipsis/.test(rule.body)

    if (fs || lh) {
      // 该规则的字号/行高要改；若同时有固定高度，则标记风险
      const risk = []
      if (h) risk.push(`固定高度 ${h[1]}px`)
      if (lh) risk.push(`px 行高 ${lh[1]}px 需同步改`)
      if (nowrap && clip) risk.push("单行截断")
      if (ellipsis) risk.push("省略号截断")
      findings.push({
        file: rel, line: lineNo, selector: rule.selector.slice(0, 70),
        fontSize: fs ? fs[1] : "-", lineHeightPx: lh ? lh[1] : "-",
        height: h ? h[1] : "-", width: w ? w[1] : "-",
        nowrap, clip, ellipsis, risk,
      })
    }
  }
}

const risky = findings.filter((f) => f.height !== "-" || (f.nowrap && f.clip))
console.log(`  含 px 字号/行高的规则: ${findings.length} 条`)
console.log(`  其中高度固定 px（放大后可能裁切）: ${risky.length} 条\n`)

console.log("  高风险：高度固定 + 单行截断（放大到 150% 最可能出问题）")
console.log("  " + "─".repeat(104))
for (const f of risky.filter((x) => x.nowrap && x.clip).sort((a, b) => Number(b.height) - Number(a.height))) {
  console.log(`  ${f.file.split("/").pop().padEnd(28)} L${String(f.line).padStart(4)}  h=${String(f.height).padStart(3)}px fs=${String(f.fontSize).padStart(4)}px  ${f.selector}`)
}

console.log("\n  中风险：高度固定但没有单行截断")
console.log("  " + "─".repeat(104))
for (const f of risky.filter((x) => !(x.nowrap && x.clip)).slice(0, 30)) {
  console.log(`  ${f.file.split("/").pop().padEnd(28)} L${String(f.line).padStart(4)}  h=${String(f.height).padStart(3)}px fs=${String(f.fontSize).padStart(4)}px  ${f.selector}`)
}

// 统计：有多少条规则同时有 px 行高（必须同步改为无单位）
const withLh = findings.filter((f) => f.lineHeightPx !== "-")
console.log(`\n  同时含 px 行高、必须同步改为无单位比值的规则: ${withLh.length} 条`)
for (const f of withLh) {
  const ratio = (Number(f.lineHeightPx) / Number(f.fontSize === "-" ? f.lineHeightPx : f.fontSize)).toFixed(2)
  console.log(`    ${f.file.split("/").pop().padEnd(28)} L${String(f.line).padStart(4)}  fs=${String(f.fontSize).padStart(4)} lh=${String(f.lineHeightPx).padStart(3)}  → 约 ${ratio}  ${f.selector.slice(0, 44)}`)
}
