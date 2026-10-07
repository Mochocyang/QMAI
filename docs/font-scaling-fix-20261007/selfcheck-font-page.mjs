/**
 * 自检可视化页面的字体探测是否准确。
 *
 * 为什么必须自检：这一页是拿给用户做决策的。如果探测逻辑坏了，
 * 用户会看到"本机已安装"却其实没有，据此选出来的字体装了也没用 ——
 * 那就是用错误的证据引导决定。
 *
 * 做法：用真实 Chrome 打开该页，等探测脚本跑完，取出每个徽标的文字，
 * 与"我已知的本机字体"对照，并截图存证。
 */
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const url = process.argv[2] ?? "http://localhost:55860"

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } })

const errors = []
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)))
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)) })

await page.goto(url, { waitUntil: "load" })
await page.waitForTimeout(1200)

// 探测结果
const rows = await page.evaluate(() =>
  [...document.querySelectorAll(".probe")].map((el) => ({
    font: el.getAttribute("data-font"),
    badge: el.textContent.trim(),
  })),
)

console.log("  徽标探测结果：")
for (const r of rows) console.log(`    ${r.badge.padEnd(8)}  ${r.font}`)

const summary = await page.evaluate(() => {
  const el = [...document.querySelectorAll("p")].find((p) => p.textContent.includes("现场检测结果"))
  return el ? el.textContent.replace(/\s+/g, " ").trim() : "(未找到总结行)"
})
console.log(`\n  页顶总结：${summary}`)

// 独立复核：用 Playwright 自己再测一遍，和页面结论对照
const independent = await page.evaluate((fonts) => {
  const c = document.createElement("canvas")
  const ctx = c.getContext("2d")
  const t = "青幕写作第章汉字测试国语音ABCabc123，。"
  ctx.font = "72px monospace"
  const base = ctx.measureText(t).width
  const out = {}
  for (const f of fonts) {
    ctx.font = `72px "${f}", monospace`
    out[f] = Math.abs(ctx.measureText(t).width - base) > 0.5
  }
  return out
}, rows.map((r) => r.font))

console.log("\n  独立复核（页面外重算一次）：")
let mismatch = 0
for (const r of rows) {
  const pageSaidYes = r.badge.includes("已安装") && !r.badge.includes("未安装")
  const mine = independent[r.font]
  const agree = pageSaidYes === mine
  if (!agree) mismatch++
  console.log(`    ${agree ? "一致" : "不一致"}  页面=${pageSaidYes ? "有" : "无"}  复核=${mine ? "有" : "无"}  ${r.font}`)
}

console.log()
if (errors.length) {
  console.log("  页面报错：")
  for (const e of errors.slice(0, 5)) console.log(`    ${e}`)
}
console.log(mismatch === 0 ? "  自检通过：探测与独立复核完全一致" : `  自检失败：${mismatch} 处不一致`)

await page.screenshot({ path: process.argv[3] ?? "docs/font-scaling-fix-20261007/font-page.png", fullPage: true })
console.log("  已截图")
await browser.close()
if (mismatch !== 0) process.exitCode = 1
