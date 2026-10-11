/**
 * 静态预判"字号放大后被裁切"的高风险规则 —— 给任务 3 一份定点排查清单。
 *
 * 为什么需要静态预判（而不是只靠浏览器实测）：
 *   溢出实测只能在**可达页面**上发现问题。编辑器、工具页、各类对话框在浏览器里
 *   大多不可达（已实测：编辑器 DOM 在 11 个分区的采集里命中数为 0），
 *   而这些地方恰恰大量使用 `font: Npx/Mpx` 这种"行高写死"的简写。
 *   静态分析不受可达性限制，可把风险点全部列出交给真实 exe 目视确认。
 *
 * 判定口径（只找"结构性"的高风险，不猜）：
 *   在**同一条 CSS 规则块**内（按花括号配对切分，不是按行 —— 很多规则是多行的，
 *   只看单行会漏），若同时满足
 *     A. 绝对 px 行高 —— 来自 `font: ... Npx/Mpx` 简写，或 `line-height: Npx`；
 *     B. 固定 px 高度 —— `height` / `min-height` / `max-height`；
 *     C. 放大到目标倍数后行高 > 该高度；
 *   则高风险（是否真裁切取决于 overflow 与是否表单控件；input/textarea 默认裁切，
 *   弹性容器可能只是撑开）。
 *
 * 为什么这条风险换算解决不了：
 *   `height` 不是字号，不在换算范围内、**换算不会改变它**。这是"字号缩放 ×
 *   固定容器尺寸"的固有矛盾，必须靠容器侧解决（高度也改 rem，或用
 *   min-height + 不裁切 + 自适应对齐）。
 *
 * 用法：
 *   node predict-clipping-risk.mjs                # 摘要 + 全部高风险规则
 *   node predict-clipping-risk.mjs --json         # 机器可读
 *   node predict-clipping-risk.mjs --threshold 130
 *   node predict-clipping-risk.mjs --selftest     # 自检：证明本工具确实能检出风险
 *
 * ⚠️ 为什么必须有 --selftest：
 *   本工具在真实代码上只报出很少几条（当前 2 条规则）。"报得少"既可能是
 *   真的健壮，也可能是**分析器失灵**。二者无法从结果本身区分，
 *   所以必须用合成样本证明它在该报的时候一定会报 ——
 *   一个只会说"没问题"的检查器比没有检查器更危险。
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const REPO = process.cwd()
const SRC = join(REPO, "src")
const argv = process.argv.slice(2)
const AS_JSON = argv.includes("--json")
const tIdx = argv.indexOf("--threshold")
const SCALE = (tIdx >= 0 ? Number(argv[tIdx + 1]) : 150) / 100

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e.endsWith(".css")) out.push(p)
  }
  return out
}

/** 按花括号配对把 CSS 切成规则块，并保留每条声明所在的行号。 */
function parseRules(text) {
  const rules = []
  let depth = 0
  let blockStart = -1
  let selectorStart = 0
  const lineOf = (idx) => text.slice(0, idx).split("\n").length

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "{") {
      if (depth === 0) {
        rules.push({ selector: text.slice(selectorStart, i).trim().replace(/\s+/g, " ").slice(-160), bodyStart: i + 1 })
        blockStart = i + 1
      }
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0 && rules.length) {
        const r = rules[rules.length - 1]
        r.body = text.slice(r.bodyStart, i)
        r.startLine = lineOf(r.bodyStart)
        r.selector = text.slice(selectorStart, r.bodyStart - 1).trim().replace(/\s+/g, " ")
        // 选择器可能很长，保留尾部（含关键类名）与完整文本
        selectorStart = i + 1
      }
    } else if (ch === ";" && depth === 0) {
      selectorStart = i + 1
    }
  }
  return rules.filter((r) => r.body !== undefined)
}

/** 从一段 CSS 文本里找出高风险规则（供主流程与自检共用）。 */
function findRisks(text, rel, SCALE) {
  const risks = []
  for (const rule of parseRules(text)) {
    const body = rule.body.replace(/\s+/g, " ")

    // A. 规则内的"有效行高"（px）。三种来源都要算，否则会漏掉一大类：
    //    A1 `font: … Npx/Mpx` 简写里的 px 行高
    //    A2 `line-height: Mpx`
    //    A3 `line-height: <无单位比值>`（或 font 简写 `…/1.6`）× 该规则的字号
    //       —— 无单位行高同样随字号缩放，1489 处 Tailwind text-* 就是这种，
    //          若只找 px 行高，会把"固定高度 + 无单位行高"这一类全漏掉。
    let lineHeightPx = null
    let lhSource = null
    const shorthand = body.match(/\bfont:\s*[^;{}]*?([\d.]+)px\s*\/\s*([\d.]+)(px)?/)
    if (shorthand && shorthand[3] === "px") {
      lineHeightPx = Number(shorthand[2]); lhSource = "font 简写 px 行高"
    } else {
      const lhDeclPx = body.match(/line-height:\s*([\d.]+)px/)
      if (lhDeclPx) { lineHeightPx = Number(lhDeclPx[1]); lhSource = "line-height px" }
      else {
        // 无单位比值：来自 line-height: 1.6 或 font 简写 …/1.6
        let ratio = null
        const lhRatio = body.match(/line-height:\s*([\d.]+)(?!\s*(px|rem|em|%))/)
        if (lhRatio) ratio = Number(lhRatio[1])
        const shRatio = body.match(/\bfont:\s*[^;{}]*?[\d.]+(?:px|rem)\s*\/\s*([\d.]+)(?!\s*(px|rem|em|%))/)
        if (shRatio) ratio = Number(shRatio[1])
        // 该规则的字号（px），无则视为 16px（根字号）
        let fontSizePx = 16
        const fsPx = body.match(/font-size:\s*([\d.]+)px/)
        if (fsPx) fontSizePx = Number(fsPx[1])
        else {
          const shFs = body.match(/\bfont:\s*[^;{}]*?([\d.]+)px\s*\//)
          if (shFs) fontSizePx = Number(shFs[1])
        }
        if (ratio !== null) { lineHeightPx = ratio * fontSizePx; lhSource = `无单位行高 ${ratio} × 字号 ${fontSizePx}px` }
      }
    }
    if (lineHeightPx === null) continue

    // B. 规则内的固定 px 高度
    const heights = []
    for (const m of body.matchAll(/(?:^|[;{\s])height:\s*([\d.]+)px/g)) heights.push({ kind: "height", v: Number(m[1]) })
    for (const m of body.matchAll(/min-height:\s*([\d.]+)px/g)) heights.push({ kind: "min-height", v: Number(m[1]) })
    for (const m of body.matchAll(/max-height:\s*([\d.]+)px/g)) heights.push({ kind: "max-height", v: Number(m[1]) })
    if (!heights.length) continue

    const needed = lineHeightPx * SCALE
    const isFormControl = /(^|[\s,(>])(input|textarea|select)\b/i.test(rule.selector)
    const overflowDecl = (body.match(/overflow(?:-[xy])?:\s*[^;}]+/g) ?? []).join(" ")
    const overflow = /hidden|clip/.test(overflowDecl) ? "hidden" : (/auto|scroll/.test(overflowDecl) ? "auto" : "未声明")

    for (const h of heights) {
      if (h.v + 0.01 >= needed) continue
      risks.push({
        file: rel, line: rule.startLine, selector: rule.selector.slice(0, 150),
        lineHeightPx: Math.round(lineHeightPx * 100) / 100, lhSource,
        heightKind: h.kind, heightPx: h.v, neededPx: Math.round(needed * 100) / 100,
        deficitPx: Math.round((needed - h.v) * 100) / 100,
        formControl: isFormControl, overflow,
        // 置信度：显式 px 行高 + 表单控件/overflow:hidden 最可能真裁切；
        // 无单位行高 + 未声明 overflow 更可能只是撑开容器
        confidence: (lhSource === "font 简写 px 行高" || lhSource === "line-height px")
          ? (isFormControl || overflow === "hidden" ? "高" : "中")
          : (isFormControl ? "中" : "低（可能只是撑开）"),
        raw: body.slice(0, 130),
      })
    }
  }
  return risks
}

/* ── 自检：用合成样本证明"该报的一定报"，并证明"不该报的不会误报" ── */
if (argv.includes("--selftest")) {
  // 每个样本：[说明, CSS, 期望检出的条数]
  const cases = [
    ["font 简写 px 行高 + 固定 height（经典垂直居中写法）",
      `.a > input { height: 28px; font: 14px/28px var(--ui); }`, 1],
    ["line-height:px + min-height",
      `.b { min-height: 20px; line-height: 20px; }`, 1],
    ["无单位行高 × 字号（最易漏的一类）",
      `.c > textarea { height: 30px; font-size: 16px; line-height: 1.6; }`, 1],
    ["负向：无单位行高恰好放得下（1.6 × 16 = 25.6，×1.5 = 38.4 ≤ 40）",
      `.c2 > textarea { height: 40px; font-size: 16px; line-height: 1.6; }`, 0],
    ["font 简写里的无单位行高",
      `.d > input { height: 30px; font: 15px/1.5 var(--ui); }`, 1],
    ["多行规则（跨行写法也必须检出，这正是初版按行分析漏掉的）",
      `.e > input {\n  height: 28px;\n  font: 14px/28px var(--ui);\n}`, 1],
    ["max-height 也要算",
      `.f { max-height: 16px; line-height: 20px; }`, 1],
    ["负向：高度足够放得下（不该报）",
      `.g > input { height: 60px; font: 14px/28px var(--ui); }`, 0],
    ["负向：无固定高度（不该报）",
      `.h { font: 14px/28px var(--ui); }`, 0],
    ["负向：无任何行高信息（不该报）",
      `.i > input { height: 20px; font-size: 14px; }`, 0],
    ["负向：高度恰好等于 150% 行高（边界，不该报）",
      `.j > input { height: 42px; font: 14px/28px var(--ui); }`, 0],
  ]
  console.log("  ══ predict-clipping-risk 自检 ══\n")
  let bad = 0
  for (const [name, css, want] of cases) {
    const got = findRisks(css, "<synthetic>", SCALE).length
    const ok = got === want
    if (!ok) bad++
    console.log(`  ${ok ? "✓" : "✗"} ${name}`)
    console.log(`      期望 ${want} 条，实得 ${got} 条`)
    if (!ok) console.log(`      CSS: ${css.replace(/\n/g, "\\n")}`)
  }
  // 另需证明真实代码至少能被检出过一次（否则"0 条"无从判断）
  const realTotal = walk(SRC).reduce((n, f) => n + findRisks(readFileSync(f, "utf8"), relative(REPO, f), SCALE).length, 0)
  console.log(`\n  真实代码检出 ${realTotal} 条（自检的意义：只有证明"能检出"，这个数字才可信）`)
  console.log(bad === 0 ? `\n  ✓ 自检全部通过（${cases.length} 例）` : `\n  ✗ 自检失败 ${bad} 例`)
  process.exit(bad === 0 ? 0 : 1)
}

const risks = []
for (const f of walk(SRC)) {
  const text = readFileSync(f, "utf8")
  const rel = relative(REPO, f).replace(/\\/g, "/")
  risks.push(...findRisks(text, rel, SCALE))
}

const seen = new Map()
for (const r of risks) {
  const k = `${r.file}:${r.line}:${r.heightKind}`
  if (!seen.has(k) || seen.get(k).deficitPx < r.deficitPx) seen.set(k, r)
}
const uniq = [...seen.values()].sort((a, b) => (b.formControl - a.formControl) || (b.deficitPx - a.deficitPx))

if (AS_JSON) {
  console.log(JSON.stringify({ scale: SCALE, count: uniq.length, risks: uniq }, null, 2))
  process.exit(0)
}

console.log(`  ══ 静态预判：放大到 ${SCALE * 100}% 时行高超过固定容器高度的高风险规则 ══\n`)
console.log(`  命中规则数: ${uniq.length}（表单控件 ${uniq.filter((r) => r.formControl).length} 条；` +
  `置信度高 ${uniq.filter((r) => r.confidence === "高").length} / 中 ${uniq.filter((r) => r.confidence === "中").length} / 低 ${uniq.filter((r) => String(r.confidence).startsWith("低")).length}）`)
console.log(`  口径：同一条规则块内"有效行高" × ${SCALE} > px 高度/最小高度`)
console.log(`  有效行高包含三类来源：font 简写 px 行高、line-height:px、无单位行高 × 字号\n`)
console.log(`  注意：换算不改变 height，故此风险换算解决不了，必须改容器侧\n`)
if (!uniq.length) {
  console.log("  ✓ 无此类结构性风险")
  process.exit(0)
}
console.log("  " + "─".repeat(150))
for (const r of uniq) {
  const flag = r.formControl ? "【表单·默认裁切】" : r.overflow === "hidden" ? "【overflow:hidden】" : "【可能撑开】"
  console.log(`  ${flag} ${r.file}:${r.line}`)
  console.log(`      选择器: ${r.selector}`)
  console.log(`      行高 ${r.lineHeightPx}px → ${SCALE * 100}% 需 ${r.neededPx}px，但 ${r.heightKind} = ${r.heightPx}px，缺 ${r.deficitPx}px`)
  console.log(`      原文: ${r.raw}`)
}
console.log(`\n  ── 按文件汇总 ──`)
const byFile = {}
for (const r of uniq) (byFile[r.file] ??= []).push(r)
for (const [f, rs] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${f.padEnd(60)} ${String(rs.length).padStart(3)} 条  （表单 ${rs.filter((x) => x.formControl).length}）`)
}
