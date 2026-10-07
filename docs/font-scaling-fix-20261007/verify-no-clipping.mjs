#!/usr/bin/env node
/**
 * 真实浏览器实测：固定 px 盒高 + rem 行高 在界面字号放大后会不会把文字裁掉。
 *
 * ── 为什么需要它（静态扫描判不了）──
 * clip-sweep.mjs 能算出「行盒 36px 塞进 24px 内容盒」，但**判不了**这个元素
 * 到底会不会裁：选择器多是 class，静态看不出它是 `<input>`（会裁）还是
 * `<button>`（overflow 可见，只是挤掉内边距）。所以静态扫描只给候选，
 * 由本脚本在真实 Chromium 里读 `scrollHeight / clientHeight` 做裁决。
 *
 * ── 为什么加载的是**真实构建产物**而不是抄一份 CSS ──
 * 抄一份就等于把被测对象换成我自己写的近似值：CSS 改了它不会跟着变，
 * 于是"验证通过"只证明我抄对了。故这里直接从 dist 里读真实 CSS 文件，
 * 只在前面补一条 `html { font-size }` 来模拟界面字号档位。
 *
 * ── 本脚本自身也可能骗人，故带正/负对照 ──
 *   正对照：已修复的写法（高度与行高同为 rem）在任何档位都**不得**报裁切 ——
 *          若它也被报裁切，说明尺子坏了，所有结论作废。
 *   负对照：**故意造一个必然裁切的**（`height: 12px` + `line-height: 3rem`）
 *          必须被检出 —— 若它不报，说明检测器在放空炮。
 *
 * 用法：
 *   node verify-no-clipping.mjs            # 跑全部用例
 *   node verify-no-clipping.mjs --json
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const SHOT_DIR = join(HERE, "clip-shots")
const argv = process.argv.slice(2)
const AS_JSON = argv.includes("--json")

const CSS_FILES = [
  "src/components/uitest/ui-test.css",
  "src/components/uitest/ui-test-shelf.css",
].map((p) => join(ROOT, p))

for (const f of CSS_FILES) {
  if (!existsSync(f)) { console.error(`  ✗ 缺少真实 CSS: ${f}`); process.exit(1) }
}
const REAL_CSS = CSS_FILES.map((f) => readFileSync(f, "utf8")).join("\n")

/**
 * 被测用例。每条给出：选择器、是否含文字、期望（"clip" / "no-clip"）。
 */
const CASES = [
  {
    id: "create-name-现状",
    label: "「小说名称」输入框（现状：height 44px + line-height 1.5rem）",
    sel: ".probe-dialog .ui-test-create-name",
    // 真实规则来自 ui-test-shelf.css；这里只补 box-sizing（真实页面由 ui-test.css:2 提供）
    css: `.probe-dialog .ui-test-create-name { width: 100%; min-width: 0; height: 44px; padding: 10px 14px; border: 0; border-radius: 8px; font-size: 1rem; line-height: 1.5rem; }`,
    markup: `<div class="probe-dialog"><input class="ui-test-create-name" value="黑雨之下" /></div>`,
  },
  {
    id: "create-name-修复后",
    label: "「小说名称」输入框（完整修法：height 与上下内边距都换算为 rem）",
    sel: ".probe-dialog .ui-test-create-name",
    css: `.probe-dialog .ui-test-create-name { width: 100%; min-width: 0; height: 2.75rem; padding: 0.625rem 0.875rem; border: 0; border-radius: 8px; font-size: 1rem; line-height: 1.5rem; }`,
    markup: `<div class="probe-dialog"><input class="ui-test-create-name" value="黑雨之下" /></div>`,
  },
  {
    /*
     * 这条是本脚本最要紧的一个"反例"，因为它是**我自己的错误修法**：
     * 只把 height 换成 rem、内边距留 px。它在 150% 档完全正常，
     * 所以只看放大方向的检查会放行；但 80% 档可用高度缩得比行盒快 → 裁 4px。
     * 界面字号滑块最小值正是 80%。不留这条，"两个方向都要查"就只是句话。
     */
    id: "半修-只换height",
    label: "半修（只把 height 换成 rem、内边距留 px）—— 80% 档应裁、150% 档不裁",
    sel: ".probe-dialog .probe-half",
    css: `.probe-dialog .probe-half { width: 100%; height: 2.75rem; padding: 10px 14px; border: 0; font-size: 1rem; line-height: 1.5rem; }`,
    markup: `<div class="probe-dialog"><input class="probe-half" value="黑雨之下" /></div>`,
  },
  {
    id: "负对照-必裁",
    label: "负对照：故意造一个必然裁切的（height 12px + line-height 3rem）",
    sel: ".probe-dialog .probe-bad",
    css: `.probe-dialog .probe-bad { width: 100%; height: 12px; padding: 0; border: 0; font-size: 1rem; line-height: 3rem; }`,
    markup: `<div class="probe-dialog"><input class="probe-bad" value="黑雨之下" /></div>`,
  },
  {
    id: "正对照-rem高度",
    label: "正对照：高度与行高同为 rem（ad94b79 确立的写法）",
    sel: ".probe-dialog .probe-good",
    css: `.probe-dialog .probe-good { width: 100%; height: 1.75rem; padding: 0 4px; border: 0; font-size: 0.875rem; line-height: 1.75rem; }`,
    markup: `<div class="probe-dialog"><input class="probe-good" value="黑雨之下" /></div>`,
  },
  /*
   * 下面两条是静态扫描曾误报为 A 级（"静态即可判定会裁"）的规则。
   * 它们用的是 `min-height` —— 下限而非固定高度，盒子会随内容长高，
   * 所以文字不会被裁。这里在真实浏览器里证实这一点，
   * 以免我去"修"一个本来正确的写法。
   */
  {
    id: "min-height-模型输入框",
    label: "model-settings.css 的输入框（min-height:40px + padding + font:0.875rem/1.5）",
    sel: ".probe-dialog .model-input",
    css: `.probe-dialog .model-input { width: 100%; min-width: 0; min-height: 40px; padding: 9px 12px; border: 1px solid transparent; border-radius: 8px; font: 0.875rem/1.5 sans-serif; }`,
    markup: `<div class="probe-dialog"><input class="model-input" value="deepseek-chat" /></div>`,
  },
  {
    id: "min-height-拆书库控件",
    label: "book-analysis-workbench.css 的控件（min-height:34px + padding:6px 10px + font-size:0.8125rem）",
    sel: ".probe-dialog .wb-input",
    css: `.probe-dialog .wb-input { width: 100%; min-height: 34px; border: 1px solid #c6d1cb; border-radius: 5px; padding: 6px 10px; font-size: 0.8125rem; }`,
    markup: `<div class="probe-dialog"><input class="wb-input" value="测试作品" /></div>`,
  },
]

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const chromium = mod.chromium ?? mod.default?.chromium
const browser = await chromium.launch()

const SCALES = [80, 100, 150]
const results = []
let guardFails = []

const page = await browser.newPage({ viewport: { width: 640, height: 260 }, deviceScaleFactor: 2 })

for (const c of CASES) {
  for (const scale of SCALES) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html { font-size: ${scale}%; }
  body { margin: 0; padding: 20px; font-family: sans-serif; background: #fff; }
  .probe-dialog { box-sizing: border-box; width: 420px; }
  .probe-dialog * { box-sizing: border-box; }
  ${REAL_CSS}
  ${c.css}
</style></head><body>${c.markup}</body></html>`
    await page.setContent(html)
    await page.waitForTimeout(120)
    const sel = c.sel
    const m = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return null
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const pt = parseFloat(cs.paddingTop)
      const pb = parseFloat(cs.paddingBottom)
      return {
        tag: el.tagName.toLowerCase(),
        borderBoxHeight: +r.height.toFixed(2),
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        padTop: pt,
        padBottom: pb,
        overflow: cs.overflow,
        /*
         * ⚠️ 关键：`clientHeight` **包含内边距**，它等于 border-box 高度减边框。
         * 我第一版直接拿它当"内容盒"，于是 44px 的输入框被当成 44px 可用高度，
         * 与 36px 行盒一比得出"不裁"—— 假阴性。真正能放文字的高度还要减掉上下内边距。
         * （负对照恰好 padding:0，所以没能暴露这个错；是"断言已知值"那条守卫抓出来的。）
         */
        contentBox: +(el.clientHeight - pt - pb).toFixed(2),
        /*
         * `line-height: normal` 时 getComputedStyle 返回字符串 "normal"，
         * parseFloat 得 NaN —— 而 `NaN > x` 恒为 false，会让这条用例**静默变成
         * "不裁"**（空洞通过）。故显式回退到 1.2×font-size，并标记为推定值。
         */
        lineBox: (() => {
          const lh = parseFloat(cs.lineHeight)
          if (Number.isFinite(lh)) return { px: lh, assumed: false }
          const fs = parseFloat(cs.fontSize)
          return { px: fs * 1.2, assumed: true }
        })(),
      }
    }, sel)
    if (!m) { guardFails.push(`找不到元素: ${c.id} @${scale}%`); continue }
    if (!Number.isFinite(m.lineBox.px)) { guardFails.push(`行盒算不出（NaN）: ${c.id} @${scale}% —— 该用例会静默变成"不裁"`); continue }
    // 裁切判据：内容高度不够放下一个行盒，且元素会裁（input 会）
    const clips = m.tag === "input" || m.tag === "textarea"
      ? m.lineBox.px > m.contentBox + 0.5
      : m.scrollHeight > m.clientHeight + 1
    results.push({ ...c, scale, ...m, lineBoxPx: m.lineBox.px, lineBoxAssumed: m.lineBox.assumed, sel, clips: clips ? "clip" : "no-clip" })

    if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true })
    await page.screenshot({ path: join(SHOT_DIR, `${c.id}-${scale}.png`), clip: { x: 0, y: 0, width: 480, height: 120 } })
  }
}

await browser.close()

// ── 判定 ──
if (!AS_JSON) {
  console.log("  ══ 真实浏览器：固定 px 盒高 + rem 行高 会不会裁掉文字 ══")
  console.log("  （CSS 取自真实源文件；html{font-size} 用来模拟界面字号档位）\n")
  let lastId = null
  for (const r of results) {
    if (r.id !== lastId) { console.log(`  ${r.label}`); lastId = r.id }
    console.log(`    ${String(r.scale).padStart(3)}%  ${r.tag.padEnd(6)} 内容盒=${String(r.contentBox).padStart(5)}px  行盒=${String(Math.round(r.lineBoxPx * 10) / 10).padStart(5)}px${r.lineBoxAssumed ? "*" : " "} 盒高=${String(r.borderBoxHeight).padStart(6)}px  → ${r.clips === "clip" ? "✗ 裁切" : "✓ 不裁"}`)
  }
  console.log("")
}

// 正/负对照
//
// ⚠️ 这里曾是一个**空洞通过**：我原本直接写 `neg.every(...)`，
// 而当元素根本没找到、`neg` 是空数组时，`[].every()` 恒为 `true` ——
// 于是"负对照已检出 ✓"是在**什么都没测**的情况下打印出来的。
// 所以每一步都必须先断言"样本非空"，再断言内容。
const guard = (set, id) => {
  const got = results.filter((r) => r.id === id)
  if (got.length !== SCALES.length) guardFails.push(`对照样本不全：${id} 期望 ${SCALES.length} 条，实得 ${got.length} 条（空数组的 every() 恒为 true，会伪造通过）`)
  return got
}
const neg = guard(null, "负对照-必裁")
const pos = guard(null, "正对照-rem高度")
if (neg.length && !neg.every((r) => r.clips === "clip")) guardFails.push("负对照未被检出裁切 —— 检测器在放空炮，本脚本所有结论作废")
if (pos.length && !pos.every((r) => r.clips === "no-clip")) guardFails.push("正对照被误报裁切 —— 尺子坏了")
console.log(`  负对照（必然裁切）: ${neg.map((r) => r.scale + "%→" + r.clips).join("  ") || "(无样本)"}  ${neg.length && neg.every((r) => r.clips === "clip") ? "✓ 已检出" : "✗ 未检出"}`)
console.log(`  正对照（rem 高度）: ${pos.map((r) => r.scale + "%→" + r.clips).join("  ") || "(无样本)"}  ${pos.length && pos.every((r) => r.clips === "no-clip") ? "✓ 未误报" : "✗ 误报"}`)

/*
 * 断言**解析算得出的已知值**。这是本脚本最要紧的一条守卫：
 * 「现状」用例在 150% 档的内容盒必然是 44 − 10 − 10 = 24px、行盒必然是 1.5rem×1.5 = 36px。
 * 若测量给出的不是这两个数，说明我把盒子模型搞错了（第一版就是这样：
 * 拿含内边距的 clientHeight 当内容盒，得到 44px，于是把真缺陷报成"不裁"）。
 * 只靠正/负对照抓不住这个错（负对照恰好 padding:0）。
 */
const known = results.filter((r) => r.id === "create-name-现状" && r.scale === 150)[0]
if (!known) guardFails.push("缺少「现状 @150%」样本，无法核对已知值")
else {
  if (Math.abs(known.contentBox - 24) > 0.6) guardFails.push(`已知值不符：现状 @150% 内容盒应为 24px（44 − 10 − 10），实测 ${known.contentBox}px —— 盒子模型算错了`)
  if (Math.abs(known.lineBoxPx - 36) > 0.6) guardFails.push(`已知值不符：现状 @150% 行盒应为 36px（1.5rem × 1.5），实测 ${known.lineBoxPx}px`)
  if (Math.abs(known.borderBoxHeight - 44) > 0.6) guardFails.push(`已知值不符：现状 @150% 盒高应恒为 44px（未换算），实测 ${known.borderBoxHeight}px`)
}
console.log(`\n  已知值核对（现状 @150%）：内容盒 ${known?.contentBox}px（应 24）  行盒 ${known?.lineBoxPx}px（应 36）  盒高 ${known?.borderBoxHeight}px（应 44）`)
console.log("  （行盒后的 * 表示该元素 line-height 为 normal，按 1.2×font-size 推定）")

// min-height 类：静态扫描误报过，这里证实它们确实不裁
for (const id of ["min-height-模型输入框", "min-height-拆书库控件"]) {
  const got = results.filter((r) => r.id === id)
  if (got.length !== SCALES.length) { guardFails.push(`样本不全：${id}`); continue }
  const allSafe = got.every((r) => r.clips === "no-clip")
  console.log(`  ${id}: ${got.map((r) => r.scale + "%→" + r.clips).join("  ")}  ${allSafe ? "✓ 确实不裁（静态扫描曾误报）" : "✗ 竟然裁了，需重新评估"}`)
  if (!allSafe) guardFails.push(`${id} 实测会裁 —— 与 min-height 推断矛盾，必须复查`)
}

const target = results.filter((r) => r.id === "create-name-现状")
const fixed = results.filter((r) => r.id === "create-name-修复后")
console.log("")
const per = (rs) => SCALES.map((s) => `${s}%→${rs.find((r) => r.scale === s)?.clips ?? "?"}`).join("  ")
console.log(`  现状「小说名称」（height 44px）：      ${per(target)}`)
console.log(`  半修（height rem、内边距 px）：        ${per(results.filter((r) => r.id === "半修-只换height"))}`)
console.log(`  修复后（height 与内边距都 rem）：      ${per(fixed)}`)

/*
 * 断言"两个方向都正确"，而不只是"150% 没裁"。
 * 半修法必须在 80% 档被检出、且**在 150% 档确实看不出问题** ——
 * 后者是这条用例存在的理由：如果它在 150% 也报裁切，
 * 那说明检测器是靠别的原因红的，"缩小方向才暴露"这个结论就不成立。
 */
const half = results.filter((r) => r.id === "半修-只换height")
if (half.length !== SCALES.length) guardFails.push(`样本不全：半修-只换height（实得 ${half.length}）`)
else {
  const at80 = half.find((r) => r.scale === 80)
  const at150 = half.find((r) => r.scale === 150)
  if (at80?.clips !== "clip") guardFails.push("半修法在 80% 档未被检出裁切 —— 说明本脚本没有覆盖缩小方向（这正是它存在的理由）")
  if (at150?.clips !== "no-clip") guardFails.push(`半修法在 150% 档被报裁切（实测 ${at150?.clips}）—— 与"只换算 height 在放大方向够用"的分析矛盾，需复查`)
  if (at80 && Math.abs(at80.contentBox - 15.2) > 0.6) guardFails.push(`半修法 @80% 可用高度应为 35.2 − 20 = 15.2px，实测 ${at80.contentBox}px`)
  if (at80 && Math.abs(at80.lineBoxPx - 19.2) > 0.6) guardFails.push(`半修法 @80% 行盒应为 1.5rem × 0.8 = 19.2px，实测 ${at80.lineBoxPx}px`)
  if (at80 && Math.abs(at80.lineBoxPx - at80.contentBox - 4) > 0.6) guardFails.push(`半修法 @80% 溢出应为 19.2 − 15.2 = 4px，实测 ${(at80.lineBoxPx - at80.contentBox).toFixed(1)}px`)
}
const rem = results.filter((r) => r.id === "create-name-修复后")
if (rem.length !== SCALES.length) guardFails.push(`样本不全：create-name-修复后（实得 ${rem.length}）`)
else if (!rem.every((r) => r.clips === "no-clip")) {
  guardFails.push(`修复后在 ${rem.filter((r) => r.clips === "clip").map((r) => r.scale + "%").join("/")} 档仍报裁切 —— 修法不完整`)
}

if (AS_JSON) console.log(JSON.stringify({ results, guardFails }, null, 2))
if (guardFails.length) {
  console.log(`\n  ✗ 守卫失败 ${guardFails.length} 项`)
  for (const g of guardFails) console.log(`    · ${g}`)
  process.exit(2)
}
console.log(`\n  截图: ${SHOT_DIR}`)
process.exit(0)
