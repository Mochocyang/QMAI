// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import {
  BODY_FONT_PX_MAX,
  BODY_LINE_HEIGHT_MIN,
  BODY_SAFE_BOTTOM_MAX,
  DEFAULT_BODY_FONT_PX,
  DEFAULT_BODY_LINE_HEIGHT,
  DEFAULT_BODY_SAFE_BOTTOM,
} from "@/lib/font-settings"
import {
  applyReaderWindowAppearance,
  defaultReaderWindowAppearance,
  isReaderWindowSkin,
  normalizeReaderWindowAppearance,
  publishReaderWindowAppearance,
  readerWindowThemeForSkin,
} from "@/lib/reader-window-appearance"

const APPEARANCE = {
  skin: "zhi" as const,
  uiFontFamily: "microsoft-yahei",
  uiFontSizeScale: 1.25,
  bodyFontFamily: "kaiti",
  bodyFontPx: 21,
  bodyLineHeight: 2.05,
  bodyLetterSpacing: 0.5,
  bodyMarginX: 40,
  bodySafeBottom: 80,
}

function resetRoot() {
  const html = document.documentElement
  html.className = ""
  delete html.dataset.uiTestSkin
  html.removeAttribute("style")
}

afterEach(() => {
  resetRoot()
})

describe("readerWindowThemeForSkin", () => {
  it("星夜是深色皮肤，另外两个是浅色", () => {
    expect(readerWindowThemeForSkin("xing")).toBe("dark")
    expect(readerWindowThemeForSkin("jing")).toBe("light")
    expect(readerWindowThemeForSkin("zhi")).toBe("light")
  })
})

describe("isReaderWindowSkin", () => {
  it("只认三个皮肤 id", () => {
    expect(isReaderWindowSkin("jing")).toBe(true)
    expect(isReaderWindowSkin("zhi")).toBe(true)
    expect(isReaderWindowSkin("xing")).toBe(true)
    expect(isReaderWindowSkin("dark")).toBe(false)
    expect(isReaderWindowSkin(undefined)).toBe(false)
    expect(isReaderWindowSkin(null)).toBe(false)
  })
})

describe("normalizeReaderWindowAppearance", () => {
  it("不是对象一律 null（宁可走兜底快照，也不要半份参数）", () => {
    expect(normalizeReaderWindowAppearance(undefined)).toBeNull()
    expect(normalizeReaderWindowAppearance(null)).toBeNull()
    expect(normalizeReaderWindowAppearance("zhi")).toBeNull()
    expect(normalizeReaderWindowAppearance(42)).toBeNull()
  })

  it("合法快照原样保留（含负字距与「跟随窗口」的 null 边距）", () => {
    expect(normalizeReaderWindowAppearance(APPEARANCE)).toEqual(APPEARANCE)
    expect(normalizeReaderWindowAppearance({ ...APPEARANCE, bodyLetterSpacing: -0.5 })).toEqual({
      ...APPEARANCE,
      bodyLetterSpacing: -0.5,
    })
    expect(normalizeReaderWindowAppearance({ ...APPEARANCE, bodyMarginX: null })?.bodyMarginX).toBeNull()
  })

  it("空对象落到出厂默认（缺字段不是「设成 0」，而是「没设过」）", () => {
    const normalized = normalizeReaderWindowAppearance({})
    expect(normalized).not.toBeNull()
    expect(normalized?.bodyFontPx).toBe(DEFAULT_BODY_FONT_PX)
    expect(normalized?.bodyLineHeight).toBe(DEFAULT_BODY_LINE_HEIGHT)
    expect(normalized?.bodySafeBottom).toBe(DEFAULT_BODY_SAFE_BOTTOM)
    expect(normalized?.bodyMarginX).toBeNull()
    expect(normalized?.uiFontSizeScale).toBe(1)
  })

  it("越界 / 垃圾值被钳住，不会把正文写成 0px 或空字体", () => {
    const normalized = normalizeReaderWindowAppearance({
      skin: "不存在的皮肤",
      uiFontFamily: 12345,
      uiFontSizeScale: 99,
      bodyFontFamily: null,
      bodyFontPx: 999,
      bodyLineHeight: 0,
      bodyLetterSpacing: 99,
      bodyMarginX: -20,
      bodySafeBottom: 9999,
    })
    expect(normalized?.bodyFontPx).toBe(BODY_FONT_PX_MAX)
    expect(normalized?.bodyLineHeight).toBe(BODY_LINE_HEIGHT_MIN)
    expect(normalized?.bodySafeBottom).toBe(BODY_SAFE_BOTTOM_MAX)
    expect(normalized?.bodyMarginX).toBe(0)
    // 字体名被清理后一定落到合法 id，而不是原样拼进 CSS
    expect(normalized?.bodyFontFamily).not.toBe(null)
    expect(normalized?.uiFontFamily).not.toBe(12345)
    expect(normalized?.skin).toBe("jing")
  })
})

describe("applyReaderWindowAppearance", () => {
  it("皮肤写进 data-ui-test-skin（ui-test.css 的整套令牌都挂在这个属性上）", () => {
    applyReaderWindowAppearance(APPEARANCE)
    expect(document.documentElement.dataset.uiTestSkin).toBe("zhi")
    // 纸间是浅色
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("星夜同时切到深色（原生控件才不会残留浅色）", () => {
    applyReaderWindowAppearance({ ...APPEARANCE, skin: "xing" })
    expect(document.documentElement.dataset.uiTestSkin).toBe("xing")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("界面字号倍率写成根字号百分比（与 App 里同一条写法）", () => {
    applyReaderWindowAppearance(APPEARANCE)
    expect(document.documentElement.style.fontSize).toBe("125%")
    applyReaderWindowAppearance({ ...APPEARANCE, uiFontSizeScale: 0.85 })
    expect(document.documentElement.style.fontSize).toBe("85%")
  })

  it("正文排版 5 个变量逐个落地", () => {
    applyReaderWindowAppearance(APPEARANCE)
    const style = document.documentElement.style
    expect(style.getPropertyValue("--qmai-body-font-px")).toBe("21px")
    expect(style.getPropertyValue("--qmai-body-leading")).toBe("2.05")
    expect(style.getPropertyValue("--qmai-body-letter-spacing")).toBe("0.5px")
    expect(style.getPropertyValue("--qmai-body-margin-x")).toBe("40px")
    expect(style.getPropertyValue("--qmai-body-safe-bottom")).toBe("80px")
  })

  it("边距为 null 时移除该变量（「跟随窗口」必须让 CSS 的 clamp 兜底）", () => {
    applyReaderWindowAppearance({ ...APPEARANCE, bodyMarginX: 40 })
    expect(document.documentElement.style.getPropertyValue("--qmai-body-margin-x")).toBe("40px")
    applyReaderWindowAppearance({ ...APPEARANCE, bodyMarginX: null })
    expect(document.documentElement.style.getPropertyValue("--qmai-body-margin-x")).toBe("")
  })

  it("字体两项各写各的变量，互不覆盖（正文不能拖着界面一起变）", () => {
    applyReaderWindowAppearance(APPEARANCE)
    const style = document.documentElement.style
    expect(style.getPropertyValue("--qmai-ui-font-family")).toContain("Microsoft YaHei")
    expect(style.getPropertyValue("--qmai-body-font-family")).toContain("KaiTi")
  })

  it("参数残缺也不抛错：返回实际生效的那份快照", () => {
    const applied = applyReaderWindowAppearance(undefined)
    expect(applied).toEqual(defaultReaderWindowAppearance())
    expect(document.documentElement.dataset.uiTestSkin).toBe(applied.skin)
  })
})

describe("publishReaderWindowAppearance", () => {
  it("非 Tauri 环境是空操作，不抛错（浏览器里直开页面验收时走这条路）", () => {
    expect(() => publishReaderWindowAppearance()).not.toThrow()
  })
})
