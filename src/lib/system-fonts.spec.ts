/**
 * 阶段 3 的判据用例：本机中文字体的**清理、去重与注入防线**。
 *
 * 这个文件存在的理由：这一层的每个函数都在处理**来自系统的不受信字符串**，
 * 而它们的失败方式全都是静默的 —— 一个漏过清理的族名会悄悄改掉整条 CSS 栈，
 * 一个去重失败会让用户看到两个一模一样的字体项。两者都不会抛错。
 */
import { describe, expect, it } from "vitest"
import {
  SYSTEM_FONT_PREFIX,
  firstFamilyOfCssStack,
  isSystemFontValue,
  newSystemFontsOnly,
  sanitizeFontFamilyName,
  systemFontCss,
  systemFontNameOf,
  systemFontValue,
} from "@/lib/system-fonts"
import { UI_FONT_OPTIONS, getUiFontFamilyCss, normalizeUiFontFamily } from "@/lib/font-settings"

describe("阶段 3：族名清理", () => {
  it("正常族名原样通过", () => {
    expect(sanitizeFontFamilyName("Microsoft YaHei")).toBe("Microsoft YaHei")
    expect(sanitizeFontFamilyName("  霞鹜文楷  ")).toBe("霞鹜文楷")
    // 带括号/点/连字符的族名是真实存在的（如 Source Han Serif SC Heavy）
    expect(sanitizeFontFamilyName("Source Han Serif SC")).toBe("Source Han Serif SC")
    expect(sanitizeFontFamilyName("Noto Sans SC")).toBe("Noto Sans SC")
    expect(sanitizeFontFamilyName("UbuntuMono[wght]")).toBe("UbuntuMono[wght]")
    expect(sanitizeFontFamilyName("yyb")).toBe("yyb")
  })

  it("双引号与反斜杠必须被拒——它们能提前闭合 CSS 字符串", () => {
    // 这是本模块最重要的断言：放过它就等于允许任意 CSS 注入
    expect(sanitizeFontFamilyName('Foo"Bar')).toBeNull()
    expect(sanitizeFontFamilyName("Foo\\Bar")).toBeNull()
    expect(sanitizeFontFamilyName('"; color: red; x: "')).toBeNull()
  })

  it("控制字符与换行必须被拒", () => {
    expect(sanitizeFontFamilyName("Foo\nBar")).toBeNull()
    expect(sanitizeFontFamilyName("Foo\r\nBar")).toBeNull()
    expect(sanitizeFontFamilyName("Foo\u0000Bar")).toBeNull()
    expect(sanitizeFontFamilyName("Foo\u001fBar")).toBeNull()
    expect(sanitizeFontFamilyName("Foo\u007fBar")).toBeNull()
  })

  it("空/非字符串/超长必须被拒", () => {
    expect(sanitizeFontFamilyName("")).toBeNull()
    expect(sanitizeFontFamilyName("   ")).toBeNull()
    expect(sanitizeFontFamilyName(null)).toBeNull()
    expect(sanitizeFontFamilyName(undefined)).toBeNull()
    expect(sanitizeFontFamilyName(42)).toBeNull()
    expect(sanitizeFontFamilyName({})).toBeNull()
    expect(sanitizeFontFamilyName("x".repeat(129))).toBeNull()
    // 边界：128 恰好通过（否则真实长族名会被误杀）
    expect(sanitizeFontFamilyName("x".repeat(128))).toBe("x".repeat(128))
  })

  it("单引号不被拒——它是合法族名字符，拒它会误杀正常字体", () => {
    // 因为我们一律用双引号包裹，单引号在 CSS 字符串里没有特殊含义
    expect(sanitizeFontFamilyName("O'Brien Sans")).toBe("O'Brien Sans")
  })
})

describe("阶段 3：sys: 取值的构造与解析", () => {
  it("往返一致", () => {
    const v = systemFontValue("霞鹜文楷")
    expect(v).toBe(`${SYSTEM_FONT_PREFIX}霞鹜文楷`)
    expect(systemFontNameOf(v)).toBe("霞鹜文楷")
    expect(isSystemFontValue(v)).toBe(true)
  })

  it("不安全的族名构造不出取值", () => {
    expect(systemFontValue('Foo"Bar')).toBeNull()
    expect(systemFontValue("")).toBeNull()
  })

  it("消费端再校验一次——存到本地的值可能被改过", () => {
    // isSystemFontValue 只看前缀形状，systemFontNameOf 才校验族名
    expect(isSystemFontValue('sys:Foo"Bar')).toBe(true)
    expect(systemFontNameOf('sys:Foo"Bar')).toBeNull()
    expect(systemFontCss('sys:Foo"Bar')).toBeNull()
  })

  it("非 sys: 取值不被当作动态字体", () => {
    expect(isSystemFontValue("microsoft-yahei")).toBe(false)
    expect(systemFontNameOf("microsoft-yahei")).toBeNull()
    // 前缀本身不算（没有族名）
    expect(isSystemFontValue(SYSTEM_FONT_PREFIX)).toBe(false)
  })

  it("CSS 栈把族名放在最前、并以通用族收尾", () => {
    // 注意入参是**持久化取值**（sys: 前缀），不是裸族名 ——
    // 消费端拿到的一律是存下来的那个值
    const css = systemFontCss("sys:霞鹜文楷")
    expect(css).not.toBeNull()
    expect(css!.startsWith('"霞鹜文楷"')).toBe(true)
    // 必须收尾于通用族：动态字体被卸载时不能掉进"空字体"
    expect(css!.trim().endsWith("sans-serif")).toBe(true)
  })
})

describe("阶段 3：与内置选项去重", () => {
  const builtins = UI_FONT_OPTIONS.map((o) => o.cssFamily)

  it("内置项已覆盖的字体必须被排除——否则下拉里同一字体会出现两次", () => {
    /*
     * 这两个都是**内置项的第一段**：
     *   Microsoft YaHei → 内置 "microsoft-yahei" 项
     *   SimSun          → 内置 "simsun" 项
     * 不排除的话用户会同时看到「微软雅黑」和「微软雅黑」（本机组），
     * 而且两项行为完全相同，无从选择。
     */
    const out = newSystemFontsOnly(
      [
        { family: "Microsoft YaHei", display: "微软雅黑" },
        { family: "SimSun", display: "宋体" },
      ],
      builtins,
    )
    expect(out).toEqual([])
  })

  it("内置项未覆盖的字体保留——否则本机字体分组会整个消失", () => {
    /*
     * 负向对照：若过滤规则写得太宽（例如"凡是 Windows 自带字体都排除"），
     * 本机分组会被清空，功能等于不存在，而上面的用例仍然全绿。
     * 这两个是本机实测枚举到的、确实不在内置表里的字体。
     */
    const out = newSystemFontsOnly(
      [
        { family: "Source Han Serif SC", display: "思源宋体 Heavy" },
        { family: "yyb", display: "yyb" },
      ],
      builtins,
    )
    expect(out.map((f) => f.family)).toEqual(["Source Han Serif SC", "yyb"])
  })

  it("第一段命中的字体被排除", () => {
    // "system" 项第一段就是 PingFang SC（macOS），在 Windows 上不存在，
    // 但若某台机器枚举出它，它应当被内置项吸收
    const out = newSystemFontsOnly([{ family: "PingFang SC", display: "苹方" }], builtins)
    expect(out).toEqual([])
  })

  it("大小写不同视为同一字体", () => {
    const out = newSystemFontsOnly([{ family: "PINGFANG SC", display: "苹方" }], builtins)
    expect(out).toEqual([])
  })

  it("重复族名只保留一个", () => {
    const out = newSystemFontsOnly(
      [
        { family: "Foo Sans", display: "甲" },
        { family: "foo sans", display: "乙" },
      ],
      [],
    )
    expect(out).toHaveLength(1)
    expect(out[0].family).toBe("Foo Sans")
  })

  it("不安全族名整条丢弃，不参与去重", () => {
    const out = newSystemFontsOnly(
      [
        { family: 'Bad"Name', display: "坏" },
        { family: "Good Sans", display: "好" },
      ],
      [],
    )
    expect(out.map((f) => f.family)).toEqual(["Good Sans"])
  })

  it("display 不安全时回退到族名，而不是丢弃整条", () => {
    // display 只用于展示，不进入 CSS，故不必因它丢掉一个可用字体
    const out = newSystemFontsOnly([{ family: "Good Sans", display: 'Bad"Label' }], [])
    expect(out).toEqual([{ family: "Good Sans", display: "Good Sans" }])
  })

  it("firstFamilyOfCssStack 正确取首段", () => {
    expect(firstFamilyOfCssStack('"Microsoft YaHei", "Microsoft JhengHei", sans-serif'))
      .toBe("microsoft yahei")
    // 无引号的首段也要能取到
    expect(firstFamilyOfCssStack("SimSun, serif")).toBe("simsun")
  })
})

describe("阶段 3：normalizeUiFontFamily 接受动态取值", () => {
  it("sys: 取值通过归一化", () => {
    expect(normalizeUiFontFamily("sys:霞鹜文楷")).toBe("sys:霞鹜文楷")
  })

  it("不安全或空的 sys: 取值回退默认档", () => {
    expect(normalizeUiFontFamily('sys:Foo"Bar')).toBe("system")
    expect(normalizeUiFontFamily("sys:")).toBe("system")
    expect(normalizeUiFontFamily("sys:   ")).toBe("system")
  })

  it("内置取值仍然不变——动态支持不得影响既有行为", () => {
    expect(normalizeUiFontFamily("microsoft-yahei")).toBe("microsoft-yahei")
    expect(normalizeUiFontFamily("arial")).toBe("system")
    expect(normalizeUiFontFamily(undefined)).toBe("system")
  })

  it("动态取值能生成实际可用的 CSS 栈", () => {
    const css = getUiFontFamilyCss("sys:霞鹜文楷")
    expect(css.startsWith('"霞鹜文楷"')).toBe(true)
    // 不得回退成内置默认栈（那等于"选了没反应"）
    expect(css).not.toBe(UI_FONT_OPTIONS[0].cssFamily)
  })

  it("内置取值生成的 CSS 与改造前逐字一致——零视觉回归", () => {
    for (const option of UI_FONT_OPTIONS) {
      expect(getUiFontFamilyCss(option.value)).toBe(option.cssFamily)
    }
  })
})
