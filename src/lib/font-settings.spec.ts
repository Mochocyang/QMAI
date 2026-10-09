// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  BODY_FONT_OPTIONS,
  BODY_FONT_PX_MAX,
  BODY_FONT_PX_MIN,
  BODY_FONT_PX_PRESETS,
  BODY_LETTER_SPACING_MAX,
  BODY_LETTER_SPACING_MIN,
  BODY_LINE_HEIGHT_MAX,
  BODY_LINE_HEIGHT_MIN,
  BODY_MARGIN_X_MAX,
  BODY_MARGIN_X_MIN,
  BODY_MARGIN_X_VIEWPORT_MAX,
  BODY_MARGIN_X_VIEWPORT_MIN,
  BODY_MARGIN_X_VIEWPORT_VW,
  BODY_SAFE_BOTTOM_MAX,
  BODY_SAFE_BOTTOM_MIN,
  DEFAULT_BODY_FONT_FAMILY,
  DEFAULT_BODY_FONT_PX,
  DEFAULT_BODY_LETTER_SPACING,
  DEFAULT_BODY_LINE_HEIGHT,
  DEFAULT_BODY_MARGIN_X,
  DEFAULT_BODY_SAFE_BOTTOM,
  DEFAULT_UI_FONT_FAMILY,
  LEGACY_BODY_FONT_PX_AT_SCALE_1,
  UI_FONT_OPTIONS,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  UI_FONT_SIZE_PRESETS,
  applyBodyFontFamily,
  applyBodyTypography,
  bodyFontPxFromScale,
  clampBodyFontPx,
  clampBodyLetterSpacing,
  clampBodyLineHeight,
  clampBodyMarginX,
  clampBodySafeBottom,
  clampUiFontSizeScale,
  defaultBodyMarginXForViewport,
  getBodyFontFamilyCss,
  getUiFontFamilyCss,
  normalizeBodyFontFamily,
  normalizeUiFontFamily,
  resolveMigratedBodyFontPx,
  applyUiFontFamily,
} from "./font-settings"

/* ────────── 本机字体可用性的实测事实与判断器（本文件多处共用，故置于顶部） ────────── */

/**
 * 本机字体可用性的**实测事实文件**（由 probe-installed-fonts.mjs --out 生成）。
 *
 * ── 为什么判断器必须读这份文件，而不是读一张手写白名单 ──
 * 本文件曾经用的是 `CJK_FONT_NAMES` —— 一张把"能覆盖中文的族名"与
 * "本机真的装了这个字体"混在一起的静态白名单。它的致命问题不是写错了名字，
 * 而是**它根本没有在测"能不能用"**：20 条里有 8 条在本机实测不可用
 * （PingFang SC / Heiti SC / Songti SC / Kaiti SC / STKaiti / STFangsong /
 * Source Han Sans SC），可白名单照样把它们判为 true。后果是把
 * `Source Han Sans SC` 提到 `noto-sans` 栈首（本机实测不可用 → 用户点它
 * 就是"选了没反应"）时，**全部测试依然全绿** —— 正是本次要修的病症
 * 换了个地方再犯一次。
 *
 * ── 事实文件必须自证"尺子有效"──
 * 下方「尺子对照」一组的断言（正对照 Arial 可用、负对照 __QMaiNoSuchFont__
 * 不可用、三基准各自都取到具体字体族）**不是走过场**：一份由"坏尺子"产出的
 * 事实文件会把**所有**字体名都判成不可用，此时"每个选项打头字体名都可用"
 * 这条断言虽然仍会红，可一旦有人图省事把它反转过来，就会变成永远为真。
 * 断言这两个对照取值，等于断言这份事实文件出自一次**对照法本身成立**的实跑，
 * 而不是一次读数不可信的运行。没有这一条，下面所有可用性断言都是无条件相信。
 */
const FONT_AVAILABILITY = JSON.parse(
  readFileSync(resolve(__dirname, "../../docs/font-scaling-fix-20261007/font-availability.json"), "utf8"),
) as {
  probedAt: string
  host: { platform: string }
  baselines: string[]
  ruler: {
    positiveControl: { name: string; usable: boolean }
    negativeControl: { name: string; usable: boolean }
    baselinesSane: boolean
    ok: boolean
  }
  entries: Array<{
    name: string
    role: string
    sampleKind: "cjk" | "latin"
    usable: boolean
    evidence: { baseline: string; withFont: string | null; baseFont: string | null; differs: boolean }
    perBaseline: Array<{ baseline: string; withFont: string | null; baseFont: string | null; differs: boolean }>
  }>
}

const AVAILABILITY_ENTRIES = FONT_AVAILABILITY.entries

/** 事实文件里声明过的基准名（serif / sans-serif / monospace）。 */
const AVAILABILITY_BASELINES = new Set(FONT_AVAILABILITY.baselines ?? [])

/**
 * 每条 entry 的"出处"是否成立：`usable` 必须能从它自己记录的证据推出来。
 *
 * ── 为什么需要这条：一格编辑就能伪造可用性 ──
 * 复审实测：把 `Source Han Sans SC` 的 `usable` 从 false 改成 true（`ruler.ok`、
 * 正/负对照、`baselinesSane` 全都不动），spec **34 passed / 34 全绿**。
 * 原因是"事实文件出自一次尺子有效的实跑"这条断言只锚定 Arial 正对照、
 * `__QMaiNoSuchFont__` 负对照与 `baselinesSane`，**不锚定任何单条 entry 的出处**。
 *
 * 现在逐条断言（任一不成立即红）：
 *   ① 证据字段必须齐备：`evidence.baseline` 非空、`withFont`/`baseFont` 非 null
 *      （"该条目的实验组实际渲染族"取不到，就说明这次读数不可用）；
 *   ② 基准名必须属于文件自己声明的 `baselines` 列表（不许凭一个没跑过的基准下结论）；
 *   ③ **双向往返**：`usable === true` ⟺ `perBaseline` 里至少有一条 `differs === true`，
 *      且 `evidence.differs` 与 `withFont !== baseFont` 一致 —— 这正是 probe 的判定规则，
 *      单改 `usable` 一格必然把它破坏（Source Han Sans SC 的 perBaseline 全是
 *      differs:false，改成 true 立刻自相矛盾）。
 *   ④ 条目数下界：文件被截断/删条目时也要红（一次只跑三五个名字的"实跑"不足以支撑
 *      下面"两个选项表里每个字体名都被实测过"的断言）。
 */
function availabilityProvenanceIssues(entries: typeof AVAILABILITY_ENTRIES): string[] {
  const issues: string[] = []
  for (const e of entries) {
    const where = `条目「${e.name}」`
    const ev = e.evidence
    if (!ev || typeof ev.baseline !== "string" || ev.baseline.length === 0) {
      issues.push(`${where} 的证据缺少基准名`)
      continue
    }
    if (!AVAILABILITY_BASELINES.has(ev.baseline)) {
      issues.push(`${where} 的证据基准「${ev.baseline}」不在文件声明的 baselines 里`)
    }
    if (typeof ev.withFont !== "string" || ev.withFont.length === 0) {
      issues.push(`${where} 的证据里没有实验组实际渲染族（withFont 为空）——该条目的可用性无出处`)
    }
    if (typeof ev.baseFont !== "string" || ev.baseFont.length === 0) {
      issues.push(`${where} 的证据里没有基准组实际渲染族（baseFont 为空）——该条目的可用性无出处`)
    }
    if (ev.differs !== (ev.withFont !== ev.baseFont)) {
      issues.push(`${where} 的 evidence.differs=${String(ev.differs)} 与 withFont/baseFont 不一致（证据自相矛盾）`)
    }
    const per = Array.isArray(e.perBaseline) ? e.perBaseline : []
    if (!per.length) {
      issues.push(`${where} 没有 perBaseline 明细，无法核对"每个基准下都测过"`)
    }
    const anyDiffers = per.some((p) => p?.differs === true)
    if (e.usable !== anyDiffers) {
      issues.push(
        `${where} 的 usable=${String(e.usable)} 与 perBaseline 实测不符` +
        `（perBaseline 里${anyDiffers ? "有" : "没有任何"} differs:true）—— ` +
        `"一格编辑就能伪造可用性"必须在这里被拦住`,
      )
    }
    // 可用的条目其首个可用基准的基准名也必须是自己声明过的基准之一
    if (e.usable === true && e.sampleKind === "cjk") {
      const usableBaselines = per.filter((p) => p?.differs === true).map((p) => p.baseline)
      if (!usableBaselines.some((b) => AVAILABILITY_BASELINES.has(b))) {
        issues.push(`${where} 被判可用，但没有任何 diff 出现在声明的基准上：${usableBaselines.join("、") || "（无）"}`)
      }
    }
  }
  return issues
}

/** 被实测过的所有名字（不论判定）。 */
const PROBED_NAMES = new Set(AVAILABILITY_ENTRIES.map((e) => e.name))

/**
 * **本机用中文样本实测可用**的名字集合。
 *
 * 两个条件缺一不可：
 *   · `usable` —— 对照法实测（加了这个名字之后渲染确实变了）；
 *   · `sampleKind === "cjk"` —— 样本是纯中文。
 * 第二个条件才是"能覆盖中文"的证据：probe 用纯中文样本，
 * 一个没有中文字形的字体（如 Arial、Segoe UI）会被判为不可用，
 * 所以 usable+cjk 恰好等价于"本机能提供中文字形"。
 * 只用 usable 不用 sampleKind 的话，Arial（拉丁样本实测可用）也会混进来。
 */
const USABLE_CJK_NAMES = new Set(
  AVAILABILITY_ENTRIES.filter((e) => e.usable && e.sampleKind === "cjk").map((e) => e.name),
)

/**
 * CSS 通用族与**系统字体关键字**（不是字体名，是 CSS Fonts 规范定义的关键字，
 * 由浏览器解析为平台默认字体，写进栈里是正确的用法）。
 * 从"字体名"里剔除它们，是为了让"每个字体名都被实测过"这条断言
 * 只针对真正的字体名 —— 这不是放宽，而是把断言对准它想守的东西。
 */
const NON_FONT_FAMILY_TOKENS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace",
  "-apple-system", "BlinkMacSystemFont",
  "inherit", "initial", "unset", "revert",
])

/** 从一条 cssFamily 里抽出所有"字体名"（去引号、去空白、剔除通用族与系统关键字）。 */
function fontNamesIn(cssFamily: string): string[] {
  // 变量引用（如 follow-ui 的 var(--qmai-ui-font-family)）里的字体名由别处决定，
  // 不在这里展开：展开会把界面字体表的名字重复算一遍。
  if (cssFamily.includes("var(")) return []
  return cssFamily
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean)
    .filter((n) => !NON_FONT_FAMILY_TOKENS.has(n))
}

/** 字体栈打头的那一项（去引号）。 */
function leadingFontName(cssFamily: string): string {
  return cssFamily.split(",")[0].trim().replace(/^["']|["']$/g, "")
}

/**
 * 判断器：字体栈打头的名字必须是**本机实测可用**的中文字体。
 *
 * 与旧版 `leadsWithCjkFont` 的区别：旧版只问"这个名字长不长得像中文字体"
 * （查一张手写白名单），本版问"这个名字在本机**真的能渲染出中文**吗"
 * （查实测事实文件）。后者才是用户点下去会不会"没反应"的判据。
 */
function leadsWithMeasuredCjkFont(cssFamily: string): boolean {
  return USABLE_CJK_NAMES.has(leadingFontName(cssFamily))
}

/** 通用族收尾判据：通用族必须是**最后一项**（允许前后空格，但不允许拼错/自造）。 */
const endsWithGenericFamily = (cssFamily: string): boolean =>
  /(^|,)\s*(serif|sans-serif|monospace)\s*$/.test(cssFamily)

describe("font settings", () => {
  it("defaults to the local system font and ignores invalid stored values", () => {
    expect(DEFAULT_UI_FONT_FAMILY).toBe("system")
    expect(normalizeUiFontFamily(null)).toBe("system")
    expect(normalizeUiFontFamily("missing-font")).toBe("system")
  })

  it("resolves local machine font options to CSS font-family stacks", () => {
    expect(getUiFontFamilyCss("system")).toContain("system-ui")
    expect(getUiFontFamilyCss("microsoft-yahei")).toContain("Microsoft YaHei")
  })

  it("applies the selected font to the app root CSS variable", () => {
    const values = new Map<string, string>()
    const root = {
      style: {
        setProperty: (key: string, value: string) => values.set(key, value),
      },
    } as unknown as HTMLElement

    applyUiFontFamily("microsoft-yahei", root)

    expect(values.get("--qmai-ui-font-family")).toContain("Microsoft YaHei")
  })
})

describe("界面字号范围", () => {
  it("范围是 80%–150%（用户确认）", () => {
    expect(UI_FONT_SIZE_MIN).toBe(0.8)
    expect(UI_FONT_SIZE_MAX).toBe(1.5)
  })

  it("钳制到范围内，且不动范围内的值", () => {
    expect(clampUiFontSizeScale(1.5)).toBe(1.5)
    expect(clampUiFontSizeScale(1)).toBe(1)
    expect(clampUiFontSizeScale(0.8)).toBe(0.8)
    // 超出边界
    expect(clampUiFontSizeScale(1.6)).toBe(1.5)
    expect(clampUiFontSizeScale(0.7)).toBe(0.8)
    // 旧上限 1.3 与旧下限 0.85 现在都必须原样保留 —— 这正是过去会被截断的取值
    expect(clampUiFontSizeScale(1.3)).toBe(1.3)
    expect(clampUiFontSizeScale(0.85)).toBe(0.85)
  })

  it("非法输入退回默认档而不是产生 NaN", () => {
    expect(clampUiFontSizeScale(Number.NaN)).toBe(1)
    expect(clampUiFontSizeScale("abc")).toBe(1)
    expect(clampUiFontSizeScale(null)).toBe(1)
    expect(clampUiFontSizeScale(undefined)).toBe(1)
    expect(clampUiFontSizeScale(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it("钳制是幂等的（存 150% 后读回仍是 150%，不会被二次截断）", () => {
    for (const v of [0.8, 0.85, 1, 1.25, 1.3, 1.5]) {
      const once = clampUiFontSizeScale(v)
      expect(clampUiFontSizeScale(once)).toBe(once)
      expect(once).toBe(v)
    }
  })

  it("保留两位小数，避免浮点尾巴", () => {
    expect(clampUiFontSizeScale(1.234)).toBe(1.23)
    expect(clampUiFontSizeScale(1.236)).toBe(1.24)
    expect(clampUiFontSizeScale(1.0001)).toBe(1)
    // 注意：1.005 不能用来测"四舍五入到 1.01" —— 它在二进制里略小于 1.005，
    // toFixed(2) 会得到 "1.00"。这是浮点表示的现实，不是本函数的缺陷，
    // 故此处只用无歧义的取值，避免写出一条会随引擎实现漂移的断言。
  })

  it("预设全部落在范围内且含 150% 特大档", () => {
    expect(UI_FONT_SIZE_PRESETS.map((p) => p.value)).toEqual([0.85, 1, 1.25, 1.5])
    for (const preset of UI_FONT_SIZE_PRESETS) {
      expect(preset.value).toBeGreaterThanOrEqual(UI_FONT_SIZE_MIN)
      expect(preset.value).toBeLessThanOrEqual(UI_FONT_SIZE_MAX)
      // 预设必须能被钳制原样通过，否则选中态永远匹配不上
      expect(clampUiFontSizeScale(preset.value)).toBe(preset.value)
    }
  })
})

describe("正文字体（与界面字体相互独立）", () => {
  it("默认值保持现状（宋体系），避免默认观感变化", () => {
    expect(DEFAULT_BODY_FONT_FAMILY).toBe("serif-default")
    const css = getBodyFontFamilyCss(DEFAULT_BODY_FONT_FAMILY)
    expect(css).toContain("Noto Serif SC")
    expect(css).toContain("Source Han Serif SC")
    expect(css).toContain("Songti SC")
    expect(css).toContain("SimSun")
  })

  it("默认栈与改造前 ui-test.css 里 --serif 的取值逐字一致", () => {
    // 逐字一致是"默认观感不变"的硬条件：回退栈只要差一个字，
    // 默认档的正文与那几个共用 --serif 的标题就会换字形。
    expect(getBodyFontFamilyCss(DEFAULT_BODY_FONT_FAMILY)).toBe(
      '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif',
    )
  })

  it("每个选项都以通用族收尾（字体缺失时仍有合理回退）", () => {
    for (const option of BODY_FONT_OPTIONS) {
      if (option.value === "follow-ui") continue // 变量引用，通用族由界面字体表负责
      expect(endsWithGenericFamily(option.cssFamily)).toBe(true)
    }
  })

  it("正文每个选项的栈里都含实测可用的中文字体，且首个可用名不晚于第二位", () => {
    // 这条拦的是"整条栈全是本机没有的名字"——那样正文选中后必然静默回退到
    // 浏览器兜底，用户看到的就是"选了没反应"。允许出现在第二位是因为
    // source-han-sans 刻意以 Adobe 原版名 "Source Han Sans SC" 打头
    // （本机实测不可用），紧随其后的 "Noto Sans SC" 已实测可用，
    // 且两者在字形上是同一套设计（Source Han Sans = Noto Sans CJK 的共同发行），
    // 所以那一条不存在"选了没反应"。真要收紧成"必须打头可用"，
    // 就得改动产品字体栈顺序（跨机器行为会变），不属于本次修复范围。
    for (const option of BODY_FONT_OPTIONS) {
      if (option.value === "follow-ui") continue
      const names = fontNamesIn(option.cssFamily)
      const firstUsable = names.findIndex((n) => USABLE_CJK_NAMES.has(n))
      expect(firstUsable, `${option.value} 整条栈里没有任何实测可用的中文字体`).toBeGreaterThanOrEqual(0)
      expect(firstUsable, `${option.value} 的首个可用字体名排在第 ${firstUsable + 1} 位，过晚`).toBeLessThanOrEqual(1)
    }
  })

  it("非法值回退到默认，而不是产生空字体", () => {
    expect(normalizeBodyFontFamily("nope")).toBe(DEFAULT_BODY_FONT_FAMILY)
    expect(normalizeBodyFontFamily(null)).toBe(DEFAULT_BODY_FONT_FAMILY)
    expect(normalizeBodyFontFamily(undefined)).toBe(DEFAULT_BODY_FONT_FAMILY)
    expect(getBodyFontFamilyCss("nope")).toBe(getBodyFontFamilyCss(DEFAULT_BODY_FONT_FAMILY))
  })

  it("可选「跟随界面字体」，且它指向界面字体变量而不是复制一份字体栈", () => {
    // 必须是变量引用：复制字体栈会在用户改界面字体后失效
    expect(getBodyFontFamilyCss("follow-ui")).toBe("var(--qmai-ui-font-family)")
  })

  it("正文字体与界面字体互不干扰（两组选项互不共享写入的变量）", () => {
    const values = new Map<string, string>()
    const root = {
      style: { setProperty: (k: string, v: string) => values.set(k, v) },
    } as unknown as HTMLElement
    applyBodyFontFamily("kaiti", root)
    applyUiFontFamily("simsun", root)
    expect(values.get("--qmai-body-font-family")).toContain("KaiTi")
    expect(values.get("--qmai-ui-font-family")).toContain("SimSun")
    // 关键：写正文字体不能顺带改掉界面字体变量
    expect(values.get("--qmai-ui-font-family")).not.toContain("KaiTi")
  })

  it("正文选项里不出现「本机默认」这类与界面字体重复的项（避免两处同义）", () => {
    // 正文必须显式区分"衬线正文默认"与"跟随界面字体"；
    // 若再放一个含糊的"系统默认"，用户无法预期它到底跟谁。
    const values = BODY_FONT_OPTIONS.map((o) => o.value)
    expect(values).toContain("follow-ui")
    expect(values).toContain(DEFAULT_BODY_FONT_FAMILY)
    expect(values).not.toContain("system")
    expect(new Set(values).size).toBe(values.length)
  })

  it("界面字体与正文字体的默认值各自独立（改一个不影响另一个）", () => {
    // 这两个默认值曾被混为一谈的隐患：--serif 一度就是界面字体的近亲。
    expect(DEFAULT_UI_FONT_FAMILY).toBe("system")
    expect(DEFAULT_BODY_FONT_FAMILY).toBe("serif-default")
    expect(getUiFontFamilyCss(DEFAULT_UI_FONT_FAMILY)).not.toBe(getBodyFontFamilyCss(DEFAULT_BODY_FONT_FAMILY))
  })
})

/*
 * 这里原来有一组 BODY_FONT_SIZE_MIN/MAX、DEFAULT_BODY_FONT_SIZE_SCALE、
 * clampBodyFontSizeScale、BODY_FONT_SIZE_PRESETS 的用例。
 *
 * 它们测的是**正文字号的百分比（倍数）模型** —— 那个模型在本分支已被
 * 「正文字号 = 绝对 px」取代，旧持久化函数也从 project-store 删掉了，
 * 但这组常量一直留在生产文件里，且注释还在讲
 * 「文档最终字号 = 界面字号 × 正文字号」这句**已经废掉**的语义
 * （最终整体代码审查第 5 条：死代码 + 说谎注释）。
 * 生产代码零引用、只被自己的用例养着，于是整组删除。
 *
 * 真正还有意义的是**一次性历史迁移**：`resolveMigratedBodyFontPx`
 * 负责把旧倍数换成 px，它的用例在下面「旧倍数迁移」一节里。
 */

/* ────────────────────────── 界面字体选项（只列中文字体） ────────────────────────── */


describe("界面字体选项（只列中文字体）", () => {
  it("不再提供纯拉丁字体选项", () => {
    expect(UI_FONT_OPTIONS.map((o) => o.value)).not.toContain("arial")
  })

  it("旧值 arial 平滑回退到默认，不抛错", () => {
    expect(normalizeUiFontFamily("arial")).toBe(DEFAULT_UI_FONT_FAMILY)
  })

  it("每个选项都以通用族收尾，保证未安装时静默回退可预期", () => {
    for (const option of UI_FONT_OPTIONS) {
      expect(endsWithGenericFamily(option.cssFamily)).toBe(true)
    }
  })

  it("界面字体选项与计划中的 11 项**全等**（增删都必须显式改本测试）", () => {
    // 这条曾经是"抽查 10 个 value 是否包含"——名义上叫"常用选项齐备"，
    // 实际漏掉了本次新增的 microsoft-jhenghei（表里 11 项、只查了 10 项），
    // 一个会误导读者的"齐备"。改为与完整期望数组全等：
    // 顺序、增、删三者任一变化都会红，逼实施者显式面对。
    expect(UI_FONT_OPTIONS.map((o) => o.value)).toEqual([
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
    ])
  })

  it("事实文件出自一次尺子有效的实跑（正/负对照取值正确）", () => {
    // 见文件头对 FONT_AVAILABILITY 的说明：没有这两条，下游所有可用性断言
    // 都只是"相信一份 JSON"，无法区分"真测出来的"与"坏尺子批量判死"。
    expect(FONT_AVAILABILITY.ruler.positiveControl.name).toBe("Arial")
    expect(FONT_AVAILABILITY.ruler.positiveControl.usable).toBe(true)
    expect(FONT_AVAILABILITY.ruler.negativeControl.name).toBe("__QMaiNoSuchFont__")
    expect(FONT_AVAILABILITY.ruler.negativeControl.usable).toBe(false)
    expect(FONT_AVAILABILITY.ruler.baselinesSane).toBe(true)
    expect(FONT_AVAILABILITY.ruler.ok).toBe(true)
    expect(FONT_AVAILABILITY.baselines).toEqual(["serif", "sans-serif", "monospace"])
    // 事实文件必须真的有一批可用项，否则"每个打头名字都可用"可能只是
    // 因为集合为空而空洞成立（空集会让任何名字都判否，不会判是，但仍值得钉住）
    expect(USABLE_CJK_NAMES.size).toBeGreaterThanOrEqual(10)
    // 抽取函数本身必须是有产出的，否则下面那条"差集为空"会空洞通过
    expect(fontNamesIn('SimSun, "Songti SC", serif')).toEqual(["SimSun", "Songti SC"])
    expect(fontNamesIn("var(--qmai-ui-font-family)")).toEqual([])
  })

  it("事实文件里每条 entry 都有逐条出处（堵住一格编辑就能伪造可用性的路径）", () => {
    /*
     * ── 这条守的是什么 ──
     * 上一条只锚定"这份文件出自一次尺子有效的实跑"（正/负对照 + baselinesSane），
     * **不锚定任何单条 entry 的出处**。复审实测：把 `Source Han Sans SC` 的
     * `usable` 从 false 改成 true（ruler.ok 与正/负对照全都不动），
     * spec 34 passed / 34 全绿 —— 一次方格编辑就把"本机没有这个字体"伪造成"有"，
     * 而下面的"栈首必须实测可用"断言完全依赖这个字段。
     * 所以这里逐条要求：usable 必须能从该条目**自己记录的证据**推出来
     *（基准名在声明列表里、withFont/baseFont 非空、usable ⟺ perBaseline 里有 differs）。
     */
    expect(AVAILABILITY_ENTRIES.length).toBeGreaterThanOrEqual(30)
    expect(availabilityProvenanceIssues(AVAILABILITY_ENTRIES)).toEqual([])

    // ── 负向对照：证明上面那条会失败（否则它只是装饰）──
    // 复现复审那一次"一格编辑"：只把 Source Han Sans SC 的 usable 翻成 true。
    const shsBefore = AVAILABILITY_ENTRIES.find((e) => e.name === "Source Han Sans SC")!
    expect(shsBefore.usable).toBe(false) // 现状确实是 false —— 变异的前提成立
    const mutated = AVAILABILITY_ENTRIES.map((e) =>
      e.name === "Source Han Sans SC" ? { ...e, usable: true } : e)
    const mutatedIssues = availabilityProvenanceIssues(mutated)
    expect(mutated.find((e) => e.name === "Source Han Sans SC")!.usable).toBe(true)
    expect(mutatedIssues.some((s) => s.includes("Source Han Sans SC"))).toBe(true)
    // 该条目正是"noto-sans 栈的次选"，也正是复审用来当变异靶子的那一个：
    // 它必须被判不可用，否则把栈首换成它会静默回退到 Noto Sans SC。
    expect(USABLE_CJK_NAMES.has("Source Han Sans SC")).toBe(false)

    // 另一种伪造：usable 不动，但把证据里的实验组渲染族抹掉
    const emptied = AVAILABILITY_ENTRIES.map((e) =>
      e.name === "Noto Sans SC" ? { ...e, evidence: { ...e.evidence, withFont: null } } : e)
    expect(availabilityProvenanceIssues(emptied).some((s) => s.includes("Noto Sans SC"))).toBe(true)

    // 第三种伪造：把基准名换成文件里没声明过的名字
    const bogusBaseline = AVAILABILITY_ENTRIES.map((e) =>
      e.name === "SimHei" ? { ...e, evidence: { ...e.evidence, baseline: "some-unlisted-baseline" } } : e)
    expect(availabilityProvenanceIssues(bogusBaseline).some((s) => s.includes("SimHei"))).toBe(true)
  })

  it("两个选项表里出现的每个字体名都被 probe 实测过（差集必须为空）", () => {
    const inStacks = new Set<string>()
    for (const option of UI_FONT_OPTIONS) for (const n of fontNamesIn(option.cssFamily)) inStacks.add(n)
    for (const option of BODY_FONT_OPTIONS) for (const n of fontNamesIn(option.cssFamily)) inStacks.add(n)

    // 先证明抽取确实抽到了东西（否则空集让下面的差集恒为空）
    expect(inStacks.size).toBeGreaterThanOrEqual(15)
    expect(inStacks).toContain("SimSun")
    expect(inStacks).toContain("Fangsong SC")

    const neverProbed = [...inStacks].filter((n) => !PROBED_NAMES.has(n)).sort()
    expect(neverProbed).toEqual([])

    // ── 负向对照：证明本断言会失败 ──
    // 把本次补测的两个名字从 probe 表里拿掉，还原改造前的状态，
    // 差集必须**非空**。若这里也得到空数组，说明上面的断言是永远为真的装饰。
    const probeBeforeFix = new Set([...PROBED_NAMES].filter((n) => n !== "Fangsong SC" && n !== "Segoe UI"))
    const diffBeforeFix = [...inStacks].filter((n) => !probeBeforeFix.has(n)).sort()
    expect(diffBeforeFix).toEqual(["Fangsong SC", "Segoe UI"])
  })

  it("每个选项都以中文字体打头，不能拿纯拉丁字体顶在前面", () => {
    // 先验证判断器本身有区分力：给一条纯拉丁字体打头的栈，它必须判否。
    // 否则下面那条 for 循环就是"永远为真"的装饰（本任务吃过一次亏：
    // document.fonts.check 对编造的字体名也返回 true，正是负向对照抓出来的）。
    expect(leadsWithMeasuredCjkFont('Arial, "Microsoft YaHei", system-ui, sans-serif')).toBe(false)
    expect(leadsWithMeasuredCjkFont('Helvetica, "Segoe UI", sans-serif')).toBe(false)
    expect(leadsWithMeasuredCjkFont('system-ui, "Microsoft YaHei", sans-serif')).toBe(false)
    // 编造的名字同样必须判否（老白名单也拦得住它，但不能因此省掉）
    expect(leadsWithMeasuredCjkFont('"Not A Real Font SC", "Microsoft YaHei", sans-serif')).toBe(false)
    // 正对照：本机实测可用的中文字体打头必须判是
    expect(leadsWithMeasuredCjkFont('"Microsoft YaHei", system-ui, sans-serif')).toBe(true)

    for (const option of UI_FONT_OPTIONS) {
      if (option.value === "system") continue // 见下一条：system 是显式豁免
      expect(leadsWithMeasuredCjkFont(option.cssFamily)).toBe(true)
    }
  })

  it("system 项豁免打头可用性，但仍须含实测可用名且以通用族收尾", () => {
    const system = UI_FONT_OPTIONS.find((o) => o.value === "system")!
    /*
     * ── 为什么 system 必须豁免"打头名字本机可用" ──
     * 这一项表达的是「跟随本机默认」，不是「用户选中了苹方」。
     * 它的栈首刻意放 macOS 的 "PingFang SC"，在 Windows 上必然不可用，
     * 靠紧接其后的 "Microsoft YaHei UI" 命中 —— 那是**设计**，
     * 不是"选了没反应"：用户点的是"本机默认"，本机也确实用了本机的字体。
     * 若把它也纳入"打头必须可用"，唯一能让测试变绿的改法就是改掉这个栈，
     * 而那会改变默认档字形（已被 verify-ui-font-applies.mjs --compare +
     * ui-font-before.json 在真实浏览器里钉死），属于销毁回归防线。
     */
    expect(leadingFontName(system.cssFamily)).toBe("PingFang SC")
    // 本机确实没有苹方 —— 这条钉住"豁免是有前提的"，不是随手放行
    expect(USABLE_CJK_NAMES.has("PingFang SC")).toBe(false)
    expect(USABLE_CJK_NAMES.has("Microsoft YaHei UI")).toBe(true)

    const usableInStack = fontNamesIn(system.cssFamily).filter((n) => USABLE_CJK_NAMES.has(n))
    expect(usableInStack.length).toBeGreaterThan(0)
    expect(endsWithGenericFamily(system.cssFamily)).toBe(true)
  })

  it("通用族收尾判据的边界（拼错/自造必须判否，尾随空格必须判是）", () => {
    // 旧判据 /(serif|sans-serif|monospace)$/ 的三个漏网点，一一钉住：
    expect(endsWithGenericFamily('"SimHei", san-serif')).toBe(false)   // 拼错
    expect(endsWithGenericFamily('"SimHei", my-serif')).toBe(false)    // 自造
    expect(endsWithGenericFamily('"SimHei", sans-serif ')).toBe(true)  // 尾随空格
    expect(endsWithGenericFamily('"SimHei", sans-serif')).toBe(true)
    expect(endsWithGenericFamily("san-serif")).toBe(false)
    expect(endsWithGenericFamily("serif")).toBe(true)
    expect(endsWithGenericFamily('"SimHei", "Microsoft YaHei", sans-serif')).toBe(true)
    // 负向对照：旧判据对前两条判"通过"，本判据判"不通过" —— 证明判据真的收紧了
    const oldRule = (s: string) => /(serif|sans-serif|monospace)$/.test(s)
    expect(oldRule('"SimHei", san-serif')).toBe(true)
    expect(oldRule('"SimHei", my-serif')).toBe(true)
    expect(oldRule('"SimHei", sans-serif ')).toBe(false)
  })

  it("system 项的字体栈逐字保持改造前的取值（默认档不能变字形）", () => {
    // 这个栈与改造前 ui-test.css 里 --ui 的取值逐字一致，也是 index.css :root
    // 的默认值。顺序只要变一个字，"用户没做任何选择、默认字形却变了"的
    // 视觉回归就会发生。已由 verify-ui-font-applies.mjs --compare +
    // ui-font-before.json 在真实浏览器里双重守住，这里再加一道静态防线。
    expect(UI_FONT_OPTIONS[0].value).toBe("system")
    expect(UI_FONT_OPTIONS[0].cssFamily).toBe(
      '"PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    )
  })
})

/* ────────────────────────── 正文排版参数（px 模型） ────────────────────────── */

describe("正文排版参数", () => {
  it("正文字号范围 12–32px，默认 18px", () => {
    expect(BODY_FONT_PX_MIN).toBe(12)
    expect(BODY_FONT_PX_MAX).toBe(32)
    expect(DEFAULT_BODY_FONT_PX).toBe(18)
  })

  it("正文字号取整并夹到范围内", () => {
    expect(clampBodyFontPx(15)).toBe(15)
    expect(clampBodyFontPx(15.4)).toBe(15)
    expect(clampBodyFontPx(15.6)).toBe(16)
    expect(clampBodyFontPx(1)).toBe(BODY_FONT_PX_MIN)
    expect(clampBodyFontPx(999)).toBe(BODY_FONT_PX_MAX)
    // 关键的不对称：数字 0 是用户真的想要最小字号（→12），
    // 而 bodyFontPxFromScale(0) 是「根本没存过正文倍数」（→18，见那一组用例）。
    // 日后若有人「统一」这两处判断，存储语义会被静默改掉。
    expect(clampBodyFontPx(0)).toBe(BODY_FONT_PX_MIN)
  })

  it("正文字号对无效输入退回默认，而不是被隐式转成 0 再夹到下限", () => {
    // Number(null) === 0，若不特殊处理会得到 12px ——
    // 「没存过值」与「用户要最小字号」是两件事
    expect(clampBodyFontPx(null)).toBe(DEFAULT_BODY_FONT_PX)
    expect(clampBodyFontPx(undefined)).toBe(DEFAULT_BODY_FONT_PX)
    expect(clampBodyFontPx("")).toBe(DEFAULT_BODY_FONT_PX)
    expect(clampBodyFontPx("abc")).toBe(DEFAULT_BODY_FONT_PX)
    expect(clampBodyFontPx(Number.NaN)).toBe(DEFAULT_BODY_FONT_PX)
    // Number("  ") === 0、Number([]) === 0：只特判 "" 是不够的 ——
    // 同一个文件里 clampBodyFontPx("  ") 与 bodyFontPxFromScale("  ")
    // 必须给出同一个答案（默认档），否则存储里的空白串会被读成「最小字号」
    expect(clampBodyFontPx("  ")).toBe(DEFAULT_BODY_FONT_PX)
    expect(clampBodyFontPx([])).toBe(DEFAULT_BODY_FONT_PX)
    // Number(true) === 1 / Number(false) === 0：布尔值同样不是「用户选了值」
    expect(clampBodyFontPx(true)).toBe(DEFAULT_BODY_FONT_PX)
    expect(clampBodyFontPx(false)).toBe(DEFAULT_BODY_FONT_PX)
    // 与迁移函数口径一致（同一输入 → 同一答案）
    expect(bodyFontPxFromScale("  ")).toBe(DEFAULT_BODY_FONT_PX)
    expect(bodyFontPxFromScale([])).toBe(DEFAULT_BODY_FONT_PX)
  })

  it("数字字符串必须照常可用：localStorage 里存的就是 String(number)", () => {
    // 为什么单独立一条：getItem() 返回的永远是字符串。
    // 若某个钳制函数改成只接受 typeof value === "number"，
    // 用户存过的值会被当成"没存过"而悄悄退回默认 ——
    // 界面一切正常，只是设置"不生效"，属于最难发现的那类缺陷。
    // 注意 toFiniteNumber 会先 trim：读取路径上出现带空白的字符串
    // 是有可能的（手改过 app-state.json / 老版本写入格式不同）。
    expect(clampBodyFontPx("18")).toBe(18)
    expect(clampBodyFontPx(" 21 ")).toBe(21)
    expect(clampBodyLineHeight("1.95")).toBe(1.95)
    expect(clampBodyLetterSpacing("2")).toBe(2)
    expect(clampBodyMarginX("40")).toBe(40)
    expect(clampBodySafeBottom("60")).toBe(60)
    // 越界的字符串同样要钳制，而不是原样漏出去
    expect(clampBodyFontPx("999")).toBe(BODY_FONT_PX_MAX)
    expect(clampBodyLineHeight("9")).toBe(BODY_LINE_HEIGHT_MAX)
    // 负数也得能读出来（字间距允许负值）
    expect(clampBodyLetterSpacing("-0.5")).toBe(-0.5)
  })

  it("旧倍数迁移成 px：0.85→15 / 1→18 / 1.25→23 / 1.5→27", () => {
    // 第二参数缺省 = 界面字号 100%，老调用与老语义不变
    expect(bodyFontPxFromScale(0.85)).toBe(15)
    expect(bodyFontPxFromScale(1)).toBe(18)
    expect(bodyFontPxFromScale(1.25)).toBe(23)
    expect(bodyFontPxFromScale(1.5)).toBe(27)
    expect(bodyFontPxFromScale(1, 1)).toBe(18)
    expect(bodyFontPxFromScale(1.5, 1)).toBe(27)
  })

  it("界面字号非 100% 时，迁移必须把它乘进去——否则老用户一升级正文就变小", () => {
    // 改造前正文渲染高度 = 18px × 界面倍数 × 正文倍数：
    //   --qmai-body-font-size: calc(1.125rem * var(--qmai-body-font-scale, 1))
    //   而 rem 的基准是根字号，App 把它设成 uiFontSizeScale×100%。
    // 例：界面 150% + 正文 100% 改造前渲染 27px；只乘正文倍数会得到 18px。
    expect(bodyFontPxFromScale(1, 1.5)).toBe(27)
    // 18 × 0.85 × 1.5 = 22.95 → 23
    expect(bodyFontPxFromScale(0.85, 1.5)).toBe(23)
    // 18 × 1.25 × 1.5 = 33.75 → 被新的 32px 上限钳住。
    // 这是「上限 32px」的既定代价，钉在这里以免日后被当成 bug 顺手改掉。
    expect(bodyFontPxFromScale(1.25, 1.5)).toBe(BODY_FONT_PX_MAX)
    expect(bodyFontPxFromScale(1.5, 1.5)).toBe(BODY_FONT_PX_MAX)
    // 界面字号缩小同理：18 × 1 × 0.85 = 15.3 → 15
    expect(bodyFontPxFromScale(1, 0.85)).toBe(15)
  })

  it("旧倍数迁移对垃圾值不抛错", () => {
    expect(bodyFontPxFromScale(null)).toBe(DEFAULT_BODY_FONT_PX)
    expect(bodyFontPxFromScale("")).toBe(DEFAULT_BODY_FONT_PX)
    expect(bodyFontPxFromScale(0)).toBe(DEFAULT_BODY_FONT_PX)
    expect(bodyFontPxFromScale(-3)).toBe(DEFAULT_BODY_FONT_PX)
    expect(bodyFontPxFromScale(Number.NaN)).toBe(DEFAULT_BODY_FONT_PX)
    expect(bodyFontPxFromScale("  ")).toBe(DEFAULT_BODY_FONT_PX)
    expect(bodyFontPxFromScale([])).toBe(DEFAULT_BODY_FONT_PX)
  })

  it("迁移基准常量是「历史的 18px」，与默认字号数值相同但含义不同", () => {
    // 这两个常量一旦被「去重」成一个，日后改默认字号就会静默改掉迁移结果 ——
    // 所以名字里必须带 LEGACY，并且这里把它单独钉住。
    expect(LEGACY_BODY_FONT_PX_AT_SCALE_1).toBe(18)
  })

  it("字号预设全部是范围内的整数且钳制后原样通过", () => {
    // 若预设值钳制后会变，设置页的「选中态」就永远匹配不上
    expect(BODY_FONT_PX_PRESETS.map((p) => p.value)).toEqual([15, 18, 21, 24])
    for (const preset of BODY_FONT_PX_PRESETS) {
      expect(Number.isInteger(preset.value)).toBe(true)
      expect(clampBodyFontPx(preset.value)).toBe(preset.value)
    }
  })

  it("行间距范围 1.2–2.6，默认 1.95，保留两位小数", () => {
    // 上下限写成字面量：否则 clampBodyLineHeight(1) === BODY_LINE_HEIGHT_MIN
    // 对任何 MIN ≥ 1 都成立，范围被悄悄挪走也不会红
    expect(BODY_LINE_HEIGHT_MIN).toBe(1.2)
    expect(BODY_LINE_HEIGHT_MAX).toBe(2.6)
    expect(DEFAULT_BODY_LINE_HEIGHT).toBe(1.95)
    expect(clampBodyLineHeight(1.95)).toBe(1.95)
    expect(clampBodyLineHeight(1)).toBe(BODY_LINE_HEIGHT_MIN)
    expect(clampBodyLineHeight(9)).toBe(BODY_LINE_HEIGHT_MAX)
    expect(clampBodyLineHeight(1.234)).toBe(1.23)
    expect(clampBodyLineHeight(null)).toBe(DEFAULT_BODY_LINE_HEIGHT)
    expect(clampBodyLineHeight("  ")).toBe(DEFAULT_BODY_LINE_HEIGHT)
    expect(clampBodyLineHeight([])).toBe(DEFAULT_BODY_LINE_HEIGHT)
  })

  it("行间距钳制幂等", () => {
    for (const v of [1.2, 1.5, 1.95, 2.05, 2.6]) {
      const once = clampBodyLineHeight(v)
      expect(clampBodyLineHeight(once)).toBe(once)
    }
  })

  it("字间距范围 -1–6px，默认 0", () => {
    // 字面量下限/上限：只用常量自比的话，把范围整体挪走测试照样绿
    expect(BODY_LETTER_SPACING_MIN).toBe(-1)
    expect(BODY_LETTER_SPACING_MAX).toBe(6)
    expect(DEFAULT_BODY_LETTER_SPACING).toBe(0)
    expect(clampBodyLetterSpacing(0)).toBe(0)
    expect(clampBodyLetterSpacing(-9)).toBe(BODY_LETTER_SPACING_MIN)
    expect(clampBodyLetterSpacing(99)).toBe(BODY_LETTER_SPACING_MAX)
    expect(clampBodyLetterSpacing(0.5)).toBe(0.5)
    expect(clampBodyLetterSpacing(null)).toBe(DEFAULT_BODY_LETTER_SPACING)
    // 注意：字间距的默认值恰好是 0，而 Number("  ") 与 Number([]) 也是 0，
    // 所以下面这两条在"不修"的实现下**同样会绿**（无法证伪）。它们留着是为了
    // 与另外四条钳制保持同一份输入矩阵；真正能证伪的是布尔那条：
    // Number(true) === 1，不修的话会得到 1px 而不是默认的 0。
    expect(clampBodyLetterSpacing("  ")).toBe(DEFAULT_BODY_LETTER_SPACING)
    expect(clampBodyLetterSpacing([])).toBe(DEFAULT_BODY_LETTER_SPACING)
    expect(clampBodyLetterSpacing(true)).toBe(DEFAULT_BODY_LETTER_SPACING)
  })

  it("左右边距 null = 跟随窗口，这是默认值", () => {
    // null 不是"忘了设"，而是一个有意义的取值：让 CSS 的
    // clamp(20px, 4vw, 48px) 生效，老用户打开后界面与改造前逐位相同
    expect(DEFAULT_BODY_MARGIN_X).toBeNull()
    expect(clampBodyMarginX(null)).toBeNull()
    expect(clampBodyMarginX(undefined)).toBeNull()
    expect(clampBodyMarginX("")).toBeNull()
    expect(clampBodyMarginX("abc")).toBeNull()
    // 必须是 null 而不是 0：0 的含义是「把边距钉死在 0」，那是另一个选择
    expect(clampBodyMarginX("  ")).toBeNull()
    expect(clampBodyMarginX([])).toBeNull()
    expect(clampBodyMarginX(true)).toBeNull()
  })

  it("左右边距一旦给了数字就钳到 0–160 并取整", () => {
    // 字面量下限/上限：常量自比无法发现范围被改
    expect(BODY_MARGIN_X_MIN).toBe(0)
    expect(BODY_MARGIN_X_MAX).toBe(160)
    expect(clampBodyMarginX(0)).toBe(0)
    expect(clampBodyMarginX(10)).toBe(10)
    expect(clampBodyMarginX(10.6)).toBe(11)
    expect(clampBodyMarginX(-5)).toBe(BODY_MARGIN_X_MIN)
    expect(clampBodyMarginX(9999)).toBe(BODY_MARGIN_X_MAX)
  })

  it("底部安全距离范围 0–240px，默认 51px", () => {
    // 字面量下限/上限：常量自比无法发现范围被改
    expect(BODY_SAFE_BOTTOM_MIN).toBe(0)
    expect(BODY_SAFE_BOTTOM_MAX).toBe(240)
    expect(DEFAULT_BODY_SAFE_BOTTOM).toBe(51)
    expect(clampBodySafeBottom(51)).toBe(51)
    expect(clampBodySafeBottom(-1)).toBe(BODY_SAFE_BOTTOM_MIN)
    expect(clampBodySafeBottom(9999)).toBe(BODY_SAFE_BOTTOM_MAX)
    expect(clampBodySafeBottom(null)).toBe(DEFAULT_BODY_SAFE_BOTTOM)
    expect(clampBodySafeBottom("  ")).toBe(DEFAULT_BODY_SAFE_BOTTOM)
    expect(clampBodySafeBottom([])).toBe(DEFAULT_BODY_SAFE_BOTTOM)
  })

  it("每个默认值都落在自己的范围内，并且是自己那条钳制的不动点", () => {
    // 守的是一类真实事故：默认值被改到范围外时，store 按默认值初始化，
    // 渲染前 applyBodyTypography 又把它钳回去，于是设置页显示「自定义 · 34px」
    // 而实际渲染 32px —— 正是「设了 150% 下次启动被截成别的值」那一类。
    const ranges = [
      { name: "正文字号", min: BODY_FONT_PX_MIN, max: BODY_FONT_PX_MAX, def: DEFAULT_BODY_FONT_PX, clamp: clampBodyFontPx },
      { name: "行间距", min: BODY_LINE_HEIGHT_MIN, max: BODY_LINE_HEIGHT_MAX, def: DEFAULT_BODY_LINE_HEIGHT, clamp: clampBodyLineHeight },
      { name: "字间距", min: BODY_LETTER_SPACING_MIN, max: BODY_LETTER_SPACING_MAX, def: DEFAULT_BODY_LETTER_SPACING, clamp: clampBodyLetterSpacing },
      { name: "底部安全距离", min: BODY_SAFE_BOTTOM_MIN, max: BODY_SAFE_BOTTOM_MAX, def: DEFAULT_BODY_SAFE_BOTTOM, clamp: clampBodySafeBottom },
    ]
    for (const range of ranges) {
      expect(range.min, `${range.name} 的下限大于默认值`).toBeLessThanOrEqual(range.def)
      expect(range.def, `${range.name} 的默认值大于上限`).toBeLessThanOrEqual(range.max)
      expect(range.clamp(range.def), `${range.name} 的默认值不是自身钳制的不动点`).toBe(range.def)
    }
    // 第五条范围（左右边距）的默认值是 null = 跟随窗口，
    // 它的不变量是「钳制后仍然是 null」，而不是等于某个数
    expect(clampBodyMarginX(DEFAULT_BODY_MARGIN_X)).toBeNull()
  })

  it("「跟随窗口」的 CSS 兜底范围 clamp(20px, 4vw, 48px) 收在单一来源里", () => {
    // 任务 8 的滑块停靠位置、任务 12 对 ui-test-editor.css 的静态守卫
    // 都引用这三个数；各抄一份就会出现第七处「两处定义的范围」。
    expect(BODY_MARGIN_X_VIEWPORT_MIN).toBe(20)
    expect(BODY_MARGIN_X_VIEWPORT_VW).toBe(4)
    expect(BODY_MARGIN_X_VIEWPORT_MAX).toBe(48)
  })

  it("defaultBodyMarginXForViewport 复现 clamp(20px, 4vw, 48px) 的取值", () => {
    // 4vw = 16 → 夹到下限
    expect(defaultBodyMarginXForViewport(400)).toBe(20)
    // 4vw = 40 → 区间内
    expect(defaultBodyMarginXForViewport(1000)).toBe(40)
    // 4vw = 80 → 夹到上限
    expect(defaultBodyMarginXForViewport(2000)).toBe(48)
    // 边界要真的落在 clamp 的拐点上：500 × 4% = 20（正好下限），1200 × 4% = 48（正好上限）
    expect(defaultBodyMarginXForViewport(500)).toBe(20)
    expect(defaultBodyMarginXForViewport(1200)).toBe(48)
    // 取整：900 × 4% = 36
    expect(defaultBodyMarginXForViewport(900)).toBe(36)
    expect(Number.isInteger(defaultBodyMarginXForViewport(913))).toBe(true)
  })

  it("defaultBodyMarginXForViewport 对非法宽度给下限，而不是 0", () => {
    // 0 会被读成「边距被设成了 0」，而实际正文仍有 20–48px 的间距 ——
    // 显示 0 就是界面在说谎。非法宽度下给下限最接近真实渲染。
    expect(defaultBodyMarginXForViewport(0)).toBe(BODY_MARGIN_X_VIEWPORT_MIN)
    expect(defaultBodyMarginXForViewport(-5)).toBe(BODY_MARGIN_X_VIEWPORT_MIN)
    expect(defaultBodyMarginXForViewport("abc")).toBe(BODY_MARGIN_X_VIEWPORT_MIN)
    expect(defaultBodyMarginXForViewport(Number.NaN)).toBe(BODY_MARGIN_X_VIEWPORT_MIN)
    expect(defaultBodyMarginXForViewport([])).toBe(BODY_MARGIN_X_VIEWPORT_MIN)
    expect(defaultBodyMarginXForViewport(null)).toBe(BODY_MARGIN_X_VIEWPORT_MIN)
    expect(defaultBodyMarginXForViewport(undefined)).toBe(BODY_MARGIN_X_VIEWPORT_MIN)
    expect(defaultBodyMarginXForViewport(Number.POSITIVE_INFINITY)).toBe(BODY_MARGIN_X_VIEWPORT_MIN)
    // 数字字符串可用（localStorage 里存的是 String(number)）
    expect(defaultBodyMarginXForViewport("1000")).toBe(40)
  })
})

describe("resolveMigratedBodyFontPx 决定升级后第一次读正文字号", () => {
  it("存过旧倍数：把它乘入界面字号后迁移（与 bodyFontPxFromScale 同一条公式）", () => {
    expect(resolveMigratedBodyFontPx(1, 1)).toBe(18)
    expect(resolveMigratedBodyFontPx(1, 1.5)).toBe(27)
    expect(resolveMigratedBodyFontPx(1.25, 1.5)).toBe(BODY_FONT_PX_MAX)
    expect(resolveMigratedBodyFontPx(0.85, 1)).toBe(15)
  })

  it("没存过旧倍数、界面字号非默认：按界面字号补种，否则正文会凭空变小", () => {
    // 改造前 18px 也被界面字号放大着（rem 基准是根字号），
    // 这里若不补种，界面 150% 的用户升级后会从 27px 掉到 store 默认 18px。
    expect(resolveMigratedBodyFontPx(null, 1.5)).toBe(27)
    expect(resolveMigratedBodyFontPx(undefined, 1.5)).toBe(27)
    expect(resolveMigratedBodyFontPx("", 1.5)).toBe(27)
    // 补种值与「旧倍数 = 1」的迁移结果必须是同一个数（单一来源，不各写一份）
    expect(resolveMigratedBodyFontPx(null, 1.5)).toBe(bodyFontPxFromScale(1, 1.5))
    // 18 × 1.25 = 22.5 → 23
    expect(resolveMigratedBodyFontPx(null, 1.25)).toBe(23)
    // 垃圾值（0 / 负数 / 空格串 / 数组 / 布尔）等同于「没存过」，
    // 不能当成「用户选了最小倍数」而在界面 150% 时补种出一个 12px
    expect(resolveMigratedBodyFontPx(0, 1.5)).toBe(27)
    expect(resolveMigratedBodyFontPx(-3, 1.5)).toBe(27)
    expect(resolveMigratedBodyFontPx("  ", 1.5)).toBe(27)
    expect(resolveMigratedBodyFontPx([], 1.5)).toBe(27)
    expect(resolveMigratedBodyFontPx(true, 1.5)).toBe(27)
  })

  it("没存过、界面字号为 1：返回 null，不写值（让「未设置」保持未设置）", () => {
    // 此时补种的值恰好等于默认值，写它没有任何意义，只会把「未设置」变成「设成了 18」
    expect(resolveMigratedBodyFontPx(null, 1)).toBeNull()
    expect(resolveMigratedBodyFontPx(undefined, undefined)).toBeNull()
    expect(resolveMigratedBodyFontPx("", 1)).toBeNull()
    expect(resolveMigratedBodyFontPx("  ", 1)).toBeNull()
    expect(resolveMigratedBodyFontPx([], 1)).toBeNull()
    expect(resolveMigratedBodyFontPx(0, 1)).toBeNull()
  })

  it("界面字号越界时先钳进 80%–150% 再补种，结果不会跑出字号范围", () => {
    expect(resolveMigratedBodyFontPx(null, 9)).toBe(27)
    expect(resolveMigratedBodyFontPx(1, 9)).toBe(27)
    expect(resolveMigratedBodyFontPx(null, 0.1)).toBe(14) // 钳到 0.8 → 18 × 0.8 = 14.4 → 14
  })
})

describe("applyBodyTypography 写 CSS 变量", () => {
  function makeRoot() {
    const el = document.createElement("div")
    return el
  }

  it("五行变量一次写齐，字号与两处 px 值带单位", () => {
    const root = makeRoot()
    applyBodyTypography(
      { fontPx: 15, lineHeight: 2.1, letterSpacing: 0.5, marginX: 40, safeBottom: 80 },
      root,
    )
    expect(root.style.getPropertyValue("--qmai-body-font-px")).toBe("15px")
    expect(root.style.getPropertyValue("--qmai-body-leading")).toBe("2.1")
    expect(root.style.getPropertyValue("--qmai-body-letter-spacing")).toBe("0.5px")
    expect(root.style.getPropertyValue("--qmai-body-margin-x")).toBe("40px")
    expect(root.style.getPropertyValue("--qmai-body-safe-bottom")).toBe("80px")
  })

  it("marginX 为 null 时移除该属性，让 CSS 兜底生效", () => {
    const root = makeRoot()
    applyBodyTypography({ fontPx: 15, lineHeight: 1.95, letterSpacing: 0, marginX: 40, safeBottom: 51 }, root)
    expect(root.style.getPropertyValue("--qmai-body-margin-x")).toBe("40px")
    applyBodyTypography({ fontPx: 15, lineHeight: 1.95, letterSpacing: 0, marginX: null, safeBottom: 51 }, root)
    // 留着空字符串也会盖掉 CSS 的 clamp，必须是彻底移除
    expect(root.style.getPropertyValue("--qmai-body-margin-x")).toBe("")
  })

  it("行高不带单位（带了 px 会让行高不随字号变化）", () => {
    const root = makeRoot()
    applyBodyTypography({ fontPx: 18, lineHeight: 1.95, letterSpacing: 0, marginX: null, safeBottom: 51 }, root)
    expect(root.style.getPropertyValue("--qmai-body-leading")).not.toMatch(/px/)
  })

  it("不传 root 时写的是 documentElement（生产路径，必须真跑一次）", () => {
    // 之前每条用例都传了一个游离的 div，于是「不传 root」这条分支
    // （以及 typeof document === "undefined" 的守卫）从来没被跑过。
    const root = document.documentElement
    const props = [
      "--qmai-body-font-px",
      "--qmai-body-leading",
      "--qmai-body-letter-spacing",
      "--qmai-body-margin-x",
      "--qmai-body-safe-bottom",
    ]
    try {
      // 先留一个脏值，确认 marginX=null 时是「移除」而不是「没写过」
      root.style.setProperty("--qmai-body-margin-x", "40px")
      applyBodyTypography({ fontPx: 21, lineHeight: 2.05, letterSpacing: 0.5, marginX: null, safeBottom: 80 })
      expect(root.style.getPropertyValue("--qmai-body-font-px")).toBe("21px")
      expect(root.style.getPropertyValue("--qmai-body-leading")).toBe("2.05")
      expect(root.style.getPropertyValue("--qmai-body-letter-spacing")).toBe("0.5px")
      expect(root.style.getPropertyValue("--qmai-body-safe-bottom")).toBe("80px")
      expect(root.style.getPropertyValue("--qmai-body-margin-x")).toBe("")
    } finally {
      // documentElement 是跨用例共享的，写进去的变量必须清干净，否则会泄漏到别的用例
      for (const prop of props) root.style.removeProperty(prop)
      expect(root.style.getPropertyValue("--qmai-body-font-px")).toBe("")
    }
  })
})
