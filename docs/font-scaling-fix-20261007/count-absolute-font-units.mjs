/**
 * 精确清点所有"绝对单位字号"位置 —— 这是字号修复的完整范围。
 *
 * 前几版只清点了 7 个 CSS 文件（262 处），漏掉了 tsx 里的 Tailwind 任意值
 * text-[13px]（编译为 font-size:13px，绝对单位，同样不缩放）。
 * 本脚本统一清点五类来源，避免再次漏项：
 *   1. CSS  font-size: Npx
 *   2. CSS  font: ... Npx/... 简写（字号与行高**分别**计数，故有"声明处数/数值个数"两个口径）
 *   3. CSS  经自定义属性间接传递的 px 尺寸（如 --x: 28px 被 line-height: var(--x) 使用）
 *          —— 这是第四类，2026-10-08 任务 2 执行时实测发现：codemod 只认字面量 px，
 *             看不见 line-height: var(--x)，导致换算后仍有 11 个元素行高不缩放。
 *   4. TSX  text-[Npx] 任意值
 *   5. TSX  inline style fontSize: Npx / "Npx"，以及 SVG 的 fontSize="N" 属性
 *          —— SVG 属性无单位后缀，且不参与排版（图标几何），故单独归类并要求显式登记。
 * 并区分"绝对单位"与"相对单位（rem/em/%）"——后者本就会缩放，无需改。
 *
 * ── 本脚本的三处已知缺陷（2026-10-08 修复，均有自检对照）──
 *   (a) 旧版用 (v/16).toFixed(4) 显示 rem，把 12.5px 截断成 0.7813rem（正确为 0.78125rem）。
 *       现改为 BigInt 精确长除法，并用 --selftest 断言"12.5px → 0.78125rem"。
 *   (b) 旧版正则只匹配 `fontSize:` 冒号形式，看不见 SVG 的 `fontSize="N"` 属性。
 *       现新增 svg-fontSize-attribute 类，实测应为 2 处（context-usage-ring、provider-brand-icon）。
 *   (c) 旧版把 557 处"声明"与 569 个"数值"混为一谈（差值恰为 12 处 font 简写同时带
 *       px 字号与 px 行高）。现分两列分别打印，不再用一个数字含糊。
 *
 * ── 用法 ──
 *   node count-absolute-font-units.mjs            清点并写 absolute-font-units.md
 *   node count-absolute-font-units.mjs --selftest 只跑内置对照（不读仓库），证明本尺子可信
 *   退出码：绝对单位 > 0，或出现"未登记且影响文字布局"的 px 自定义属性 → 1；否则 0。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(process.cwd(), "src")

/**
 * 精确 px→rem（纯除以 16），**不丢精度**。
 * 旧版用 toFixed(4)，把 12.5px 显示成 0.7813rem —— 因为 12.5/16 = 0.78125 是 5 位小数。
 * 所有取值都是 0.5 的整数倍，故除以 16 后分母只含因子 2，十进制必然有限，可精确展开。
 */
export function pxToRemExact(px) {
  const s = String(px).trim()
  const neg = s.startsWith("-")
  const body = neg ? s.slice(1) : s
  const [int, frac = ""] = body.split(".")
  const digits = (int || "0") + frac
  const scale = frac.length
  const num = BigInt(digits)
  const den = BigInt(10) ** BigInt(scale) * 16n
  const g = (a, b) => (b === 0n ? a : g(b, a % b))
  const gg = g(num, den)
  const n2 = num / gg
  const d2 = den / gg
  const intPart = n2 / d2
  let rem = n2 % d2
  let out = String(intPart)
  if (rem !== 0n) {
    out += "."
    let guard = 0
    while (rem !== 0n && guard++ < 40) {
      rem *= 10n
      out += String(rem / d2)
      rem %= d2
    }
  }
  return (neg ? "-" : "") + out
}

/** 影响文字排版（行盒 / 文字容器）的属性 —— 这些属性上的 px 会让界面字号失效。 */
const TEXT_AFFECTING_PROPS = new Set(["line-height", "font-size", "font", "height", "min-height", "max-height"])

/**
 * 刻意保留为 px 的自定义属性白名单（每项都必须写明理由）。
 * 判据：该值是否参与**文字布局**。纯外部间距不影响字号生效，故可保留 px。
 * 新增白名单条目必须在此处写明理由，否则 --check 会失败 —— 防止"随手加进白名单"变成新的静默漏洞。
 */
const PX_VAR_ALLOWLIST = new Map([
  ["--ui-heading-top", "纯外部留白（只用于 padding/padding-top），不参与文字布局；界面字号放大时留白保持不变是刻意选择"],
  ["--radius", "圆角，与文字无关"],
])

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(css|tsx|ts)$/.test(e)) out.push(p)
  }
  return out
}

const rel = (f) => relative(process.cwd(), f).replace(/\\/g, "/")

/** 纯函数：从一批文件内容里清点全部命中。拆出来是为了 --selftest 能喂假数据。 */
export function collect(filesWithText) {
  const hits = []
  const varDefs = new Map()   // name -> [{file,line,px}]
  const varUses = new Map()   // name -> [{file,line,prop,text}]

  for (const { file, text } of filesWithText) {
    const isCss = file.endsWith(".css")
    const lines = text.split(/\r?\n/)
    let declSeq = 0

    lines.forEach((line, i) => {
      const n = i + 1

      if (isCss) {
        for (const m of line.matchAll(/font-size:\s*([\d.]+)(px|rem|em|%)/g)) {
          hits.push({ file, line: n, kind: m[2] === "px" ? "css-font-size-px" : "css-font-size-relative", value: m[1] + m[2], raw: line.trim(), decl: `${file}:${n}:fs:${declSeq++}` })
        }
        // font 简写：字号与行高分别计数（旧版只记字号，导致 557/569 口径混淆）
        for (const m of line.matchAll(/\bfont:\s*([^;{}]*?)([\d.]+)(px|rem|em)(\s*\/\s*([\d.]+)(px|rem|em)?)?/g)) {
          const decl = `${file}:${n}:font:${declSeq++}`
          const u1 = m[3]
          hits.push({ file, line: n, kind: u1 === "px" ? "css-font-shorthand-px" : "css-font-shorthand-relative", value: m[2] + u1, raw: line.trim().slice(0, 80), decl, part: "font-size" })
          if (m[5] !== undefined && m[6] !== undefined) {
            const u2 = m[6]
            hits.push({ file, line: n, kind: u2 === "px" ? "css-font-shorthand-lh-px" : "css-font-shorthand-lh-relative", value: m[5] + u2, raw: line.trim().slice(0, 80), decl, part: "line-height" })
          }
        }
        for (const m of line.matchAll(/line-height:\s*([\d.]+)(px|rem|em)/g)) {
          hits.push({ file, line: n, kind: m[2] === "px" ? "css-line-height-px" : "css-line-height-relative", value: m[1] + m[2], raw: line.trim().slice(0, 80), decl: `${file}:${n}:lh:${declSeq++}` })
        }
        // 第 3 类：px 取值的自定义属性定义
        for (const m of line.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([\d.]+)px/g)) {
          if (!varDefs.has(m[1])) varDefs.set(m[1], [])
          varDefs.get(m[1]).push({ file, line: n, px: m[2] })
        }
      } else {
        for (const m of line.matchAll(/text-\[([\d.]+)(px|rem|em)\]/g)) {
          hits.push({ file, line: n, kind: m[2] === "px" ? "tw-arbitrary-px" : "tw-arbitrary-relative", value: m[1] + m[2], raw: line.trim().slice(0, 80), decl: `${file}:${n}:tw:${declSeq++}` })
        }
        for (const m of line.matchAll(/fontSize:\s*["']([\d.]+)(px|rem|em)["']/g)) {
          hits.push({ file, line: n, kind: m[2] === "px" ? "inline-fontSize-px" : "inline-fontSize-relative", value: m[1] + m[2], raw: line.trim().slice(0, 80), decl: `${file}:${n}:ifz:${declSeq++}` })
        }
        for (const m of line.matchAll(/fontSize:\s*([\d.]+)\s*[,}]/g)) {
          hits.push({ file, line: n, kind: "inline-fontSize-number", value: m[1], raw: line.trim().slice(0, 80), decl: `${file}:${n}:ifzn:${declSeq++}` })
        }
        // 缺陷 (b)：SVG 的 fontSize="N" 属性（无单位，不属于字号缩放目标，但必须看得见）
        for (const m of line.matchAll(/fontSize=["']([\d.]+)["']/g)) {
          hits.push({ file, line: n, kind: "svg-fontSize-attribute", value: m[1], raw: line.trim().slice(0, 80), decl: `${file}:${n}:svg:${declSeq++}` })
        }
      }
    })

    // 自定义属性的使用点：按"声明"而非"行"解析，才能跨行/跨多值找到消费者
    if (isCss) {
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "")
      for (const m of stripped.matchAll(/([a-z-]+)\s*:\s*([^;{}]*)/g)) {
        const prop = m[1]
        const val = m[2]
        for (const vm of val.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
          if (!varUses.has(vm[1])) varUses.set(vm[1], [])
          varUses.get(vm[1]).push({ file, line: stripped.slice(0, m.index).split("\n").length, prop, text: `${prop}: ${val.trim().slice(0, 80)}` })
        }
      }
    }
  }

  return { hits, varDefs, varUses }
}

/** 汇总"经变量间接传递的 px"中影响文字布局、且未登记白名单的项。 */
export function indirectPxProblems(varDefs, varUses) {
  const problems = []
  const registry = []
  for (const [name, defs] of varDefs) {
    const uses = varUses.get(name) ?? []
    const textProps = [...new Set(uses.map((u) => u.prop))].filter((p) => TEXT_AFFECTING_PROPS.has(p))
    const allow = PX_VAR_ALLOWLIST.get(name)
    const entry = { name, px: defs[0].px, def: defs[0], uses, textProps, allow }
    registry.push(entry)
    if (textProps.length > 0 && !allow) problems.push(entry)
    if (allow && textProps.length > 0 && !/留白|圆角|与文字无关/.test(allow)) problems.push({ ...entry, reason: "白名单理由未说明为何不影响文字布局" })
  }
  return { registry, problems }
}

// ─────────────────────────── 自检 ───────────────────────────
function selftest() {
  let pass = 0
  let fail = 0
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`    ✓ ${name}`) }
    else { fail++; console.log(`    ✗ ${name}\n        实得 ${JSON.stringify(got)}\n        期望 ${JSON.stringify(want)}`) }
  }

  console.log("  ══ 尺子自检：先证明它可信，再拿它量东西 ══\n")
  console.log("  ── (a) px→rem 必须精确（旧版 toFixed(4) 会截断）──")
  eq("12.5px → 0.78125rem（旧版错报 0.7813）", pxToRemExact(12.5), "0.78125")
  eq("16px → 1rem", pxToRemExact(16), "1")
  eq("13px → 0.8125rem", pxToRemExact(13), "0.8125")
  eq("9px → 0.5625rem", pxToRemExact(9), "0.5625")
  eq("19px → 1.1875rem", pxToRemExact(19), "1.1875")
  eq("100px → 6.25rem", pxToRemExact(100), "6.25")
  eq("1px → 0.0625rem", pxToRemExact(1), "0.0625")

  console.log("\n  ── (b) 必须看得见 SVG 的 fontSize=\"N\" 属性 ──")
  const svgFixture = [{ file: "a.tsx", text: `<svg><text fontSize="7">x</text><text fontSize="13.5">y</text></svg>` }]
  const svgHits = collect(svgFixture).hits.filter((h) => h.kind === "svg-fontSize-attribute")
  eq("两条 fontSize=\"N\" 全部命中", svgHits.map((h) => h.value), ["7", "13.5"])
  eq("只匹配属性形式，不误吞 fontSize: 冒号形式", collect([{ file: "b.tsx", text: `<i style={{ fontSize: "12px" }} />` }]).hits.filter((h) => h.kind === "svg-fontSize-attribute").length, 0)

  console.log("\n  ── (c) 声明处数 与 数值个数 必须分开（差值 = 带 px 行高的 font 简写）──")
  const c1 = collect([{ file: "c.css", text: `.a { font: 14px/22px var(--ui); }` }])
  eq("font 简写同时产出一个声明、两个数值", [new Set(c1.hits.map((h) => h.decl)).size, c1.hits.length], [1, 2])
  const c2 = collect([{ file: "d.css", text: `.a { font: 14px/1.7 var(--ui); }` }])
  eq("无单位行高只算一个数值（行高不缩放，属正常）", [new Set(c2.hits.map((h) => h.decl)).size, c2.hits.length], [1, 1])

  console.log("\n  ── (d) 经变量间接传递的 px 必须被发现（本次实测漏项的那一类）──")
  const d1 = collect([{ file: "e.css", text: `.r { --h: 28px; } .u { line-height: var(--h); }` }])
  const d1p = indirectPxProblems(d1.varDefs, d1.varUses)
  eq("line-height 消费的 px 变量被判为问题", d1p.problems.map((p) => p.name), ["--h"])
  const d2 = collect([{ file: "f.css", text: `.r { --top: 22px; } .u { padding: var(--top) 10px; }` }])
  eq("纯 padding 消费的 px 变量同样需人工确认（进 registry）", indirectPxProblems(d2.varDefs, d2.varUses).registry.map((r) => r.name), ["--top"])
  const d3 = collect([{ file: "g.css", text: `.r { --h: 1.75rem; } .u { line-height: var(--h); }` }])
  eq("已是 rem 的变量不算问题（负向对照）", indirectPxProblems(d3.varDefs, d3.varUses).problems.length, 0)
  const d4 = collect([{ file: "h.css", text: `.r { --c: #fff; } .u { color: var(--c); }` }])
  eq("非 px 变量不算问题（负向对照）", indirectPxProblems(d4.varDefs, d4.varUses).problems.length, 0)

  console.log(`\n  自检结果: ${pass} 通过 / ${fail} 失败`)
  return fail === 0
}

if (process.argv.includes("--selftest")) {
  process.exit(selftest() ? 0 : 1)
}

// ─────────────────────────── 主流程 ───────────────────────────
const files = walk(SRC)
const filesWithText = files.map((f) => ({ file: rel(f), text: readFileSync(f, "utf8") }))
const { hits, varDefs, varUses } = collect(filesWithText)

const byKind = {}
for (const h of hits) (byKind[h.kind] ??= []).push(h)

const ABSOLUTE = ["css-font-size-px", "css-font-shorthand-px", "css-font-shorthand-lh-px", "css-line-height-px", "tw-arbitrary-px", "inline-fontSize-px"]
const RELATIVE = ["css-font-size-relative", "css-font-shorthand-relative", "css-font-shorthand-lh-relative", "css-line-height-relative", "tw-arbitrary-relative", "inline-fontSize-relative"]
const OTHER = ["inline-fontSize-number", "svg-fontSize-attribute"]

console.log("  ══ 按类型 ══")
let absTotal = 0, relTotal = 0, otherTotal = 0
for (const k of [...ABSOLUTE, ...RELATIVE, ...OTHER]) {
  const v = byKind[k]
  if (!v) continue
  const tag = ABSOLUTE.includes(k) ? "【不缩放·需改】" : RELATIVE.includes(k) ? "【已缩放·无需改】" : "【需人工确认】"
  console.log(`    ${k.padEnd(34)} ${String(v.length).padStart(4)}  ${tag}`)
  if (ABSOLUTE.includes(k)) absTotal += v.length
  else if (RELATIVE.includes(k)) relTotal += v.length
  else otherTotal += v.length
}

// (c) 两个口径分列 —— 声明处数 ≠ 数值个数，差值恰为"同时带 px 字号与 px 行高"的 font 简写
const declCount = new Set(hits.map((h) => h.decl)).size
console.log(`\n    声明处数（去重后的 CSS/TSX 声明）: ${declCount}`)
console.log(`    数值个数（字号/行高等单个数值）  : ${hits.length}`)
console.log(`    两者差值                        : ${hits.length - declCount}  （即 font 简写同时带 px 字号与 px 行高的处数）`)
console.log(`\n    绝对单位（不缩放，需改）合计: ${absTotal}`)
console.log(`    相对单位（已缩放，无需改）合计: ${relTotal}`)
console.log(`    其他（需确认）合计: ${otherTotal}`)
console.log(`    全部命中: ${hits.length}`)

// 第 3 类：经变量间接传递
const { registry, problems } = indirectPxProblems(varDefs, varUses)
console.log("\n  ══ 经自定义属性间接传递的 px（codemod 看不见，必须人工核对）══")
if (registry.length === 0) console.log("    （无）")
for (const r of registry.sort((a, b) => a.name.localeCompare(b.name))) {
  const props = r.uses.length ? [...new Set(r.uses.map((u) => u.prop))].join(", ") : "(无消费者 · 可能是死变量)"
  const verdict = r.allow ? `已登记白名单：${r.allow}` : r.textProps.length ? "★ 影响文字布局，未登记白名单 → 必须改 rem" : "影响文字布局的消费者：无"
  console.log(`    ${r.name.padEnd(24)} = ${r.px}px   定义 ${r.def.file}:${r.def.line}`)
  console.log(`        消费属性: ${props}`)
  console.log(`        判定: ${verdict}`)
}
if (problems.length > 0) {
  console.log(`\n    ✗ 需处理 ${problems.length} 个：`)
  for (const p of problems) console.log(`        ${p.name} = ${p.px}px（${p.textProps.join(", ")}）${p.reason ? " · " + p.reason : ""}`)
}

// 绝对单位按文件聚合，取前 20
console.log("\n  ══ 需改的绝对单位 · 按文件（前 20）══")
const byFile = {}
for (const k of ABSOLUTE) for (const h of byKind[k] ?? []) byFile[h.file] = (byFile[h.file] ?? 0) + 1
for (const [f, c] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`    ${f.padEnd(64)} ${c}`)
}
console.log(`    文件数: ${Object.keys(byFile).length}`)

// px 取值分布（精确 rem）
console.log("\n  ══ 需改的 px 取值分布（rem 为精确值，非截断）══")
const dist = {}
for (const k of ABSOLUTE) for (const h of byKind[k] ?? []) {
  const num = h.value.replace(/px$/, "")
  dist[num] = (dist[num] ?? 0) + 1
}
const nums = Object.keys(dist).map(Number).sort((a, b) => b - a)
for (const v of nums) {
  console.log(`    ${String(v).padStart(6)}px → ${(pxToRemExact(v) + "rem").padEnd(12)} ${String(dist[v]).padStart(4)} 处`)
}

// 写完整清单
const out = ["# 绝对单位字号/行高 · 完整清单", "", `生成时间: ${new Date().toISOString()}`, "",
  `需改（绝对单位）: ${absTotal} 个数值（${declCount} 处声明；差值 ${hits.length - declCount} 为 font 简写的行高部分）`,
  `无需改（相对单位）: ${relTotal} 个数值`, "",
  "## 经自定义属性间接传递的 px（codemod 看不见）", "",
  "| 变量 | 值 | 定义处 | 消费属性 | 判定 |", "|---|---|---|---|---|"]
for (const r of registry.sort((a, b) => a.name.localeCompare(b.name))) {
  const props = r.uses.length ? [...new Set(r.uses.map((u) => u.prop))].join(", ") : "(无消费者)"
  const verdict = r.allow ? `白名单：${r.allow}` : r.textProps.length ? "★ 未登记，须改 rem" : "无文字布局消费者"
  out.push(`| \`${r.name}\` | ${r.px}px | ${r.def.file}:${r.def.line} | ${props} | ${verdict} |`)
}
out.push("", "## 需改清单", "", "| 文件 | 行 | 类型 | 值 | 原文 |", "|---|---|---|---|---|")
for (const k of ABSOLUTE) for (const h of (byKind[k] ?? []).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  out.push(`| ${h.file} | ${h.line} | ${h.kind} | ${h.value} | \`${(h.raw ?? "").replace(/\|/g, "\\|").slice(0, 70)}\` |`)
}
writeFileSync(join(process.cwd(), "docs/font-scaling-fix-20261007/absolute-font-units.md"), out.join("\n"), "utf8")
console.log("\n  完整清单 → docs/font-scaling-fix-20261007/absolute-font-units.md")

// 结论与退出码：让本脚本成为可判定的关卡，而不是只打印数字
const ok = absTotal === 0 && problems.length === 0
console.log(`\n  结论: 绝对单位 ${absTotal} 个 / 未登记的间接 px ${problems.length} 个 → ${ok ? "✓ 通过（换算完整）" : "✗ 未通过（换算不完整）"}`)
process.exit(ok ? 0 : 1)
