/**
 * 截图更新日志预览，便于直接在对话里查看。
 * Playwright 走全局安装（本仓库未本地安装）。
 */
import { pathToFileURL } from "node:url"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const mod = await import(pathToFileURL(`${process.env.APPDATA}/npm/node_modules/playwright/index.js`).href)
const chromium = mod.chromium ?? mod.default?.chromium

const here = dirname(fileURLToPath(import.meta.url))
const page_url = pathToFileURL(resolve(here, "changelog-preview.html")).href

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  await page.goto(page_url, { waitUntil: "load" })
  await page.waitForTimeout(200)

  // 整页：浅色 / 深色 / 折叠态 / 对比
  await page.screenshot({ path: resolve(here, "shots-changelog/overview.png"), fullPage: true })

  // 深色那张单独出，正文最长
  const dark = page.locator(".pane.dark")
  await dark.screenshot({ path: resolve(here, "shots-changelog/dark.png") })

  // 默认折叠态
  const collapsed = page.locator(".pane").nth(2)
  await collapsed.screenshot({ path: resolve(here, "shots-changelog/collapsed.png") })

  // 英文态
  await page.getByRole("button", { name: "English" }).click()
  await page.waitForTimeout(150)
  await page.screenshot({ path: resolve(here, "shots-changelog/en-overview.png"), fullPage: true })

  const items = await page.locator("#card-light li").count()
  console.log(`浅色卡片条目数：${items}`)
} finally {
  await browser.close()
}
console.log("截图完成")
