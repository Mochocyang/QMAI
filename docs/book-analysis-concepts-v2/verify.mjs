import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs"

const directory = path.dirname(fileURLToPath(import.meta.url))
const screenshots = path.join(directory, "screenshots")
await fs.mkdir(screenshots, { recursive: true })
const browser = await chromium.launch({
  executablePath: "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe",
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
const errors = []
page.on("pageerror", error => errors.push(error.message))
const url = pathToFileURL(path.join(directory, "index.html")).href
const action = (name, value) => page.locator(`[data-action="${name}"]${value === undefined ? "" : `[data-value="${value}"]`}`)
const checks = []
const check = (value, name) => { assert.ok(value, name); checks.push(name) }
async function fit(name) {
  const metrics = await page.evaluate(() => ({
    width: innerWidth,
    content: document.documentElement.scrollWidth,
    logo: document.querySelector(".app-id img").naturalWidth,
    icons: document.querySelectorAll("#app svg").length,
    header: document.querySelector(".app-header").getBoundingClientRect().height,
    overflow: [...document.querySelectorAll(".btn,.type-pick,.skill-card,.request-title")].filter(el =>
      el.getBoundingClientRect().width > 0 && el.scrollWidth > el.clientWidth + 2).map(el => el.textContent),
  }))
  check(metrics.width >= metrics.content, `${name}: no page overflow`)
  check(metrics.overflow.length === 0, `${name}: controls fit (${metrics.overflow.join(",")})`)
  check(metrics.logo > 0 && metrics.icons > 10, `${name}: assets rendered`)
  if(metrics.width > 760) check(metrics.header <= 66, `${name}: compact header`)
}
async function screenshot(name, fullPage = true) {
  await page.screenshot({ path: path.join(screenshots, name + ".png"), fullPage })
}
try {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    for (const design of ["A", "B", "C"]) {
      await page.goto(`${url}#${design}`)
      await fit(`${design}-${width}`)
      await screenshot(`${design}-${width}`)
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${url}#A`)
  await page.getByLabel("起始章节").fill("101")
  await page.getByLabel("结束章节").fill("123")
  await action("range").click()
  check((await page.locator(".selection-summary").innerText()).includes("23章"), "range beyond chapter 100")
  await action("preset", "all").click()
  check((await page.locator(".selection-summary").innerText()).includes("923章"), "whole-book selection")
  await action("chapters").click()
  await action("clearChapters").click()
  await page.getByLabel("搜索章节").fill("101")
  await page.locator('[data-chapter="101"]').check()
  await page.getByLabel("搜索章节").fill("123")
  await page.locator('[data-chapter="123"]').check()
  check((await page.locator("#chapter-count").innerText()).includes("2"), "non-contiguous chapters retained")
  await page.getByLabel("搜索章节").fill("")
  await page.locator('[data-chapter="125"]').click({ modifiers: ["Shift"] })
  check((await page.locator("#chapter-count").innerText()).includes("4"), "Shift range selection")
  await screenshot("A-chapters-1440")
  await action("chapters").click()
  await page.getByLabel("角色灵魂需求", { exact: true }).fill("保留缺点，不继承职业")
  await page.getByLabel("分析故事框架").check()
  await page.getByLabel("故事框架需求", { exact: true }).fill("只关注信息投放")
  await page.getByLabel("分析文风规则").check()
  await page.getByLabel("文风规则需求", { exact: true }).fill("只关注对白")
  await action("focusDemand", "character").click()
  check(await page.getByLabel("角色灵魂需求", { exact: true }).inputValue() === "保留缺点，不继承职业", "three independent requirements")
  check(await page.locator("[data-type]:checked").count() === 3, "three analyses can be selected together")
  await page.getByLabel("搜索成果").fill("魏渊")
  check(await page.locator(".skill-card").count() === 1, "result search")
  await page.getByLabel("搜索成果").fill("")
  await page.locator('[data-input="pending"]').check()
  check(await page.locator(".skill-card").count() === 2, "pending filter")
  await page.locator('[data-input="pending"]').uncheck()
  await action("view", "list").click()
  check(await page.locator(".skill-grid").evaluate(el => el.classList.contains("list")), "list view")
  await action("view", "grid").click()
  await action("expand", "xqa").click()
  await action("review", "xqa").click()
  check(await page.locator(".rule-review h3").count() === 3, "complete rule review")
  await page.locator(".rule-review summary").first().click()
  check(await page.locator(".rule-review details").first().evaluate(el => el.open), "evidence disclosure")
  await page.keyboard.press("Escape")
  check(!(await page.locator("#modal").evaluate(el => el.open)), "Escape dismisses")
  await action("import").first().click()
  await page.locator("#files").setInputFiles([
    { name: "样例一.txt", mimeType: "text/plain", buffer: Buffer.from("示例") },
    { name: "样例二.txt", mimeType: "text/plain", buffer: Buffer.from("示例") },
  ])
  check(await page.locator(".file-row").count() === 2, "batch import preview")
  await page.setViewportSize({ width: 390, height: 844 })
  await screenshot("import-390", false)
  check(await page.locator("#modal").evaluate(el => el.scrollWidth <= el.clientWidth), "mobile import fits")
  await action("submitImport").click()
  await action("books").click()
  await page.mouse.click(5, 5)
  check(!(await page.locator("#modal").evaluate(el => el.open)), "outside click dismisses")
  await page.setViewportSize({ width: 1440, height: 1000 })
  await action("generate").click()
  await action("pause").click()
  check((await page.locator(".progress-line").innerText()).includes("已暂停"), "pause simulation")
  await action("pause").click()
  await page.waitForTimeout(2500)
  check((await page.locator(".progress-line").innerText()).includes("本次模拟分析完成"), "resume simulation")
  await action("design", "B").click()
  await page.getByLabel("生成故事框架").check()
  await page.getByLabel("生成文风规则").check()
  check(await page.locator(".request-body").count() === 3, "B all request sections expand")
  await page.setViewportSize({ width: 390, height: 844 })
  await fit("B-expanded-390")
  await screenshot("B-expanded-390")
  await page.setViewportSize({ width: 1440, height: 1000 })
  await action("design", "C").click()
  await action("evidence", "0").click()
  check(await page.locator(".inline-evidence").count() === 1, "C inline evidence")
  await action("revise").first().click()
  await page.getByLabel("修订要求").fill("保留人物犹豫的一面")
  await action("submitRevision").click()
  await page.waitForTimeout(2500)
  check((await page.locator(".editor-toolbar").innerText()).includes("v3"), "C revision version")
  await action("confirm").click()
  await action("submitConfirm").click()
  check((await page.locator(".editor-toolbar").innerText()).includes("已入库"), "C confirmation")
  await action("composer").click()
  check(await page.locator(".editor-composer").isVisible(), "C inline analysis settings")
  await page.setViewportSize({ width: 390, height: 844 })
  await fit("C-composer-390")
  await screenshot("C-composer-390")
  const downloadPromise = page.waitForEvent("download")
  await action("download").first().click()
  const download = await downloadPromise
  check(download.suggestedFilename().startsWith("设计样例"), "export is marked sample")
  check(errors.length === 0, `no page errors (${errors.join(",")})`)
  console.log(JSON.stringify({ checks: checks.length, passed: checks, errors, screenshots }, null, 2))
} finally {
  await browser.close()
}
