/**
 * 用 canvas getImageData 做像素哈希 —— 修正截图法，并对中文也有效。
 *
 * 为什么换法：
 *   - 截图哈希（locator.screenshot）与 canvas 测宽结论矛盾：后者证明 Arial 等
 *     拉丁字体可区分（宽度 846.59 vs 基准 800），前者却判"全部相同"。
 *     故截图法在此环境下不可信。
 *   - canvas 测宽对中文无效：CJK 全角字形宽度恒为 1em，黑体/宋体/楷体宽度相同。
 *   - canvas 读像素兼具两者：字体解析走 canvas（已知可用），
 *     判别靠像素缓冲（对中英文字形差异都敏感）。
 *
 * 判据：
 *   - 对照「不存在的字体」必须与基准相同（若不同则方法失效）
 *   - serif / sans-serif / monospace 必须互不相同
 *   - 已安装的中文字体之间必须互不相同 → 证明中文族名可解析
 */
import { createHash } from "node:crypto"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch({ headless: true })
const page = await browser.newPage()
await page.goto("data:text/html,<html><body></body></html>")

/** 在 canvas 上画文字并返回像素缓冲的哈希。 */
async function pixelHash(family, text, size) {
  return page.evaluate(({ family, text, size }) => {
    const c = document.createElement("canvas")
    c.width = 1400
    c.height = Math.ceil(size * 1.8)
    const ctx = c.getContext("2d")
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = "#000"
    ctx.font = `${size}px ${family}`
    ctx.textBaseline = "top"
    ctx.fillText(text, 4, 4)
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    // 简易 FNV-1a 哈希，只取非白像素以降低噪声
    let h = 0x811c9dc5
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) {
        h ^= data[i] | (data[i + 1] << 8) | (data[i + 2] << 16)
        h = Math.imul(h, 0x01000193) >>> 0
      }
    }
    return h.toString(16).padStart(8, "0")
  }, { family, text, size })
}

const LATIN = "Hamburgefonstiv WXYZ 0123 Il1O0"
const CJK = "青幕写作汉语字体测试国语音永"
const MIXED = "青幕AI写作 第1章 ABCabc 123，。"

async function runGroup(label, text, fonts) {
  console.log(`\n  ══ ${label} ══`)
  const base = await pixelHash(`"__QQQ_NoSuchFont_ZZZ__"`, text, 40)
  const generic = {
    serif: await pixelHash(`serif`, text, 40),
    "sans-serif": await pixelHash(`sans-serif`, text, 40),
    monospace: await pixelHash(`monospace`, text, 40),
  }
  console.log(`    不存在基准: ${base}`)
  console.log(`    serif=${generic.serif}  sans-serif=${generic["sans-serif"]}  monospace=${generic.monospace}`)
  const genericDistinct = new Set(Object.values(generic)).size

  const hashes = {}
  for (const f of fonts) hashes[f] = await pixelHash(`"${f}"`, text, 40)

  const distinct = new Set(Object.values(hashes)).size
  const sameAsBase = Object.entries(hashes).filter(([, h]) => h === base).map(([f]) => f)
  console.log(`    不同位图数: ${distinct}/${fonts.length}`)
  for (const [f, h] of Object.entries(hashes)) {
    console.log(`      ${f.padEnd(20)} ${h}${h === base ? "  ← 与'不存在'相同" : ""}`)
  }
  console.log(`    通用族可区分: ${genericDistinct > 1 ? "是" : "否"}`)
  console.log(`    与'不存在'相同者: ${sameAsBase.length ? sameAsBase.join(", ") : "（无）"}`)
  return { distinct, total: fonts.length, genericDistinct, sameAsBase }
}

const rA = await runGroup("A. 纯拉丁", LATIN, ["Arial", "Georgia", "Consolas", "Times New Roman", "Verdana", "Segoe UI"])
const rB = await runGroup("B. 纯中文", CJK, ["SimHei", "SimSun", "KaiTi", "Microsoft YaHei", "FangSong", "DengXian", "Microsoft JhengHei"])
const rC = await runGroup("B2. 纯中文·中文族名", CJK, ["微软雅黑", "黑体", "楷体", "宋体", "等线", "仿宋"])
const rD = await runGroup("C. 混合", MIXED, ["Arial", "SimHei", "KaiTi", "Microsoft YaHei"])

console.log("\n  ══ 方法自检与结论 ══")
const selfCheckOk = rA.genericDistinct > 1 && rB.genericDistinct > 1 &&
  rA.sameAsBase.length === 0 && rB.sameAsBase.length === 0

console.log(`    自检（对照字体必须与基准不同、通用族必须可区分）: ${selfCheckOk ? "通过" : "未通过"}`)
if (selfCheckOk) {
  console.log(`    拉丁具名字体可区分: ${rA.distinct}/${rA.total} → ${rA.distinct > 1 ? "是" : "否"}`)
  console.log(`    中文具名字体可区分: ${rB.distinct}/${rB.total} → ${rB.distinct > 1 ? "是" : "否"}`)
  console.log(`    中文族名（微软雅黑等）可区分: ${rC.distinct}/${rC.total} → ${rC.distinct > 1 ? "是" : "否"}`)
  console.log()
  if (rA.distinct > 1 && rB.distinct > 1) {
    console.log("    → 该浏览器能解析系统字体（含中文）。可用于验证字体修复。")
    console.log("    → 之前的\"看不到字体\"结论是截图哈希法的缺陷所致，已推翻。")
  } else {
    console.log("    → 通用族可用但具名字体不可区分。")
  }
} else {
  console.log("    → 方法仍不可靠，结论不能采信。")
}

await browser.close()
