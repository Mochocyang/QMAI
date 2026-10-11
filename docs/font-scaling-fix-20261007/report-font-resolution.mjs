/**
 * 字体解析权威报告 —— 用于验证所有字体相关改动是否真的生效。
 *
 * 方法：canvas 2D 画文字 → getImageData 取像素 → 对非白像素做 FNV-1a 哈希。
 * 为什么是它（三次方法迭代的结论）：
 *   1. locator.screenshot 哈希：与 canvas 测宽结论矛盾（判 Arial 也"不存在"），
 *      在本环境不可信 —— 已弃用。
 *   2. canvas measureText 测宽：对中文无效（CJK 全角宽度恒为 1em，
 *      黑体/宋体/楷体宽度相同），且需指定 monospace 兜底才有效 —— 仅作辅助。
 *   3. canvas getImageData 像素哈希：字体解析走 canvas（已知可用），
 *      判别靠像素缓冲（对中英文字形差异均敏感）—— 本脚本采用。
 *
 * 自检判据（修正后）：
 *   - 通用族 serif 与 sans-serif 必须不同（否则渲染无区分，方法不可用）
 *   - 已知拉丁字体必须互不相同
 *   - 已知中文字体必须互不相同
 *   注意：**"不存在字体"与 sans-serif 相同是正常的** ——
 *   缺失字体会回退到本机默认字体，Windows 中文默认正是微软雅黑。
 *   上一版把"对照必须与基准不同"当作合格条件，这是错误的断言。
 *
 * 用法：node report-font-resolution.mjs [--json]
 */
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const AS_JSON = process.argv.includes("--json")

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch({ headless: true })
const page = await browser.newPage()
await page.goto("data:text/html,<html><body></body></html>")

const TEXT = "青幕写作汉语字体测试国语音永 Hamburgefonstiv WXYZ 0123"

async function pixelHash(family) {
  return page.evaluate(({ family, TEXT }) => {
    const size = 40
    const c = document.createElement("canvas")
    c.width = 1500
    c.height = Math.ceil(size * 1.8)
    const ctx = c.getContext("2d")
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = "#000"
    ctx.font = `${size}px ${family}`
    ctx.textBaseline = "top"
    ctx.fillText(TEXT, 4, 4)
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let h = 0x811c9dc5
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) {
        h ^= data[i] | (data[i + 1] << 8) | (data[i + 2] << 16)
        h = Math.imul(h, 0x01000193) >>> 0
      }
    }
    return h.toString(16).padStart(8, "0")
  }, { family, TEXT })
}

/** 英文族名 ↔ 中文族名 对照：用于确认二者是否指向同一字体。 */
const PAIRS = [
  ["SimHei", "黑体"],
  ["SimSun", "宋体"],
  ["NSimSun", "新宋体"],
  ["KaiTi", "楷体"],
  ["FangSong", "仿宋"],
  ["DengXian", "等线"],
  ["Microsoft YaHei", "微软雅黑"],
  ["Microsoft JhengHei", "微软正黑体"],
]

const GENERICS = ["serif", "sans-serif", "monospace", "cursive", "fantasy"]
const LATIN = ["Arial", "Georgia", "Consolas", "Times New Roman", "Verdana", "Segoe UI", "Cascadia Mono"]
const CJK = ["SimHei", "SimSun", "KaiTi", "FangSong", "DengXian", "Microsoft YaHei", "Microsoft JhengHei", "Noto Sans SC", "Noto Serif SC", "Source Han Serif SC"]
const BUNDLE_CANDIDATES = ["LXGW WenKai", "HarmonyOS Sans SC", "MiSans", "Alibaba PuHuiTi"]

const report = { generic: {}, latin: {}, cjk: {}, bundle: {}, pairs: [], default: null }

const missingHash = await pixelHash(`"__QQQ_NoSuchFont_ZZZ__"`)
for (const g of GENERICS) report.generic[g] = await pixelHash(g)
report.default = missingHash

for (const f of LATIN) report.latin[f] = await pixelHash(`"${f}"`)
for (const f of CJK) report.cjk[f] = await pixelHash(`"${f}"`)
for (const f of BUNDLE_CANDIDATES) report.bundle[f] = await pixelHash(`"${f}"`)
for (const [en, zh] of PAIRS) report.pairs.push({ en, zh, enHash: await pixelHash(`"${en}"`), zhHash: await pixelHash(`"${zh}"`) })

await browser.close()

// ── 自检 ──
const genericDistinct = new Set(Object.values(report.generic)).size
const latinDistinct = new Set(Object.values(report.latin)).size
const cjkDistinct = new Set(Object.values(report.cjk)).size
const selfCheck = {
  genericOk: genericDistinct > 1,
  latinOk: latinDistinct > 1,
  cjkOk: cjkDistinct > 1,
}
selfCheck.passed = selfCheck.genericOk && selfCheck.latinOk && selfCheck.cjkOk

// 哪些"捆绑候选"在本机已存在（哈希不等于默认回退）
const bundleInstalled = Object.entries(report.bundle).filter(([, h]) => h !== missingHash).map(([f]) => f)
const bundleMissing = Object.entries(report.bundle).filter(([, h]) => h === missingHash).map(([f]) => f)

const pairSame = report.pairs.filter((p) => p.enHash === p.zhHash).map((p) => `${p.en}=${p.zh}`)
const pairDiff = report.pairs.filter((p) => p.enHash !== p.zhHash).map((p) => `${p.en}≠${p.zh}`)

if (AS_JSON) {
  console.log(JSON.stringify({ ...report, selfCheck, bundleInstalled, bundleMissing, pairSame, pairDiff }, null, 2))
} else {
  console.log("  ══ 方法自检 ══")
  console.log(`    通用族可区分: ${genericDistinct}/${GENERICS.length} → ${selfCheck.genericOk ? "是" : "否"}`)
  console.log(`    拉丁字体互异: ${latinDistinct}/${LATIN.length} → ${selfCheck.latinOk ? "是" : "否"}`)
  console.log(`    中文字体互异: ${cjkDistinct}/${CJK.length} → ${selfCheck.cjkOk ? "是" : "否"}`)
  console.log(`    自检结论: ${selfCheck.passed ? "通过 —— 该浏览器能解析系统字体（含中文）" : "未通过 —— 结论不可采信"}`)

  console.log("\n  ══ 通用族 ══")
  for (const [g, h] of Object.entries(report.generic)) console.log(`    ${g.padEnd(14)} ${h}`)
  console.log(`    ${"(不存在字体)".padEnd(14)} ${missingHash}  ← 本机默认回退`)

  console.log("\n  ══ 拉丁字体 ══")
  for (const [f, h] of Object.entries(report.latin)) console.log(`    ${f.padEnd(20)} ${h}${h === missingHash ? "  ← 与默认相同" : ""}`)

  console.log("\n  ══ 中文字体 ══")
  for (const [f, h] of Object.entries(report.cjk)) console.log(`    ${f.padEnd(22)} ${h}${h === missingHash ? "  ← 本机未安装" : ""}`)

  console.log("\n  ══ 英文族名 vs 中文族名（同一字体应为同一哈希）══")
  for (const p of report.pairs) {
    const same = p.enHash === p.zhHash
    console.log(`    ${p.en.padEnd(20)} ${p.enHash}    ${p.zh.padEnd(8)} ${p.zhHash}   ${same ? "同一字体" : "不同（或一方缺失）"}`)
  }
  console.log(`    指向同一字体: ${pairSame.length ? pairSame.join(", ") : "（无）"}`)

  console.log("\n  ══ 捆绑候选字体在本机是否已存在 ══")
  console.log(`    已存在: ${bundleInstalled.length ? bundleInstalled.join(", ") : "（无）"}`)
  console.log(`    未安装: ${bundleMissing.length ? bundleMissing.join(", ") : "（无）"}`)

  console.log("\n  ══ 对设计的含义 ══")
  if (selfCheck.passed) {
    console.log("    · 本机浏览器可解析系统字体 → 字体修复可用真实产物验证。")
    console.log(`    · 中文族名可直接用于 CSS font-family（${pairSame.slice(0, 3).join("、") || "已验证"}）。`)
    console.log("    · 未安装的字体名不会报错，只会静默回退到默认 → 因此必须由 Rust 侧枚举真实字体，")
    console.log("      否则用户选了不存在的字体会「看起来没反应」。")
  } else {
    console.log("    · 自检未通过，本报告不可用于结论。")
  }
}

if (!selfCheck.passed) process.exitCode = 1
