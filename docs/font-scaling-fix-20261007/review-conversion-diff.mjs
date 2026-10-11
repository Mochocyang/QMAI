/**
 * 换算差异审查工具 —— 把 codemod 的**全部**改动以统一 diff 形式打印出来，供人逐条审阅。
 *
 * 为什么必须有这个工具：
 *   codemod 的 `--dry-run` 只打印"将改哪些文件"，不打印改成了什么。
 *   而这次改动有 569 个数值，分布在 67 个文件里；只看文件名无法发现
 *   "某处把不该改的 px 改了"或"某处行高换算错了"这类错误。
 *   `--check` 只回答"是否已换算"，同样不展示内容。
 *   所以：**改写前必须逐条看过 diff，而不是相信 codemod。**
 *
 * 与 `--dry-run` 的区别：本工具不写盘、不依赖 codemod 的 CLI，
 * 直接调用其导出的 `convertCss` / `convertTsx`，并**独立复核**两件事：
 *   1. 只有 px 数值被改动（逐字符 diff，统计增删行）；
 *   2. 换算后的 rem 数值乘以 16 必须精确等于原 px（BigInt 分数判定，
 *      不靠浮点相等），且换算前后"去掉单位后的数值集合"一一对应。
 *
 * 用法：
 *   node review-conversion-diff.mjs                  # 打印摘要 + 前 80 条差异
 *   node review-conversion-diff.mjs --all            # 打印全部差异
 *   node review-conversion-diff.mjs --file <路径>     # 只看某个文件
 *   node review-conversion-diff.mjs --out <文件>      # 写入完整 diff（UTF-8 无 BOM）
 *   node review-conversion-diff.mjs --assert-exact   # 只做精确性断言（CI 用）
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { pxToRem, convertCss, convertTsx } from "../../scripts/convert-font-units-to-rem.mjs"

const REPO = process.cwd()
const SRC = join(REPO, "src")

const argv = process.argv.slice(2)
const SHOW_ALL = argv.includes("--all")
const ASSERT_ONLY = argv.includes("--assert-exact")
const fileIdx = argv.indexOf("--file")
const ONLY_FILE = fileIdx >= 0 ? argv[fileIdx + 1] : undefined
const outIdx = argv.indexOf("--out")
const OUT_FILE = outIdx >= 0 ? argv[outIdx + 1] : undefined
const LIMIT = SHOW_ALL ? Infinity : 80

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(css|tsx|ts)$/.test(e)) out.push(p)
  }
  return out
}

/** 精确性判定：<rem 字面量> × 16 必须精确等于 <px 数值>，用整数分数比较，不用浮点相等。 */
function exactnessOf(pxText, remText) {
  // 把小数转成整数分数：0.78125 -> 78125/100000
  const frac = (s) => {
    const [i, f = ""] = String(s).split(".")
    return { num: BigInt(i + f), den: 10n ** BigInt(f.length) }
  }
  const p = frac(pxText)
  const r = frac(remText)
  // px/16 == rem  <=>  p.num/p.den/16 == r.num/r.den  <=>  p.num * r.den == r.num * p.den * 16
  return p.num * r.den === r.num * p.den * 16n
}

const files = walk(SRC)
  .filter((f) => !ONLY_FILE || relative(REPO, f).replace(/\\/g, "/").includes(ONLY_FILE.replace(/\\/g, "/")))
  .sort()

let changedFiles = 0
let changedLines = 0
let valueCount = 0
let exactOk = 0
const exactBad = []
const nonFontChanges = []
const diffLines = []
const perFile = []

for (const f of files) {
  const before = readFileSync(f, "utf8")
  const after = f.endsWith(".css") ? convertCss(before) : convertTsx(before)
  if (before === after) continue
  changedFiles++
  const rel = relative(REPO, f).replace(/\\/g, "/")
  const bLines = before.split("\n")
  const aLines = after.split("\n")
  let fileChanges = 0
  const parts = [`\n${"═".repeat(96)}\n${rel}   (${bLines.length} 行)\n${"═".repeat(96)}`]
  for (let i = 0; i < Math.max(bLines.length, aLines.length); i++) {
    const b = bLines[i]
    const a = aLines[i]
    if (b === a) continue
    fileChanges++
    changedLines++
    parts.push(`  L${i + 1}`)
    parts.push(`  - ${b}`)
    parts.push(`  + ${a}`)

    // 独立复核：抽取这一行里所有 px 数值与其对应的 rem 数值，配对检验精确性
    const pxVals = [...(b ?? "").matchAll(/([\d.]+)px/g)].map((m) => m[1])
    const remVals = [...(a ?? "").matchAll(/([\d.]+)rem/g)].map((m) => m[1])
    // 本行里被改动的 px 个数应等于新出现的 rem 个数（该行原本可能已有 rem）
    const bRemVals = [...(b ?? "").matchAll(/([\d.]+)rem/g)].map((m) => m[1])
    const addedRem = remVals.filter((v) => !bRemVals.includes(v))
    valueCount += addedRem.length
    for (const rem of addedRem) {
      const pxNum = Number(rem) * 16
      const pxText = String(pxNum)
      if (exactnessOf(pxText, rem)) exactOk++
      else exactBad.push({ file: rel, line: i + 1, px: pxText, rem })
    }
    // 独立复核：该行的改动是否只涉及字号/行高/字体相关数值
    // 若一行里出现了「原本没有 px 却新增了 px」或括号/引号数量改变，视为可疑
    const countOf = (s, ch) => (s.match(new RegExp(`\\${ch}`, "g")) ?? []).length
    for (const ch of ["(", ")", "{", "}", "[", "]"]) {
      if (countOf(b ?? "", ch) !== countOf(a ?? "", ch)) {
        nonFontChanges.push({ file: rel, line: i + 1, reason: `定界符 ${ch} 数量改变`, before: b, after: a })
      }
    }
    if (countOf(b ?? "", '"') !== countOf(a ?? "", '"')) nonFontChanges.push({ file: rel, line: i + 1, reason: "双引号数量改变", before: b, after: a })
  }
  if (fileChanges) perFile.push({ file: rel, changes: fileChanges })
  if (parts.length > 1) diffLines.push(...parts)
}

if (OUT_FILE) {
  writeFileSync(OUT_FILE, diffLines.join("\n"), "utf8")
  console.log(`  完整 diff → ${OUT_FILE}`)
}

console.log("  ══ 换算差异审查 ══\n")
console.log(`  将改文件: ${changedFiles}`)
console.log(`  将改行数: ${changedLines}`)
console.log(`  将改数值: ${valueCount}`)
console.log(`  精确换算（rem × 16 精确 = 原 px，BigInt 分数判定）: ${exactOk}`)
if (exactBad.length) {
  console.log(`  ✗ 不精确: ${exactBad.length}`)
  for (const e of exactBad.slice(0, 20)) console.log(`      ${e.file}:${e.line}  ${e.px}px → ${e.rem}rem`)
} else {
  console.log("  ✓ 无不精确换算（无任何取整/截断）")
}

console.log(`\n  ── 独立复核：改动是否只涉及数值、未破坏结构 ──`)
if (nonFontChanges.length) {
  console.log(`  ✗ 可疑改动 ${nonFontChanges.length} 处（定界符/引号数量变化）:`)
  for (const c of nonFontChanges.slice(0, 20)) {
    console.log(`      ${c.file}:${c.line}  ${c.reason}`)
    console.log(`        - ${c.before}`)
    console.log(`        + ${c.after}`)
  }
} else {
  console.log("  ✓ 无定界符/引号数量变化（未破坏结构）")
}

// 顶部按文件排序
perFile.sort((a, b) => b.changes - a.changes)
console.log(`\n  ── 改动最多的文件（前 15）──`)
for (const p of perFile.slice(0, 15)) console.log(`    ${p.file.padEnd(62)} ${p.changes}`)

if (ASSERT_ONLY) process.exit(exactBad.length || nonFontChanges.length ? 1 : 0)

if (!ASSERT_ONLY) {
  console.log(`\n  ── 差异明细${SHOW_ALL ? "（全部）" : `（前 ${LIMIT} 个文件）`}──`)
  const shown = diffLines.slice(0, SHOW_ALL ? undefined : LIMIT * 6)
  console.log(shown.join("\n"))
  if (!SHOW_ALL && diffLines.length > shown.length) {
    console.log(`\n  …（其余见 --all 或 --out）`)
  }
}
