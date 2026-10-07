/**
 * 字号缩放裁切守卫：禁止「固定 px 盒高 + 可缩放行盒」把文字裁掉。
 *
 * ── 为什么需要这条守卫 ──
 * 阶段 1 把字号/行高从 px 换算成 rem，但**布局高度有意保持 px**（design §4.4）。
 * 这个组合埋下一个新缺陷类：盒子高度不随界面字号长，而里面的行盒会。
 *   height: 44px（不动）+ line-height: 1.5rem（放大）
 *   → 100% 档：内容盒 24px、行盒 24px，恰好；
 *   → 150% 档：内容盒仍 24px、行盒 36px，**超出 12px，文字被 input 裁掉**。
 *
 * 这是**本次改动引入的回归**，不是既有问题：换算前 `font-size:16px;
 * line-height:24px` 两个都是绝对单位，任何档位都不裁。
 * ad94b79 已经手工修过同一类的 4 处（model-settings.css 的 .model-tag-compose），
 * 但漏了 ui-test-shelf.css 的 .ui-test-create-name —— 直到对抗性审查才发现。
 * 靠人眼找不完，所以固化成测试。
 *
 * ── 判据为什么这样定 ──
 * 判据是「150% 档下行盒是否放得进内容盒」，不是"看起来会不会裁"：
 *   内容盒 = height − 上下内边距（border-box；真实页面由 ui-test.css:2 保证）
 *   行盒   = line-height（可缩放）或 无单位比值 × font-size
 * 两条排除项都是**实测确认**过的，不是想当然：
 *   · 只有 `min-height` 的规则不算 —— 它是下限，盒子会随内容长高。
 *     实测 model-settings.css 的 `min-height:40px` 在 150% 档长到 51.5px、
 *     book-analysis-workbench.css 的 `min-height:34px` 长到 37px，都不裁。
 *   · 固定 px 高度 + 固定 px 行高不裁（两者都不缩放）。
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import postcss from "postcss"
import { describe, expect, it } from "vitest"

const UITEST_DIR = __dirname
/**
 * 必须同时查**放大与缩小两个方向**。
 *
 * 这是我第一版的错：只查 150%。那版用的判据是"height 与 line-height 同为 rem"，
 * 我就据此把 `.ui-test-create-name` 只改了 height、内边距留着 px —— 150% 通过了，
 * 但 80% 档会裁 4px：内边距不随根字号缩小，可用高度缩得比行盒更快。
 * 设倍率 s：可用 = 44s − 20，行盒 = 24s，溢出 = 20(1 − s) ——
 * s<1 与 s>1 **同样**溢出。只看放大方向就永远看不到前半段。
 * 界面字号滑块最小值正是 80%（真实 exe 实测 min=80），所以这是必修项。
 */
const SCALES = [0.8, 1.5] as const
const ROOT_PX = 16

// ───────────────────────── 解析 ─────────────────────────

type Len = { px: number; scalable: boolean }

/** 解析长度；rem/em 记为可缩放。返回 null 表示无法作为长度解析。 */
function len(value: string | undefined, fontPx = ROOT_PX): Len | null {
  if (!value) return null
  const m = /^(-?\d*\.?\d+)(px|rem|em)$/i.exec(value.trim())
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  switch (m[2].toLowerCase()) {
    case "px": return { px: n, scalable: false }
    case "rem": return { px: n * ROOT_PX, scalable: true }
    case "em": return { px: n * fontPx, scalable: true }
    default: return null
  }
}

function declsOf(rule: postcss.Rule): Record<string, string> {
  const out: Record<string, string> = {}
  rule.walkDecls((d) => { out[d.prop.toLowerCase()] = d.value })
  return out
}

/** `font: 0.875rem/1.5 var(--ui)` 简写里抽出字号与行高。 */
function fromFontShorthand(value: string, ctx: { root: number }): { size: Len | null; lineHeight: Len | null; ratio: number | null } {
  const m = /(?:^|\s)(\d*\.?\d+(?:px|rem|em))\s*(?:\/\s*(\d*\.?\d+(?:px|rem|em)?))?(?:\s|$)/.exec(value)
  if (!m) return { size: null, lineHeight: null, ratio: null }
  const size = len(m[1], ctx.root)
  if (!m[2]) return { size, lineHeight: null, ratio: null }
  if (/^\d*\.?\d+$/.test(m[2])) return { size, lineHeight: null, ratio: Number(m[2]) }
  return { size, lineHeight: len(m[2], ctx.root), ratio: null }
}

export type ClipFinding = { file: string; selector: string; detail: string }

/**
 * 扫一份 CSS，返回在该档位下会裁切的规则。
 * 纯函数，便于用 fixture 自检。
 */
export function findClippingRules(css: string, scale: number, file = "(fixture)"): ClipFinding[] {
  const SCALE = scale
  const root = postcss.parse(css)
  const out: ClipFinding[] = []
  root.walkRules((rule) => {
    // at-rule 内部（@media 等）同样要查
    const d = declsOf(rule)
    const short = d["font"] ? fromFontShorthand(d["font"], { root: ROOT_PX }) : { size: null, lineHeight: null, ratio: null }

    const heightRaw = d["height"]
    // 只有 min-height：下限，盒子会随内容长高 → 不裁（实测确认，见文件头注释）
    if (!heightRaw) return
    const h = len(heightRaw)
    if (!h) return
    // height 固定但 min-height 更大 → 实际以下限为准，仍可长高
    const minH = len(d["min-height"])
    if (minH && minH.px > h.px && !h.scalable) return
    /*
     * ⚠️ 这里**不能**因为「height 是 rem」就直接放行。
     * 那是我第二版的错：高度可缩放但内边距是 px 时，可用高度 = 44s − 20，
     * 而行盒 = 24s —— 两者只在 s=1 相等，s<1 时可用高度缩得更快。
     * 必须把高度与内边距**各自**按是否可缩放折算到当前档位，
     * 再和行盒比，才能同时覆盖放大与缩小两个方向。
     */

    const size = short.size ?? len(d["font-size"])
    let lineBox: number | null = null
    let lhDesc = ""
    if (short.lineHeight) { lineBox = short.lineHeight.px * (short.lineHeight.scalable ? SCALE : 1); lhDesc = `font 简写行高 ${short.lineHeight.px}px${short.lineHeight.scalable ? "(rem)" : "(px)"}` }
    else if (short.ratio != null) { lineBox = short.ratio * (size?.px ?? ROOT_PX) * SCALE; lhDesc = `font 简写无单位行高 ${short.ratio}` }
    else if (d["line-height"]) {
      const raw = d["line-height"].trim()
      if (/^\d*\.?\d+$/.test(raw)) { lineBox = Number(raw) * (size?.px ?? ROOT_PX) * SCALE; lhDesc = `无单位行高 ${raw}` }
      else { const lh = len(raw); if (lh) { lineBox = lh.px * (lh.scalable ? SCALE : 1); lhDesc = `行高 ${lh.px}px${lh.scalable ? "(rem)" : "(px)"}` } }
    } else if (size) {
      // 无显式行高：浏览器 normal ≈ 1.2，且随字号缩放
      lineBox = 1.2 * size.px * (size.scalable ? SCALE : 1)
      lhDesc = "行高 normal(按 1.2×字号推定)"
    }
    if (lineBox == null) return

    // 可用高度 = height − 上下内边距（border-box）；两者各自按是否可缩放折算
    const padTop = len(d["padding-top"]) ?? (d["padding"] ? len(d["padding"].split(/\s+/)[0]) : null)
    const padBot = len(d["padding-bottom"]) ?? (d["padding"] ? len(d["padding"].split(/\s+/)[2] ?? d["padding"].split(/\s+/)[0]) : null)
    const pt = (padTop?.px ?? 0) * (padTop?.scalable ? SCALE : 1)
    const pb = (padBot?.px ?? 0) * (padBot?.scalable ? SCALE : 1)
    const heightAt = h.px * (h.scalable ? SCALE : 1)
    const contentBox = heightAt - pt - pb

    if (lineBox > contentBox + 0.5) {
      out.push({
        file,
        selector: rule.selector,
        detail: `@${Math.round(SCALE * 100)}%: 可用高度 ${contentBox.toFixed(1)}px（height ${h.px}px${h.scalable ? `×${SCALE}(rem)` : "(px 不缩放)"} − 上下内边距 ${(pt + pb).toFixed(1)}px${(padTop?.scalable || padBot?.scalable) ? "(rem)" : "(px 不缩放)"}）< 行盒 ${lineBox.toFixed(1)}px（${lhDesc}）→ 溢出 ${(lineBox - contentBox).toFixed(1)}px`,
      })
    }
  })
  return out
}

function walkCss(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walkCss(p, out)
    else if (e.endsWith(".css")) out.push(p)
  }
  return out
}

// ───────────────────────── 测试 ─────────────────────────

describe("字号缩放裁切守卫", () => {
  it("守卫本身可信：能检出已知缺陷，且不误报已知安全写法", () => {
    // 正例：真实缺陷的原始取值（本次修复前）——必须被检出，且溢出量恰为 12px
    const bad = findClippingRules(
      `.ui-test-create-project-dialog .ui-test-create-name { width: 100%; height: 44px; padding: 10px 14px; border: 0; font-size: 1rem; line-height: 1.5rem; }`,
      1.5,
    )
    expect(bad).toHaveLength(1)
    expect(bad[0].detail).toContain("溢出 12.0px")
    expect(bad[0].detail).toContain("可用高度 24.0px")

    // 同一写法在 100% 档不裁（可用高度 = 行盒 = 24px），证明判据不是恒报
    expect(findClippingRules(`.x { height: 44px; padding: 10px 14px; font-size: 1rem; line-height: 1.5rem; }`, 1)).toHaveLength(0)

    // 反例 1：正确写法（高度与内边距都随根字号缩放）——两个方向都必须安全
    const good = `.x { height: 2.75rem; padding: 0.625rem 0.875rem; font-size: 1rem; line-height: 1.5rem; }`
    for (const s of SCALES) expect(findClippingRules(good, s), `@${s}`).toHaveLength(0)

    /*
     * 正例 2（本守卫最要紧的一条）：**只把 height 换成 rem、内边距留 px** ——
     * 这正是我第一次的"修法"。它在 150% 档是安全的，所以只看放大方向的
     * 检查会放行；但 80% 档可用高度 35.2 − 20 = 15.2px < 行盒 19.2px，会裁 4px。
     * 真实 exe 实测滑块最小值就是 80%，故这条必须被抓住。
     */
    const halfFixed = `.x { height: 2.75rem; padding: 10px 14px; font-size: 1rem; line-height: 1.5rem; }`
    expect(findClippingRules(halfFixed, 1.5), "150% 档确实看不出来").toHaveLength(0)
    const at80 = findClippingRules(halfFixed, 0.8)
    expect(at80, "只换算 height、内边距留 px 的不完整修法必须在 80% 档被检出").toHaveLength(1)
    expect(at80[0].detail).toContain("溢出 4.0px")
    expect(at80[0].detail).toContain("15.2px")

    // 反例：只有 min-height（下限会长高，实测不裁）
    expect(findClippingRules(`.x input { min-height: 40px; padding: 9px 12px; font: 0.875rem/1.5 sans-serif; }`, 1.5)).toHaveLength(0)
    // 反例：min-height 大于 height
    expect(findClippingRules(`.x input { height: 20px; min-height: 40px; padding: 0; font-size: 1rem; line-height: 1.5rem; }`, 1.5)).toHaveLength(0)
    // 反例：px 高度 + px 行高（都不缩放）
    expect(findClippingRules(`.x { height: 44px; padding: 10px 14px; font-size: 16px; line-height: 24px; }`, 1.5)).toHaveLength(0)
    // 正例：px 高度 + 无单位行高（数字行高会随字号缩放）——必须检出
    expect(findClippingRules(`.x { height: 20px; font-size: 0.875rem; line-height: 1.6; }`, 1.5)).toHaveLength(1)
    // 反例：高度足够大
    expect(findClippingRules(`.x { height: 200px; font-size: 1rem; line-height: 1.5rem; }`, 1.5)).toHaveLength(0)
  })

  it.each([...SCALES])("测试版全部 CSS：不存在会裁切文字的规则（%s 档）", (scale) => {
    const findings: ClipFinding[] = []
    for (const abs of walkCss(UITEST_DIR)) {
      findings.push(...findClippingRules(readFileSync(abs, "utf8"), scale, relative(process.cwd(), abs).replace(/\\/g, "/")))
    }
    const report = findings.map((f) => `\n  ${f.file}  ${f.selector}\n    ${f.detail}`).join("")
    expect(
      findings,
      `发现 ${findings.length} 条会在界面字号 ${Math.round(scale * 100)}% 档裁掉文字的规则：${report}\n` +
      `修法：让「height − 上下内边距」与 line-height 同源（都用 rem），这样可用高度 = 行盒 × 倍率，任何档位都成立。\n` +
      `注意只改 height、内边距留 px 是**不完整**修法：放大方向看不出问题，缩小方向（80%）会裁。`,
    ).toHaveLength(0)
  })

  it("「小说名称」输入框：height 与上下内边距同源（本缺陷的定点回归测试）", () => {
    const css = readFileSync(resolve(UITEST_DIR, "ui-test-shelf.css"), "utf8")
    const root = postcss.parse(css)
    const decls: Record<string, string> = {}
    root.walkRules((rule) => {
      if (rule.selector.includes(".ui-test-create-name")) {
        rule.walkDecls((d) => { decls[d.prop.toLowerCase()] = d.value })
      }
    })
    expect(decls["height"], "找不到 .ui-test-create-name 的 height 声明").toBeDefined()
    expect(decls["height"]).toBe("2.75rem")
    // 只断言 height 是不够的 —— 这正是第一版守卫的漏洞。上下内边距也必须可缩放，
    // 否则缩小方向仍会裁（见上面 findClippingRules 的 80% 用例）。
    expect(decls["padding"], "找不到 padding 声明").toBeDefined()
    const parts = decls["padding"].trim().split(/\s+/)
    const vertical = parts.length === 1 ? parts[0] : parts[0]
    expect(vertical, `padding 的上下值应为 rem（当前 padding: ${decls["padding"]}）`).toMatch(/rem$/)
    // line-height 也必须是 rem，否则「可用 = 行盒」这条不变量不成立
    expect(decls["line-height"], "找不到 line-height 声明").toMatch(/rem$/)
  })
})
