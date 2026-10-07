import { describe, expect, it } from "vitest"
import {
  BODY_FONT_OPTIONS,
  BODY_FONT_SIZE_MAX,
  BODY_FONT_SIZE_MIN,
  BODY_FONT_SIZE_PRESETS,
  DEFAULT_BODY_FONT_FAMILY,
  DEFAULT_BODY_FONT_SIZE_SCALE,
  DEFAULT_UI_FONT_FAMILY,
  UI_FONT_OPTIONS,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  UI_FONT_SIZE_PRESETS,
  applyBodyFontFamily,
  clampBodyFontSizeScale,
  clampUiFontSizeScale,
  getBodyFontFamilyCss,
  getUiFontFamilyCss,
  normalizeBodyFontFamily,
  normalizeUiFontFamily,
  applyUiFontFamily,
} from "./font-settings"

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
      if (option.value === "follow-ui") continue
      expect(option.cssFamily).toMatch(/(serif|sans-serif|monospace)$/)
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

describe("正文字号（独立于界面字号）", () => {
  it("范围是 85%–150%，默认 100%", () => {
    expect(BODY_FONT_SIZE_MIN).toBe(0.85)
    expect(BODY_FONT_SIZE_MAX).toBe(1.5)
    expect(DEFAULT_BODY_FONT_SIZE_SCALE).toBe(1)
    // 上限 1.5 与界面字号上限 1.5 相乘 = 2.25 倍（约 40.5px），
    // 这是设计里确认过的最大文档字号，已实测无裁切
    expect(UI_FONT_SIZE_MAX * BODY_FONT_SIZE_MAX).toBeCloseTo(2.25, 10)
  })

  it("无效输入退回默认 1，而不是被隐式转换为下限", () => {
    // Number(null) === 0 会把"没有存过值"钳成 0.85，
    // 于是首次启动的正文就比设计值小 —— 必须退回 1
    expect(clampBodyFontSizeScale(null)).toBe(1)
    expect(clampBodyFontSizeScale(undefined)).toBe(1)
    expect(clampBodyFontSizeScale("")).toBe(1)
    expect(clampBodyFontSizeScale("abc")).toBe(1)
    expect(clampBodyFontSizeScale(Number.NaN)).toBe(1)
    expect(clampBodyFontSizeScale(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it("钳制到 85%–150% 且保留两位小数", () => {
    expect(clampBodyFontSizeScale(0.1)).toBe(BODY_FONT_SIZE_MIN)
    expect(clampBodyFontSizeScale(9)).toBe(BODY_FONT_SIZE_MAX)
    expect(clampBodyFontSizeScale(1.234)).toBe(1.23)
    expect(clampBodyFontSizeScale("1.25")).toBe(1.25)
    expect(clampBodyFontSizeScale(1)).toBe(1)
  })

  it("钳制幂等（反复保存不会漂移）", () => {
    for (const v of [0.8, 0.85, 1, 1.25, 1.5, 2]) {
      const once = clampBodyFontSizeScale(v)
      expect(clampBodyFontSizeScale(once)).toBe(once)
    }
  })

  it("预设全部落在范围内且钳制后原样通过（否则选中态永远匹配不上）", () => {
    expect(BODY_FONT_SIZE_PRESETS.map((p) => p.value)).toEqual([0.85, 1, 1.25, 1.5])
    for (const preset of BODY_FONT_SIZE_PRESETS) {
      expect(preset.value).toBeGreaterThanOrEqual(BODY_FONT_SIZE_MIN)
      expect(preset.value).toBeLessThanOrEqual(BODY_FONT_SIZE_MAX)
      expect(clampBodyFontSizeScale(preset.value)).toBe(preset.value)
    }
  })

  it("与界面字号是两个独立的范围（不能共用同一份常量）", () => {
    // 界面字号下限 80%、正文下限 85%，上限都是 150%：
    // 若哪天有人图省事让两者共用常量，这条会提醒他先想清楚
    expect(UI_FONT_SIZE_MIN).not.toBe(BODY_FONT_SIZE_MIN)
    expect(UI_FONT_SIZE_MAX).toBe(BODY_FONT_SIZE_MAX)
    expect(BODY_FONT_SIZE_PRESETS).not.toBe(UI_FONT_SIZE_PRESETS)
  })
})

/* ────────────────────────── 界面字体选项（只列中文字体） ────────────────────────── */

/**
 * 被认定为"能覆盖中文"的字体族名白名单。
 *
 * 为什么需要一个白名单而不是"看起来像中文"的模糊判断：本文件的规矩是
 * **以实测可用的名字为准**（见 probe-installed-fonts.mjs 的实测表）。
 * 「微软正黑体」用中文名在本机实测不可用、必须写英文名 `Microsoft JhengHei`，
 * 所以"含汉字"根本不能作为判据 —— 只能按真实族名列白名单。
 */
const CJK_FONT_NAMES = [
  // Windows 自带
  "Microsoft YaHei",
  "Microsoft YaHei UI",
  "Microsoft JhengHei",
  "SimHei",
  "SimSun",
  "NSimSun",
  "KaiTi",
  "FangSong",
  "DengXian",
  // macOS 自带（阶段 4 的真机回退项）
  "PingFang SC",
  "Heiti SC",
  "Songti SC",
  "Kaiti SC",
  "STKaiti",
  "Fangsong SC",
  "STFangsong",
  // 计划随后续安装包分发的开源字体
  "Noto Sans SC",
  "Noto Serif SC",
  "Source Han Sans SC",
  "Source Han Serif SC",
] as const

/** 取字体栈的第一项（去掉引号），判断它是不是白名单里的中文字体。 */
function leadsWithCjkFont(cssFamily: string): boolean {
  const first = cssFamily.split(",")[0].trim().replace(/^["']|["']$/g, "")
  return (CJK_FONT_NAMES as readonly string[]).includes(first)
}

describe("界面字体选项（只列中文字体）", () => {
  it("不再提供纯拉丁字体选项", () => {
    expect(UI_FONT_OPTIONS.map((o) => o.value)).not.toContain("arial")
  })

  it("旧值 arial 平滑回退到默认，不抛错", () => {
    expect(normalizeUiFontFamily("arial")).toBe(DEFAULT_UI_FONT_FAMILY)
  })

  it("每个选项都以通用族收尾，保证未安装时静默回退可预期", () => {
    for (const option of UI_FONT_OPTIONS) {
      expect(option.cssFamily).toMatch(/(serif|sans-serif|monospace)$/)
    }
  })

  it("含中文覆盖的常用选项齐备", () => {
    const values = UI_FONT_OPTIONS.map((o) => o.value)
    for (const v of ["system", "microsoft-yahei", "simhei", "simsun", "nsimsun",
                     "kaiti", "fangsong", "dengxian", "noto-sans", "noto-serif"]) {
      expect(values).toContain(v)
    }
  })

  it("每个选项都以中文字体打头，不能拿纯拉丁字体顶在前面", () => {
    // 先验证判断器本身有区分力：给一条纯拉丁字体打头的栈，它必须判否。
    // 否则下面那条 for 循环就是"永远为真"的装饰（本任务吃过一次亏：
    // document.fonts.check 对编造的字体名也返回 true，正是负向对照抓出来的）。
    expect(leadsWithCjkFont('Arial, "Microsoft YaHei", system-ui, sans-serif')).toBe(false)
    expect(leadsWithCjkFont('Helvetica, "Segoe UI", sans-serif')).toBe(false)
    expect(leadsWithCjkFont('system-ui, "Microsoft YaHei", sans-serif')).toBe(false)
    expect(leadsWithCjkFont('"Microsoft YaHei", system-ui, sans-serif')).toBe(true)

    for (const option of UI_FONT_OPTIONS) {
      expect(leadsWithCjkFont(option.cssFamily)).toBe(true)
    }
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
