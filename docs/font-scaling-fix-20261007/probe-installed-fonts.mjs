#!/usr/bin/env node
/**
 * 实测「字体选项表里每个字体名在本机是否真的可用」。
 *
 * 为什么必须实测：静态列出一个本机不存在的字体，用户选中后浏览器会
 * **静默回退**到回退栈里的下一个字体 —— 看起来就是"选了没反应"，
 * 而本次修复的起点正是用户抱怨"界面字体设置没有效果"。
 * 同一个病症不能换个地方再犯一次。
 *
 * ── 判定手段与被否决的方案 ──
 * 曾用 `document.fonts.check('16px "<name>"')`，**实测证明它不可用**：
 * 对编造的不存在字体名 `__QMaiNoSuchFont__` 它也返回 true
 * （该方法判断的是"该字体族当前能否用于渲染"，而浏览器对不存在的族会
 * 回退到默认字体，于是恒为 true —— 一个永远为真的检查器）。
 *
 * 现在采用**对照法**，判定依据是 Chromium 通过
 * `CSS.getPlatformFontsForNode` 报告的**实际渲染字体族**（权威证据）：
 *   实验组  font-family: "<候选>", <基准>
 *   对照组  font-family: <基准>
 * 若两者报告的实际字体族相同（且排版宽度也相同），则该候选在**该基准下**
 * 被完整吞掉。
 *
 * ── 为什么必须用**多个基准**（单基准实测出过假阴性）──
 * 首版只用 `monospace` 一个基准，结果 `NSimSun`（Windows 自带的「新宋体」）
 * 被判为"不可用" —— 因为**本机 `monospace` 的默认回退恰好就是 NSimSun**，
 * 候选与基准撞在同一个字体上，对照法失效。
 * 改用三个基准（serif / sans-serif / monospace），只要**任一**基准下
 * 渲染结果发生变化就判为可用：NSimSun 在 sans-serif 基准下与雅黑不同，
 * 于是被正确识别。反之，若候选不存在，三组必然全部与各自基准相同。
 *
 * 判定不依赖"候选名"与"系统真实族名"的映射（那很脆弱：
 * 「微软雅黑」报告回来是 `Microsoft YaHei`，`KaiTi` 报告回来仍是 `KaiTi`），
 * 只看"加了候选之后渲染有没有变化"——这正是用户能看见的那件事。
 *
 * 样本按字符类型区分：中文候选用纯中文样本（含拉丁字形的字体对中文无效），
 * 正对照 Arial 用纯拉丁样本。
 *
 * 尺子自身的对照（任何一项不成立，本次结论即无效）：
 *   ① 正对照：Arial（本机必然存在）对拉丁样本必须判为"可用"
 *   ② 负对照：编造的不存在字体名对中文样本必须判为"不可用"
 *   ③ 对照组本身有效：三个基准各自都要报告出具体字体族
 *   ④ 多基准确实覆盖了单基准的假阴性：NSimSun 必须被判为可用
 */

import { existsSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..")

const CJK = "青幕中文样张写作字体"
const LATIN = "QMAI Font Sample Ag"

/** 待测字体名。`sample` 指定用哪类样本（中文候选用中文）。 */
const NAMES = [
  { role: "对照-必然存在", name: "Arial", sample: LATIN },
  { role: "对照-必然不存在", name: "__QMaiNoSuchFont__", sample: CJK },
  { role: "微软雅黑", name: "Microsoft YaHei", sample: CJK },
  { role: "微软雅黑UI", name: "Microsoft YaHei UI", sample: CJK },
  { role: "微软雅黑-中文名", name: "微软雅黑", sample: CJK },
  { role: "微软正黑体", name: "Microsoft JhengHei", sample: CJK },
  { role: "微软正黑体-中文名", name: "微软正黑体", sample: CJK },
  { role: "黑体", name: "SimHei", sample: CJK },
  { role: "黑体-中文名", name: "黑体", sample: CJK },
  { role: "宋体", name: "SimSun", sample: CJK },
  { role: "宋体-中文名", name: "宋体", sample: CJK },
  { role: "新宋体", name: "NSimSun", sample: CJK },
  { role: "新宋体-中文名", name: "新宋体", sample: CJK },
  { role: "楷体", name: "KaiTi", sample: CJK },
  { role: "楷体-中文名", name: "楷体", sample: CJK },
  { role: "仿宋", name: "FangSong", sample: CJK },
  { role: "仿宋-中文名", name: "仿宋", sample: CJK },
  { role: "等线", name: "DengXian", sample: CJK },
  { role: "等线-中文名", name: "等线", sample: CJK },
  { role: "苹方(macOS)", name: "PingFang SC", sample: CJK },
  { role: "黑体-简(macOS)", name: "Heiti SC", sample: CJK },
  { role: "宋体-简(macOS)", name: "Songti SC", sample: CJK },
  { role: "楷体-简(macOS)", name: "Kaiti SC", sample: CJK },
  { role: "STKaiti(macOS)", name: "STKaiti", sample: CJK },
  { role: "STFangsong(macOS)", name: "STFangsong", sample: CJK },
  { role: "冬青黑体(macOS)", name: "Hiragino Sans GB", sample: CJK },
  { role: "思源黑体", name: "Noto Sans SC", sample: CJK },
  { role: "思源宋体", name: "Noto Serif SC", sample: CJK },
  { role: "思源黑体-旧名", name: "Source Han Sans SC", sample: CJK },
  { role: "思源宋体-旧名", name: "Source Han Serif SC", sample: CJK },
  { role: "霞鹜文楷", name: "LXGW WenKai", sample: CJK },
  { role: "鸿蒙黑体", name: "HarmonyOS Sans SC", sample: CJK },
  { role: "小米", name: "MiSans", sample: CJK },
  { role: "阿里巴巴普惠体", name: "Alibaba PuHuiTi", sample: CJK },
]

async function loadPlaywright() {
  for (const c of [join(process.env.APPDATA ?? "", "npm/node_modules/playwright/index.js"), join(REPO, "node_modules/playwright/index.js")]) {
    if (existsSync(c)) {
      const mod = await import(pathToFileURL(c).href)
      return mod.chromium ?? mod.default?.chromium
    }
  }
  throw new Error("找不到 playwright")
}

/** 实验基准：三个通用族。多基准用于覆盖"候选与某个基准撞同一字体"的假阴性。 */
const BASELINES = ["serif", "sans-serif", "monospace"]

const SETUP = (cases) => {
  document.getElementById("qmai-font-probe")?.remove()
  const wrap = document.createElement("div")
  wrap.id = "qmai-font-probe"
  wrap.style.cssText = "position:fixed;left:-9999px;top:0;"
  cases.forEach((c, i) => {
    for (const [tag, family] of c.probes) {
      const el = document.createElement("div")
      el.id = `qmai-fp-${i}-${tag}`
      el.style.cssText = `font-family:${family};font-size:16px;white-space:nowrap;display:block;`
      el.textContent = c.sample
      wrap.appendChild(el)
    }
  })
  document.body.appendChild(wrap)
  const out = {}
  cases.forEach((c, i) => {
    for (const [tag] of c.probes) {
      const el = document.getElementById(`qmai-fp-${i}-${tag}`)
      out[`${i}-${tag}`] = { width: el.getBoundingClientRect().width, text: el.textContent }
    }
  })
  return out
}

async function platformFontsOf(cdp, selector) {
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 })
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector })
    if (!nodeId) return null
    const r = await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
    return r.fonts.map((f) => f.familyName).sort().join(" + ")
  } catch { return null }
}

async function main() {
  const chromium = await loadPlaywright()
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable")

  // 每个候选生成 N 组「实验/对照」：experiment=<候选>,<基准>  baseline=<基准>
  const cases = NAMES.map((n) => ({
    sample: n.sample,
    probes: BASELINES.flatMap((b, bi) => [
      [`x${bi}`, `"${n.name}", ${b}`],
      [`b${bi}`, b],
    ]),
  }))

  await page.goto("about:blank")
  const measures = await page.evaluate(SETUP, cases)

  const rows = []
  for (let i = 0; i < NAMES.length; i++) {
    const perBaseline = []
    for (let bi = 0; bi < BASELINES.length; bi++) {
      const withFont = await platformFontsOf(cdp, `#qmai-fp-${i}-x${bi}`)
      const baseline = await platformFontsOf(cdp, `#qmai-fp-${i}-b${bi}`)
      const wX = measures[`${i}-x${bi}`].width
      const wB = measures[`${i}-b${bi}`].width
      const differs = (withFont !== null && baseline !== null && withFont !== baseline)
        || Math.abs(wX - wB) > 0.01
      perBaseline.push({ baseline: BASELINES[bi], withFont, baseFont: baseline, differs })
    }
    // 任一基准下渲染发生变化 → 该候选在本机确实生效
    const usable = perBaseline.some((p) => p.differs)
    const evidence = perBaseline.find((p) => p.differs) ?? perBaseline[0]
    const baselineSane = perBaseline.every((p) => p.baseFont !== null && p.baseFont !== "" && p.baseFont !== "(none)")
    rows.push({ ...NAMES[i], perBaseline, usable, evidence, baselineSane })
  }
  await browser.close()

  const byName = (n) => rows.find((r) => r.name === n)
  const arial = byName("Arial")
  const bogus = byName("__QMaiNoSuchFont__")
  const nsimsun = byName("NSimSun")
  const baselineSane = rows.every((r) => r.baselineSane)
  const singleBaselineWouldMiss = (() => {
    // 复现首版单基准的假阴性：NSimSun 在 monospace 基准下判定为何
    const p = nsimsun?.perBaseline.find((x) => x.baseline === "monospace")
    return p ? !p.differs : false
  })()
  const rulerOk = arial?.usable === true && bogus?.usable === false && baselineSane && nsimsun?.usable === true

  console.log("  ══ 字体名在本机的可用性实测（对照法 · 三基准 · Chromium 报告的实际字体族）══")
  console.log("")
  console.log("  判定       字体名                    判定依据（实验组与对照组的实际字体族）")
  console.log("  " + "─".repeat(104))
  for (const r of rows) {
    const mark = r.usable ? "✓ 可用" : "✗ 不可用"
    if (r.usable) {
      console.log(`  ${mark}  ${r.role.padEnd(20)} [${r.evidence.baseline}] ${r.evidence.withFont}  ≠  ${r.evidence.baseFont}`)
    } else {
      const all = r.perBaseline.map((p) => `${p.baseline}=${p.withFont}`).join(" ")
      console.log(`  ${mark}  ${r.role.padEnd(20)} 三基准均无变化: ${all}`)
    }
  }
  const usable = rows.filter((r) => r.usable).length
  console.log("")
  console.log(`  可用 ${usable} / 不可用 ${rows.length - usable}（共 ${rows.length} 项）`)
  console.log("")
  console.log("  ── 尺子自身的对照 ──")
  console.log(`  ① 正对照 Arial 判为可用           ${arial?.usable === true ? "✓" : "✗ 实际 " + arial?.usable}`)
  console.log(`  ② 负对照 编造字体名判为不可用     ${bogus?.usable === false ? "✓" : "✗ 实际 " + bogus?.usable}`)
  console.log(`  ③ 三基准各自都取到具体字体族      ${baselineSane ? "✓" : "✗ 有基准取不到字体族，判定不可信"}`)
  console.log(`  ④ 复现单基准假阴性（NSimSun 在 monospace 下无变化）: ${singleBaselineWouldMiss ? "✓ 确实存在，故多基准是必要的" : "— 本次未复现"}`)
  console.log(`  ⑤ 多基准修正后 NSimSun 判为可用   ${nsimsun?.usable === true ? "✓" : "✗ 实际 " + nsimsun?.usable}`)
  console.log("")
  console.log("  说明：判为「不可用」的项，用户选中后会静默回退到回退栈里的下一个字体，")
  console.log("       也就是\"选了没反应\"。本报告只提供事实，不替代产品决定。")
  if (!rulerOk) {
    console.log("")
    console.log("  ✗ 尺子对照失败：本次读数不可信")
    process.exit(1)
  }
}

main().catch((e) => { console.log(`  ✗ 运行失败: ${e?.message ?? e}`); process.exit(1) })
