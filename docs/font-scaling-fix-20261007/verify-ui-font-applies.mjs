#!/usr/bin/env node
/**
 * 证明「界面字体」设置真的生效。
 *
 * 为什么需要这个脚本：
 * `src/components/uitest/ui-test.css` 里的 `--ui` 曾硬编码为
 *   --ui: "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
 * 于是用户在「外观与界面」里选任何字体都**没有任何效果** ——
 * `applyUiFontFamily` 确实把选择写进了 `--qmai-ui-font-family`，
 * 但界面元素用的是 `var(--ui)`，两者之间没有任何连接。
 * 这类"设置存下来了、也读回来了，就是没作用"的缺陷，
 * 靠读代码很容易看漏（两个名字都与字体有关，看起来像是通的），
 * 所以必须有一条会失败/会通过的可执行判据。
 *
 * 判据方法（双重证据）：
 *   1. canvas 像素哈希 + measureText 宽度 —— 样本文本含中文与拉丁字母，
 *      换字体就会改变字形轮廓 → 哈希与宽度都变。
 *   2. Chromium 的 `CSS.getPlatformFontsForNode` —— 浏览器直接报告该节点
 *      渲染时用了哪些真实字体家族。这是最接近"用户看到什么"的证据，
 *      也是唯一能区分「字体串写对了」与「真的换了字形」的手段
 *      （字体没装时会静默回退，字串看着对、画面没变）。
 *
 * 尺子自身的对照（任何一项不成立，本脚本的结论都不成立）：
 *   ① 直接给元素写内联 font-family → 指纹必须变（度量方法能识别换字体）
 *   ② 给容器写内联 --ui → 指纹必须变（var(--ui) 通路本身是活的）
 *   ③ 负向对照：默认栈前面加一个不存在的字体名 → 指纹必须与默认**相同**
 *   ④ 覆盖面：必须真的找到足够多的界面文字元素
 *   ⑤ Chromium 报告的真实字体在所有用例间不能完全相同
 *   ⑥ 默认字体栈必须读自产品本身，不能由本脚本写死
 *
 * ── 用例分两段（本次修复的核心）──
 *   · FROZEN_CASES：默认 / 黑体 / 楷体 / 仿宋 / 不存在，**一字不改**，
 *     与冻结基线 ui-font-before.json 逐字节可比。它们是"改造前一个字体都不生效"
 *     这条史实的载体，动了它们就等于销毁任务 5/6/7 的回归防线。
 *   · OPTION_CASES：**直接从产品真值派生**（`import` src/lib/font-settings.ts
 *     拿 UI_FONT_OPTIONS），`css` 用 `option.cssFamily` 而不是手抄字面量。
 *
 *   为什么必须派生而不是手抄：改造前这里写的是
 *     { name: "黑体", css: "SimHei, sans-serif" }
 *   而产品真值是 'SimHei, "Heiti SC", "Microsoft YaHei", sans-serif'。
 *   于是本脚本证明的只是"CSS 变量通路是活的"，**不是**"这条选项的栈会渲染成
 *   那个字体"—— 11 个产品选项里真正被端到端覆盖的只有 4 个（默认 + 黑/楷/仿），
 *   且那 3 条用的还是非产品字符串。用户的原病症正是"选了没反应"，
 *   新增的 5 个选项（微软正黑体/新宋体/等线/思源黑体/思源宋体）当时只有间接证据。
 *   现在 OPTION_CASES 逐项覆盖全部 11 项，且栈字符串就是产品里的那一条。
 *
 * ── 新增的两道守卫（都经 --selftest 的负向对照证明会失败）──
 *   · 全表覆盖守卫：UI_FONT_OPTIONS 的每个 value 必须在 OPTION_CASES 里
 *     出现且仅出现一次。以后谁再加字体选项而不补端到端用例，本工具立刻红。
 *   · 逐项真实渲染族守卫：期望 differ 的档，若 Chromium 报出的真实渲染字体族
 *     与默认档完全相同，即判失败。这比只比指纹更贴近"用户看到了什么"，
 *     并抓住"指纹变了但换的是别的字体"。负向对照是一道真实用例：
 *     `"__QMaiNoSuchFont__", <产品默认栈>` 期望 differ，实际渲染与默认相同。
 *
 * ── 第三条证据通道：真实页面栅格化指纹（本次实测逼出来的）──
 * 覆盖 11 个产品选项后实测发现：`微软雅黑`（"Microsoft YaHei"）与默认档的
 * canvas 指纹**完全相同**（32/32 元素的像素哈希与宽度一字不差），
 * 而 Chromium 报告的真实族确实从 "Microsoft YaHei UI" 变成了 "Microsoft YaHei"。
 * 到底谁对？用整页截图逐像素判定（同栈连拍两张完全相同 → 噪声为 0）：
 *   · 默认 vs 微软雅黑         不同像素 6236 / 1296000 = 0.481%
 *   · 默认 vs 黑体（真换字体） 不同像素 10228          = 0.789%
 *   · 元素盒指纹（x/y/w/h）两者相同 → 排版不动，变的是字形栅格化
 * 即：**用户看得见变化，是 canvas 指纹对这对 face 失明**
 * （msyh.ttc 里的 "Microsoft YaHei" 与 "Microsoft YaHei UI" 共享字形轮廓与
 * 字符宽度，canvas 光栅化结果一致，而 DOM 光栅化会因 hinting/抗锯齿设置不同
 * 而产生可见差异）。这不是产品缺陷（"选了没反应"），是测量工具的假阴性。
 *
 * 处理方式**不是放宽判据**，而是给判据补一条更贴近"用户看到了什么"的通道：
 *   `expect: differ` 的档，三条通道（canvas 指纹 / 真实渲染字体 / 整页栅格）
 *   **任一**变化即算生效 —— 通道更多，只会更容易发现"真的变了"；
 *   `expect: same` 的档，三条通道**全部**必须不变 —— 比原先只查指纹**更严**。
 * 真正"选了没反应"的档（字体名不存在、静默回退到默认栈）三条通道全都不变，
 * 依旧被负向对照与不符期望判据抓住。
 * 整页栅格通道**不进入** perCase/defaultHash，因此冻结基线 ui-font-before.json
 * 依旧逐字节可比，一行都不用重录。
 *
 * ── 基线对比的"修复前"判定（F1 修复）──
 * 基线 ui-font-before.json 里的 `cases` 记着录制当时有哪些用例。
 * `beforeDiffer`（"修复前就能生效的字体"）**只允许遍历 `before.cases`**：
 * 若用当前 CASES 去查 `before.perCase`，任何**基线录制之后新增**的用例
 * 在基线里都没有键 → `undefined !== before.defaultHash` 为真 →
 * 被判成"修复前就已经生效"，而守卫 I 只在"基线与现在都无字体生效"时才失败，
 * 于是这种情况静默放过、退出码 0。本工具存在的唯一意义就是证明
 * 「改造前一个字体都不生效」，打印一条与史实相反且无人会发现的结论
 * 等于把"未覆盖"换成"已覆盖且改造前就生效"的谎言。所以：
 *   · 只遍历 before.cases；
 *   · 当前有、基线没有的用例 → 显式打印「基线无对照，不参与"修复前"判定」；
 *   · 基线有、当前没有的用例 → **fail**（说明冻结证据丢了，比如有人删了用例）。
 * `--selftest` 里有一组对照实验复现"旧写法会把新增用例误判为修复前能生效"。
 *
 * 用法：
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs --record docs/.../ui-font-before.json
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs --compare docs/.../ui-font-before.json
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs --selftest
 *
 * 退出码：0 = 全部判据通过；1 = 有判据不通过（含守卫不通过）。
 * 注意：`--selftest` 含一道**浏览器内的**负向对照（逐项真实渲染族守卫必须
 * 对一道假用例报错），因此它需要 dist/ 与 playwright，与主流程同条件。
 */

import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs"
import { join, extname, resolve, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..")
const DIST = join(REPO, "dist")
const SETTINGS_NAV = 'nav[aria-label="设置分类"]'
const MIN_ELEMENTS = 8

const MISSING_FONT = "__QMaiNoSuchFont__"

/** 默认档用例的键。所有"与默认档相比"的判定都以它为准。 */
const DEFAULT_KEY = "默认"

/**
 * 指纹样本文本。**必须同时含中文与拉丁字母**。
 *
 * 原因：中文字形在字体缺失时会统一回退到系统默认中文字体，
 * 于是"两套不同的字体栈"在纯中文样本上可能渲染得一模一样
 * （实测本机 "PingFang SC" 优先与 system-ui 优先就是如此：
 * 中文都回退到 Microsoft YaHei UI，哈希、宽度、非空像素数全同）。
 * 若样本只有中文，"默认档没变"就会因为看不出差别而空洞成立。
 * 拉丁字母能区分出字体栈中靠前的那几个家族的差异。
 */
const SAMPLE_TEXT = "青幕AI界面字体Ag"

/**
 * 冻结用例：与冻结基线 ui-font-before.json 逐字节可比，**一字不改**。
 *
 * 这些用例名同时是基线 `cases` / `perCase` 的键 —— 一旦改名，
 * "修复前能生效的字体"这条史实判定就会因为查不到键而失效（见文件头的 F1 说明）。
 * `css: null` 表示「移除行内属性，用产品自己的默认」。
 *
 * 这里刻意**不写死默认字体栈**：初版把默认写成一个常量，
 * 而那常量其实是 index.css 改造前的旧值，并非产品实际默认栈
 * （改造前界面元素用的是 ui-test.css 里硬编码的 `--ui`）。
 * 基准搞错了，后面所有对比都不可靠 —— 所以默认档一律从页面读。
 */
const FROZEN_CASES = [
  { key: "默认", name: "默认", css: null, expect: "same", origin: "frozen" },
  { key: "黑体", name: "黑体", css: "SimHei, sans-serif", expect: "differ", origin: "frozen" },
  { key: "楷体", name: "楷体", css: "KaiTi, serif", expect: "differ", origin: "frozen" },
  { key: "仿宋", name: "仿宋", css: "FangSong, serif", expect: "differ", origin: "frozen" },
  { key: "不存在", name: "不存在", css: "DYNAMIC_MISSING", expect: "same", origin: "frozen" },
]

/**
 * 从产品真值派生选项用例。**绝不手抄字体栈。**
 *
 * 失败即失败：import 不成功就抛错退出，不允许"退化成手抄字面量"——
 * 那正是本次要消除的问题。Node 24.9 可直接 import 该 .ts
 * （顶层是纯数据 + 纯函数、无 import 语句）。
 */
async function loadProductFontOptions() {
  const file = join(REPO, "src", "lib", "font-settings.ts")
  if (!existsSync(file)) {
    throw new Error(`找不到产品真值文件 ${file}，无法派生选项用例（不允许退化成手抄字面量）`)
  }
  let mod
  try {
    mod = await import(pathToFileURL(file).href)
  } catch (err) {
    throw new Error(
      `无法 import 产品真值 ${file}：${err?.message ?? err} —— ` +
      `请确认 node 版本支持直接跑 .ts（本机实测 Node 24.9 可以），` +
      `本脚本拒绝退化成手抄字面量。`,
    )
  }
  const options = mod.UI_FONT_OPTIONS
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error("产品真值里读不到 UI_FONT_OPTIONS（或为空），无法派生选项用例")
  }
  for (const o of options) {
    if (typeof o?.value !== "string" || typeof o?.cssFamily !== "string" || typeof o?.label !== "string") {
      throw new Error(`UI_FONT_OPTIONS 里有一项结构不对：${JSON.stringify(o)}`)
    }
  }
  return options
}

/** 由产品真值派生选项用例：name=label、css=cssFamily、expect 由 value 决定。 */
function buildOptionCases(productOptions) {
  return productOptions.map((o) => ({
    key: `opt:${o.value}`,
    name: o.label,
    value: o.value,
    css: o.cssFamily,
    // system 就是"跟随本机默认"，它与默认档必须渲染一致；
    // 其余每一项都是用户显式选了某个字体，必须真的改变渲染。
    expect: o.value === "system" ? "same" : "differ",
    origin: "option",
  }))
}

/**
 * 负向对照 = 默认栈前面加一个不存在的字体名。
 *
 * 不能只用不存在的字体名自成一套栈：那样整条栈会塌到浏览器兜底衬线，
 * 它与默认档不同只能说明"栈不同"，说明不了"字体名真的被忽略"。
 */
function missingCase(fallbackStack) {
  return `"${MISSING_FONT}", ${fallbackStack}`
}

/* ══════════════════ 守卫：抽成纯函数，便于 --selftest 直接喂坏输入 ══════════════════ */

/**
 * 全表覆盖守卫：产品选项表的每个 value 必须在 OPTION_CASES 里出现且**仅**一次。
 *
 * 这是防漂移的牙：以后谁再加一个字体选项而不补端到端用例，本工具立刻红。
 * 当前调用是 1:1 派生，运行时必然成立 —— 正因如此，
 * 它必须由 `--selftest` 用**合成输入**证明会失败，否则就只是装饰。
 */
function coverageIssues(productOptions, optionCases) {
  const issues = []
  const count = new Map()
  for (const c of optionCases) count.set(c.value, (count.get(c.value) ?? 0) + 1)
  for (const o of productOptions) {
    const n = count.get(o.value) ?? 0
    if (n === 0) issues.push(`产品选项「${o.value}」在 OPTION_CASES 里缺失（新增选项后必须补端到端用例）`)
    else if (n > 1) issues.push(`产品选项「${o.value}」在 OPTION_CASES 里出现了 ${n} 次（重复用例会掩盖缺失）`)
  }
  const productValues = new Set(productOptions.map((o) => o.value))
  for (const v of count.keys()) {
    if (!productValues.has(v)) issues.push(`OPTION_CASES 里的「${v}」不是产品选项（用例与产品真值脱节）`)
  }
  return issues
}

/**
 * 逐项真实渲染族守卫：期望 differ 的档，其 Chromium 报告的真实渲染字体族
 * 不能与默认档完全相同。
 *
 * 比"只比指纹"更贴近"用户看到了什么"：指纹变了但换的是别的字体、
 * 或者根本只是度量抖动，都会在这里露出来。
 */
function renderedFamilyIssues(cases, defaultKey, cdpFonts) {
  const issues = []
  const def = JSON.stringify(cdpFonts[defaultKey] ?? null)
  for (const c of cases) {
    if (c.expect !== "differ") continue
    const now = JSON.stringify(cdpFonts[c.key] ?? null)
    if (now === def) {
      issues.push(`用例「${c.name}」期望换字体，但 Chromium 报告的真实渲染字体族与默认档完全相同：${now}`)
    }
  }
  return issues
}

/** 默认档是否真的取到了非空的真实字体证据（取不到就不能拿它当基准）。 */
function defaultFontEvidenceUsable(cdpFonts, defaultKey) {
  const rec = cdpFonts[defaultKey] ?? {}
  return Object.values(rec).some((v) => typeof v === "string" && v.length > 0)
}

/**
 * 基线的"修复前"覆盖判定（F1 核心）。
 *
 * @param before 冻结基线对象（含 cases / perCase / defaultHash）
 * @param currentCases 当前 CASES（每项有 key / name / expect）
 * @param currentPerCase 当前每个 key 的指纹
 * @param currentDefaultHash 当前默认档指纹
 * @returns {{ hasRecordedCases, beforeDiffer, added, lost, nowDiffer, beforeDifferButNowSame }}
 *
 * **beforeDiffer 只遍历 before.cases** —— 即基线真正记录过的那些用例名，
 * 只对这些名字查 before.perCase。任何基线录制之后新增的用例都不参与
 * "修复前能生效"的判定，而是进入 `added` 并被显式打印。
 */
function classifyBaselineComparison(before, currentCases, currentPerCase, currentDefaultHash) {
  const recorded = Array.isArray(before?.cases) ? before.cases : null
  const currentKeys = currentCases.map((c) => c.key)
  const currentKeySet = new Set(currentKeys)
  const byKey = new Map(currentCases.map((c) => [c.key, c]))

  const added = recorded ? currentKeys.filter((k) => !recorded.includes(k)) : currentKeys
  const lost = recorded ? recorded.filter((k) => !currentKeySet.has(k)) : []

  const beforeDiffer = []
  const beforeDifferButNowSame = []
  for (const k of recorded ?? []) {
    const h = before.perCase?.[k]
    if (h === undefined) continue // 基线自身不完整，交由调用方单独报告
    if (h === before.defaultHash) continue // 修复前与默认档相同 = 该字体当时不生效
    const cur = byKey.get(k)
    if (!cur) continue // 已计入 lost
    if (cur.expect === "differ") beforeDiffer.push(k)
    else beforeDifferButNowSame.push(k)
  }

  const nowDiffer = currentCases
    .filter((c) => c.expect === "differ" && currentPerCase[c.key] !== undefined && currentPerCase[c.key] !== currentDefaultHash)
    .map((c) => c.key)

  return { hasRecordedCases: recorded !== null, beforeDiffer, added, lost, nowDiffer, beforeDifferButNowSame }
}

/* ── 1. 自检：先证明度量方法本身是对的 ─────────────────────────────── */
async function selftest() {
  const results = []
  const check = (name, ok, detail = "") => results.push({ name, ok, detail })

  const h1 = hashOf("abc")
  const h2 = hashOf("abc")
  const h3 = hashOf("abd")
  check("哈希函数确定性（同输入同输出）", h1 === h2, `${h1} vs ${h2}`)
  check("哈希函数敏感性（改一位就变）", h1 !== h3, `${h1} vs ${h3}`)

  // 聚合哈希必须与元素顺序无关，否则页面渲染顺序一变就误报
  const a = aggregate([{ key: "b", v: 1 }, { key: "a", v: 2 }])
  const b = aggregate([{ key: "a", v: 2 }, { key: "b", v: 1 }])
  check("聚合哈希与元素顺序无关", a === b, `${a} vs ${b}`)
  const c = aggregate([{ key: "a", v: 2 }, { key: "b", v: 9 }])
  check("聚合哈希对取值敏感", a !== c, `${a} vs ${c}`)

  // 用例集合必须两边都有，否则判据会一边倒地空洞通过
  check("冻结用例含唯一默认基准", FROZEN_CASES.filter((x) => x.key === DEFAULT_KEY).length === 1, "")
  check("冻结用例既有期望不同也有期望相同",
    FROZEN_CASES.some((x) => x.expect === "differ") && FROZEN_CASES.some((x) => x.expect === "same"), "")

  // 针对真实踩过的坑：默认基准曾被写死成一个并非产品默认的常量
  const base = FROZEN_CASES.find((x) => x.key === DEFAULT_KEY)
  check("默认基准取自产品默认（不写死字体栈）", base.css === null, String(base.css))

  const neg = missingCase('"PingFang SC", sans-serif')
  check("负向对照 = 不存在的字体 + 默认栈",
    neg.startsWith(`"${MISSING_FONT}"`) && neg.includes("PingFang SC"), neg)

  // 样本必须双语，否则"默认档没变"可能只因中文都回退到同一字体而空洞成立
  check("指纹样本含中文", /[\u4e00-\u9fff]/.test(SAMPLE_TEXT), SAMPLE_TEXT)
  check("指纹样本含拉丁字母", /[A-Za-z]/.test(SAMPLE_TEXT), SAMPLE_TEXT)

  /* ══ 负向对照区（本次新增守卫的"会失败"证据）══ */

  /* ── F1：新增用例不得被判为"修复前就能生效" ── */
  const fakeBefore = {
    appDefaultStack: "（合成基线）",
    cases: ["默认", "黑体", "楷体", "仿宋", "不存在"],
    defaultHash: "BASE",
    perCase: { 默认: "BASE", 黑体: "BASE", 楷体: "BASE", 仿宋: "BASE", 不存在: "BASE" },
  }
  const synthCurrent = [
    { key: "默认", name: "默认", expect: "same" },
    { key: "黑体", name: "黑体", expect: "differ" },
    { key: "楷体", name: "楷体", expect: "differ" },
    { key: "仿宋", name: "仿宋", expect: "differ" },
    { key: "不存在", name: "不存在", expect: "same" },
    { key: "opt:noto-sans", name: "思源黑体", expect: "differ" }, // ← 基线录制之后新增
  ]
  const synthNow = { 默认: "BASE", 黑体: "H1", 楷体: "H2", 仿宋: "H3", 不存在: "BASE", "opt:noto-sans": "H9" }
  const clsOk = classifyBaselineComparison(fakeBefore, synthCurrent, synthNow, "BASE")
  check("F1 新增用例被列入「基线无对照」", clsOk.added.includes("opt:noto-sans"), clsOk.added.join("、"))
  check("F1 新增用例**不**被判为「修复前能生效」", !clsOk.beforeDiffer.includes("opt:noto-sans"),
    clsOk.beforeDiffer.length ? clsOk.beforeDiffer.join("、") : "（空）")
  check("F1 修复前能生效的确实为空（与史实一致）", clsOk.beforeDiffer.length === 0, clsOk.beforeDiffer.join("、"))
  check("F1 新增用例仍计入「现在能生效」", clsOk.nowDiffer.includes("opt:noto-sans"), clsOk.nowDiffer.join("、"))

  // 复现旧写法的错误结论 —— 证明本修复不是无病呻吟
  const oldWrong = synthCurrent
    .filter((x) => x.expect === "differ" && fakeBefore.perCase[x.key] !== fakeBefore.defaultHash)
    .map((x) => x.key)
  check("F1 旧写法确实把新增用例误判为「修复前就能生效」（负向对照）",
    oldWrong.includes("opt:noto-sans"), `旧写法输出：${oldWrong.join("、") || "（空）"}`)

  // 基线有、当前没有 → 必须被 lost 抓到
  const clsLost = classifyBaselineComparison(
    fakeBefore, synthCurrent.filter((x) => x.key !== "楷体"), synthNow, "BASE")
  check("F1 基线有、当前没有的用例被列为「丢失冻结证据」", clsLost.lost.includes("楷体"), clsLost.lost.join("、"))
  // 基线没记 cases 时必须显式不可判定，而不是静默把所有用例当"新增"混过去
  const clsNoCases = classifyBaselineComparison({ ...fakeBefore, cases: undefined }, synthCurrent, synthNow, "BASE")
  check("F1 基线缺 cases 时明确标记「未记录用例清单」", clsNoCases.hasRecordedCases === false, "")

  /* ── F2-a：全表覆盖守卫必须能被坏输入触发 ── */
  const synthProduct = [{ value: "a" }, { value: "b" }, { value: "c" }]
  const badCoverage = [{ value: "a" }, { value: "a" }, { value: "b" }] // c 缺失、a 重复
  const covIssues = coverageIssues(synthProduct, badCoverage)
  check("F2 全表覆盖守卫抓到「缺失」", covIssues.some((s) => s.includes("缺失") && s.includes("c")),
    covIssues.join(" ｜ "))
  check("F2 全表覆盖守卫抓到「重复」", covIssues.some((s) => s.includes("重复") && s.includes("a")),
    covIssues.join(" ｜ "))
  check("F2 全表覆盖守卫对 1:1 的正确输入无意见",
    coverageIssues(synthProduct, synthProduct.map((o) => ({ value: o.value }))).length === 0, "")
  check("F2 全表覆盖守卫抓到「用例里的值不是产品选项」",
    coverageIssues(synthProduct, [{ value: "a" }, { value: "b" }, { value: "c" }, { value: "d" }])
      .some((s) => s.includes("不是产品选项")), "")

  /* ── F2-b：逐项真实渲染族守卫的纯逻辑负向对照 ── */
  const synthCases = [
    { key: "默认", name: "默认", expect: "same" },
    { key: "假换", name: "假换", expect: "differ" },
    { key: "真换", name: "真换", expect: "differ" },
  ]
  const synthFonts = {
    默认: { ".ui-test-root button": "Microsoft YaHei UI" },
    假换: { ".ui-test-root button": "Microsoft YaHei UI" }, // 与默认完全相同
    真换: { ".ui-test-root button": "SimHei" },
  }
  const rfIssues = renderedFamilyIssues(synthCases, "默认", synthFonts)
  check("F2 逐项真实渲染族守卫抓到「期望换但真实字体族与默认相同」",
    rfIssues.some((s) => s.includes("假换")), rfIssues.join(" ｜ "))
  check("F2 逐项真实渲染族守卫不误报真正换了的用例",
    !renderedFamilyIssues(synthCases.filter((x) => x.key !== "假换"), "默认", synthFonts).length, "")
  check("F2 默认档真实字体证据取不到时能被识别",
    defaultFontEvidenceUsable(synthFonts, "默认") === true
      && defaultFontEvidenceUsable({ 默认: { ".ui-test-root button": "" } }, "默认") === false, "")

  /* ── F2-b 浏览器内负向对照：在真实页面上跑一道"假换字体"用例 ── */
  if (!existsSync(DIST)) {
    check("F2 浏览器内负向对照（假换字体必须被真实读数抓住）", false,
      `找不到 ${DIST}，无法执行；请先 npm run build（本项不允许静默跳过）`)
  } else {
    try {
      const browserResult = await selftestBrowserNegativeControl()
      for (const r of browserResult) check(r.name, r.ok, r.detail)
    } catch (err) {
      check("F2 浏览器内负向对照（假换字体必须被真实读数抓住）", false, `运行失败：${err?.message ?? err}`)
    }
  }

  const failed = results.filter((r) => !r.ok)
  for (const r of results) console.log(`    ${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `  ${r.detail}` : ""}`)
  console.log(`\n  自检：${results.length - failed.length} 通过 / ${failed.length} 失败`)
  process.exit(failed.length === 0 ? 0 : 1)
}

/**
 * 浏览器内的负向对照（F2 逐项真实渲染族守卫）。
 *
 * 在真实 dist 产物里跑三道用例：
 *   默认（css=null）—— 基准
 *   假换字体（`"__QMaiNoSuchFont__", <产品默认栈>`，expect=differ）—— 实际渲染
 *     与默认完全相同，**必须**被守卫抓到；
 *   真换字体（SimHei, sans-serif，expect=differ）—— **必须**不被误报。
 * 输入数据全部来自真实页面（getComputedStyle + CDP），不是合成对象。
 */
async function selftestBrowserNegativeControl() {
  return withPage(async ({ page, cdp }) => {
    const appDefaultStack = await page.evaluate(READ_DEFAULT_STACK)
    if (!appDefaultStack) throw new Error("读不到产品默认栈，负向对照无法构造")
    const cases = [
      { key: DEFAULT_KEY, name: "默认", css: null, expect: "same" },
      { key: "假换字体", name: "假换字体", css: missingCase(appDefaultStack), expect: "differ" },
      { key: "真换字体", name: "真换字体", css: "SimHei, sans-serif", expect: "differ" },
    ]
    const { byCase, cdpFonts, shots } = await measureCases(page, cdp, cases, appDefaultStack)
    const defaultHash = aggregate(byCase[DEFAULT_KEY].map((e) => ({ key: e.key, v: `${e.pixelHash}|${e.width}` })))
    const fakeHash = aggregate(byCase["假换字体"].map((e) => ({ key: e.key, v: `${e.pixelHash}|${e.width}` })))
    const realHash = aggregate(byCase["真换字体"].map((e) => ({ key: e.key, v: `${e.pixelHash}|${e.width}` })))
    const perCase = { [DEFAULT_KEY]: defaultHash, 假换字体: fakeHash, 真换字体: realHash }
    const judgeCtx = {
      perCase, defaultHash, cdpFonts,
      defaultFontsKey: JSON.stringify(cdpFonts[DEFAULT_KEY] ?? null),
      shots, defaultShot: shots[DEFAULT_KEY],
    }

    const issues = renderedFamilyIssues(cases, DEFAULT_KEY, cdpFonts)
    const jFake = judgeCase(cases[1], judgeCtx)
    const jReal = judgeCase(cases[2], judgeCtx)
    const out = []
    out.push({
      name: "F2 浏览器内：默认档取到非空真实字体证据",
      ok: defaultFontEvidenceUsable(cdpFonts, DEFAULT_KEY),
      detail: JSON.stringify(cdpFonts[DEFAULT_KEY] ?? {}),
    })
    out.push({
      name: "F2 浏览器内：逐项真实渲染族守卫对「假换字体」报错",
      ok: issues.some((s) => s.includes("假换字体")),
      detail: issues.find((s) => s.includes("假换字体")) ?? `未报错（实际问题：${issues.join(" ｜ ") || "无"}）`,
    })
    out.push({
      name: "F2 浏览器内：逐项真实渲染族守卫不误报「真换字体」",
      ok: !issues.some((s) => s.includes("真换字体")),
      detail: `假换真实字体=${JSON.stringify(cdpFonts["假换字体"])} 真换真实字体=${JSON.stringify(cdpFonts["真换字体"])}`,
    })
    out.push({
      name: "F2 浏览器内：假换字体三通道全同 → 判为「没生效」（真缺陷会被抓住）",
      ok: jFake.changed === false && jFake.ok === false,
      detail: `变化通道=${jFake.channels.join("+") || "（无）"} 期望differ实际判定ok=${jFake.ok}`,
    })
    out.push({
      name: "F2 浏览器内：真换字体整页栅格与默认不同（新通道真的能区分换字体）",
      ok: jReal.shot === true,
      detail: `默认栅格=${shots[DEFAULT_KEY]} 真换栅格=${shots["真换字体"]}`,
    })
    out.push({
      name: "F2 浏览器内：假换字体整页栅格与默认相同（新通道不会误报）",
      ok: shots["假换字体"] === shots[DEFAULT_KEY],
      detail: `默认栅格=${shots[DEFAULT_KEY]} 假换栅格=${shots["假换字体"]}`,
    })
    out.push({
      name: "F2 浏览器内：真换字体的真实渲染族确实变了",
      ok: jReal.font === true,
      detail: `真换真实字体=${JSON.stringify(cdpFonts["真换字体"])}`,
    })
    return out
  })
}

function hashOf(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 16)
}

/** 按 key 排序后拼接再哈希：与遍历顺序无关。 */
function aggregate(entries) {
  const sorted = [...entries].sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
  return hashOf(sorted.map((e) => `${e.key}=${e.v}`).join("\n"))
}

/* ── 2. 静态服务 dist ─────────────────────────────────────────────── */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm",
}

function serve() {
  const server = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? "/").split("?")[0])
    if (p === "/") p = "/index.html"
    const file = join(DIST, p)
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end("not found")
      return
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" })
    res.end(readFileSync(file))
  })
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, port: server.address().port })))
}

async function loadPlaywright() {
  const candidates = [
    join(process.env.APPDATA ?? "", "npm/node_modules/playwright/index.js"),
    join(REPO, "node_modules/playwright/index.js"),
  ]
  for (const c of candidates) {
    if (existsSync(c)) {
      const mod = await import(pathToFileURL(c).href)
      return mod.chromium ?? mod.default?.chromium
    }
  }
  throw new Error("找不到 playwright，请先 npx playwright install chromium")
}

/* ── 3. 页面内度量 ───────────────────────────────────────────────── */
const MEASURE = (sample) => {
  const SEL = [
    ".ui-test-root button",
    ".ui-test-root label",
    ".ui-test-root select",
    ".ui-test-root input:not([type=checkbox]):not([type=radio]):not([type=range])",
    ".ui-test-root p",
    ".ui-test-root h1",
    ".ui-test-root h2",
    ".ui-test-root [role=button]",
  ].join(", ")

  const canvas = document.createElement("canvas")
  canvas.width = 420
  canvas.height = 64
  const ctx = canvas.getContext("2d", { willReadFrequently: true })

  /** 用给定字体在 canvas 上画样本文本，返回「像素哈希 + 宽度」。 */
  function fingerprint(fontShorthand) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = fontShorthand
    ctx.textBaseline = "top"
    ctx.fillStyle = "#000"
    ctx.fillText(sample, 4, 4)
    const width = ctx.measureText(sample).width
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    // FNV-1a 32 位
    let h = 0x811c9dc5
    for (let i = 0; i < data.length; i++) {
      h ^= data[i]
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return { hash: h.toString(16), width: Math.round(width * 1000) / 1000 }
  }

  const seen = new Set()
  const out = []
  for (const el of document.querySelectorAll(SEL)) {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden") continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    // 稳定的键：按同级序号生成 DOM 路径，避免依赖页面渲染顺序
    const parts = []
    let node = el
    while (node && node !== document.body && parts.length < 6) {
      const parent = node.parentElement
      if (!parent) break
      const idx = Array.prototype.indexOf.call(parent.children, node)
      parts.unshift(`${node.tagName.toLowerCase()}${idx}`)
      node = parent
    }
    const key = parts.join(">")
    if (seen.has(key)) continue
    seen.add(key)
    const text = (el.value ?? el.textContent ?? "").trim().slice(0, 8)
    const fp = fingerprint(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`)
    out.push({
      key, tag: el.tagName.toLowerCase(), text,
      family: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      pixelHash: fp.hash, width: fp.width,
    })
  }
  return out
}

/** 写 --qmai-ui-font-family 到 documentElement 行内样式 —— 与 applyUiFontFamily 一致。 */
const APPLY_VAR = (css) => {
  const root = document.documentElement
  if (css === null) root.style.removeProperty("--qmai-ui-font-family")
  else root.style.setProperty("--qmai-ui-font-family", css)
}

/** 读产品真实默认字体栈（临时移除行内覆盖后 :root 的计算值）。 */
const READ_DEFAULT_STACK = () => {
  const root = document.documentElement
  const inline = root.style.getPropertyValue("--qmai-ui-font-family")
  root.style.removeProperty("--qmai-ui-font-family")
  const computed = getComputedStyle(root).getPropertyValue("--qmai-ui-font-family").trim()
  if (inline) root.style.setProperty("--qmai-ui-font-family", inline)
  return computed
}

/** 内联 font-family 直接改元素本身（① 号对照，绕过变量通路）。 */
const OVERRIDE_INLINE = (css) => {
  for (const el of document.querySelectorAll(".ui-test-root button, .ui-test-root label, .ui-test-root select, .ui-test-root p, .ui-test-root h1, .ui-test-root h2")) {
    if (css === null) el.style.removeProperty("font-family")
    else el.style.setProperty("font-family", css)
  }
}

/** 内联 --ui 改容器（② 号对照，只走变量通路）。 */
const OVERRIDE_UI_VAR = (css) => {
  for (const el of document.querySelectorAll(".ui-test-root")) {
    if (css === null) el.style.removeProperty("--ui")
    else el.style.setProperty("--ui", css)
  }
}

async function openSettings(page) {
  await page.waitForTimeout(2500)
  const clickedSettings = await page.evaluate(() => {
    for (const el of document.querySelectorAll(".ui-test-root button, .ui-test-root a")) {
      if ((el.getAttribute("aria-label") ?? "") === "设置") { el.click(); return true }
    }
    return false
  })
  await page.waitForTimeout(1200)
  await page.evaluate((navSel) => {
    const nav = document.querySelector(navSel)
    const btn = nav?.querySelector("[data-ui-settings-category-button]")
    if (btn) btn.click()
  }, SETTINGS_NAV)
  await page.waitForTimeout(800)
  return clickedSettings
}

/* ── 4. CDP 权威证据：Chromium 实际用了哪些字体 ────────────────────── */
async function platformFontsOf(cdp) {
  const out = {}
  for (const sel of [".ui-test-crumb", ".ui-test-page-title", ".ui-test-root button", ".ui-test-root p"]) {
    try {
      const { root } = await cdp.send("DOM.getDocument", { depth: 0 })
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })
      if (!nodeId) continue
      const r = await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
      out[sel] = r.fonts.map((f) => f.familyName).join(" + ")
    } catch {
      // 选择器不存在属正常（不同页面结构不同），不视为失败
    }
  }
  return out
}

/* ── 5. 页面会话与用例测量（主流程与自检共用）─────────────────────── */
async function withPage(fn) {
  if (!existsSync(DIST)) throw new Error(`找不到构建产物 ${DIST}，请先 npm run build`)
  const chromium = await loadPlaywright()
  const { server, port } = await serve()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("DOM.enable")
  await cdp.send("CSS.enable")
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0].slice(0, 120)))
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" })
    const opened = await openSettings(page)
    return await fn({ page, cdp, pageErrors, opened })
  } finally {
    await browser.close()
    server.close()
  }
}

/** 依次应用每个用例的字体栈并测量（canvas 指纹 + 真实渲染族 + 整页栅格指纹）。 */
async function measureCases(page, cdp, cases, appDefaultStack) {
  const byCase = {}
  const cdpFonts = {}
  const shots = {}
  for (const c of cases) {
    const css = c.css === "DYNAMIC_MISSING" ? missingCase(appDefaultStack) : c.css
    await page.evaluate(APPLY_VAR, css)
    await page.waitForTimeout(150)
    byCase[c.key] = await page.evaluate(MEASURE, SAMPLE_TEXT)
    cdpFonts[c.key] = await platformFontsOf(cdp)
    // 第三条通道：真实页面栅格化。同一档连拍两张实测逐字节相同（噪声为 0），
    // 所以它既是"用户看到了什么"的最近似证据，也不会误报。
    const buf = await page.screenshot({ fullPage: true })
    shots[c.key] = createHash("sha256").update(buf).digest("hex").slice(0, 16)
  }
  await page.evaluate(APPLY_VAR, null)
  await page.waitForTimeout(150)
  return { byCase, cdpFonts, shots }
}

const hashOfCase = (rec) => aggregate(rec.map((e) => ({ key: e.key, v: `${e.pixelHash}|${e.width}` })))

/**
 * 逐用例判定"是否发生了用户可见的变化"，并把三通道证据分开返回。
 *
 * 三通道：
 *   pix   canvas 像素指纹（含宽度）
 *   font  Chromium CSS.getPlatformFontsForNode 报告的真实渲染字体族
 *   shot  整页栅格化指纹
 * `expect: differ` → 任一通道变化即算生效（通道更多，只会更容易发现"真的变了"）；
 * `expect: same`   → 三通道全部必须不变（比只查指纹更严）。
 */
function judgeCase(c, ctx) {
  const pix = ctx.perCase[c.key] !== ctx.defaultHash
  const font = JSON.stringify(ctx.cdpFonts[c.key] ?? null) !== ctx.defaultFontsKey
  const shot = ctx.shots[c.key] !== ctx.defaultShot
  const channels = [pix && "像素指纹", font && "真实字体", shot && "整页栅格"].filter(Boolean)
  const changed = channels.length > 0
  return { pix, font, shot, channels, changed, ok: c.expect === "differ" ? changed : !changed }
}

/* ── 6. 主流程 ───────────────────────────────────────────────────── */
async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--selftest")) return selftest()

  const argVal = (flag) => {
    const i = argv.indexOf(flag)
    if (i < 0) return null
    const v = argv[i + 1]
    if (!v || v.startsWith("--")) {
      console.log(`  ✗ ARG-FAIL：${flag} 后面缺少文件路径`)
      process.exit(1)
    }
    return v
  }
  const recordAt = argVal("--record")
  const compareAt = argVal("--compare")

  if (!existsSync(DIST)) {
    console.log(`  ✗ 找不到构建产物 ${DIST}，请先 npm run build`)
    process.exit(1)
  }

  // 选项用例**必须**从产品真值派生；import 失败就明确失败，不退化成手抄字面量。
  const productOptions = await loadProductFontOptions()
  const OPTION_CASES = buildOptionCases(productOptions)
  const CASES = [...FROZEN_CASES, ...OPTION_CASES]

  return withPage(async ({ page, cdp, pageErrors, opened }) => {
    const guards = []
    const fail = (code, detail) => guards.push({ code, detail })

    const containerCount = await page.evaluate(() => document.querySelectorAll(".ui-test-root").length)
    if (!opened || containerCount === 0) fail("A/界面未就绪", `未能进入设置页（.ui-test-root 数=${containerCount}）`)

    // ── ① 尺子对照：内联 font-family 必须改变指纹 ──────────────────
    await page.evaluate(APPLY_VAR, null)
    await page.evaluate(OVERRIDE_INLINE, null)
    await page.waitForTimeout(150)
    const appDefaultStack = await page.evaluate(READ_DEFAULT_STACK)
    if (!appDefaultStack) fail("G/默认栈缺失", "读不到 --qmai-ui-font-family 的产品默认值，基准无从建立")
    const baseline = await page.evaluate(MEASURE, SAMPLE_TEXT)

    await page.evaluate(OVERRIDE_INLINE, "SimHei, sans-serif")
    await page.waitForTimeout(150)
    const inline = await page.evaluate(MEASURE, SAMPLE_TEXT)
    await page.evaluate(OVERRIDE_INLINE, null)
    await page.waitForTimeout(150)

    const inlineChanged = countChanged(baseline, inline)
    if (baseline.length >= MIN_ELEMENTS && inlineChanged === 0) {
      fail("B/尺子失效", "直接把元素字体内联改成黑体，指纹却毫无变化 —— 度量方法识别不出换字体，本次所有结论无效")
    }

    // ── ② 尺子对照：内联 --ui 必须改变指纹（变量通路是活的）────────
    await page.evaluate(OVERRIDE_UI_VAR, "SimHei, sans-serif")
    await page.waitForTimeout(150)
    const viaUiVar = await page.evaluate(MEASURE, SAMPLE_TEXT)
    await page.evaluate(OVERRIDE_UI_VAR, null)
    await page.waitForTimeout(150)

    const uiVarChanged = countChanged(baseline, viaUiVar)
    if (baseline.length >= MIN_ELEMENTS && uiVarChanged === 0) {
      fail("C/变量通路断了", "内联 --ui 后指纹无变化 —— var(--ui) 通路本身没有接到任何元素上，本次所有结论无效")
    }

    if (baseline.length < MIN_ELEMENTS) {
      fail("D/样本过少", `只测到 ${baseline.length} 个界面文字元素（下限 ${MIN_ELEMENTS}），页面可能没渲染出来`)
    }

    // ── 主判据：逐个用例 ────────────────────────────────────────────
    const { byCase, cdpFonts, shots } = await measureCases(page, cdp, CASES, appDefaultStack)

    const defaultRec = byCase[DEFAULT_KEY]
    const defaultHash = hashOfCase(defaultRec)
    const perCase = Object.fromEntries(CASES.map((c) => [c.key, hashOfCase(byCase[c.key])]))
    const judgeCtx = {
      perCase,
      defaultHash,
      cdpFonts,
      defaultFontsKey: JSON.stringify(cdpFonts[DEFAULT_KEY] ?? null),
      shots,
      defaultShot: shots[DEFAULT_KEY],
    }

    // ── ③ 负向对照：不存在的字体必须与默认**三条通道全部**一致 ─────
    const missingHash = perCase["不存在"]
    if (missingHash !== defaultHash) {
      fail("E/负向对照失败", "在默认栈前加一个不存在的字体名，指纹却与默认不同 —— 说明指纹变化并非来自字体本身，判据不可信")
    }
    if (shots["不存在"] !== shots[DEFAULT_KEY]) {
      fail("E/负向对照失败（栅格）", "不存在的字体名导致整页栅格化指纹与默认档不同 —— 该通道被判据采信，但它本不该变化，判据不可信")
    }
    if (JSON.stringify(cdpFonts["不存在"] ?? null) !== judgeCtx.defaultFontsKey) {
      fail("E/负向对照失败（真实字体）", "不存在的字体名导致 Chromium 报告的真实渲染字体与默认档不同，判据不可信")
    }

    // ── ④ 新增守卫：全表覆盖（防漂移的牙）──────────────────────────
    const covIssues = coverageIssues(productOptions, OPTION_CASES)
    for (const s of covIssues) fail("O/选项用例覆盖不全", s)

    // ── ⑤ 新增守卫：逐项真实渲染族 ─────────────────────────────────
    if (!defaultFontEvidenceUsable(cdpFonts, DEFAULT_KEY)) {
      fail("Q/真实字体证据缺失", `默认档取不到任何非空真实渲染字体，逐项真实渲染族守卫无从判定：${JSON.stringify(cdpFonts[DEFAULT_KEY] ?? {})}`)
    } else {
      for (const s of renderedFamilyIssues(CASES, DEFAULT_KEY, cdpFonts)) fail("P/真实渲染字体未改变", s)
    }

    /* ── 输出 ─────────────────────────────────────────────────────── */
    console.log("  ══ 界面字体生效性（真实产物 dist/ · 1440x900）══")
    console.log(`  测到的界面文字元素: ${baseline.length}`)
    console.log(`  产品默认字体栈: ${appDefaultStack.slice(0, 90)}${appDefaultStack.length > 90 ? "…" : ""}`)
    console.log(`  用例: 冻结 ${FROZEN_CASES.length} 项 + 产品选项 ${OPTION_CASES.length} 项（选项用例由 src/lib/font-settings.ts 直接派生）`)
    console.log("")
    console.log("  三条证据通道：像素指纹（canvas）· 真实字体（Chromium CDP）· 整页栅格（截图逐像素）")
    console.log("")
    console.log("  用例                    判定   变化元素数  变化通道                  计算字体（首个元素）")
    console.log("  " + "─".repeat(96))

    let judgeFail = 0
    const diffNames = []
    const judged = []
    for (const c of CASES) {
      const rec = byCase[c.key]
      const changed = countChanged(defaultRec, rec)
      const j = judgeCase(c, judgeCtx)
      judged.push({ c, j })
      if (!j.ok) judgeFail++
      if (c.expect === "differ" && j.changed) diffNames.push(c.name)
      const fam = (rec[0]?.family ?? "").split(",")[0].replace(/["']/g, "")
      const label = `${c.origin === "option" ? "◆" : " "}${c.key}`
      const channels = j.channels.length ? j.channels.join("+") : "（三通道全同）"
      console.log(`  ${label.padEnd(22)} ${(j.changed ? "不同" : "相同").padEnd(6)} ${String(changed).padStart(6)}      ${channels.padEnd(24)} ${fam}${j.ok ? "" : "   ← 不符期望"}`)
    }
    console.log("  （◆ = 由产品选项表派生的用例；无标记的是与冻结基线逐字可比的冻结用例）")
    console.log("  （判定：expect=differ 的档三通道任一变化即生效；expect=same 的档必须三通道全同）")

    console.log("")
    console.log("  ── Chromium 报告的真实渲染字体（权威证据）──")
    const allFontSets = new Set()
    for (const c of CASES) {
      const fonts = cdpFonts[c.key] ?? {}
      const summary = Object.values(fonts).filter(Boolean).join(" / ") || "（取不到）"
      allFontSets.add(JSON.stringify(fonts))
      console.log(`  ${c.key.padEnd(18)} ${summary}`)
    }
    if (allFontSets.size < 2) {
      fail("H/字体未真正改变", "所有用例的 Chromium 实际渲染字体完全相同 —— 说明字体根本没换，本次结论无效")
    }

    console.log("")
    console.log("  ── 整页栅格化指纹（同档连拍两张实测逐字节相同，故本通道噪声为 0）──")
    for (const { c, j } of judged) {
      console.log(`  ${c.key.padEnd(18)} ${shots[c.key]}  ${j.shot ? "≠ 默认" : "= 默认"}`)
    }

    console.log("")
    console.log("  ── 尺子自身的对照（任何一项不成立，本次测量结论就不成立）──")
    console.log(`  ① 内联 font-family 对照   变化元素数 ${inlineChanged}  → ${inlineChanged > 0 ? "✓ 度量能识别换字体" : "✗ 识别不出"}`)
    console.log(`  ② 内联 --ui 对照          变化元素数 ${uiVarChanged}  → ${uiVarChanged > 0 ? "✓ var(--ui) 通路是活的" : "✗ 通路没接上"}`)
    console.log(`  ③ 负向对照（不存在字体）  指纹${missingHash === defaultHash ? "✓同" : "✗异"} 真实字体${JSON.stringify(cdpFonts["不存在"] ?? null) === judgeCtx.defaultFontsKey ? "✓同" : "✗异"} 栅格${shots["不存在"] === shots[DEFAULT_KEY] ? "✓同" : "✗异"}`)
    console.log(`  ④ 覆盖面                  ${baseline.length} 个元素（下限 ${MIN_ELEMENTS}）${baseline.length >= MIN_ELEMENTS ? " ✓" : " ✗"}`)
    console.log(`  ⑤ 真实字体随用例改变      ${allFontSets.size} 种不同字体组合 ${allFontSets.size >= 2 ? "✓" : "✗"}`)
    console.log(`  ⑥ 默认栈读自产品本身      ${appDefaultStack ? "✓" : "✗"}`)
    console.log(`  ⑦ 全表覆盖（${productOptions.length} 个产品选项各有且仅有一个用例）  ${covIssues.length === 0 ? "✓" : "✗ " + covIssues.join("；")}`)
    console.log(`  ⑧ 逐项真实渲染族（期望换的都真的换了）        ${renderedFamilyIssues(CASES, DEFAULT_KEY, cdpFonts).length === 0 ? "✓" : "✗"}`)
    console.log(`  ⑨ 整页栅格通道（期望 same 的档栅格必须不变）  ${judged.filter((x) => x.c.expect === "same" && x.j.shot).length === 0 ? "✓" : "✗ 有 same 档的栅格变了"}`)

    /* ── 基线对比 ─────────────────────────────────────────────────── */
    const snapshot = {
      // 记录产品**实际**默认栈，而不是脚本里的某个常量 ——
      // 否则"默认档没变"只能证明脚本没变，证明不了产品没变
      appDefaultStack,
      // cases / perCase 一律以用例**键**为准：键必须与冻结基线里的逐字一致，
      // 否则 F1 的"修复前能生效"判定会因为查不到键而失效。
      cases: CASES.map((c) => c.key),
      optionValues: OPTION_CASES.map((c) => c.value),
      elementCount: baseline.length,
      defaultHash,
      defaultFamilies: defaultRec.map((e) => ({ key: e.key, family: e.family })),
      cdpFonts,
      // perCase 保持"canvas 像素指纹"这一种口径，**不得**混入新通道：
      // 冻结基线 ui-font-before.json 里的 perCase/defaultHash 就是这个口径，
      // 混入新通道会让 defaultHash 与基线不再可比，等于逼人重录基线。
      // 整页栅格指纹另立字段，且只用于本次运行的逐用例判定。
      perCase,
      pageShot: shots,
    }

    if (recordAt) {
      writeFileSync(resolve(REPO, recordAt), JSON.stringify(snapshot, null, 2), "utf8")
      console.log(`\n  已记录基线: ${recordAt}`)
    }

    if (compareAt) {
      const before = JSON.parse(readFileSync(resolve(REPO, compareAt), "utf8"))
      const changedDefault = before.defaultHash !== defaultHash
      const stackChanged = before.appDefaultStack !== appDefaultStack
      const beforeFonts = JSON.stringify(before.cdpFonts?.[DEFAULT_KEY] ?? {})
      const nowFonts = JSON.stringify(cdpFonts[DEFAULT_KEY] ?? {})
      const fontsChanged = beforeFonts !== nowFonts
      console.log("")
      console.log("  ── 与基线对比（默认档观感是否改变）──")
      console.log(`  基线元素数         ${before.elementCount} → 现在 ${baseline.length}`)
      console.log(`  默认档指纹         ${changedDefault ? "✗ 已改变" : "✓ 完全一致"}`)
      console.log(`  默认档真实渲染字体 ${fontsChanged ? "✗ 已改变" : "✓ 一致"}`)
      console.log(`  默认字体栈字符串   ${stackChanged ? "（已改变 —— 见下）" : "✓ 完全一致"}`)
      /*
       * 判据以「用户看到的东西」为准，不以字体栈字符串为准。
       *
       * 本次修复把两套并存的字体栈合成了一套：旧 index.css 的
       * --qmai-ui-font-family（system-ui 优先）与旧 ui-test.css 硬编码的
       * --ui（PingFang SC 优先，且少了 -apple-system / "Segoe UI" 回退项）。
       * 合并后字符串必然不同，但**实际渲染结果可能完全一样**。
       * 若把"字符串必须逐字相同"当作判据，就会把一次无视觉影响的合并
       * 误判为回归，并逼实施者去做没有必要的"字面保真"。
       *
       * 但这不等于放宽判据：真正在意的就是"用户看到的字形变了没有"，
       * 所以下面两条只要有一条不成立即判失败 —— 指纹（样本含双语）
       * 与浏览器报告的真实字体。两者都相同才允许字符串不同，
       * 且会**打印提示**而不是静默放过。
       */
      if (changedDefault || fontsChanged) {
        const beforeKeys = new Map((before.defaultFamilies ?? []).map((e) => [e.key, e.family]))
        let shown = 0
        for (const e of defaultRec) {
          const prev = beforeKeys.get(e.key)
          if (prev && prev !== e.family && shown < 6) {
            console.log(`    ${e.key}`)
            console.log(`      之前: ${prev}`)
            console.log(`      现在: ${e.family}`)
            shown++
          }
        }
        fail("F/默认档观感改变", changedDefault
          ? `默认档字形与基线不同（${before.defaultHash} → ${defaultHash}）`
          : `默认档 Chromium 实际渲染字体与基线不同（${beforeFonts} → ${nowFonts}）`)
      } else if (stackChanged) {
        console.log("    之前: " + before.appDefaultStack)
        console.log("    现在: " + appDefaultStack)
        console.log("    → 字符串不同、但渲染结果相同（指纹与真实渲染字体均已核对），")
        console.log("      属把两套并存字体栈合并为一套的必然结果，默认观感未变。")
        console.log("      新增的 -apple-system / \"Segoe UI\" 只在前面几个家族全部缺失时")
        console.log("      才会被用到；本机由 Microsoft YaHei UI 提供全部字形，故不可达。")
        console.log("      目标平台为 Windows。")
      }

      /* ── "修复前能生效的字体"：只遍历基线真正记录过的用例名（F1）── */
      const cls = classifyBaselineComparison(before, CASES, perCase, defaultHash)
      const nameOf = (k) => CASES.find((c) => c.key === k)?.name ?? k

      console.log("")
      console.log("  ── 修复前 / 现在 能生效的字体（F1：只认基线记录过的用例）──")
      if (!cls.hasRecordedCases) {
        fail("K/基线未记录用例清单",
          `基线 ${compareAt} 里没有 cases 数组，无法判断"哪些用例是录制时就有的"，本次比较不可信`)
        console.log("  基线未记录用例清单 → 无法区分「新增用例」与「录制时就有」")
      } else {
        console.log(`  基线记录过的用例: ${(before.cases ?? []).join("、")}`)
      }
      if (cls.lost.length) {
        fail("J/基线用例丢失",
          `基线里记录过、当前 CASES 里没有的用例: ${cls.lost.join("、")} —— 冻结证据被删了，必须先恢复用例或明确说明`)
      }
      if (cls.added.length) {
        // 要求 2：当前有、基线没有的用例必须显式打印，且绝不参与"修复前"判定
        console.log(`  本次新增用例（基线无对照，不参与"修复前"判定）: ${cls.added.map(nameOf).join("、")}`)
      }
      console.log(`  修复前能生效的字体: ${cls.beforeDiffer.length ? cls.beforeDiffer.map(nameOf).join("、") : "（无 —— 这正是缺陷）"}`)
      console.log(`  现在能生效的字体:   ${cls.nowDiffer.map(nameOf).join("、") || "（无）"}`)
      /*
       * ── 对照实验（每次 --compare 都在真实基线上重跑一遍，不会过期）──
       * 下面这行**原样**复现修复前那行代码：
       *   CASES.filter((c) => c.expect === "differ" && before.perCase[c.name] !== before.defaultHash)
       * 它用**当前** CASES 去查 before.perCase。任何在基线录制之后新增的用例
       * 在基线里都没有键 → `undefined !== before.defaultHash` 为真 →
       * 被判成"修复前就已经生效"。上面那行正确地输出"（无）"，
       * 而这一行会输出一长串**与史实相反**的结论 —— 两行并排打印，
       * 就是本问题的可复现证据。
       */
      const oldStyle = CASES
        .filter((c) => c.expect === "differ" && before.perCase[c.name] !== before.defaultHash)
        .map((c) => c.name)
      console.log(`  （对照：修复前那行代码对同一份基线会输出「修复前能生效的字体: ${oldStyle.join("、") || "（无）"}」）`)
      console.log(`    这 ${new Set(oldStyle).size} 项全部是本次新增的用例（基线里根本没有它们的键），`)
      console.log(`    与"改造前一个字体都不生效"的史实相反，而旧守卫 I 只在"基线与现在都无字体生效"时才失败，`)
      console.log(`    所以它会静默放过、退出码 0 —— 这正是必须修掉的那个谎言。`)
      if (cls.beforeDifferButNowSame.length) {
        console.log(`  ⚠ 基线说当时能生效、现在期望却是"相同"的用例: ${cls.beforeDifferButNowSame.join("、")}（基线数据不自洽，请核对）`)
      }
      if (cls.beforeDiffer.length === 0 && cls.nowDiffer.length === 0) {
        fail("I/修复未生效", "基线与现在都无字体生效 —— 修复没有产生任何效果")
      }
    }

    console.log("")
    if (pageErrors.length) {
      console.log("  页面报错（非 Tauri 环境下属预期）:")
      for (const e of pageErrors.slice(0, 2)) console.log(`    ${e}`)
      console.log("")
    }

    for (const g of guards) console.log(`  ✗ GUARD-FAIL [${g.code}] ${g.detail}`)
    const verdict = guards.length === 0 && judgeFail === 0
    console.log(`  结论: ${judgeFail === 0 ? `字体档 ${diffNames.length} 个生效、负向对照三通道一致` : `${judgeFail} 个用例不符期望`}，守卫 ${guards.length} 项未通过 → ${verdict ? "✓ 通过" : "✗ 未通过"}`)
    process.exit(verdict ? 0 : 1)
  })
}

/** 以 baseline 为基准，统计有多少元素的指纹发生了变化。 */
function countChanged(baseline, other) {
  const byKey = new Map(other.map((e) => [e.key, `${e.pixelHash}|${e.width}`]))
  let n = 0
  for (const e of baseline) {
    const now = byKey.get(e.key)
    if (now !== undefined && now !== `${e.pixelHash}|${e.width}`) n++
  }
  return n
}

main().catch((err) => {
  console.log(`  ✗ 运行失败: ${err?.message ?? err}`)
  process.exit(1)
})
