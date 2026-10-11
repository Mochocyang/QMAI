/**
 * 用真实浏览器打开兜底渲染出的 HTML，截图确认「不是空白、标签正确、排版可用」。
 * 输入：%TEMP%\real-*.html（由 render-real-files.mjs 产出）。
 */
import { readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const playwrightPath = `${process.env.APPDATA}/npm/node_modules/playwright/index.js`
const mod = await import(pathToFileURL(playwrightPath).href)
const chromium = mod.chromium ?? mod.default?.chromium

const dir = process.env.TEMP
const files = readdirSync(dir).filter((f) => f.startsWith("real-") && f.endsWith(".html")).sort()
if (!files.length) { console.log("没有 real-*.html，请先跑 render-real-files.mjs"); process.exit(1) }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
for (const f of files) {
  const full = join(dir, f)
  if (!existsSync(full)) continue
  await page.goto(pathToFileURL(full).href)
  await page.waitForTimeout(150)
  const info = await page.evaluate(() => {
    const eyebrow = document.querySelector(".eyebrow")?.textContent?.trim() ?? "(无)"
    const cards = document.querySelectorAll("details.cc").length
    const body = document.body
    return {
      eyebrow,
      cards,
      height: body.scrollHeight,
      textLen: (body.innerText || "").replace(/\s+/g, "").length,
      hasEmptyHint: (body.innerText || "").includes("cards 为空"),
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  const shot = join(dir, f.replace(/\.html$/, ".png"))
  await page.screenshot({ path: shot, fullPage: false })
  console.log(`${f}`)
  console.log(`   头部="${info.eyebrow}"  卡片=${info.cards}  正文高度=${info.height}px  文本量=${info.textLen}字  空白提示=${info.hasEmptyHint}  横向溢出=${info.horizontalOverflow}px`)
  console.log(`   判定=${info.textLen > 50 && !info.hasEmptyHint && info.horizontalOverflow <= 0 ? "可用" : "!! 需复查"}  截图=${shot}`)
}
await browser.close()
