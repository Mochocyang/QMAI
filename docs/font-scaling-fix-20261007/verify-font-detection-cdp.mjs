/**
 * 用 CDP 的 CSS.getPlatformFontsForNode 取"实际渲染用了哪个字体"的权威答案。
 *
 * 为什么必须换方法：我先前用 canvas 测宽判断字体是否存在，它报 SimHei「未安装」，
 * 但 C:\Windows\Fonts\simhei.ttf 明明存在、注册表也注册为 "SimHei"。
 * 而我的"独立复核"用的是同一套 canvas 测宽 —— 两次一致只能说明实现一致，
 * 发现不了方法本身的盲区。
 *
 * CSS.getPlatformFontsForNode 不问宽度，而是让浏览器报告它真正加载了哪个字体族，
 * 机制完全不同，因此可以证伪 canvas 的结论。
 */
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const CANDIDATES = [
  ["SimHei", "SimHei"],
  ["NSimSun", "NSimSun"],
  ["SimSun", "SimSun"],
  ["Microsoft YaHei", "Microsoft YaHei"],
  ["Noto Sans SC", "Noto Sans SC"],
  ["Source Han Serif SC", "Source Han Serif SC"],
  ["Noto Serif SC", "Noto Serif SC"],
  ["Microsoft JhengHei", "Microsoft JhengHei"],
  ["KaiTi", "KaiTi"],
  ["FangSong", "FangSong"],
  ["DengXian", "DengXian"],
  ["Microsoft YaHei UI", "Microsoft YaHei UI"],
  // 期望"不存在"的对照：用它来确认"报告出的族名 = 我请求的族名"确实意味着命中
  ["__DefinitelyMissingFont__", "__DefinitelyMissingFont__"],
]

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()
const page = await browser.newPage()

// 用 data: 空白页，排除应用 CSS 干扰
await page.goto("data:text/html,<html><body></body></html>")

const cdp = await page.context().newCDPSession(page)
await cdp.send("DOM.enable")
await cdp.send("CSS.enable")

// 建好探针元素：每个都用「候选字体 + 明确不存在的兜底」，
// 这样若候选字体不存在，就会落到兜底字体，报告出来的族名就不是候选字体
await page.evaluate((cands) => {
  const host = document.body
  for (const [label, family] of cands) {
    const d = document.createElement("div")
    d.id = "probe-" + label.replace(/[^A-Za-z0-9]/g, "_")
    d.textContent = "青幕写作第章汉字测试ABC123"
    d.style.cssText = `font-family: "${family}", "__DefinitelyMissingFont__"; font-size: 40px;`
    host.appendChild(d)
  }
}, CANDIDATES)

const { root } = await cdp.send("DOM.getDocument")

console.log("  请求的族名".padEnd(30) + "浏览器实际使用的族名")
console.log("  " + "─".repeat(64))

const results = []
for (const [label, family] of CANDIDATES) {
  const id = "probe-" + label.replace(/[^A-Za-z0-9]/g, "_")
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#" + id })
  let actual = "(查询失败)"
  try {
    const r = await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
    const fonts = r.fonts ?? []
    actual = fonts.map((f) => f.familyName).join(" + ") || "(无)"
  } catch (e) {
    actual = "错误: " + String(e.message).slice(0, 60)
  }
  const hit = actual.includes(family)
  results.push({ label, family, actual, hit })
  console.log(`  ${label.padEnd(28)} ${actual}${hit ? "   ← 命中" : ""}`)
}

console.log()
const missingControl = results.find((r) => r.family === "__DefinitelyMissingFont__")
console.log(`  对照：不存在的字体 → 实际用了「${missingControl.actual}」，` +
  (missingControl.hit ? "仍报命中（说明该方法不可靠！）" : "未命中（说明该方法能正确识别缺失）"))

console.log("\n  canvas 测宽与实际渲染不一致的字体：")
let disagree = 0
const canvasResult = await page.evaluate((cands) => {
  const c = document.createElement("canvas")
  const ctx = c.getContext("2d")
  const t = "青幕写作第章汉字测试国语音ABCabc123，。"
  ctx.font = "72px monospace"
  const base = ctx.measureText(t).width
  const out = {}
  for (const [, f] of cands) {
    ctx.font = `72px "${f}", monospace`
    out[f] = Math.abs(ctx.measureText(t).width - base) > 0.5
  }
  return out
}, CANDIDATES)

for (const r of results) {
  if (r.family === "__DefinitelyMissingFont__") continue
  const canvasSays = canvasResult[r.family]
  if (canvasSays !== r.hit) {
    disagree++
    console.log(`    ${r.family}: canvas=${canvasSays ? "有" : "无"}  实际渲染=${r.hit ? "有" : "无"}`)
  }
}
console.log(disagree === 0 ? "    （无不一致）" : `    共 ${disagree} 处不一致`)

await browser.close()
