/**
 * 修正上一次测试的方法缺陷：区分"拉丁字形"与"中文字形"。
 *
 * 上次四个浏览器一致报"看不到系统字体"，这个一致性可疑。
 * 更可能的解释：测试串以中文为主，而 Arial/Consolas 这类拉丁字体
 * 并不含中文字形，于是中文部分统一回退到同一个中文字体 ——
 * 若拉丁部分又恰好都落到同一回退，位图就会相同，得出假结论。
 *
 * 本脚本用三类字符串分别测试：
 *   A) 纯拉丁 —— 检验 Arial/Georgia/Consolas/Times 是否真的可区分
 *   B) 纯中文 —— 检验黑体/宋体/楷体/雅黑 是否可区分
 *   C) 混合   —— 上次用的那种
 * 并对每个字体额外测"拉丁+该字体"的宽度，交叉印证。
 */
import { createHash } from "node:crypto"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1000, height: 200 }, deviceScaleFactor: 1 })
await page.goto("data:text/html,<html><body style='margin:0;background:#fff'></body></html>")

const LATIN = "Hamburgefonstiv WXYZ 0123 Il1O0"
const CJK = "青幕写作汉语字体测试国语音，。"
const MIXED = "青幕AI写作 第1章 ABCabc 123，。"

async function hashOf(family, text) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">
    <div id="t" style="font-family:${family};font-size:40px;line-height:1.3;white-space:pre;padding:8px;color:#000">${text}</div>
  </body></html>`)
  await page.waitForTimeout(160)
  return createHash("sha256").update(await page.locator("#t").screenshot()).digest("hex").slice(0, 10)
}

const GROUPS = [
  ["A. 纯拉丁", LATIN, ["Arial", "Georgia", "Consolas", "Times New Roman", "Segoe UI", "Verdana"]],
  ["B. 纯中文", CJK, ["SimHei", "SimSun", "KaiTi", "Microsoft YaHei", "FangSong", "DengXian"]],
  ["C. 混合", MIXED, ["Arial", "SimHei", "KaiTi", "Microsoft YaHei"]],
]

for (const [label, text, fonts] of GROUPS) {
  console.log(`\n  ══ ${label} ══`)
  const missingHash = await hashOf(`"__QQQ_NoSuchFont_ZZZ__"`, text)
  const genericHash = await hashOf(`serif`, text)
  const sansHash = await hashOf(`sans-serif`, text)
  console.log(`    不存在字体: ${missingHash}   serif: ${genericHash}   sans-serif: ${sansHash}`)

  const hashes = {}
  for (const f of fonts) hashes[f] = await hashOf(`"${f}"`, text)

  const distinct = new Set(Object.values(hashes)).size
  console.log(`    不同位图数: ${distinct}/${fonts.length}`)
  for (const [f, h] of Object.entries(hashes)) {
    const tag = h === missingHash ? "  ← 与'不存在'相同" : ""
    console.log(`      ${f.padEnd(18)} ${h}${tag}`)
  }
  console.log(`    → ${distinct > 1 ? "可区分（字体能生效）" : "不可区分"}`)
}

// 交叉印证：用 canvas 测宽度，看拉丁字体宽度是否各自不同
console.log("\n  ══ 交叉印证：canvas 测宽（纯拉丁）══")
const widths = await page.evaluate(() => {
  const c = document.createElement("canvas")
  const ctx = c.getContext("2d")
  const t = "Hamburgefonstiv WXYZ 0123"
  const out = {}
  for (const f of ["monospace", '"Arial", monospace', '"Georgia", monospace', '"Consolas", monospace', '"Times New Roman", monospace', '"Verdana", monospace', '"__NoSuch__", monospace']) {
    ctx.font = `64px ${f}`
    out[f] = Number(ctx.measureText(t).width.toFixed(2))
  }
  return out
})
for (const [f, w] of Object.entries(widths)) console.log(`    ${f.padEnd(28)} ${w}`)
const uniq = new Set(Object.values(widths)).size
console.log(`    不同宽度数: ${uniq}/${Object.keys(widths).length} → ${uniq > 1 ? "拉丁字体可区分" : "拉丁字体亦不可区分"}`)

await browser.close()
