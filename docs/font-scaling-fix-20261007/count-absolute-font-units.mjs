/**
 * 精确清点所有"绝对单位字号"位置 —— 这是字号修复的完整范围。
 *
 * 前几版只清点了 7 个 CSS 文件（262 处），漏掉了 tsx 里的 Tailwind 任意值
 * text-[13px]（编译为 font-size:13px，绝对单位，同样不缩放）。
 * 本脚本统一清点四类来源，避免再次漏项：
 *   1. CSS  font-size: Npx
 *   2. CSS  font: ... Npx/... 简写
 *   3. TSX  text-[Npx] 任意值
 *   4. TSX  inline style fontSize: Npx / "Npx"
 * 并区分"绝对单位"与"相对单位（rem/em/%）"——后者本就会缩放，无需改。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(process.cwd(), "src")

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(css|tsx|ts)$/.test(e)) out.push(p)
  }
  return out
}

const files = walk(SRC)
const hits = []
const rel = (f) => relative(process.cwd(), f).replace(/\\/g, "/")

for (const f of files) {
  const text = readFileSync(f, "utf8")
  const lines = text.split(/\r?\n/)
  const isCss = f.endsWith(".css")

  lines.forEach((line, i) => {
    const n = i + 1

    if (isCss) {
      for (const m of line.matchAll(/font-size:\s*([\d.]+)(px|rem|em|%)/g)) {
        hits.push({ file: rel(f), line: n, kind: m[2] === "px" ? "css-font-size-px" : "css-font-size-relative", value: m[1] + m[2], raw: line.trim() })
      }
      for (const m of line.matchAll(/\bfont:\s*([^;{}]*?)([\d.]+)(px|rem|em)(\s*\/\s*([\d.]+)(px|rem|em)?)?/g)) {
        const unit = m[3]
        hits.push({ file: rel(f), line: n, kind: unit === "px" ? "css-font-shorthand-px" : "css-font-shorthand-relative", value: m[2] + unit, raw: line.trim().slice(0, 80) })
      }
      for (const m of line.matchAll(/line-height:\s*([\d.]+)(px|rem|em)/g)) {
        hits.push({ file: rel(f), line: n, kind: m[2] === "px" ? "css-line-height-px" : "css-line-height-relative", value: m[1] + m[2], raw: line.trim().slice(0, 80) })
      }
    } else {
      // TSX: Tailwind 任意值
      for (const m of line.matchAll(/text-\[([\d.]+)(px|rem|em)\]/g)) {
        hits.push({ file: rel(f), line: n, kind: m[2] === "px" ? "tw-arbitrary-px" : "tw-arbitrary-relative", value: m[1] + m[2], raw: line.trim().slice(0, 80) })
      }
      // TSX: 内联 fontSize
      for (const m of line.matchAll(/fontSize:\s*["']([\d.]+)(px|rem|em)["']/g)) {
        hits.push({ file: rel(f), line: n, kind: m[2] === "px" ? "inline-fontSize-px" : "inline-fontSize-relative", value: m[1] + m[2], raw: line.trim().slice(0, 80) })
      }
      for (const m of line.matchAll(/fontSize:\s*([\d.]+)\s*[,}]/g)) {
        hits.push({ file: rel(f), line: n, kind: "inline-fontSize-number", value: m[1], raw: line.trim().slice(0, 80) })
      }
    }
  })
}

const byKind = {}
for (const h of hits) (byKind[h.kind] ??= []).push(h)

const ABSOLUTE = ["css-font-size-px", "css-font-shorthand-px", "css-line-height-px", "tw-arbitrary-px", "inline-fontSize-px"]
const RELATIVE = ["css-font-size-relative", "css-font-shorthand-relative", "css-line-height-relative", "tw-arbitrary-relative", "inline-fontSize-relative"]
const OTHER = ["inline-fontSize-number"]

console.log("  ══ 按类型 ══")
let absTotal = 0, relTotal = 0, otherTotal = 0
for (const k of [...ABSOLUTE, ...RELATIVE, ...OTHER]) {
  const v = byKind[k]
  if (!v) continue
  const tag = ABSOLUTE.includes(k) ? "【不缩放·需改】" : RELATIVE.includes(k) ? "【已缩放·无需改】" : "【需人工确认】"
  console.log(`    ${k.padEnd(30)} ${String(v.length).padStart(4)}  ${tag}`)
  if (ABSOLUTE.includes(k)) absTotal += v.length
  else if (RELATIVE.includes(k)) relTotal += v.length
  else otherTotal += v.length
}

console.log(`\n    绝对单位（不缩放，需改）合计: ${absTotal}`)
console.log(`    相对单位（已缩放，无需改）合计: ${relTotal}`)
console.log(`    其他（需确认）合计: ${otherTotal}`)
console.log(`    全部命中: ${hits.length}`)

// 绝对单位按文件聚合，取前 20
console.log("\n  ══ 需改的绝对单位 · 按文件（前 20）══")
const byFile = {}
for (const k of ABSOLUTE) for (const h of byKind[k] ?? []) byFile[h.file] = (byFile[h.file] ?? 0) + 1
for (const [f, c] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`    ${f.padEnd(64)} ${c}`)
}
console.log(`    文件数: ${Object.keys(byFile).length}`)

// px 取值分布
console.log("\n  ══ 需改的 px 取值分布 ══")
const dist = {}
for (const k of ABSOLUTE) for (const h of byKind[k] ?? []) {
  const num = h.value.replace(/px$/, "")
  dist[num] = (dist[num] ?? 0) + 1
}
const nums = Object.keys(dist).map(Number).sort((a, b) => b - a)
for (const v of nums) {
  const rem = (v / 16).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
  console.log(`    ${String(v).padStart(6)}px → ${(rem + "rem").padEnd(12)} ${String(dist[v]).padStart(4)} 处`)
}

// 写完整清单
const out = ["# 绝对单位字号/行高 · 完整清单", "", `生成时间: ${new Date().toISOString()}`, "", `需改（绝对单位）: ${absTotal} 处`, `无需改（相对单位）: ${relTotal} 处`, "", "| 文件 | 行 | 类型 | 值 | 原文 |", "|---|---|---|---|---|"]
for (const k of ABSOLUTE) for (const h of (byKind[k] ?? []).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  out.push(`| ${h.file} | ${h.line} | ${h.kind} | ${h.value} | \`${(h.raw ?? "").replace(/\|/g, "\\|").slice(0, 70)}\` |`)
}
writeFileSync(join(process.cwd(), "docs/font-scaling-fix-20261007/absolute-font-units.md"), out.join("\n"), "utf8")
console.log("\n  完整清单 → docs/font-scaling-fix-20261007/absolute-font-units.md")
