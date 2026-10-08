// @vitest-environment jsdom
/**
 * 阶段 3：界面字体下拉里的「本机中文字体」分组。
 *
 * ── 为什么这个文件必须存在 ──
 * `ui-test-tools.spec.tsx` 里那条
 * `Array.from(font.options).map(v).toEqual(UI_FONT_OPTIONS.map(v))` 在本机是**假绿**：
 * jsdom 里 `isTauri()` 为 false，所以枚举根本不发生、分组也不渲染，
 * 那条断言无论我把分组代码写成什么样都会通过 —— 包括把它整个删掉。
 * 这里显式喂入枚举结果，才真正测到"分组会渲染、值可持久化、不安全项被挡"。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import type { SettingsDraft } from "@/components/settings/settings-types"
import { DEFAULT_SIDEBAR_NAV_CONFIG } from "@/lib/sidebar-nav-preferences"
import { UI_FONT_OPTIONS, BODY_FONT_OPTIONS, getBodyFontFamilyCss, normalizeBodyFontFamily, normalizeUiFontFamily } from "@/lib/font-settings"
import { SYSTEM_FONT_PREFIX } from "@/lib/system-fonts"
import { BUNDLED_FONT_LICENSES } from "@/lib/bundled-font-licenses"

/** 本机字体枚举的假结果，由各用例覆盖。 */
const sysFonts = vi.hoisted(() => ({
  result: [] as { family: string; display: string }[],
  error: null as string | null,
  calls: 0,
}))

vi.mock("@/lib/system-fonts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/system-fonts")>()),
  loadSystemCjkFonts: async () => {
    sysFonts.calls += 1
    return { fonts: sysFonts.result, error: sysFonts.error }
  },
}))

const { InterfaceSection } = await import("@/components/settings/sections/interface-section")

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  sysFonts.result = []
  sysFonts.error = null
  sysFonts.calls = 0
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** 渲染真实的 InterfaceSection（保留真实 setDraft 状态更新）。 */
async function renderSection() {
  function Harness() {
    const [draft, setDraft] = useState<SettingsDraft>({
      uiLanguage: "zh",
      uiFontFamily: "system",
      uiFontSizeScale: 1,
      // 正文的 6 个字段也必须给：缺了会让字号/行距算出 NaN、
      // 正文字体下拉拿到 undefined，在 jsdom 里刷一堆与本测试无关的告警，
      // 从而把真正的失败淹没掉
      uiBodyFontFamily: "serif-default",
      uiBodyFontPx: 18,
      uiBodyLineHeight: 1.95,
      uiBodyLetterSpacing: 0,
      uiBodyMarginX: null,
      uiBodySafeBottom: 51,
      visualStyle: "fangzheng",
      sidebarNavConfig: DEFAULT_SIDEBAR_NAV_CONFIG,
    } as SettingsDraft)
    return (
      <InterfaceSection
        draft={draft}
        setDraft={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
      />
    )
  }
  await act(async () => { root.render(<Harness />) })
  // 让枚举的 promise 结算并触发一次重渲染
  await act(async () => { await Promise.resolve() })
}

function fontSelect(): HTMLSelectElement {
  const el = container.querySelector<HTMLSelectElement>('select[aria-label="界面字体"]')
  if (!el) throw new Error("找不到界面字体下拉")
  return el
}

describe("阶段 3：本机中文字体分组", () => {
  it("枚举到字体时渲染分组，值是 sys: 前缀", async () => {
    sysFonts.result = [
      { family: "Source Han Serif SC", display: "思源宋体" },
      { family: "yyb", display: "yyb" },
    ]
    await renderSection()

    const groups = fontSelect().querySelectorAll("optgroup")
    expect(Array.from(groups).map((g) => g.label)).toEqual(["推荐", "本机中文字体"])

    const sysGroup = Array.from(groups).find((g) => g.label === "本机中文字体")!
    const options = Array.from(sysGroup.querySelectorAll("option"))
    expect(options.map((o) => o.value)).toEqual([
      `${SYSTEM_FONT_PREFIX}Source Han Serif SC`,
      `${SYSTEM_FONT_PREFIX}yyb`,
    ])
    // 展示名用 display，不是族名
    expect(options.map((o) => o.textContent)).toEqual(["思源宋体", "yyb"])
  })

  it("没枚举到字体时不渲染空分组——空分组会被误读成「本机没有中文字体」", async () => {
    sysFonts.result = []
    await renderSection()
    expect(fontSelect().querySelectorAll("optgroup")).toHaveLength(1)
    expect(fontSelect().querySelector("optgroup")!.label).toBe("推荐")
  })

  it("枚举失败时显示原因，而不是假装「没有中文字体」", async () => {
    sysFonts.error = "中文字体枚举目前仅实现 Windows（DirectWrite）"
    await renderSection()
    expect(container.textContent).toContain("未能读取本机字体")
    expect(container.textContent).toContain("DirectWrite")
  })

  it("不安全的族名不进下拉——选项值直接决定喂给 CSS 的族名", async () => {
    sysFonts.result = [
      { family: 'Bad"Name', display: "注入" },
      { family: "Good Sans", display: "好" },
    ]
    await renderSection()
    const values = Array.from(fontSelect().querySelectorAll("option")).map((o) => o.value)
    expect(values).toContain(`${SYSTEM_FONT_PREFIX}Good Sans`)
    expect(values.some((v) => v.includes("Bad"))).toBe(false)
  })

  it("选中本机字体后走真实的归一化路径——不会被当成非法值退回默认档", async () => {
    sysFonts.result = [{ family: "Source Han Serif SC", display: "思源宋体" }]
    await renderSection()

    const select = fontSelect()
    const target = `${SYSTEM_FONT_PREFIX}Source Han Serif SC`
    await act(async () => {
      select.value = target
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })

    /*
     * 关键断言：受控组件的 value 必须真的变成选中的那个。
     * 若 normalizeUiFontFamily 不认 sys: 取值，这里会看到 value 弹回 "system"
     * —— 界面上就是"选了又跳回去"，正是本次要根除的病症。
     */
    expect(fontSelect().value).toBe(target)
    expect(normalizeUiFontFamily(target)).toBe(target)
  })

  it("推荐分组的取值与内置选项逐字一致——不得改动既有下拉内容", async () => {
    sysFonts.result = [{ family: "yyb", display: "yyb" }]
    await renderSection()
    const recommended = fontSelect().querySelector('optgroup[label="推荐"]')!
    expect(Array.from(recommended.querySelectorAll("option")).map((o) => o.value))
      .toEqual(UI_FONT_OPTIONS.map((o) => o.value))
  })

  it("枚举次数与重渲染无关——设置页重渲染不得反复跨 IPC 枚举", async () => {
    sysFonts.result = [{ family: "yyb", display: "yyb" }]
    await renderSection()
    // 触发一次与字体无关的状态变更（切换字号）
    const range = container.querySelector<HTMLInputElement>('input[aria-label="界面字号"]')!
    await act(async () => {
      range.value = "120"
      range.dispatchEvent(new Event("change", { bubbles: true }))
    })
    /*
     * effect 无依赖 + 模块级缓存 ⇒ 每个消费者挂载时请求一次，此后与重渲染无关。
     *
     * 为什么是 2 而不是 1：正文字体控件搬进共享组件 `BodyTypographyFields`
     * 之后，设置页有**两个** useSystemFonts 消费者 —— 界面字体下拉在本文件、
     * 正文字体下拉在共享组件里，各自挂载一次。真实 `loadSystemCjkFonts`
     * 是模块级缓存，第二次调用不会真的再跨一次 IPC。
     * 断言仍取**精确值**：上面刚触发过一次与字体无关的状态变更，
     * 若哪个 effect 的依赖数组写错，计数会超过 2 而变红。
     */
    expect(sysFonts.calls).toBe(2)
  })
})

function bodySelect(): HTMLSelectElement {
  const el = container.querySelector<HTMLSelectElement>('select[aria-label="正文字体"]')
  if (!el) throw new Error("找不到正文字体下拉")
  return el
}

describe("阶段 3：正文字体下拉的本机分组", () => {
  it("正文字体下拉也有本机中文字体分组，值同样是 sys: 前缀", async () => {
    sysFonts.result = [{ family: "yyb", display: "yyb" }]
    await renderSection()
    const groups = bodySelect().querySelectorAll("optgroup")
    expect(Array.from(groups).map((g) => g.label)).toEqual(["推荐", "本机中文字体"])
    const sysGroup = Array.from(groups).find((g) => g.label === "本机中文字体")!
    expect(Array.from(sysGroup.querySelectorAll("option")).map((o) => o.value))
      .toEqual([`${SYSTEM_FONT_PREFIX}yyb`])
  })

  it("推荐分组的取值与内置正文字体选项逐字一致", async () => {
    sysFonts.result = [{ family: "yyb", display: "yyb" }]
    await renderSection()
    const recommended = bodySelect().querySelector('optgroup[label="推荐"]')!
    expect(Array.from(recommended.querySelectorAll("option")).map((o) => o.value))
      .toEqual(BODY_FONT_OPTIONS.map((o) => o.value))
  })

  it("两个下拉各自按自己的内置表去重——不能共用一份过滤结果", async () => {
    /*
     * 这是本文件最重要的一条断言，钉住一个真实存在的不对称：
     *   `Source Han Serif SC` 是**正文**内置项（source-han-serif）的第一段，
     *   却不是任何**界面**内置项的第一段。
     * 若两个下拉共用同一份去重结果（例如都用界面表过滤），
     * 正文下拉就会多出一个与内置「思源宋体」重复的项 / 或者界面下拉缺一项。
     * 本机实测确实装着这个字体（枚举结果里就有），所以这不是假想的边界。
     */
    sysFonts.result = [{ family: "Source Han Serif SC", display: "Source Han Serif Heavy" }]
    await renderSection()

    const inUi = Array.from(fontSelect().querySelectorAll("option")).map((o) => o.value)
    const inBody = Array.from(bodySelect().querySelectorAll("option")).map((o) => o.value)
    const value = `${SYSTEM_FONT_PREFIX}Source Han Serif SC`

    // 界面内置表没有它 → 界面下拉里应当出现
    expect(inUi).toContain(value)
    // 正文内置表已有「思源宋体」→ 正文下拉里应当被去重
    expect(inBody).not.toContain(value)
    // 但正文的内置项本身仍在
    expect(inBody).toContain("source-han-serif")
  })

  it("选中本机正文字体后走真实归一化路径——不会弹回默认档", async () => {
    /*
     * 用 `LXGW WenKai`（霞鹜文楷，本项目的随包字体之一）：
     * 它不在正文内置表里，所以**确实会**出现在正文下拉中，可以被选中。
     * ⚠️ 不能用 `Source Han Serif SC` —— 它已被正文内置项
     * `source-han-serif` 覆盖，按设计会被去重掉（见上一条用例），
     * 于是"选中它"这个动作根本不可能发生。
     */
    sysFonts.result = [{ family: "LXGW WenKai", display: "霞鹜文楷" }]
    await renderSection()
    const select = bodySelect()
    const target = `${SYSTEM_FONT_PREFIX}LXGW WenKai`
    // 前提自检：它必须真的在选项里，否则下面的断言是"选一个不存在的值"
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.value)).toContain(target)
    await act(async () => {
      select.value = target
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(bodySelect().value).toBe(target)
    expect(normalizeBodyFontFamily(target)).toBe(target)
  })

  it("正文本机字体的 CSS 栈以衬线收尾——卸载后不能掉到黑体", async () => {
    const css = getBodyFontFamilyCss("sys:霞鹜文楷")
    expect(css.startsWith('"霞鹜文楷"')).toBe(true)
    // 正文默认是宋体系；掉到 sans-serif 会让整篇小说静默换字形
    expect(css.trim().endsWith("serif")).toBe(true)
    expect(css.trim().endsWith("sans-serif")).toBe(false)
  })
})

describe("随包字体的第三方许可告知（鸿蒙黑体的许可强制义务）", () => {
  /**
   * 鸿蒙黑体的许可要求"在软件中显著注明使用了 HarmonyOS Sans"。
   * 这几条断言的是**界面上真的有这句话**，而不只是数据文件里有 ——
   * 数据正确但没渲染出来，许可义务照样没履行。
   */
  const notice = () => container.querySelector('[data-ui="harmonyos-notice"]')

  it("渲染了许可告知区，且显著声明出现在界面上", async () => {
    await renderSection()

    const section = container.querySelector('[data-ui="bundled-font-licenses"]')
    expect(section, "界面上没有随包字体许可告知区").not.toBeNull()

    expect(notice(), "没有渲染鸿蒙黑体的显著声明").not.toBeNull()
    // 必须点名 HarmonyOS Sans（只说"用了鸿蒙黑体"不够，许可是按英文名写的）
    expect(notice()!.textContent).toMatch(/HarmonyOS Sans/i)
  })

  it("9 款族全部列出，且每款都带版权行", async () => {
    await renderSection()
    const items = container.querySelectorAll('[data-ui="bundled-font-license-list"] li')
    expect(items).toHaveLength(BUNDLED_FONT_LICENSES.length)
    expect(items.length).toBe(9)

    // 逐条核对：显示名与版权行都要真的渲染出来，不能只列个名字
    const rendered = Array.from(items).map((li) => li.textContent ?? "")
    for (const font of BUNDLED_FONT_LICENSES) {
      const hit = rendered.some((t) => t.includes(font.display) && t.includes(font.copyright))
      expect(hit, `${font.display} 的版权行没有渲染出来：${font.copyright}`).toBe(true)
    }
  })

  it("告知的位置不依赖用户已选字体——默认设置下也必须可见", async () => {
    // 用默认草稿（uiFontFamily = "system"）渲染，声明仍须出现。
    // 若把它塞进某个"仅在选了随包字体时才展开"的分支里，许可义务就落空了。
    await renderSection()
    expect(notice()).not.toBeNull()
    expect(fontSelect().value).toBe("system")
  })

  it("告知是纯展示，不往 draft 里写任何字段——不得改动设置保存流程", async () => {
    const written: string[] = []
    function Harness() {
      const [draft, setDraft] = useState<SettingsDraft>({
        uiLanguage: "zh",
        uiFontFamily: "system",
        uiFontSizeScale: 1,
        uiBodyFontFamily: "serif-default",
        uiBodyFontPx: 18,
        uiBodyLineHeight: 1.95,
        uiBodyLetterSpacing: 0,
        uiBodyMarginX: null,
        uiBodySafeBottom: 51,
        visualStyle: "fangzheng",
        sidebarNavConfig: DEFAULT_SIDEBAR_NAV_CONFIG,
      } as SettingsDraft)
      return (
        <InterfaceSection
          draft={draft}
          setDraft={(key, value) => {
            written.push(String(key))
            setDraft((current) => ({ ...current, [key]: value }))
          }}
        />
      )
    }
    await act(async () => { root.render(<Harness />) })
    await act(async () => { await Promise.resolve() })

    // 只渲染、不交互 ⇒ 不应有任何 setDraft 调用
    expect(written).toEqual([])
  })
})
