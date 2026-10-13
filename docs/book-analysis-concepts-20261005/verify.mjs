import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs"

const directory = path.dirname(fileURLToPath(import.meta.url))
const output = path.join(directory, "screenshots")
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  executablePath: "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe",
  headless: true,
})
const errors = []
const checks = []
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
page.on("pageerror", error => { errors.push(error.message); console.error(error.stack) })
page.on("console", message => { if(message.type() === "error") console.error(message.text()) })
const url = pathToFileURL(path.join(directory, "index.html")).href
const action = (name, value) => page.locator(`[data-action="${name}"]${value === undefined ? "" : `[data-value="${value}"]`}`)
const verify = (condition, name) => { assert.ok(condition, name); checks.push(name) }
async function fit(name) {
  const size = await page.evaluate(() => ({
    viewport: innerWidth, content: document.documentElement.scrollWidth,
    logo: document.querySelector(".brand img").naturalWidth,
    icons: document.querySelectorAll("#workspace svg").length,
  }))
  verify(size.content <= size.viewport, `${name}: no horizontal overflow (${size.content}/${size.viewport})`)
  verify(size.logo > 0 && size.icons > 10, `${name}: logo and icons rendered (${JSON.stringify(size)})`)
}
try {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    for (const scheme of ["A", "B", "C"]) {
      await page.goto(`${url}#${scheme}`)
      await fit(`${scheme}-${width}`)
      await page.screenshot({ path: path.join(output, `${scheme}-${width}.png`), fullPage: true })
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${url}#A`)
  await page.getByLabel("起始章节").fill("101")
  await page.getByLabel("结束章节").fill("123")
  await action("applyRange").click()
  verify((await page.locator(".demand-footer").innerText()).includes("23"), "range after chapter 101")
  await action("preset", "all").click()
  verify((await page.locator(".demand-footer").innerText()).includes("923"), "whole-book selection")
  await action("chapters").click()
  await action("clearChapters").click()
  await page.getByLabel("搜索章节").fill("101")
  await page.locator('[data-chapter="101"]').check()
  await page.getByLabel("搜索章节").fill("123")
  await page.locator('[data-chapter="123"]').check()
  await action("applyChapters").click()
  verify((await page.locator(".demand-footer").innerText()).includes("已选 2 章"), "non-contiguous selection persists across search")
  await action("chapters").click()
  await page.getByLabel("搜索章节").fill("123")
  verify(await page.locator('[data-chapter="123"]').isChecked(), "selection retained on reopen")
  await page.keyboard.press("Escape")
  verify(!(await page.locator("#modal").evaluate(el => el.open)), "Escape dismisses dialog")
  await action("books").click()
  await page.mouse.click(10, 10)
  verify(!(await page.locator("#modal").evaluate(el => el.open)), "outside click dismisses dialog")
  await action("kind", "story").click()
  await page.getByLabel("故事 Skill需求").fill("测试独立故事需求")
  await action("kind", "style").click()
  await page.getByLabel("文风 Skill需求").fill("测试独立文风需求")
  await action("kind", "story").click()
  verify(await page.getByLabel("故事 Skill需求").inputValue() === "测试独立故事需求", "independent requirements")
  await action("kind", "characters").click()
  await page.getByLabel("搜索成果").fill("魏渊")
  verify(await page.locator(".result-row:visible").count() === 1, "results search")
  await page.getByLabel("搜索成果").fill("")
  await action("filter").click()
  await page.locator("#filter-pending").check()
  await action("applyFilter").click()
  verify(await page.locator(".result-row:visible").count() === 2, "pending filter")
  await action("filter").click()
  await page.locator("#filter-pending").uncheck()
  await action("applyFilter").click()
  verify(await page.locator(".result-row:visible").count() === 3, "clear pending filter")
  await action("expand", "0").first().click()
  await action("evidence", "0").click()
  verify(await page.locator(".evidence-quote").isVisible(), "evidence details")
  await action("close").first().click()
  await page.screenshot({ path: path.join(output, "A-expanded-1440.png"), fullPage: true })
  await action("import").click()
  await page.locator("#files").setInputFiles([
    { name: "样例一.txt", mimeType: "text/plain", buffer: Buffer.from("预览样例") },
    { name: "样例二.txt", mimeType: "text/plain", buffer: Buffer.from("预览样例") },
  ])
  verify(await page.locator(".file-item").count() === 2, "multiple TXT file preview")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, "import-390.png") })
  verify(await page.locator("#modal").evaluate(el => el.scrollWidth <= el.clientWidth), "import dialog fits mobile")
  await action("submitImport").click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await action("scheme", "B").click()
  await action("generate").click()
  await action("pause").click()
  verify((await page.locator(".job-strip").innerText()).includes("已暂停"), "pause simulated analysis")
  await action("pause").click()
  await page.waitForTimeout(2000)
  await action("step", "4").first().click()
  verify(await page.locator(".rule-line").count() === 3, "step flow results")
  await action("scheme", "C").click()
  await action("composer").first().click()
  verify(await page.locator(".inline-composer").isVisible(), "C inline new-analysis settings")
  await action("composer").first().click()
  await action("revise").click()
  await page.getByLabel("补充修订要求").fill("减少绝对化判断")
  await action("submitRevision").click()
  await page.waitForTimeout(2000)
  verify((await page.locator(".document-heading").innerText()).includes("v3"), "revision creates new displayed version")
  await action("confirm").click()
  await action("submitConfirm").click()
  verify((await page.locator(".document-heading").innerText()).includes("已确认"), "confirmation updates preview status")
  const downloadPromise = page.waitForEvent("download")
  await action("download").first().click()
  const download = await downloadPromise
  verify(download.suggestedFilename().includes("设计示例"), "export is explicitly labeled sample")
  await page.getByLabel("搜索成果").fill("魏渊")
  verify(!(await page.locator("#results article").isVisible()) && await page.locator(".other-result:visible").count() === 1, "C search filters primary and secondary results")
  verify(errors.length === 0, "no browser JavaScript errors")
  console.log(JSON.stringify({ checks: checks.length, passed: checks, errors, screenshots: output }, null, 2))
} finally {
  await browser.close()
}
