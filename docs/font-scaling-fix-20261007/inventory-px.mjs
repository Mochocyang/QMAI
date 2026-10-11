/**
 * 精确盘点需要改动的 px 字号 / 行高，并给出每一处的上下文。
 *
 * 为什么需要精确清单：160 处 px 字号分散在 7 个文件、取值范围 10–32px，
 * 不能机械全局替换 —— 有些 px 是图标/装饰尺寸（改动会破坏布局），
 * 有些是正文行高（必须与字号同步改，否则放大后行距会挤）。
 * 这份清单是设计文档里"改动边界"的依据。
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(process.cwd(), "src")

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e.endsWith(".css")) out.push(p)
  }
  return out
}

const files = walk(SRC)
const rows = []

for (const f of files) {
  const text = readFileSync(f, "utf8")
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    // font-size: Npx  或 font: <weight> Npx/<lh> family
    const fs = [...line.matchAll(/font-size:\s*([\d.]+)px/g)]
    for (const m of fs) {
      rows.push({ file: relative(process.cwd(), f), line: i + 1, kind: "font-size", value: Number(m[1]), raw: line.trim() })
    }
    const shorthand = [...line.matchAll(/\bfont:\s*([^;]*?)([\d.]+)px\s*\/\s*([\d.]+)(px)?/g)]
    for (const m of shorthand) {
      rows.push({ file: relative(process.cwd(), f), line: i + 1, kind: "font-shorthand", value: Number(m[2]), raw: line.trim() })
      // 记录其行高单位：px 行高需一并改为无单位
      if (m[4] === "px") {
        rows.push({ file: relative(process.cwd(), f), line: i + 1, kind: "line-height(px)", value: Number(m[3]), raw: line.trim() })
      }
    }
    const lh = [...line.matchAll(/line-height:\s*([\d.]+)px/g)]
    for (const m of lh) {
      rows.push({ file: relative(process.cwd(), f), line: i + 1, kind: "line-height(px)", value: Number(m[1]), raw: line.trim() })
    }
  })
}

const byKind = {}
for (const r of rows) (byKind[r.kind] ??= []).push(r)

console.log("  按类型统计：")
for (const [k, v] of Object.entries(byKind)) {
  console.log(`    ${k.padEnd(18)} ${String(v.length).padStart(3)} 处   取值 ${Math.min(...v.map((x) => x.value))}–${Math.max(...v.map((x) => x.value))}px`)
}
console.log(`    合计               ${String(rows.length).padStart(3)} 处`)

console.log("\n  按文件统计：")
const byFile = {}
for (const r of rows) ((byFile[r.file] ??= {}))[r.kind] = ((byFile[r.file][r.kind] ?? 0) + 1)
for (const [f, kinds] of Object.entries(byFile).sort()) {
  const total = Object.values(kinds).reduce((a, b) => a + b, 0)
  const detail = Object.entries(kinds).map(([k, n]) => `${k}=${n}`).join(" ")
  console.log(`    ${f.replace(/\\/g, "/").padEnd(46)} ${String(total).padStart(3)}   ${detail}`)
}

// 只有 font-size / font-shorthand 才是"字号"，line-height 是配套项
const fontSizeRows = byKind["font-size"] ?? []
const shorthandRows = byKind["font-shorthand"] ?? []
console.log(`\n  纯 font-size 声明: ${fontSizeRows.length} 处`)
console.log(`  font 简写含字号  : ${shorthandRows.length} 处`)
console.log(`  → 需要改字号的共 ${fontSizeRows.length + shorthandRows.length} 处`)

console.log("\n  font-size 取值分布（决定能否用统一系数换算）：")
const dist = {}
for (const r of fontSizeRows) dist[r.value] = (dist[r.value] ?? 0) + 1
for (const v of Object.keys(dist).map(Number).sort((a, b) => b - a)) {
  console.log(`    ${String(v).padStart(3)}px → ${String(dist[v]).padStart(3)} 处`)
}

// 输出完整清单到文件，供设计文档引用
const out = ["# px 字号/行高完整清单", "", `生成时间: ${new Date().toISOString()}`, `合计 ${rows.length} 处`, ""]
out.push("| 文件 | 行 | 类型 | 值 | 原文 |", "|---|---|---|---|---|")
for (const r of rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  out.push(`| ${r.file.replace(/\\/g, "/")} | ${r.line} | ${r.kind} | ${r.value} | \`${r.raw.replace(/\|/g, "\\|").slice(0, 90)}\` |`)
}
const outPath = join(process.cwd(), "docs/font-scaling-fix-20261007/px-inventory.md")
const { writeFileSync } = await import("node:fs")
writeFileSync(outPath, out.join("\n"), "utf8")
console.log(`\n  完整清单已写入 docs/font-scaling-fix-20261007/px-inventory.md`)
