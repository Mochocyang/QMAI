import { describe, expect, it } from "vitest"
import {
  DEFAULT_UI_FONT_FAMILY,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  UI_FONT_SIZE_PRESETS,
  clampUiFontSizeScale,
  getUiFontFamilyCss,
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
