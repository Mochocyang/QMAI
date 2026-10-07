/**
 * 决定性诊断：headless Chromium 到底能不能看到本机字体？
 *
 * 背景：像素比对把 Arial、Times New Roman 也判为"不存在" —— 这不可能。
 * 说明问题的根源不是"字体没装"，而是"这个浏览器解析不到系统字体"。
 * 先确认这一点，否则后面所有基于浏览器的字体结论都不可信。
 *
 * 判据：
 *   - 通用族（serif / sans-serif / monospace）之间是否互不相同？
 *     若它们都相同 → 连通用族都没区分，字体渲染整体不可信。
 *   - 具名字体之间是否互不相同？若全部相同 → 解析不到系统字体。
 */
import { createHash } from "node:crypto"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()

const info = browser.version()
console.log(`  Chromium 版本: ${info}`)

const page = await browser.newPage({ viewport: { width: 900, height: 200 }, deviceScaleFactor: 1 })
await page.goto("data:text/html,<html><body style='margin:0;background:#fff'></body></html>")

async function hashOf(family) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">
    <div id="t" style="font-family:${family};font-size:44px;line-height:1.3;white-space:pre;padding:10px;color:#000">青幕AI写作 第1章 ABCabc 123，。</div>
  </body></html>`)
  await page.waitForTimeout(200)
  const buf = await page.locator("#t").screenshot()
  return createHash("sha256").update(buf).digest("hex").slice(0, 12)
}

console.log("\n  ── A. 通用族（浏览器必然内置）──")
const generics = {
  "serif": "serif",
  "sans-serif": "sans-serif",
  "monospace": "monospace",
  "cursive": "cursive",
  "fantasy": "fantasy",
}
const gHashes = {}
for (const [label, fam] of Object.entries(generics)) {
  gHashes[label] = await hashOf(fam)
  console.log(`    ${label.padEnd(12)} ${gHashes[label]}`)
}
const distinctGenerics = new Set(Object.values(gHashes)).size
console.log(`    → 不同位图数: ${distinctGenerics} / ${Object.keys(generics).length}`)
console.log(`    → 通用族${distinctGenerics > 1 ? "有区分（字体渲染基本可用）" : "完全无区分（字体渲染不可用！）"}`)

console.log("\n  ── B. 具名系统字体 ──")
const named = ["Arial", "Times New Roman", "Georgia", "Consolas", "Segoe UI", "SimHei", "Microsoft YaHei", "KaiTi"]
const nHashes = {}
for (const f of named) {
  nHashes[f] = await hashOf(`"${f}"`)
  console.log(`    ${f.padEnd(18)} ${nHashes[f]}`)
}
const distinctNamed = new Set(Object.values(nHashes)).size
console.log(`    → 不同位图数: ${distinctNamed} / ${named.length}`)

console.log("\n  ── C. 具名字体 vs 明确不存在 ──")
const missingHash = await hashOf(`"__QQQ_NoSuchFont_ZZZ__"`)
console.log(`    ${"__NoSuchFont__".padEnd(18)} ${missingHash}`)
const sameAsMissing = Object.entries(nHashes).filter(([, h]) => h === missingHash).map(([f]) => f)
console.log(`    与"不存在"位图相同的具名字体: ${sameAsMissing.length ? sameAsMissing.join(", ") : "（无）"}`)

console.log("\n  ── D. 页面自己报告的可用字体 ──")
const api = await page.evaluate(async () => {
  const out = { hasQueryLocalFonts: typeof window.queryLocalFonts === "function", count: null, sample: [] }
  if (out.hasQueryLocalFonts) {
    try {
      const fonts = await window.queryLocalFonts()
      out.count = fonts.length
      out.sample = [...new Set(fonts.map((f) => f.family))].slice(0, 15)
    } catch (e) {
      out.error = String(e).slice(0, 80)
    }
  }
  return out
})
console.log(`    window.queryLocalFonts 存在: ${api.hasQueryLocalFonts}`)
if (api.count !== null) console.log(`    可枚举字体数: ${api.count}，示例: ${api.sample.join(", ")}`)
if (api.error) console.log(`    调用出错: ${api.error}`)

console.log("\n  ── 结论 ──")
if (distinctGenerics <= 1) {
  console.log("    此 headless Chromium 连通用族都不区分 → 字体渲染不可用，")
  console.log("    所有基于此处截图的字体结论都无效（不能用来判断本机字体）。")
} else if (distinctNamed <= 1) {
  console.log("    通用族可区分，但所有具名字体渲染完全相同 → 解析不到系统字体。")
  console.log("    即：这个浏览器看不到 C:\\Windows\\Fonts，因此不能用来做本机字体探测。")
} else {
  console.log("    具名字体之间可区分 → 该浏览器能看到系统字体。")
}

await browser.close()
