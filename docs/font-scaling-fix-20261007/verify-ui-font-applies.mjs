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
 * 判据方法（单一判据 + 两条诊断通道）：
 *   1. canvas 像素哈希 + measureText 宽度 —— 这是**唯一判据**。样本文本含中文与
 *      拉丁字母，换字体就会改变字形轮廓 → 哈希与宽度都变。
 *   2. Chromium 的 `CSS.getPlatformFontsForNode` —— 浏览器报告该节点渲染时用了
 *      哪个真实字体家族。它回答"是哪一套字"，但**单独变化不足以判定"用户看得见"**
 *      （同一个 msyh.ttc 里的两个 face 会换名字却不换字形，见下），故只作诊断/佐证。
 *   3. 整页栅格化指纹（截图逐像素）—— 同为诊断/佐证。它会被"整页下移 1px"这类
 *      纯度量差异点亮，所以不能单独作为"生效"的判据（复审的偏移残差实验已证明
 *      微软雅黑档与默认档的栅格差异在最优整数偏移后残差为 0）。
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
 * ── 两道守卫（都经 --selftest 的负向对照证明会失败）──
 *   · 冻结期望清单守卫（M5）：产品 UI_FONT_OPTIONS 的 value 清单与 OPTION_CASES 的
 *     value 清单都必须与 EXPECTED_OPTION_VALUES **逐项相等**。
 *     ⚠ 301d2e2 曾在这里宣称「以后再有人加字体选项而不补端到端用例，本工具立刻红」，
 *     而当时的 OPTION_CASES 就是从同一份 UI_FONT_OPTIONS `map` 出来的，1:1 派生
 *     在构造上恒真 —— 复审实测：加第 12 个选项时静态 spec 红、本工具 EXIT=0 绿。
 *     那句话是不实的，现已由这份**冻结清单**兑现（构造上恒真的守卫不是守卫）。
 *   · 逐项真实渲染族守卫：期望 differ 的档，若 Chromium 报出的真实渲染字体族
 *     与默认档完全相同，即判失败。它是**佐证**（比只比指纹更能抓住"指纹变了但
 *     换的是别的字体"），不替代字形判据。负向对照是一道真实用例：
 *     `"__QMaiNoSuchFont__", <产品默认栈>` 期望 differ，实际渲染与默认相同。
 *   · 栈首可用性守卫（M7）：每个非 system 选项的字体栈打头名字必须是
 *     font-availability.json 里 `usable && sampleKind === "cjk"` 的实测可用名。
 *     静态 spec 与端到端工具由同一条事实文件驱动，覆盖面不再一宽一窄
 *     （复审实测：把 noto-sans 栈首换成实测不可用的 Source Han Sans SC 时，
 *     静态 spec 红、而本工具 EXIT=0 绿）。system 显式豁免并写明理由。
 *
 * ── 为什么"三通道任一变化即生效"是错的（复审用独立测量推翻 301d2e2 的归因）──
 * 301d2e2 见到「微软雅黑」档 canvas 指纹与默认档完全相同、而真实族从
 * Microsoft YaHei UI 变成了 Microsoft YaHei、整页截图差 0.481%，
 * 于是判定"用户看得见变化，是 canvas 这对 face 失明"，把 expect=differ 放宽为
 * 三通道任一变化。复审复跑的测量（本文件与本机 playwright 实测复核一致）：
 *   · canvas 像素哈希：两个 face 在 12/13/14/16/24/48/96px **全部相同**；
 *   · 逐字符 advance 宽度**全部相同**
 *     （16px 实测：16,16,11.258,4.703,16,16,16,16,11.258,10.234，两侧一字不差）；
 *   · 逐元素：墨迹像素数变化 **0/32**、水平质心 Δx 全部 **0.0000**，
 *     只有垂直质心/包围盒有 0.17–0.61px 的亚像素差；
 *   · 固定裁剪框多字号：16px 差 1071 像素，但最优整数偏移 (0,1) 后**残差 0**；
 *     48px 最优 (0,2) 残差 0；96px 最优 (0,4) 残差 0 → **纯垂直位移，不是字形变化**；
 *   · 根因：`line-height: normal` 下行盒高度 Microsoft YaHei 比 Microsoft YaHei UI
 *     **恰好高 1px**（本机实测 12px→15/16、13px→16/17、14px→18/19、16px→20/21、
 *     24px→30/31、32px→41/42；48px 实测差 3，故不纳入断言），
 *     因为 fontBoundingBox 的 ascent 差 1px。两者是同一个 msyh.ttc 里的两个 face。
 * 结论：用户点「微软雅黑」看到的是同一套字形、只挪了不到 1px。把它算作"生效"
 * 是实现层事实，不是感知层事实 —— 属于本项目最忌讳的"看起来过了但没验证用户看到的东西"。
 * 故 expect=differ 的通过条件**只看字形通道（canvas 字形指纹）**；
 * CDP 真实族与整页栅格降级为**诊断/佐证打印**，单独变化不足以免除失败。
 * 整页栅格与真实族**不进入** perCase/defaultHash，冻结基线 ui-font-before.json
 * 依旧逐字节可比，一行都不用重录（本提交用 git diff 自证 blob 未变）。
 *
 * ── 新期望值 expect: "metric-only"（只给 opt:microsoft-yahei）──
 * "字形相同、只有度量差"不再被放行，而是被**显式记录并钉死**，配正向断言
 * （可证伪的写法才算判据；偏离任一条即红）：
 *   ① 该档 CDP 真实渲染族与默认档**不同**，且本机实测为 Microsoft YaHei
 *      （默认档实测为 Microsoft YaHei UI）—— 见 METRIC_ONLY_EXPECTATION；
 *   ② canvas 字形指纹与默认档**完全相同** —— 未换字形；
 *   ③ 逐元素**墨迹像素数变化 = 0**、**水平质心 Δx = 0.0000** —— 未换字形
 *      （与 ② 互为佐证：② 是整体指纹，③ 是两个独立标量投影）；
 *   ④ `line-height: normal` 的行盒高度与默认档**恰好差 1px**（同一进程内实测取差值）
 *      —— 这一条才是"度量近似"与"完全无效"的分界：没有它，②③ 与"这一档根本
 *      没接上"无法区分。
 * 报告里 `differ`（真换字形）/ `metric-only`（字形相同仅度量差）/ "没生效" **分开计数**，
 * 绝不把 metric-only 混进"生效"里含糊过去；--compare 的两行也相应区分。
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
 * ── 基线自身完整性守卫（M2 / M3 / M4，都是复审实测出来的绕过路径）──
 * 三条都不是"用例名"的问题，而是**字段缺失/为空**被当成了可用真值：
 *   · M2 `cases` 是**空数组**（不是删除）：`Array.isArray([])` 为真，旧守卫 K 不触发，
 *     于是全部 16 个用例被塞进"新增"、打印「修复前能生效的字体:（无 —— 这正是缺陷）」
 *     并 **EXIT=0 通过** —— 零记录的空洞真值被当成了证明。
 *     现在 `cases` 不是数组**或为空**都判 GUARD-FAIL [K]，措辞为
 *     「未记录用例清单或清单为空，本次比较不可信」，且不再打印那条"（无）"结论
 *     （零记录时它没有出处，改印"（不可判定）"）。
 *   · M3 删掉 `defaultHash`：`h !== before.defaultHash` 对每个记录用例都成立 →
 *     会**重新打印**「修复前能生效的字体: 黑体、楷体、仿宋」这条不实陈述
 *     （守卫 F 虽兜住退出码，陈述已经打出去了）。现在不是非空字符串就
 *     GUARD-FAIL [L/基线缺 defaultHash] 并**整段跳过**对比输出。
 *   · M4 删掉 `perCase`：直接抛 `Cannot read properties of undefined (reading '黑体')`，
 *     退出码 1 但没有 GUARD-FAIL。现在 GUARD-FAIL [L/基线缺 perCase]；
 *     单个用例缺键也进 `incomplete` 并 GUARD-FAIL [L/基线 perCase 不完整]，
 *     兑现了代码里"交由调用方单独报告"的承诺，且对照实验行改用可选链不再崩。
 *
 * ── 本工具不重录任何冻结基线 ──
 * `ui-font-before.json` / `census-before.json` / `overflow-before.json` 三个 blob
 * 一字未动（`git diff <父提交> HEAD --stat -- docs/font-scaling-fix-20261007/*-before.json`
 * 为空即证）。`perCase`/`defaultHash` 仍只有"canvas 字形指纹"一种口径，
 * 新增的墨迹量/质心/行盒高/整页栅格都另立字段，不混进冻结口径。
 *
 * 用法：
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs --record docs/.../ui-font-before.json
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs --compare docs/.../ui-font-before.json
 *   node docs/font-scaling-fix-20261007/verify-ui-font-applies.mjs --selftest
 *
 * 退出码：0 = 全部判据通过；1 = 有判据不通过（含守卫不通过）。
 * 注意：`--selftest` 含**浏览器内的**负向对照（逐项真实渲染族守卫必须对一道假用例
 * 报错、真/假 metric-only 档必须分别通过/失败），因此它需要 dist/ 与 playwright，
 * 与主流程同条件。
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
 * **冻结的**产品选项 value 清单（按任务计划的顺序）。
 *
 * 为什么必须冻结而不是从 UI_FONT_OPTIONS 派生：301d2e2 的"全表覆盖守卫"
 * 是拿 OPTION_CASES（由 UI_FONT_OPTIONS `map` 出来）去比 UI_FONT_OPTIONS，
 * 构造上恒真，等于没有守卫 —— 复审实测「加第 12 个选项」时静态 spec 红、
 * 本工具 EXIT=0 绿，而注释却宣称本工具会立刻红。
 *
 * 改这里必须**同时**改：
 *   ① 任务计划里的选项清单；
 *   ② `src/lib/font-settings.spec.ts` 里对 UI_FONT_OPTIONS 的**全等**断言；
 *   ③ `src/lib/font-settings.ts` 的 UI_FONT_OPTIONS 本身。
 * 本清单的意义就是让「悄悄加选项」在端到端层**也**变红。
 */
const EXPECTED_OPTION_VALUES = [
  "system",
  "microsoft-yahei",
  "microsoft-jhenghei",
  "simhei",
  "simsun",
  "nsimsun",
  "kaiti",
  "fangsong",
  "dengxian",
  "noto-sans",
  "noto-serif",
]

/**
 * `expect: "metric-only"` 的**唯一**许可档，以及它的正向期望值。
 *
 * 本机实测（playwright 复跑，与复审一致）：
 *   默认档 `--qmai-ui-font-family` → Chromium 报告真实渲染族 **Microsoft YaHei UI**
 *   微软雅黑档                     → **Microsoft YaHei**
 * 两者是同一个 `msyh.ttc` 里的两个 face：canvas 字形指纹、逐字符 advance、
 * 墨迹像素数、水平质心全部相同；只有 `line-height: normal` 的行盒高度差 1px。
 * 这些具体数值都是**实测**出来的，不是抄来的：本文件 --selftest 会断言
 * metric-only 档仅此一例，且运行时逐条复核。
 */
const METRIC_ONLY_EXPECTATION = {
  key: "opt:microsoft-yahei",
  /** 该档 Chromium 应报出的真实渲染族（实测值）。 */
  renderedFamily: "Microsoft YaHei",
  /** 默认档 Chromium 应报出的真实渲染族（实测值，作为对照的一半）。 */
  defaultRenderedFamily: "Microsoft YaHei UI",
  /** `line-height: normal` 下行盒高度与默认档的实测差值（每个字号都恰好 +1px）。 */
  lineBoxDelta: 1,
}

/**
 * 行盒高度取样的字号。全部是**实测差值为 1px** 的字号
 * （12→15/16、13→16/17、14→18/19、16→20/21、24→30/31、32→41/42）。
 * 48px 实测差 3px，属另一种比例关系，故不纳入这条断言（写进注释备查，不假装它也是 1）。
 */
const LINE_BOX_SIZES = [12, 13, 14, 16, 24, 32]


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
    /*
     * system 就是"跟随本机默认"，它与默认档必须渲染一致；
     * microsoft-yahei 是**已知的度量近似档**（字形完全相同、只差 1px 行盒度量），
     * 用 metric-only 显式记录并逐条正向断言，不再假装它"换了字形"；
     * 其余每一项都是用户显式选了某个字体，必须真的改变字形。
     */
    expect: o.value === "system" ? "same"
      : o.value === "microsoft-yahei" ? "metric-only"
      : "differ",
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

/**
 * 读本机字体可用性的**实测事实文件**（与 `src/lib/font-settings.spec.ts` 同一份）。
 *
 * 返回 `usable && sampleKind === "cjk"` 的名字集合 —— 即"本机真的能提供中文字形"
 * 的名字（probe 用纯中文样本，Arial/Segoe UI 这类无中文字形的会被判不可用）。
 * 文件读不到、或集合为空，都必须**明确失败**，绝不允许静默退化成一个空集合
 * （空集合会让栈首守卫对任何名字都报错，也能让"必须可用"的断言变成空洞真值）。
 *
 * ── 为什么这里还要复核每条 entry 的出处（与 spec 的 M6 同一条规则）──
 * 本守卫是"栈首名字 ∈ 可用集合"。若事实文件本身被人改了**一格**
 * （复审实测：把 Source Han Sans SC 的 usable 从 false 翻成 true，
 * ruler.ok 与正/负对照全都不动），那么"可用集合"就被污染，
 * 栈首守卫会转而**放行**一个本机根本没有的字体名 ——
 * 两条防线又变成一宽一窄。所以在读的时候一并复核：
 * `usable` 必须与它自己记录的 perBaseline 明细一致、基准名必须是文件声明过的、
 * 实验组/基准组的实际渲染族必须非空。任一条不成立即抛错 → GUARD-FAIL S。
 * 这样"伪造事实文件"在静态 spec 与端到端工具两条线上都会红。
 */
function loadUsableCjkNames() {
  const file = join(HERE, "font-availability.json")
  if (!existsSync(file)) throw new Error(`找不到字体可用性事实文件 ${file}`)
  const data = JSON.parse(readFileSync(file, "utf8"))
  if (!Array.isArray(data?.entries)) throw new Error(`${file} 里没有 entries 数组`)

  const baselines = new Set(Array.isArray(data.baselines) ? data.baselines : [])
  const bad = []
  for (const e of data.entries) {
    const ev = e?.evidence ?? {}
    const per = Array.isArray(e?.perBaseline) ? e.perBaseline : []
    const anyDiffers = per.some((p) => p?.differs === true)
    if (typeof ev.baseline !== "string" || !baselines.has(ev.baseline)) {
      bad.push(`「${e?.name}」的证据基准 ${JSON.stringify(ev.baseline)} 不在声明过的 baselines 里`)
    } else if (typeof ev.withFont !== "string" || ev.withFont.length === 0
      || typeof ev.baseFont !== "string" || ev.baseFont.length === 0) {
      bad.push(`「${e?.name}」的证据缺少实验组/基准组的实际渲染族`)
    } else if (e.usable !== anyDiffers) {
      bad.push(`「${e?.name}」的 usable=${String(e.usable)} 与 perBaseline 实测不符` +
        `（明细里${anyDiffers ? "有" : "没有任何"} differs:true）`)
    }
  }
  if (bad.length) {
    throw new Error(
      `${file} 里有 ${bad.length} 条 entry 的 usable 与它自己的证据不符，` +
      `说明这份"实测事实"至少被改过一格，不能拿来判定栈首可用性：${bad.slice(0, 3).join("；")}` +
      `${bad.length > 3 ? ` …（共 ${bad.length} 条）` : ""}`,
    )
  }

  const names = new Set(
    data.entries.filter((e) => e.usable === true && e.sampleKind === "cjk").map((e) => e.name),
  )
  if (names.size === 0) {
    throw new Error(
      `${file} 里"可用且能提供中文字形"的集合为空 —— ` +
      `要么事实文件坏了，要么尺子把所有字体都判死了，两种情况都不可用于栈首守卫`,
    )
  }
  return { file, names, count: names.size }
}

/* ══════════════════ 守卫：抽成纯函数，便于 --selftest 直接喂坏输入 ══════════════════ */

/**
 * 派生一致性守卫：产品选项表的每个 value 必须在 OPTION_CASES 里出现且**仅**一次。
 *
 * ⚠ 它**不是**防漂移的牙：OPTION_CASES 就是从同一份 UI_FONT_OPTIONS `map` 出来的，
 * 1:1 派生在构造上恒真（301d2e2 曾把它当成"加选项就红"的守卫，那是错的）。
 * 它只负责抓"有人手工改坏了派生映射"（重复/孤儿/脱节），
 * 真正的漂移守卫是下面的 frozenListIssues。
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
 * 冻结期望清单守卫（M5）：产品表与 OPTION_CASES 的 value 清单都必须与
 * EXPECTED_OPTION_VALUES **逐项、按序**相等。
 *
 * 这是"以后再有人加第 12 个字体选项而不补端到端用例，本工具立刻红"的**真**兑现：
 * 清单是写死在这里的，不从产品表派生，所以产品表一变就红。
 * 顺序也一并比对（比"集合相等"更严），因为静态 spec 也断言顺序。
 */
function frozenListIssues(productOptions, optionCases, expected = EXPECTED_OPTION_VALUES) {
  const issues = []
  const orderedSame = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
  const productValues = productOptions.map((o) => o.value)
  const caseValues = optionCases.map((c) => c.value)
  if (!orderedSame(productValues, expected)) {
    issues.push(
      `产品 UI_FONT_OPTIONS 的 value 清单与冻结期望清单不一致：产品=[${productValues.join(",")}] ` +
      `期望=[${expected.join(",")}] —— 增/删/改/换序都必须同时改本清单、任务计划与 font-settings.spec.ts 的全等断言`,
    )
  }
  if (!orderedSame(caseValues, expected)) {
    issues.push(
      `OPTION_CASES 的 value 清单与冻结期望清单不一致：用例=[${caseValues.join(",")}] ` +
      `期望=[${expected.join(",")}] —— 端到端用例漏了或多了选项`,
    )
  }
  return issues
}

/**
 * 栈首可用性守卫（M7）：每个**非 system** 选项的字体栈打头名字必须是
 * `font-availability.json` 实测「可用且能提供中文字形」的名字。
 *
 * 为什么需要：静态 spec 有这条断言，而端到端工具原先完全没有 ——
 * 复审实测把 `noto-sans` 栈首换成实测不可用的 `Source Han Sans SC`
 * （本机静默回退到 Noto Sans SC）时，静态 spec 红、端到端工具 EXIT=0 绿，
 * 两条防线覆盖面不一致。现在两端都读同一份事实文件。
 *
 * system 显式豁免并写明理由：它表达的是「跟随本机默认」，栈首刻意放 macOS 的
 * "PingFang SC"（Windows 上必然不可用），靠紧随其后的 "Microsoft YaHei UI" 命中 ——
 * 那是设计，不是"选了没反应"；用户点的就是"本机默认"，本机也确实用了本机的字体。
 * 若把它也纳入，唯一能让判据变绿的改法就是改产品字体栈，而那会改变默认档字形
 * （已被 --compare + ui-font-before.json 在真实浏览器里钉死）。
 */
function stackLeadAvailabilityIssues(cases, usableCjkNames, exemptValues = new Set(["system"])) {
  const issues = []
  for (const c of cases) {
    if (exemptValues.has(c.value)) continue
    const lead = String(c.css ?? "").split(",")[0].trim().replace(/^["']|["']$/g, "").trim()
    if (!lead) {
      issues.push(`选项「${c.value}」的字体栈为空，无法判定栈首可用性`)
      continue
    }
    if (!usableCjkNames.has(lead)) {
      issues.push(
        `选项「${c.value}」的字体栈打头名字「${lead}」在本机实测**不可用**` +
        `（font-availability.json 里 usable && sampleKind === "cjk" 的集合不含它）—— ` +
        `用户点这一项会静默回退，等于"选了没反应"`,
      )
    }
  }
  return issues
}

/**
 * 逐项真实渲染族守卫：期望 differ 的档，其 Chromium 报告的真实渲染字体族
 * 不能与默认档完全相同。
 *
 * 定位是**佐证**，不是判据：它抓"指纹变了但换的是别的字体"，也抓"根本没接上"；
 * 而"真实族变了但字形没变"（微软雅黑档）已由 expect=metric-only 单独钉死，
 * 不再由它放行。metric-only 档的族名期望在 metricOnlyIssues 里逐条断言。
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
 * 基线自洽性守卫（M3 / M4）。
 *
 * 复审实测的两条绕过路径：
 *   · 删掉基线 `defaultHash`：`h !== before.defaultHash` 对**每个**记录用例都成立
 *     → 工具会重新打印「修复前能生效的字体: 黑体、楷体、仿宋」这条**不实陈述**
 *     （守卫 F 虽兜住退出码，但陈述已经打出去了）；
 *   · 删掉基线 `perCase`：直接抛 `Cannot read properties of undefined (reading '黑体')`，
 *     退出码 1 但没有 GUARD-FAIL，代码里"交由调用方单独报告"的承诺没兑现。
 * 所以在打印任何"修复前/现在"结论**之前**先做这一步：不完整就 GUARD-FAIL 并跳过对比。
 */
function baselineIntegrityIssues(before) {
  const issues = []
  if (typeof before?.defaultHash !== "string" || before.defaultHash.length === 0) {
    issues.push({
      code: "L/基线缺 defaultHash",
      detail: `基线里没有非空的 defaultHash，无法判断"修复前某档是否与默认档相同"，` +
        `而"每个用例都与 undefined 不同"会让工具打印一条与史实相反、无法证实的结论。本次比较不可信`,
    })
  }
  const pc = before?.perCase
  if (pc === null || typeof pc !== "object" || Array.isArray(pc)) {
    issues.push({
      code: "L/基线缺 perCase",
      detail: `基线里没有 perCase 对象，无法逐个用例核对"修复前是否生效"。` +
        `继续算下去只会崩溃或凭空判定，本次比较不可信`,
    })
  }
  return issues
}

/**
 * 基线的"修复前"覆盖判定（F1 核心）。
 *
 * @param before 冻结基线对象（含 cases / perCase / defaultHash）
 * @param currentCases 当前 CASES（每项有 key / name / expect）
 * @param currentPerCase 当前每个 key 的指纹
 * @param currentDefaultHash 当前默认档指纹
 * @returns {{ hasUsableCaseList, beforeDiffer, added, lost, incomplete, nowGlyphDiffer, nowMetricOnly, beforeDifferButNowSame }}
 *
 * **beforeDiffer 只遍历 before.cases** —— 即基线真正记录过的那些用例名，
 * 只对这些名字查 before.perCase。任何基线录制之后新增的用例都不参与
 * "修复前能生效"的判定，而是进入 `added` 并被显式打印。
 *
 * M2：`cases` 存在但为空数组同样是**不可信**的（`Array.isArray([])` 为真，
 * 旧守卫 K 不触发 → 全部用例被塞进"新增"、打印「修复前能生效的字体:（无）」、
 * EXIT=0 —— 零记录的空洞真值被当成证明）。故 `hasUsableCaseList` 要求**非空数组**。
 * M4：基线 `perCase` 里缺某个记录用例的键时，进 `incomplete` 而不是静默 `continue`，
 * 由调用方给出明确的 GUARD-FAIL。
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
  const incomplete = []
  for (const k of recorded ?? []) {
    const h = before.perCase?.[k]
    if (typeof h !== "string" || h.length === 0) { incomplete.push(k); continue }
    if (h === before.defaultHash) continue // 修复前与默认档相同 = 该字体当时不生效
    const cur = byKey.get(k)
    if (!cur) continue // 已计入 lost
    if (cur.expect === "differ" || cur.expect === "metric-only") beforeDiffer.push(k)
    else beforeDifferButNowSame.push(k)
  }

  /*
   * "现在能生效"按期望值**分档**，不许混在一起：
   *   · 字形真的变了（expect=differ 且指纹 != 默认）
   *   · 仅度量差（expect=metric-only；字形与默认相同，用户看不见变化）
   * metric-only 的完整正向断言由 metricOnlyIssues 负责，这里的归类只用于报告。
   */
  const nowGlyphDiffer = currentCases
    .filter((c) => c.expect === "differ" && currentPerCase[c.key] !== undefined && currentPerCase[c.key] !== currentDefaultHash)
    .map((c) => c.key)
  const nowMetricOnly = currentCases.filter((c) => c.expect === "metric-only").map((c) => c.key)

  return {
    hasUsableCaseList: Array.isArray(recorded) && recorded.length > 0,
    beforeDiffer, added, lost, incomplete, nowGlyphDiffer, nowMetricOnly, beforeDifferButNowSame,
  }
}

/** 一条元素记录里的"字形标量投影"：墨迹像素数与质心（不参与哈希，故与冻结基线口径无关）。 */
function glyphProjection(rec) {
  return rec.map((e) => ({ key: e.key, ink: e.ink, cx: Math.round(e.cx * 10000) / 10000, cy: Math.round(e.cy * 10000) / 10000 }))
}

/**
 * metric-only 档的"未换字形"证据（M1 的 ② ③）。
 *
 * 与默认档逐元素比对：**墨迹像素数必须一个不差、水平质心 Δx 必须为 0**。
 * 这两项与 canvas 整体指纹互为佐证：指纹是一个哈希（理论上可能碰撞），
 * 而墨迹数与水平质心是两个独立的标量投影，三者同时相同，"字形没换"就很难是巧合。
 * 垂直方向**允许**有亚像素差 —— 那正是 metric-only 档的已知度量差
 * （行盒高 1px 导致的纯垂直位移），也正是它区别于"完全无效"的地方。
 */
function glyphUnchangedIssues(caseKey, glyphRecords, defaultKey) {
  const issues = []
  const def = glyphRecords?.[defaultKey]
  const now = glyphRecords?.[caseKey]
  if (!Array.isArray(def) || def.length === 0) {
    issues.push(`默认档没有可用的字形标量记录，无法判定"未换字形"`)
    return { issues, total: 0, inkChanged: -1, maxDx: -1 }
  }
  if (!Array.isArray(now) || now.length !== def.length) {
    issues.push(`该档测到的元素数 ${Array.isArray(now) ? now.length : "（缺失）"} 与默认档 ${def.length} 不一致，无法逐元素比对`)
    return { issues, total: def.length, inkChanged: -1, maxDx: -1 }
  }
  const byKey = new Map(now.map((e) => [e.key, e]))
  let inkChanged = 0
  let maxDx = 0
  let maxDy = 0
  for (const d of def) {
    const n = byKey.get(d.key)
    if (!n) { issues.push(`元素 ${d.key} 在该档里缺失`); continue }
    if (n.ink !== d.ink) inkChanged++
    maxDx = Math.max(maxDx, Math.abs(n.cx - d.cx))
    maxDy = Math.max(maxDy, Math.abs(n.cy - d.cy))
  }
  if (inkChanged > 0) issues.push(`墨迹像素数变化的元素 ${inkChanged}/${def.length}（必须为 0：字形没换，墨迹量就不该变）`)
  if (maxDx > 0) issues.push(`水平质心最大偏移 ${maxDx.toFixed(4)}px（必须为 0：水平方向是字形宽度，换了字形必变）`)
  return { issues, total: def.length, inkChanged, maxDx, maxDy }
}

/**
 * `expect: "metric-only"` 的**完整正向断言**（M1 核心，可证伪的写法）。
 *
 * ctx 需要：perCase / defaultHash / glyphRecords / defaultKey / cdpFonts /
 * defaultFontsKey / lineBoxDeltas。任一条不成立即返回 issue（= 判失败）。
 *
 * ① 真实渲染族确实变了，且**等于实测值**（Microsoft YaHei vs 默认 Microsoft YaHei UI）
 *    —— 这一条证明"这一档确实接上了另一个 face"，否则与"完全无效"无法区分；
 * ② canvas 字形指纹与默认档**完全相同** —— 未换字形；
 * ③ 墨迹像素数变化 = 0、水平质心 Δx = 0 —— 未换字形（独立标量投影佐证 ②）；
 * ④ `line-height: normal` 行盒高度与默认档**恰好差 1px** —— 证明"度量近似"这件事
 *    真的存在，且量级就是 1px。没有 ④，②③ 无法与"这一档根本没生效"区分开。
 */
function metricOnlyIssues(c, ctx) {
  const issues = []
  const exp = METRIC_ONLY_EXPECTATION
  if (c.key !== exp.key) {
    issues.push(`期望值 metric-only 只允许用于 ${exp.key}，却出现在 ${c.key} 上 —— ` +
      `这会把"字形真的没变"的档伪装成"已生效"`)
    return issues
  }

  // ② canvas 字形指纹必须与默认档完全相同
  if (ctx.perCase?.[c.key] !== ctx.defaultHash) {
    issues.push(`canvas 字形指纹与默认档**不同**（${ctx.perCase?.[c.key]} vs ${ctx.defaultHash}）—— ` +
      `那说明这一档真的换了字形，应改用 expect=differ，而不是 metric-only`)
  }

  // ③ 墨迹像素数与水平质心
  const glyph = glyphUnchangedIssues(c.key, ctx.glyphRecords, ctx.defaultKey)
  issues.push(...glyph.issues)

  // ① CDP 真实渲染族：必须变了，且等于实测值
  const rec = ctx.cdpFonts?.[c.key] ?? null
  const defRec = ctx.cdpFonts?.[ctx.defaultKey] ?? null
  const familiesOf = (r) => Object.values(r ?? {}).filter((v) => typeof v === "string" && v.length > 0)
  const nowFamilies = familiesOf(rec)
  const defFamilies = familiesOf(defRec)
  if (JSON.stringify(rec) === ctx.defaultFontsKey || JSON.stringify(rec) === JSON.stringify(defRec)) {
    issues.push(`该档 Chromium 报告的真实渲染字体族与默认档完全相同（${JSON.stringify(rec)}）—— ` +
      `这一档根本没接上另一个 face，metric-only 的正向前提不成立`)
  }
  if (!nowFamilies.includes(exp.renderedFamily)) {
    issues.push(`该档真实渲染族里没有实测期望的「${exp.renderedFamily}」，实际为 ${JSON.stringify(nowFamilies)} —— ` +
      `本机实测值与实现不符，必须重新测量并写进 METRIC_ONLY_EXPECTATION（不许沿用旧结论）`)
  }
  if (defFamilies.length > 0 && !defFamilies.includes(exp.defaultRenderedFamily)) {
    issues.push(`默认档真实渲染族里没有实测期望的「${exp.defaultRenderedFamily}」，实际为 ${JSON.stringify(defFamilies)} —— ` +
      `对照的另一半不成立，metric-only 的结论无从谈起`)
  }

  // ④ 行盒高度差值必须恰好是 1px（同进程实测取差值）
  const deltas = ctx.lineBoxDeltas?.[c.key]
  if (!deltas || Object.keys(deltas).length === 0) {
    issues.push(`没有测到该档与默认档的行盒高度差，无法证明"确实存在 1px 级行盒度量差"`)
  } else {
    for (const size of LINE_BOX_SIZES) {
      const d = deltas[size]
      if (d !== exp.lineBoxDelta) {
        issues.push(`${size}px 的行盒高度差为 ${d}（期望恰好 ${exp.lineBoxDelta}）—— ` +
          `"字形相同仅度量差"的量级与实测不符，必须重新测量`)
      }
    }
  }
  return issues
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
  check("F1 新增用例仍计入「现在真的换了字形」", clsOk.nowGlyphDiffer.includes("opt:noto-sans"), clsOk.nowGlyphDiffer.join("、"))

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
  check("F1 基线缺 cases 时明确标记「未记录用例清单」", clsNoCases.hasUsableCaseList === false, "")

  /* ── M2：cases 为空**数组**同样是空洞真值，必须判不可信 ── */
  const clsEmptyCases = classifyBaselineComparison({ ...fakeBefore, cases: [] }, synthCurrent, synthNow, "BASE")
  check("M2 基线 cases 为空数组时必须判「清单为空、不可信」",
    clsEmptyCases.hasUsableCaseList === false,
    `hasUsableCaseList=${clsEmptyCases.hasUsableCaseList}（旧写法只看 Array.isArray，会判 true 并放行）`)
  check("M2 负向对照：旧判据（只查 Array.isArray）确实会放行空数组",
    Array.isArray([]) === true && [].length === 0, "Array.isArray([]) === true，这正是漏网点")

  /* ── M3：缺 defaultHash 必须在打印任何结论之前被守卫拦下 ── */
  const noHashIssues = baselineIntegrityIssues({ ...fakeBefore, defaultHash: undefined })
  check("M3 缺 defaultHash 时 baselineIntegrityIssues 报「L/基线缺 defaultHash」",
    noHashIssues.some((g) => g.code.includes("defaultHash")),
    noHashIssues.map((g) => g.code).join("、") || "（无）")
  check("M3 负向对照：缺 defaultHash 时旧算法会输出不实的「修复前能生效」",
    (() => {
      const b = { ...fakeBefore, defaultHash: undefined }
      const wrong = (b.cases ?? []).filter((k) => b.perCase[k] !== b.defaultHash)
      return wrong.length > 0
    })(), "每个记录用例都与 undefined 不同 → 旧写法会把它们说成「修复前就生效」")

  /* ── M4：缺 perCase 时给明确的 GUARD-FAIL，且旧对照行不许崩溃 ── */
  const noPerCaseIssues = baselineIntegrityIssues({ ...fakeBefore, perCase: undefined })
  check("M4 缺 perCase 时 baselineIntegrityIssues 报「L/基线缺 perCase」",
    noPerCaseIssues.some((g) => g.code.includes("perCase")),
    noPerCaseIssues.map((g) => g.code).join("、") || "（无）")
  const incomplete = classifyBaselineComparison(
    { ...fakeBefore, perCase: { 默认: "BASE", 黑体: "BASE" } }, synthCurrent, synthNow, "BASE")
  check("M4 perCase 不完整的用例被单列为「无从判定」而不是静默 continue",
    incomplete.incomplete.includes("楷体") && incomplete.incomplete.includes("仿宋"),
    incomplete.incomplete.join("、") || "（空）")
  check("M4 负向对照：旧写法读 before.perCase[c.name] 会抛 TypeError（不再崩溃）",
    (() => {
      try {
        const b = { ...fakeBefore, perCase: undefined }
        // 新写法用可选链；旧写法 before.perCase[c.name] 会抛
        return b.perCase?.["黑体"] === undefined
      } catch { return false }
    })(), "新写法用 before.perCase?.[…] 兜住")

  /* ── M5：冻结期望清单必须能抓住"悄悄加第 12 个选项" ── */
  const realProduct = await loadProductFontOptions()
  const realCases = buildOptionCases(realProduct)
  check("M5 冻结期望清单对当前产品表无意见",
    frozenListIssues(realProduct, realCases).length === 0,
    frozenListIssues(realProduct, realCases).join("；"))
  check("M5 冻结期望清单与产品表项数一致",
    realProduct.length === EXPECTED_OPTION_VALUES.length,
    `产品 ${realProduct.length} 项 / 冻结清单 ${EXPECTED_OPTION_VALUES.length} 项`)
  const sneakyProduct = [...realProduct, { value: "kaiti-extra", label: "再加一个楷体", cssFamily: 'KaiTi, "Kaiti SC", serif' }]
  const sneakyIssues = frozenListIssues(sneakyProduct, buildOptionCases(sneakyProduct))
  check("M5 负向对照：加第 12 个选项时冻结期望清单**会红**",
    sneakyIssues.some((s) => s.includes("kaiti-extra")),
    sneakyIssues.join("；") || "（未报错 —— 守卫是装饰）")
  check("M5 被派生映射的覆盖面守卫本身抓不到「加选项」（证明冻结清单不可省）",
    coverageIssues(sneakyProduct, buildOptionCases(sneakyProduct)).length === 0,
    "1:1 派生在构造上恒真，这正是 301d2e2 那句注释不成立的原因")

  /* ── M7：栈首可用性守卫必须能抓住"栈首换成实测不可用的名字" ── */
  const avail = loadUsableCjkNames()
  check("M7 可用性事实文件读到了足够多的「可用中文字形」名字",
    avail.count >= 10, `${avail.count} 个；文件 ${avail.file}`)
  check("M7 当前产品选项的栈首全部实测可用（含 system 豁免后无意见）",
    stackLeadAvailabilityIssues(realCases, avail.names).length === 0,
    stackLeadAvailabilityIssues(realCases, avail.names).join("；"))
  const mutatedCases = realCases.map((c) =>
    c.value === "noto-sans" ? { ...c, css: '"Source Han Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif' } : c)
  const m7Issues = stackLeadAvailabilityIssues(mutatedCases, avail.names)
  check("M7 负向对照：noto-sans 栈首换成实测不可用的 Source Han Sans SC 时**会红**",
    m7Issues.some((s) => s.includes("Source Han Sans SC")),
    m7Issues.join("；") || "（未报错 —— 守卫是装饰）")
  check("M7 system 项被显式豁免（它的栈首 PingFang SC 本机不可用是设计）",
    !avail.names.has("PingFang SC") &&
      stackLeadAvailabilityIssues(
        [{ value: "system", css: '"PingFang SC", "Microsoft YaHei UI", sans-serif' }], avail.names).length === 0,
    "豁免必须有前提：PingFang SC 确实不在实测可用集合里，豁免理由才成立")

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
 * 再加两组 metric-only 对照（M1 的正向断言必须可证伪）：
 *   真度量档：用产品里 microsoft-yahei 的真实栈、用**真实键** expect=metric-only
 *     —— 四条第 ①–④ 必须全部成立（否则判据把真实现象判死，等于把缺陷换了个方向）；
 *   假度量档：同一个键但字体栈改成默认栈（根本没换 face）
 *     —— 必须报错，且报错要同时点出"真实渲染族没变"与"行盒差不等于 1px"。
 * 输入数据全部来自真实页面（getComputedStyle + CDP + 实测行盒），不是合成对象。
 */
async function selftestBrowserNegativeControl() {
  return withPage(async ({ page, cdp }) => {
    const appDefaultStack = await page.evaluate(READ_DEFAULT_STACK)
    if (!appDefaultStack) throw new Error("读不到产品默认栈，负向对照无法构造")

    /** 跑一轮测量并组装判据上下文（每轮独立，避免同键用例互相覆盖）。 */
    const runRound = async (roundCases) => {
      const { byCase, cdpFonts, shots, lineBoxes } = await measureCases(page, cdp, roundCases, appDefaultStack)
      const defaultHash = hashOfCase(byCase[DEFAULT_KEY])
      const perCase = Object.fromEntries(roundCases.map((c) => [c.key, hashOfCase(byCase[c.key])]))
      const glyphRecords = Object.fromEntries(roundCases.map((c) => [c.key, glyphProjection(byCase[c.key])]))
      const ctx = {
        perCase, defaultHash, cdpFonts,
        defaultFontsKey: JSON.stringify(cdpFonts[DEFAULT_KEY] ?? null),
        shots, defaultShot: shots[DEFAULT_KEY],
        glyphRecords, defaultKey: DEFAULT_KEY,
        lineBoxDeltas: lineBoxDeltas(lineBoxes, DEFAULT_KEY, LINE_BOX_SIZES),
      }
      return { byCase, cdpFonts, shots, lineBoxes, ctx }
    }

    const cases = [
      { key: DEFAULT_KEY, name: "默认", css: null, expect: "same" },
      { key: "假换字体", name: "假换字体", css: missingCase(appDefaultStack), expect: "differ" },
      { key: "真换字体", name: "真换字体", css: "SimHei, sans-serif", expect: "differ" },
    ]
    const { cdpFonts, shots, ctx: judgeCtx } = await runRound(cases)

    const issues = renderedFamilyIssues(cases, DEFAULT_KEY, cdpFonts)
    const jFake = judgeCase(cases[1], judgeCtx)
    const jReal = judgeCase(cases[2], judgeCtx)

    // ── metric-only 的正/负向对照（真实浏览器内）──
    const productOptions = await loadProductFontOptions()
    const yahei = productOptions.find((o) => o.value === "microsoft-yahei")
    if (!yahei) throw new Error("产品表里找不到 microsoft-yahei，metric-only 对照无法构造")
    const realMetric = { key: METRIC_ONLY_EXPECTATION.key, name: "真度量档", css: yahei.cssFamily, expect: "metric-only" }
    const fakeMetric = { key: METRIC_ONLY_EXPECTATION.key, name: "假度量档", css: null, expect: "metric-only" }
    const roundReal = await runRound([{ key: DEFAULT_KEY, name: "默认", css: null, expect: "same" }, realMetric])
    const roundFake = await runRound([{ key: DEFAULT_KEY, name: "默认", css: null, expect: "same" }, fakeMetric])
    const jMetricReal = judgeCase(realMetric, roundReal.ctx)
    const jMetricFake = judgeCase(fakeMetric, roundFake.ctx)

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
      name: "F2 浏览器内：真换字体整页栅格与默认不同（诊断通道真的能区分换字体）",
      ok: jReal.shot === true,
      detail: `默认栅格=${shots[DEFAULT_KEY]} 真换栅格=${shots["真换字体"]}`,
    })
    out.push({
      name: "F2 浏览器内：假换字体整页栅格与默认相同（诊断通道不会误报）",
      ok: shots["假换字体"] === shots[DEFAULT_KEY],
      detail: `默认栅格=${shots[DEFAULT_KEY]} 假换栅格=${shots["假换字体"]}`,
    })
    out.push({
      name: "F2 浏览器内：真换字体的真实渲染族确实变了",
      ok: jReal.font === true,
      detail: `真换真实字体=${JSON.stringify(cdpFonts["真换字体"])}`,
    })
    out.push({
      name: "M1 浏览器内：真度量档（产品真实栈）的四条正向断言全部成立",
      ok: jMetricReal.ok === true,
      detail: `真实字体=${JSON.stringify(roundReal.cdpFonts[METRIC_ONLY_EXPECTATION.key])} ` +
        `字形指纹${jMetricReal.pix ? "变了" : "与默认相同"} 行盒差=${JSON.stringify(roundReal.ctx.lineBoxDeltas[METRIC_ONLY_EXPECTATION.key])} ` +
        (jMetricReal.ok ? "" : `问题：${jMetricReal.note}`),
    })
    out.push({
      name: "M1 浏览器内：假度量档（同键但栈没换 face）必须被判失败",
      ok: jMetricFake.ok === false
        && jMetricFake.note.includes("真实渲染族")
        && jMetricFake.note.includes("行盒高度差"),
      detail: `判定ok=${jMetricFake.ok}；问题：${jMetricFake.note || "（未报错 —— metric-only 断言是装饰）"}`,
    })
    out.push({
      name: "M1 浏览器内：真度量档的行盒高度差实测恰好为 1px（不是写死的）",
      ok: LINE_BOX_SIZES.every((s) => roundReal.ctx.lineBoxDeltas[METRIC_ONLY_EXPECTATION.key]?.[s] === 1),
      detail: LINE_BOX_SIZES.map((s) =>
        `${s}px:${roundReal.lineBoxes[DEFAULT_KEY]?.[s]}→${roundReal.lineBoxes[METRIC_ONLY_EXPECTATION.key]?.[s]}`).join("  "),
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

  /**
   * 用给定字体在 canvas 上画样本文本，返回「像素哈希 + 宽度 + 墨迹量 + 质心」。
   *
   * ⚠ `hash` 的算法**一个字节都不许动**：冻结基线的 perCase/defaultHash 就是这个
   * 口径，改动等于逼人重录基线。新增的 ink/cx/cy 是**另起一遍**按像素统计的
   * 独立标量投影（不进哈希），用于 metric-only 档的"未换字形"逐元素证据。
   */
  function fingerprint(fontShorthand) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = fontShorthand
    ctx.textBaseline = "top"
    ctx.fillStyle = "#000"
    ctx.fillText(sample, 4, 4)
    const width = ctx.measureText(sample).width
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    // FNV-1a 32 位（与冻结基线同口径：逐字节，含 RGBA 四个通道）
    let h = 0x811c9dc5
    for (let i = 0; i < data.length; i++) {
      h ^= data[i]
      h = Math.imul(h, 0x01000193) >>> 0
    }
    // 墨迹像素数 + 水平/垂直质心（alpha > 0 即视为墨迹；canvas 是透明底黑字）
    let ink = 0
    let sx = 0
    let sy = 0
    for (let p = 0; p < data.length; p += 4) {
      if (data[p + 3] === 0) continue
      const idx = p >> 2
      ink++
      sx += idx % canvas.width
      sy += Math.floor(idx / canvas.width)
    }
    return {
      hash: h.toString(16),
      width: Math.round(width * 1000) / 1000,
      ink,
      cx: ink ? sx / ink : 0,
      cy: ink ? sy / ink : 0,
    }
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
      pixelHash: fp.hash, width: fp.width, ink: fp.ink, cx: fp.cx, cy: fp.cy,
    })
  }
  return out
}

/**
 * `line-height: normal` 下行盒高度的实测（metric-only 档的 ④ 号证据）。
 *
 * ⚠ 必须用**有内容的**块：完全空的 div 不生成行盒，高度恒为 0
 * （本次实测踩到过：空 div 两侧都是 0，差值 0，看起来像"没有度量差"）。
 * 这里放一个中文字符，测量到的是真实行盒高度。
 * 实测值（font-size → 默认档/微软雅黑档）：12→15/16、13→16/17、14→18/19、
 * 16→20/21、24→30/31、32→41/42，每个都恰好 +1px；48px 实测 61/64（+3），
 * 不纳入断言。根因是 fontBoundingBox 的 ascent 在 12–32px 档差 1px。
 */
const MEASURE_LINE_BOX = ({ list, sizes }) => {
  const host = document.createElement("div")
  host.style.cssText = "position:absolute;left:-9999px;top:0;"
  document.body.appendChild(host)
  const out = {}
  for (const item of list) {
    const boxes = {}
    for (const size of sizes) {
      const d = document.createElement("div")
      d.style.cssText =
        `font-family:${item.stack};font-size:${size}px;line-height:normal;` +
        `margin:0;padding:0;border:0;display:block;`
      d.textContent = "青"
      host.appendChild(d)
      boxes[size] = d.getBoundingClientRect().height
      host.removeChild(d)
    }
    out[item.key] = boxes
  }
  host.remove()
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

/**
 * 依次应用每个用例的字体栈并测量（canvas 字形指纹 + 真实渲染族 + 整页栅格指纹
 * + `line-height: normal` 行盒高度）。
 *
 * 行盒高度只在末尾**另起一轮**测（不插在逐档循环里）：它构造的是页面上临时
 * 挂载的探测块，与用例的实际渲染无关，单独一轮更不容易互相污染。
 */
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
    // 诊断通道：真实页面栅格化。同一档连拍两张实测逐字节相同（噪声为 0），
    // 但它会被"整页下移 1px"点亮，故**只作诊断**，不单独作为"生效"的判据。
    const buf = await page.screenshot({ fullPage: true })
    shots[c.key] = createHash("sha256").update(buf).digest("hex").slice(0, 16)
  }
  await page.evaluate(APPLY_VAR, null)
  await page.waitForTimeout(150)

  const lineBoxes = await page.evaluate(MEASURE_LINE_BOX, {
    list: cases.map((c) => ({
      key: c.key,
      stack: c.css === "DYNAMIC_MISSING" ? missingCase(appDefaultStack) : (c.css ?? appDefaultStack),
    })),
    sizes: LINE_BOX_SIZES,
  })
  return { byCase, cdpFonts, shots, lineBoxes }
}

/** 每个用例相对默认档的行盒高度差（同进程实测取差值，不写死读数）。 */
function lineBoxDeltas(lineBoxes, defaultKey, sizes) {
  const out = {}
  const def = lineBoxes?.[defaultKey] ?? {}
  for (const [key, boxes] of Object.entries(lineBoxes ?? {})) {
    if (key === defaultKey) continue
    const d = {}
    for (const size of sizes) {
      const a = def[size]
      const b = boxes?.[size]
      d[size] = (typeof a === "number" && typeof b === "number") ? b - a : null
    }
    out[key] = d
  }
  return out
}

const hashOfCase = (rec) => aggregate(rec.map((e) => ({ key: e.key, v: `${e.pixelHash}|${e.width}` })))

/**
 * 逐用例判定，并把各通道证据分开返回。
 *
 * 通道：
 *   pix   canvas 字形指纹（含宽度）—— **唯一判据**
 *   font  Chromium CSS.getPlatformFontsForNode 报告的真实渲染字体族 —— 诊断/佐证
 *   shot  整页栅格化指纹 —— 诊断/佐证（会被"整页下移 1px"点亮）
 *
 * 判定规则（M1 核心）：
 *   · `expect: differ`      → **只看 pix**。font/shot 单独变化不足以免除失败：
 *                             "换了字体名（CDP 变了）+ 整页挪了不到 1px"不等于
 *                             "用户看到了另一个字形"（微软雅黑档就是这么被放行的）。
 *   · `expect: metric-only` → 走 metricOnlyIssues 的完整正向断言（字形相同 +
 *                             真实族确实变了 + 行盒恰好差 1px），偏离任一条即红。
 *   · `expect: same`        → font/shot/pix **三者全同**（保留 301d2e2 的净收紧）。
 */
function judgeCase(c, ctx) {
  const pix = ctx.perCase[c.key] !== ctx.defaultHash
  const font = JSON.stringify(ctx.cdpFonts[c.key] ?? null) !== ctx.defaultFontsKey
  const shot = ctx.shots[c.key] !== ctx.defaultShot
  const channels = [pix && "像素指纹", font && "真实字体", shot && "整页栅格"].filter(Boolean)
  const changed = channels.length > 0

  let ok
  let note = ""
  if (c.expect === "differ") {
    ok = pix
  } else if (c.expect === "same") {
    ok = !changed
  } else if (c.expect === "metric-only") {
    const issues = metricOnlyIssues(c, ctx)
    ok = issues.length === 0
    note = issues.join("；")
  } else {
    ok = false
    note = `未知的期望值「${c.expect}」（只允许 differ / metric-only / same）`
  }
  return { pix, font, shot, channels, changed, ok, note }
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

  /*
   * 栈首可用性的实测事实（M7）。读失败不抛到顶层 —— 那只会打印一行"运行失败"，
   * 不够明确；这里记成守卫，让输出里留下可检索的 GUARD-FAIL。
   */
  let usableCjk = null
  let availabilityError = null
  try {
    usableCjk = loadUsableCjkNames()
  } catch (err) {
    availabilityError = String(err?.message ?? err)
  }

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
    const { byCase, cdpFonts, shots, lineBoxes } = await measureCases(page, cdp, CASES, appDefaultStack)

    const defaultRec = byCase[DEFAULT_KEY]
    const defaultHash = hashOfCase(defaultRec)
    const perCase = Object.fromEntries(CASES.map((c) => [c.key, hashOfCase(byCase[c.key])]))
    const glyphRecords = Object.fromEntries(CASES.map((c) => [c.key, glyphProjection(byCase[c.key])]))
    const boxDeltas = lineBoxDeltas(lineBoxes, DEFAULT_KEY, LINE_BOX_SIZES)
    const judgeCtx = {
      perCase,
      defaultHash,
      cdpFonts,
      defaultFontsKey: JSON.stringify(cdpFonts[DEFAULT_KEY] ?? null),
      shots,
      defaultShot: shots[DEFAULT_KEY],
      glyphRecords,
      defaultKey: DEFAULT_KEY,
      lineBoxDeltas: boxDeltas,
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

    // ── ④ 派生一致性守卫（不是防漂移的牙，见注释）───────────────────
    const covIssues = coverageIssues(productOptions, OPTION_CASES)
    for (const s of covIssues) fail("O/选项用例覆盖不全", s)

    // ── ④-a 冻结期望清单守卫（M5：真正的防漂移的牙）────────────────
    const frozenIssues = frozenListIssues(productOptions, OPTION_CASES)
    for (const s of frozenIssues) fail("R/选项清单与冻结期望不一致", s)

    // ── ④-b 栈首可用性守卫（M7：与静态 spec 读同一份事实文件）──────
    let leadIssues = []
    if (availabilityError) {
      fail("S/可用性事实文件不可用", `${availabilityError} —— 栈首可用性守卫无从判定，本次结论不完整`)
    } else {
      leadIssues = stackLeadAvailabilityIssues(OPTION_CASES, usableCjk.names)
      for (const s of leadIssues) fail("T/栈首字体本机实测不可用", s)
    }

    // ── ⑤ 逐项真实渲染族（佐证通道；metric-only 档的族名期望在判据里）──
    const familyIssues = renderedFamilyIssues(CASES, DEFAULT_KEY, cdpFonts)
    if (!defaultFontEvidenceUsable(cdpFonts, DEFAULT_KEY)) {
      fail("Q/真实字体证据缺失", `默认档取不到任何非空真实渲染字体，逐项真实渲染族守卫无从判定：${JSON.stringify(cdpFonts[DEFAULT_KEY] ?? {})}`)
    } else {
      for (const s of familyIssues) fail("P/真实渲染字体未改变", s)
    }

    // ── ⑤-b metric-only 档必须**恰好一例**，且就是我们实测过的那一档 ──
    const metricCases = CASES.filter((c) => c.expect === "metric-only")
    if (metricCases.length !== 1 || metricCases[0].key !== METRIC_ONLY_EXPECTATION.key) {
      fail("U/metric-only 档不唯一",
        `expect=metric-only 的档应当恰好是 ${METRIC_ONLY_EXPECTATION.key} 一例，实际为 ` +
        `${metricCases.map((c) => c.key).join("、") || "（无）"} —— ` +
        `这个期望值是"字形相同、仅度量差"的**显式记录**，不许随手贴到别的档上`)
    }

    /* ── 输出 ─────────────────────────────────────────────────────── */
    console.log("  ══ 界面字体生效性（真实产物 dist/ · 1440x900）══")
    console.log(`  测到的界面文字元素: ${baseline.length}`)
    console.log(`  产品默认字体栈: ${appDefaultStack.slice(0, 90)}${appDefaultStack.length > 90 ? "…" : ""}`)
    console.log(`  用例: 冻结 ${FROZEN_CASES.length} 项 + 产品选项 ${OPTION_CASES.length} 项（选项用例由 src/lib/font-settings.ts 直接派生）`)
    console.log("")
    console.log("  判据 = canvas 字形指纹（唯一）；真实字体（Chromium CDP）与整页栅格为**诊断/佐证**")
    console.log("")
    console.log("  用例                       期望         判定        变化元素  诊断通道（不计入 differ 判定）      计算字体（首个元素）")
    console.log("  " + "─".repeat(130))

    let judgeFail = 0
    const judged = []
    for (const c of CASES) {
      const rec = byCase[c.key]
      const changed = countChanged(defaultRec, rec)
      const j = judgeCase(c, judgeCtx)
      judged.push({ c, j })
      if (!j.ok) judgeFail++
      const fam = (rec[0]?.family ?? "").split(",")[0].replace(/["']/g, "")
      const label = `${c.origin === "option" ? "◆" : " "}${c.key}`
      const verdict = j.ok
        ? (c.expect === "differ" ? "✓字形不同" : c.expect === "metric-only" ? "✓仅度量差" : "✓全同")
        : (c.expect === "same" ? "✗有变化" : "✗不符期望")
      const channels = j.channels.length ? j.channels.join("+") : "（三通道全同）"
      console.log(
        `  ${label.padEnd(26)} ${c.expect.padEnd(12)} ${verdict.padEnd(11)} ${String(changed).padStart(4)}      ` +
        `${channels.padEnd(32)} ${fam}${j.ok ? "" : "   ← 不符期望"}`,
      )
      if (!j.ok && j.note) console.log(`      ↳ ${j.note}`)
    }
    console.log("  （◆ = 由产品选项表派生的用例；无标记的是与冻结基线逐字可比的冻结用例）")
    console.log("  （判定：expect=differ **只看 canvas 字形指纹**；metric-only 走完整正向断言；same 必须三通道全同）")

    /* ── 如实分组：真换字形 / 仅度量差 / 期望相同且成立 / 没生效 ────── */
    const glyphDifferCases = judged.filter((x) => x.c.expect === "differ" && x.j.ok)
    const metricOnlyCases = judged.filter((x) => x.c.expect === "metric-only" && x.j.ok)
    const sameCases = judged.filter((x) => x.c.expect === "same" && x.j.ok)
    const failedCases = judged.filter((x) => !x.j.ok)
    const nameOf = (k) => {
      const c = CASES.find((x) => x.key === k)
      return !c ? k : (c.origin === "option" ? `${c.name}[${c.key}]` : c.name)
    }
    console.log("")
    console.log("  ── 如实分组（metric-only 与 differ **分开计数**，不混进「生效」）──")
    console.log(`  A 真的换了字形（expect=differ 且通过）：${glyphDifferCases.length} 档`)
    console.log(`      ${glyphDifferCases.map((x) => nameOf(x.c.key)).join("、") || "（无）"}`)
    console.log(`  B 仅度量差、字形相同（expect=metric-only 且通过）：${metricOnlyCases.length} 档　← 用户看不见字形变化`)
    console.log(`      ${metricOnlyCases.map((x) => nameOf(x.c.key)).join("、") || "（无）"}`)
    console.log(`  C 期望"相同"且确实相同（expect=same 且通过）：${sameCases.length} 档`)
    console.log(`      ${sameCases.map((x) => nameOf(x.c.key)).join("、") || "（无）"}`)
    console.log(`  D 没生效 / 不符期望：${failedCases.length} 档`)
    console.log(`      ${failedCases.map((x) => `${nameOf(x.c.key)}（期望 ${x.c.expect}）`).join("、") || "（无）"}`)

    /* ── metric-only 档的逐条正向证据（M1 的核心交付）──────────────── */
    if (metricOnlyCases.length) {
      const c = metricOnlyCases[0].c
      const exp = METRIC_ONLY_EXPECTATION
      const familiesOf = (k) => Object.values(cdpFonts[k] ?? {}).filter((v) => typeof v === "string" && v.length > 0)
      const g = glyphUnchangedIssues(c.key, glyphRecords, DEFAULT_KEY)
      const deltas = boxDeltas[c.key] ?? {}
      const boxPairs = LINE_BOX_SIZES
        .map((s) => `${s}px:${lineBoxes[DEFAULT_KEY]?.[s]}→${lineBoxes[c.key]?.[s]}`)
        .join("  ")
      console.log("")
      console.log(`  ── 仅度量差档的逐条正向证据（${c.key}）──`)
      console.log(`  ① 真实渲染族     默认 ${familiesOf(DEFAULT_KEY).join("/")} → 该档 ${familiesOf(c.key).join("/")}` +
        `　${familiesOf(c.key).includes(exp.renderedFamily) ? "✓" : "✗"}（同一个 msyh.ttc 的两个 face）`)
      console.log(`  ② canvas 字形指纹 ${perCase[c.key] === defaultHash ? "与默认档完全相同 ✓（未换字形）" : "与默认档不同 ✗"}`)
      console.log(`  ③ 墨迹像素数变化 ${g.inkChanged}/${g.total}　水平质心最大偏移 ${g.maxDx < 0 ? "（无数据）" : g.maxDx.toFixed(4) + "px"}` +
        `　${g.inkChanged === 0 && g.maxDx === 0 ? "✓（未换字形）" : "✗"}`)
      console.log(`     （canvas 上的垂直质心偏移 ${g.maxDy < 0 ? "（无数据）" : g.maxDy.toFixed(4) + "px"} —— canvas 按整数位置栅格化，` +
        `所以这里看不到位移；复审在本机 DOM 逐元素量到的是 0.17–0.61px 的亚像素垂直位移，`)
      console.log(`       它来自下面 ④ 的行盒高差，而不是字形变化。逐元素墨迹量与水平质心的"完全不变"才是"未换字形"的证据。）`)
      console.log(`  ④ 行盒高度差     ${boxPairs}　每档 +${exp.lineBoxDelta}px ${LINE_BOX_SIZES.every((s) => deltas[s] === exp.lineBoxDelta) ? "✓" : "✗"}`)
      console.log(`  → 结论：字形与默认档**完全相同**，用户点它看到的只是不到 1px 的垂直位移。`)
      console.log(`     这是**实现层事实**，不是感知层事实，故**不计入"生效"**，而是被显式记录并钉死：`)
      console.log(`     期望值一旦写成 metric-only，上表 ①②③④ 任一偏离即红。`)
    }

    console.log("")
    console.log("  ── Chromium 报告的真实渲染字体（诊断/佐证）──")
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
    console.log("  ── 整页栅格化指纹（诊断通道；同档连拍两张实测逐字节相同，噪声为 0）──")
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
    console.log(`  ⑦ 派生一致性（${productOptions.length} 个产品选项各有且仅有一个用例）  ${covIssues.length === 0 ? "✓" : "✗ " + covIssues.join("；")}`)
    console.log(`  ⑧ 逐项真实渲染族（佐证：期望换的都真的换了）  ${familyIssues.length === 0 ? "✓" : "✗"}`)
    console.log(`  ⑨ 整页栅格诊断（期望 same 的档栅格必须不变）  ${judged.filter((x) => x.c.expect === "same" && x.j.shot).length === 0 ? "✓" : "✗ 有 same 档的栅格变了"}`)
    console.log(`  ⑩ metric-only 正向断言（字形相同 + 族确实变了 + 行盒差恰好 1px）  ${metricOnlyCases.length === 1 ? "✓" : "✗ " + (metricOnlyCases.length ? "不只一档" : "该档未通过")}`)
    console.log(`  ⑪ 冻结期望清单（${EXPECTED_OPTION_VALUES.length} 项，产品表与用例表都必须逐项相等）  ${frozenIssues.length === 0 ? "✓" : "✗ " + frozenIssues.join("；")}`)
    console.log(`  ⑫ 栈首字体本机实测可用（非 system 选项；${availabilityError ? "事实文件不可用，见下" : `可用中文字体名 ${usableCjk.count} 个`}）  ${availabilityError ? "✗ " + availabilityError : (leadIssues.length === 0 ? "✓" : "✗ " + leadIssues.join("；"))}`)

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
      /*
       * ── M3 / M4：先验基线自洽，再打任何结论 ──
       * 复审实测的两条绕过路径都发生在"字段缺失"上：
       *   · 缺 defaultHash → 每个记录用例都"与 undefined 不同" → 会打印
       *     「修复前能生效的字体: 黑体、楷体、仿宋」这条**不实陈述**；
       *   · 缺 perCase     → 直接抛 `Cannot read properties of undefined (reading '黑体')`，
       *     退出码 1 但没有 GUARD-FAIL。
       * 所以这里先检查，不完整就 GUARD-FAIL 并**整段跳过**对比输出。
       */
      const integrity = baselineIntegrityIssues(before)
      if (integrity.length) {
        for (const g of integrity) fail(g.code, g.detail)
        console.log("")
        console.log("  ── 与基线对比 ──")
        console.log(`  基线自身不完整（${integrity.map((g) => g.code).join("、")}）→ 跳过全部对比输出，`)
        console.log("  避免把一条由缺失字段算出来的、无法证实的结论打印出去：")
        for (const g of integrity) console.log(`    ↳ ${g.detail}`)
      } else {
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
         * 所以下面两条只要有一条不成立即判失败 —— 字形指纹（样本含双语）
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
          console.log("    → 字符串不同、但渲染结果相同（字形指纹与真实渲染字体均已核对），")
          console.log("      属把两套并存字体栈合并为一套的必然结果，默认观感未变。")
          console.log("      新增的 -apple-system / \"Segoe UI\" 只在前面几个家族全部缺失时")
          console.log("      才会被用到；本机由 Microsoft YaHei UI 提供全部字形，故不可达。")
          console.log("      目标平台为 Windows。")
        }

        /* ── "修复前能生效的字体"：只遍历基线真正记录过的用例名（F1）── */
        const cls = classifyBaselineComparison(before, CASES, perCase, defaultHash)
        const describeKey = (k) => {
          const c = CASES.find((x) => x.key === k)
          return !c ? k : (c.origin === "option" ? `${c.name}[${c.key}]` : c.name)
        }

        console.log("")
        console.log("  ── 修复前 / 现在 能生效的字体（F1：只认基线记录过的用例）──")
        if (!cls.hasUsableCaseList) {
          /*
           * M2：`cases` 缺失**或为空数组**都不可信。复审实测：把 cases 换成 []
           * 时 `Array.isArray([])` 为真、旧守卫不触发，全部 16 个用例被塞进"新增"，
           * 工具打印「修复前能生效的字体:（无 —— 这正是缺陷）」并 EXIT=0 ——
           * 零记录的空洞真值被当成了证明。
           */
          fail("K/基线未记录用例清单",
            `基线 ${compareAt} 里没有 cases 数组或清单为空，无法判断"哪些用例是录制时就有的"，` +
            `本次比较不可信（零记录的空清单不能当作"修复前一个都不生效"的证据）`)
          console.log("  基线未记录用例清单或清单为空 → 无法区分「新增用例」与「录制时就有」")
        } else {
          console.log(`  基线记录过的用例: ${(before.cases ?? []).join("、")}`)
        }
        if (cls.incomplete.length) {
          // M4：兑现"基线自身不完整，交由调用方单独报告"的承诺，不再静默 continue
          fail("L/基线 perCase 不完整",
            `基线记录过、但 perCase 里没有可用指纹的用例: ${cls.incomplete.join("、")} —— ` +
            `这些用例"修复前是否生效"无从判定，本次比较不可信`)
        }
        if (cls.lost.length) {
          fail("J/基线用例丢失",
            `基线里记录过、当前 CASES 里没有的用例: ${cls.lost.join("、")} —— 冻结证据被删了，必须先恢复用例或明确说明`)
        }
        if (cls.added.length) {
          // 要求 2：当前有、基线没有的用例必须显式打印，且绝不参与"修复前"判定
          console.log(`  本次新增用例（基线无对照，不参与"修复前"判定）: ${cls.added.map(describeKey).join("、")}`)
        }
        if (cls.hasUsableCaseList) {
          console.log(`  修复前能生效的字体: ${cls.beforeDiffer.length ? cls.beforeDiffer.map(describeKey).join("、") : "（无 —— 这正是缺陷）"}`)
        } else {
          // 清单为空/缺失时，"修复前能生效的字体"这条结论**没有出处**（零记录），
          // 打印"（无 —— 这正是缺陷）"会让人误以为"已经证明了改造前一个都不生效"。
          console.log("  修复前能生效的字体: （不可判定 —— 基线用例清单缺失或为空，见上方 GUARD-FAIL）")
        }
        console.log(`  现在能生效的字体（真的换了字形）: ${cls.nowGlyphDiffer.map(describeKey).join("、") || "（无）"}`)
        console.log(`  现在仅度量不同（字形相同、用户看不见字形变化，单列不混入上一行）: ` +
          `${cls.nowMetricOnly.map(describeKey).join("、") || "（无）"}`)
        /*
         * ── 对照实验（每次 --compare 都在真实基线上重跑一遍，不会过期）──
         * 下面这行**原样**复现修复前那行代码：
         *   CASES.filter((c) => c.expect === "differ" && before.perCase[c.name] !== before.defaultHash)
         * 它用**当前** CASES 去查 before.perCase。任何在基线录制之后新增的用例
         * 在基线里都没有键 → `undefined !== before.defaultHash` 为真 →
         * 被判成"修复前就已经生效"。上面那行正确地输出"（无）"，
         * 而这一行会输出一长串**与史实相反**的结论 —— 两行并排打印，
         * 就是本问题的可复现证据。
         * （这里用 `?.` 兜住 perCase 缺失：M4 的守卫已经在上面报过，这里不许再崩。）
         */
        const oldStyle = CASES
          .filter((c) => c.expect === "differ" && before.perCase?.[c.name] !== before.defaultHash)
          .map((c) => c.name)
        console.log(`  （对照：修复前那行代码对同一份基线会输出「修复前能生效的字体: ${oldStyle.join("、") || "（无）"}」）`)
        console.log(`    这 ${new Set(oldStyle).size} 项全部是本次新增的用例（基线里根本没有它们的键），`)
        console.log(`    与"改造前一个字体都不生效"的史实相反，而旧守卫 I 只在"基线与现在都无字体生效"时才失败，`)
        console.log(`    所以它会静默放过、退出码 0 —— 这正是必须修掉的那个谎言。`)
        if (cls.beforeDifferButNowSame.length) {
          console.log(`  ⚠ 基线说当时能生效、现在期望却是"相同"的用例: ${cls.beforeDifferButNowSame.map(describeKey).join("、")}（基线数据不自洽，请核对）`)
        }
        if (cls.beforeDiffer.length === 0 && cls.nowGlyphDiffer.length === 0) {
          fail("I/修复未生效", "基线与现在都无字体真正生效 —— 修复没有产生任何字形上的效果")
        }
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
    console.log(
      `  结论: 真换字形 ${glyphDifferCases.length} 档、仅度量差 ${metricOnlyCases.length} 档` +
      `（字形相同，用户看不见字形变化，已显式记录并钉死）、期望相同且成立 ${sameCases.length} 档、` +
      `不符期望 ${failedCases.length} 档；守卫 ${guards.length} 项未通过 → ${verdict ? "✓ 通过" : "✗ 未通过"}`,
    )
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
