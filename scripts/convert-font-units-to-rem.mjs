/**
 * 把绝对单位字号/行高换算为精确 rem（16px 基准）。
 *
 * 为什么必须精确：所有 px 取值都是 0.5 的整数倍，÷16 得到有限的十进制小数，
 * 因此在根字号 100% 时换算后的计算值与改动前逐位相同 → 零视觉回归。
 * 若 px 行高改成无单位比值，像 20px/13px 这类比例无法写成精确小数，
 * 会让 100% 下的计算行高变成 19.994px，破坏等效性。故一律用 rem。
 *
 * 只改字号与行高，不动布局尺寸、图标尺寸与颜色。
 * 幂等：重复运行不再产生变化。
 *
 * 用法：
 *   node scripts/convert-font-units-to-rem.mjs --dry-run   # 只报告，不写入
 *   node scripts/convert-font-units-to-rem.mjs --check     # 有需改文件则退出码 1
 *   node scripts/convert-font-units-to-rem.mjs             # 实际写入 src/
 *
 * 范围（与 docs/font-scaling-fix-20261007/count-absolute-font-units.mjs 的口径一致）：
 *   CSS  font-size: Npx          160 处
 *   CSS  font: … Npx[/Npx] …      80 处字号 + 12 处 px 行高
 *   CSS  line-height: Npx         11 处
 *   TSX  text-[Npx]              306 处
 *   合计 557 处声明 / 569 个数值（design.md §4.1）
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

/** 注释遮罩用的占位字符：不是 `;`/`{`/`}`/空白/数字/字母，故不会被任何规则匹配。 */
const MASK = "\u0000"

/**
 * 精确换算：把十进制 px 值换算为**有限小数** rem，不做任何四舍五入。
 *
 * 用 BigInt 做长除法而不是 `value / 16` + `toFixed`：后者是"先浮点除、再四舍五入"，
 * 虽然对 0.5 的整数倍恰好也精确，但那是巧合（依赖 toFixed 位数够用）。
 * 这里显式保证：换算结果 × 16 逐位等于原值；若某 px 值无法写成有限小数则抛错，
 * 绝不静默产出近似值。
 *
 * @param {number|string} px 十进制 px 值（必须为正、有限、十进制写法）
 * @returns {string} 形如 `0.8125rem`
 */
export function pxToRem(px) {
  const raw = String(px).trim()
  const m = /^(\d+)(?:\.(\d+))?$/.exec(raw)
  if (!m) throw new Error(`非法 px 值: ${JSON.stringify(px)}（须为十进制正数）`)
  const intPart = m[1]
  const frac = m[2] ?? ""
  const numerator = BigInt(intPart + frac)
  if (numerator === 0n) throw new Error(`非法 px 值: ${JSON.stringify(px)}（须为正数）`)
  // px = numerator / 10^len(frac)；rem = px / 16
  const denominator = 10n ** BigInt(frac.length) * 16n
  return `${exactDecimal(numerator, denominator)}rem`
}

/** 用长除法写出 numerator/denominator 的精确十进制展开（分母只含 2/5 因子时必有限）。 */
function exactDecimal(numerator, denominator) {
  const whole = numerator / denominator
  let rest = numerator % denominator
  if (rest === 0n) return whole.toString()
  let digits = ""
  while (rest !== 0n) {
    rest *= 10n
    digits += (rest / denominator).toString()
    rest %= denominator
    if (digits.length > 40) throw new Error(`px 值无法精确换算为有限小数 rem: ${numerator}/${denominator}`)
  }
  return `${whole}.${digits}`
}

// ───────────────────────────── 注释处理 ─────────────────────────────

const CSS_BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g

/**
 * 把块注释替换为等长遮罩后再做替换，最后原样还原。
 *
 * 为什么是"遮罩"而不是"按注释切段分别处理"：切段会让跨注释的声明失配
 * （例如注释写在 `font:` 与 `13px` 之间时，关键字与数值会被切到两段里 → 静默漏改）。
 * 遮罩等长、不含 `;{}`，既保住注释内容一字不改，又让正则可以正常跨越注释。
 */
function withMaskedComments(text, fn) {
  const comments = []
  const masked = text.replace(CSS_BLOCK_COMMENT, (comment) => {
    comments.push(comment)
    return MASK.repeat(comment.length)
  })
  const out = fn(masked)
  let i = 0
  const restored = out.replace(/\u0000+/g, (run) => {
    const comment = comments[i++]
    if (comment === undefined || comment.length !== run.length) {
      throw new Error("注释遮罩还原失配：遮罩片段与注释不一一对应")
    }
    return comment
  })
  if (i !== comments.length) throw new Error(`注释遮罩还原失配：${comments.length} 个注释只还原了 ${i} 个`)
  return restored
}

// ───────────────────────────── CSS ─────────────────────────────

/** 声明边界：规则起始、上一条声明结束、或紧邻的（已遮罩）注释之后。 */
const DECL_BOUNDARY = "(^|[;{\\u0000])"
/** 顶层片段：length / percentage（`font` 简写里唯一可能是 font-size 的形态）。 */
const LENGTH_TOKEN =
  /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|cm|mm|q|in|pt|pc|%)$/
const PX_TOKEN = /^([\d.]+)px$/
const FONT_SHORTHAND = /(^|[;{}\u0000])(\s*)font:(\s*)([^;{}]*)/g

/**
 * 把声明值切成"顶层"片段（跳过括号与引号内部），并记录每个片段在值内的偏移。
 * `font: 500 20px/28px var(--serif)` → `500` `20px` `/` `28px` `var(--serif)`
 */
function topLevelSegments(value) {
  const segs = []
  let start = -1
  let depth = 0
  let quote = null
  const flush = (end) => {
    if (start >= 0) {
      segs.push({ start, end, text: value.slice(start, end) })
      start = -1
    }
  }
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (start < 0) {
      if (/\s/.test(ch)) continue
      start = i
    }
    if (quote) {
      if (ch === "\\") i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === "(") {
      depth++
      continue
    }
    if (ch === ")") {
      if (depth > 0) depth--
      continue
    }
    if (depth > 0) continue
    if (/\s/.test(ch)) {
      flush(i)
      continue
    }
    if (ch === "/") {
      flush(i)
      segs.push({ start: i, end: i + 1, text: "/" })
      start = -1
      continue
    }
  }
  flush(value.length)
  return segs
}

function applyEdits(text, edits) {
  if (edits.length === 0) return text
  let out = ""
  let cursor = 0
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    if (e.start < cursor) throw new Error("换算区间重叠，拒绝改写")
    out += text.slice(cursor, e.start) + e.text
    cursor = e.end
  }
  return out + text.slice(cursor)
}

function pushPxEdit(edits, seg) {
  if (!seg) return
  const m = PX_TOKEN.exec(seg.text)
  if (m) edits.push({ start: seg.start, end: seg.end, text: pxToRem(m[1]) })
}

/**
 * 按 CSS `font` 简写的语法定位并换算，而不是"值里第一个 Npx"。
 *
 * 语法：`font: [style||variant||weight||stretch]? <font-size> [ / <line-height> ]? <font-family>`
 * 所以要换算的两处是：**第一个**顶层 length/percentage 片段（= font-size），
 * 以及紧跟其后的 `/` 之后的那个片段（= line-height），且仅当它们以 px 为单位。
 * 这样字族里的 px（如 `var(--x, 20px)` 的兜底值）不会被误改，也保证了幂等。
 */
function convertFontShorthandValue(value) {
  const segs = topLevelSegments(value)
  let sizeIdx = -1
  for (let i = 0; i < segs.length; i++) {
    if (LENGTH_TOKEN.test(segs[i].text)) {
      sizeIdx = i
      break
    }
  }
  if (sizeIdx === -1) return value
  const edits = []
  pushPxEdit(edits, segs[sizeIdx])
  if (segs[sizeIdx + 1]?.text === "/") pushPxEdit(edits, segs[sizeIdx + 2])
  return applyEdits(value, edits)
}

/** 换算独立声明 `font-size:` / `line-height:`（只替换数值 token，其余字节原样保留）。 */
function convertPropertyDeclarations(css, prop) {
  // 占位字符也允许出现在冒号与数值之间：注释写在 `font-size:` 与其值之间是合法 CSS，
  // 若只允许空白，这种写法会被静默漏改（换算完整性靠全仓计数测试兜底，但根因要在这里修掉）。
  const re = new RegExp(`${DECL_BOUNDARY}([\\s\\u0000]*)${prop}:([\\s\\u0000]*)([\\d.]+)px`, "g")
  return css.replace(re, (_m, boundary, before, after, value) => `${boundary}${before}${prop}:${after}${pxToRem(value)}`)
}

function convertCssChunk(css) {
  let out = css.replace(
    FONT_SHORTHAND,
    (_m, boundary, before, after, value) =>
      `${boundary}${before}font:${after}${convertFontShorthandValue(value)}`,
  )
  out = convertPropertyDeclarations(out, "font-size")
  out = convertPropertyDeclarations(out, "line-height")
  return out
}

export function convertCss(text) {
  return withMaskedComments(text, convertCssChunk)
}

// ───────────────────────────── TSX / TS ─────────────────────────────

/**
 * 只匹配 Tailwind 的字号任意值 `text-[Npx]`。
 * 不匹配 `min-w-[16px]` / `max-w-[600px]` / `gap-[10px]` / `text-[#fff]` 等；
 * 也不匹配 SVG 的 `fontSize="N"`（图标几何，全仓 2 处，改 rem 会在固定 viewBox 里溢出）。
 */
const TW_FONT_SIZE = /text-\[([\d.]+)px\]/g

function convertTsxChunk(tsx) {
  return tsx.replace(TW_FONT_SIZE, (_m, value) => `text-[${pxToRem(value)}]`)
}

export function convertTsx(text) {
  return withMaskedComments(text, convertTsxChunk)
}

// ───────────────────────────── 文件遍历 / CLI ─────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(css|tsx|ts)$/.test(entry)) out.push(p)
  }
  return out
}

/** 读取一个文件并返回换算结果（不写入）。 */
export function convertFile(absPath) {
  const original = readFileSync(absPath, "utf8")
  const isCss = absPath.endsWith(".css")
  const converted = isCss ? convertCss(original) : convertTsx(original)
  return { original, converted, changed: original !== converted }
}

function main() {
  const dryRun = process.argv.includes("--dry-run")
  const check = process.argv.includes("--check")
  const root = join(process.cwd(), "src")
  let files = 0
  let changedFiles = 0
  for (const abs of walk(root)) {
    files++
    const { converted, changed } = convertFile(abs)
    if (!changed) continue
    changedFiles++
    const rel = relative(process.cwd(), abs).replace(/\\/g, "/")
    console.log(`  ${dryRun || check ? "将改" : "已改"} ${rel}`)
    if (!dryRun && !check) writeFileSync(abs, converted, "utf8")
  }
  console.log(`\n  扫描 ${files} 个文件，${changedFiles} 个需换算`)
  if (check && changedFiles > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
