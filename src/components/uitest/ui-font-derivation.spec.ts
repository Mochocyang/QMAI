import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import postcss from "postcss"
import { describe, expect, it } from "vitest"
import { DEFAULT_UI_FONT_FAMILY, UI_FONT_OPTIONS, getUiFontFamilyCss } from "@/lib/font-settings"

const uitestCss = readFileSync(resolve(__dirname, "ui-test.css"), "utf8")
const indexCss = readFileSync(resolve(__dirname, "../../index.css"), "utf8")

/**
 * 界面字体（--ui）的生效链路回归防线。
 *
 * 背景：`--ui` 曾硬编码成一套字体栈，而 `applyUiFontFamily` 把用户选择写进
 * `--qmai-ui-font-family` —— 两者之间没有任何连接，于是「界面字体」设置
 * 形同虚设（实测：改 --qmai-ui-font-family 后 32 个界面文字元素中有 0 个变化）。
 * 这类缺陷不会报错、不会有类型问题，读代码时两个名字又都像"字体"，
 * 极易被改回去。所以这里用静态断言把链路钉住，
 * 配合 verify-ui-font-applies.mjs（真实浏览器 + Chromium 真实渲染字体）双重覆盖。
 */
describe("界面字体生效链路", () => {
  it("--ui 派生自 --qmai-ui-font-family，不再硬编码字体栈", () => {
    let value: string | undefined
    postcss.parse(uitestCss).walkDecls("--ui", (decl) => { value = decl.value })
    expect(value).toBe("var(--qmai-ui-font-family)")
    // 任何硬编码的中文字体名出现在 --ui 里都意味着通路又断了
    expect(value).not.toMatch(/PingFang|YaHei|SimSun|SimHei|serif/)
  })

  it("--ui 与 --serif 只有一处定义，且互不牵连", () => {
    const ui: string[] = []
    const serif: string[] = []
    postcss.parse(uitestCss).walkDecls((decl) => {
      if (decl.prop === "--ui") ui.push(decl.value)
      if (decl.prop === "--serif") serif.push(decl.value)
    })
    expect(ui).toHaveLength(1)
    expect(serif).toHaveLength(1)
    // --serif 是正文字体，不能跟着界面字体走
    expect(serif[0]).not.toContain("--qmai-ui-font-family")
  })

  it("--serif 派生自 --qmai-body-font-family，回退栈与改造前逐字一致", () => {
    let value: string | undefined
    postcss.parse(uitestCss).walkDecls("--serif", (decl) => { value = decl.value })
    expect(value).toContain("var(--qmai-body-font-family")
    // 回退栈必须与改造前 --serif 的取值完全相同：未设置变量时
    // （首屏、以及任何不经过 JS 的场景）行为必须与改造前一致
    const fallback = value!.slice(value!.indexOf(",") + 1).replace(/\)\s*$/, "").trim()
    expect(fallback).toBe('"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif')
  })

  it("index.css 的 :root 默认值与 font-settings 的默认选项逐字一致", () => {
    // 两处若不一致，applyUiFontFamily 生效前后会各用一套字体：
    // 首屏闪一下再变，且默认观感与设置里显示的"本机默认"不符。
    // 实测本机上"PingFang 优先"与"system-ui 优先"渲染结果完全相同，
    // 所以这种不一致不会被肉眼或像素测试发现，只能靠静态比对拦住。
    let rootValue = ""
    postcss.parse(indexCss).walkRules((rule) => {
      if (rule.selector !== ":root") return
      rule.walkDecls("--qmai-ui-font-family", (decl) => { rootValue = decl.value })
    })
    const normalize = (s: string) => s.replace(/\s+/g, " ").replace(/,\s*/g, ",").trim()
    expect(normalize(rootValue)).toBe(normalize(getUiFontFamilyCss(DEFAULT_UI_FONT_FAMILY)))
  })

  it("默认选项保留改造前的栈顺序，避免改变默认观感", () => {
    // 改造前 --ui 的实际取值（Windows 上真正命中的是 Microsoft YaHei UI）
    const css = getUiFontFamilyCss(DEFAULT_UI_FONT_FAMILY)
    expect(css.startsWith('"PingFang SC", "Microsoft YaHei UI"')).toBe(true)
    expect(css).toContain("Microsoft YaHei")
    expect(css.trim().endsWith("sans-serif")).toBe(true)
  })
})
