/**
 * 测试哪种浏览器能真正解析系统字体 —— 决定我能否验证字体修复。
 *
 * 背景：bundled headless Chromium 解析不到 C:\Windows\Fonts
 * （Arial 等具名字体的位图与"不存在的字体"完全相同），
 * 导致我无法用它在真实产物上验证字体设置是否生效。
 *
 * 本脚本对比三种启动方式：
 *   1. bundled Chromium，headless
 *   2. bundled Chromium，headed（带界面）
 *   3. 真实 Chrome（channel: chrome / 指定 exe），headless
 *   4. 真实 Chrome，headed
 *
 * 判据：用一组"确定存在的系统字体"渲染，看位图是否互不相同、
 * 且与"不存在的字体"不同。同时给出中文族名（如"微软雅黑"）是否可匹配。
 */
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const chromium = mod.chromium ?? mod.default.chromium

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
console.log(`  真实 Chrome 存在: ${existsSync(CHROME_EXE)}`)

const NAMED = ["Arial", "Times New Roman", "SimHei", "Microsoft YaHei", "KaiTi", "Consolas"]
const CHINESE_NAMES = ["微软雅黑", "黑体", "楷体", "宋体"]

async function probe(label, launchOptions) {
  let browser
  try {
    browser = await chromium.launch(launchOptions)
  } catch (e) {
    console.log(`\n  【${label}】启动失败: ${String(e.message).split("\n")[0].slice(0, 110)}`)
    return null
  }

  const page = await browser.newPage({ viewport: { width: 900, height: 200 }, deviceScaleFactor: 1 })
  await page.goto("data:text/html,<html><body style='margin:0;background:#fff'></body></html>")

  async function hashOf(family) {
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">
      <div id="t" style="font-family:${family};font-size:44px;line-height:1.3;white-space:pre;padding:10px;color:#000">青幕AI写作 第1章 ABCabc 123，。</div>
    </body></html>`)
    await page.waitForTimeout(170)
    return createHash("sha256").update(await page.locator("#t").screenshot()).digest("hex").slice(0, 10)
  }

  const missing = await hashOf(`"__QQQ_NoSuchFont_ZZZ__"`)
  const named = {}
  for (const f of NAMED) named[f] = await hashOf(`"${f}"`)
  const chinese = {}
  for (const f of CHINESE_NAMES) chinese[f] = await hashOf(`"${f}"`)

  await browser.close()

  const namedHashes = Object.values(named)
  const distinct = new Set(namedHashes).size
  const sameAsMissing = Object.entries(named).filter(([, h]) => h === missing).map(([f]) => f)
  const cnWorks = Object.entries(chinese).filter(([, h]) => h !== missing).map(([f]) => f)

  console.log(`\n  【${label}】`)
  console.log(`    具名字体不同位图数: ${distinct}/${NAMED.length}  ${distinct > 1 ? "→ 能看到系统字体 ✓" : "→ 看不到系统字体 ✗"}`)
  console.log(`    与"不存在"相同者: ${sameAsMissing.length ? sameAsMissing.join(", ") : "（无）"}`)
  console.log(`    中文族名可匹配: ${cnWorks.length ? cnWorks.join(", ") : "（无）"}`)
  return { label, usable: distinct > 1, cnWorks }
}

const results = []
results.push(await probe("bundled Chromium · headless", { headless: true }))
results.push(await probe("bundled Chromium · headed", { headless: false }))
results.push(await probe("真实 Chrome · headless", { headless: true, executablePath: CHROME_EXE }))
results.push(await probe("真实 Chrome · headed", { headless: false, executablePath: CHROME_EXE }))

console.log("\n  ══ 汇总 ══")
for (const r of results) {
  if (!r) continue
  console.log(`    ${r.label.padEnd(30)} ${r.usable ? "可用（能验字体）" : "不可用"}`)
}

const usable = results.filter((r) => r && r.usable)
console.log()
if (usable.length) {
  console.log(`  → 用「${usable[0].label}」即可在真实产物上验证字体设置。`)
} else {
  console.log("  → 没有任何浏览器能解析系统字体；字体生效性必须改用应用内自检")
  console.log("    （例如：Rust 侧枚举 + 前端读取实际计算字体，或渲染截图对比）。")
}
