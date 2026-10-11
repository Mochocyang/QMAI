/**
 * 用**像素比对**判断字体是否真的生效 —— 这是不依赖任何宽度/族名报告的方法。
 *
 * 为什么前两种方法都不可信：
 *   - canvas 测宽：报 SimHei「未安装」，但 C:\Windows\Fonts\simhei.ttf 确实存在
 *     且注册表注册为 "SimHei"。它的"独立复核"用的是同一套测宽，无法证伪自己。
 *   - CDP CSS.getPlatformFontsForNode：连"微软雅黑"都返回空族名列表，
 *     而用不存在的字体名时它回退到微软雅黑 —— 说明该接口在这里不稳定/不可靠。
 *
 * 本方法的原理：
 *   同一段文字，分别用
 *     A) font-family: "候选字体", <哨兵兜底>
 *     B) font-family: <哨兵兜底>
 *   渲染成位图。若候选字体真的生效，两张位图必然不同；
 *   若候选字体不存在，A 完全等同于 B，位图逐字节相同。
 *
 * 哨兵兜底用一个自造的 @font-face（内嵌一个已知 base64 字体）会更严格，
 * 但这里用"不存在的族名 + 多个通用族"已足够：只要 A/B 有差异，
 * 就证明"候选字体名"改变了渲染 —— 那它必然存在。
 */
import { createHash } from "node:crypto"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/** 待测字体：含"确定存在"与"确定不存在"的对照，用来验证方法本身有效。 */
const FONTS = [
  "SimHei",
  "NSimSun",
  "SimSun",
  "Microsoft YaHei",
  "Microsoft YaHei UI",
  "KaiTi",
  "FangSong",
  "DengXian",
  "Microsoft JhengHei",
  "Noto Sans SC",
  "Noto Serif SC",
  "Source Han Serif SC",
  "Times New Roman",
  "Georgia",
  "Arial",
  "Segoe UI",
  "Cascadia Mono",
  "Consolas",
  "LXGW WenKai",
  "HarmonyOS Sans SC",
  "MiSans",
  "Alibaba PuHuiTi",
  // 对照：绝不存在
  "__DefinitelyMissingFont__",
]

const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
const browser = await (mod.chromium ?? mod.default.chromium).launch()
const page = await browser.newPage({ viewport: { width: 900, height: 300 }, deviceScaleFactor: 1 })

await page.goto("data:text/html,<html><body style='margin:0;background:#fff'></body></html>")

/** 用指定 font-family 渲染一段文字，返回截图的 SHA256。 */
async function renderHash(fontFamily) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">
    <div id="t" style="
      font-family:${fontFamily};
      font-size:48px;
      line-height:1.4;
      white-space:pre;
      padding:12px;
      color:#000;
    ">青幕AI写作 第1章 汉字测试 ABCabc 123，。</div>
  </body></html>`)
  await page.waitForTimeout(240)
  const buf = await page.locator("#t").screenshot()
  return createHash("sha256").update(buf).digest("hex")
}

// 基准：只用哨兵兜底（候选字体名缺失时的样子）
const FALLBACK = '"__DefinitelyMissingFont__", sans-serif'
const fallbackHash = await renderHash(FALLBACK)
console.log(`  兜底基准哈希: ${fallbackHash.slice(0, 16)}…\n`)

console.log("  字体".padEnd(26) + "位图是否不同于兜底   判定")
console.log("  " + "─".repeat(62))

const results = []
for (const font of FONTS) {
  const h = await renderHash(`"${font}", ${FALLBACK}`)
  const differs = h !== fallbackHash
  results.push({ font, differs })
  console.log(`  ${font.padEnd(24)} ${(differs ? "不同" : "相同").padEnd(20)} ${differs ? "存在" : "不存在"}`)
}

// 方法自检：不存在的对照必须判为"不存在"
const control = results.find((r) => r.font === "__DefinitelyMissingFont__")
console.log()
console.log(`  方法自检：不存在对照 → 判定「${control.differs ? "存在" : "不存在"}」` +
  (control.differs ? "  ← 方法失效！" : "  ← 正确"))

const exists = results.filter((r) => r.differs && r.font !== "__DefinitelyMissingFont__").map((r) => r.font)
const missing = results.filter((r) => !r.differs).map((r) => r.font)
console.log(`\n  存在（${exists.length}）: ${exists.join(", ")}`)
console.log(`  不存在（${missing.length}）: ${missing.join(", ")}`)

await browser.close()
if (control.differs) process.exitCode = 1
