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
import { UI_FONT_OPTIONS, normalizeUiFontFamily } from "@/lib/font-settings"
import { SYSTEM_FONT_PREFIX } from "@/lib/system-fonts"
import { BUNDLED_FONT_LICENSES } from "@/lib/bundled-font-licenses"

/*
 * React 19 需要这个全局，act(...) 才会正常工作且不刷警告。
 * 同目录另外三个手写 createRoot+act 的 spec 都设了它
 * （data-management-section / user-memory-section / uitest/ui-test-tools），
 * 这里原先漏了 —— 后果是每条用例都往 stderr 打
 * `The current testing environment is not configured to support act(...)`：
 * 测试仍然通过，但**真正的失败会被淹没在这堆噪声里**，
 * 而本文件恰恰有好几条"缺字段就会炸"的用例（见下方 Harness 的注释）。
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

/*
 * ── 为什么显著声明要能被测试改值 ──
 * 数据里 `prominentNotice` 当前是空字符串（随包字体全部为 OFL-1.1），
 * 所以真实渲染下界面上**没有**那个节点。若就此只断言"没有"，
 * 「显著声明一旦非空就必须留在折叠区之外」这条许可义务就**无从检验**了 ——
 * 而它正是当初把声明放在 `<details>` 之外的全部理由。
 *
 * 所以这里把该模块的那**一个**字符串换成可变的测试值，其余导出原样透传：
 * 渲染的仍是真实的 `InterfaceSection`，只有这个值被替换。
 * 默认值由 beforeEach 设回**数据文件里的真实值**，其它用例看到的仍是事实。
 */
const noticeHolder = vi.hoisted(() => ({ value: "" as string }))

vi.mock("@/lib/bundled-font-licenses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bundled-font-licenses")>()
  return {
    ...actual,
    get PROMINENT_FONT_NOTICE() {
      return noticeHolder.value
    },
  }
})

/** 真实数据源（未被 mock 的那个 JSON 文件）：用来把默认值设回事实。 */
const LICENSES_JSON = (await import("@/lib/bundled-font-licenses.json")).default as {
  prominentNotice: string
}

const { InterfaceSection } = await import("@/components/settings/sections/interface-section")

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  sysFonts.result = []
  sysFonts.error = null
  sysFonts.calls = 0
  // 默认按**事实**渲染：数据文件里 prominentNotice 是什么，界面就渲染什么
  noticeHolder.value = LICENSES_JSON.prominentNotice
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
      /*
       * 正文的 6 个字段仍然要给 —— 它们是 `SettingsDraft` 的必填字段，
       * 缺了会在别处（settings-view 的保存链路）类型不过。
       *
       * ⚠ 结尾那个 `as SettingsDraft` 会**关掉缺字段检查**，
       * 所以上面这 6 行必须手工给全、不能指望编译器提醒。
       * 这正是它值得写一句注释的原因：这个断言一旦被删掉，
       * 少了哪个字段都看不出来，只会得到一份悄悄少写一个键的草稿。
       *
       * ⚠ 另一件事理由已经变了：原先这里写的是"缺了会让共享组件在
       * `value.lineHeight.toFixed(2)` 处抛异常，整块控件渲染不出来"。
       * 那是对的 —— 当时正文字体控件确实渲染在这个页面里。
       * 用户要求把这 6 项移出设置页之后，`InterfaceSection` 已经**不再**
       * 渲染 `BodyTypographyFields`，所以现在缺字段也不会在这里抛。
       * 这句注释若不改，下一个人会以为"本页面还在渲染那 6 个控件"，
       * 进而以为"设置页移除"这件事没做完。
       */
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

  /**
   * 去重不对称的**另一半**（另一半在 body-typography-fields.spec.tsx）。
   *
   * `Source Han Serif SC` 是正文内置项 `source-han-serif` 的第一段，
   * 却不是任何界面内置项的第一段。所以：
   *   · 界面下拉 —— 界面表没有它 → **应当出现**（本用例）；
   *   · 正文下拉 —— 正文表已有它 → 应当被去重（在控件那个文件里）。
   *
   * 这两半分开守在两个文件里，是本轮"控件搬家"的直接后果：
   * 界面下拉还在设置页，正文下拉已经搬到控件里。
   * 两半都在，才是原来那条"不能共用一份过滤结果"的完整判据；
   * 任何一半单独存在都只能证明一半，所以两边都写了注释互相指路。
   */
  it("正文内置表已覆盖的本机字体，在界面下拉里仍须出现（去重不对称的另一半）", async () => {
    sysFonts.result = [{ family: "Source Han Serif SC", display: "Source Han Serif Heavy" }]
    await renderSection()
    const inUi = Array.from(fontSelect().querySelectorAll("option")).map((o) => o.value)
    expect(
      inUi,
      "界面内置表没有这个族名，界面下拉就该出现它；缺了说明去重借用了正文表",
    ).toContain(`${SYSTEM_FONT_PREFIX}Source Han Serif SC`)
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
     * 为什么现在是 1（而正文控件在设置页时是 2）：正文字体下拉已经**移出**本页面
     * （用户要求：那 6 项属于章节，不属于全局设置），于是本页面只剩界面字体
     * 下拉一个 `useSystemFonts` 消费者。真实 `loadSystemCjkFonts` 是模块级缓存，
     * 即便有第二个消费者也不会真的再跨一次 IPC —— 所以这个数字测的其实是
     * "本页面有几个消费者"。
     *
     * 断言仍取**精确值**：上面刚触发过一次与字体无关的状态变更，
     * 若哪个 effect 的依赖数组写错，计数会超过 1 而变红；
     * 若有人把正文控件又搬回设置页，计数会变成 2，同样变红 ——
     * 这正是我们想要的（见下面「设置页不得再出现这 6 项」那条）。
     */
    expect(sysFonts.calls).toBe(1)
  })

  /**
   * ── 设置页不得再出现那 6 项（用户第 3 条要求）──
   *
   * 用户原话：「设置当中显示的『正文字体、正文字号、行间距、字间距、左右边距、
   * 底部安全距离』这些内容，完全不需要放在这里」。
   *
   * ── 为什么必须用"渲染 + 查询"而不是源码文本断言 ──
   * 文本断言（`expect(src).not.toContain("BodyTypographyFields")`）有两个洞：
   *   · 组件换个名字、或改成内联 JSX 就会漏；
   *   · 而它照样会为一句**注释**报红（源码里正解释着"这 6 项已移走"）。
   * 这里直接渲染真实组件再查 DOM，问的是"用户看得见吗"，
   * 而不是"源码里出现过这个字符串吗"。
   *
   * 逐项断言而不是只查根节点：只查 `.body-font-fields` 会被
   * "共用组件被拆成 6 个内联控件"绕过 —— 那时根节点不在，
   * 但 6 项全都还在页面上。
   */
  it("设置页不再渲染正文字体与 5 个排版参数（它们属于章节，不属于全局设置）", async () => {
    sysFonts.result = [{ family: "yyb", display: "yyb" }]
    await renderSection()

    for (const label of ["正文字体", "正文字号预设", "正文字号", "行间距", "字间距", "左右边距", "底部安全距离"]) {
      expect(
        container.querySelector(`[aria-label="${label}"]`),
        `设置页不该再有「${label}」控件——它已移到章节工具栏的「字体设置」浮层`,
      ).toBeNull()
    }
    /*
     * ⚠ `[data-ui="interface-fields"]` 这个容器**必须还在** —— 它现在装的是
     * 界面字体与界面字号（那两个留下来了）。所以不能像初稿那样断言
     * "容器不存在"：那条断言会把"正确地只留界面项"报成错误。
     * 正确的判据是问**容器里装了什么**：只该有两行，且没有任何正文控件。
     */
    const fields = container.querySelector('[data-ui="interface-fields"]')
    expect(fields, "界面的字体/字号控件组必须还在（别把整块删掉）").not.toBeNull()
    expect(
      fields!.querySelectorAll(".ui-test-interface-row").length,
      "设置页的控件组应当只剩界面字体与界面字号两行",
    ).toBe(2)
    expect(
      fields!.querySelector(".body-font-fields"),
      "设置页的控件组里不得再有正文排版控件",
    ).toBeNull()

    /*
     * 反向控制：上面那一串 toBeNull 必须**不是恒真**的。
     * 把一个同名的控件塞进容器，同一个选择器必须能命中它 ——
     * 否则哪怕查询写错（比如选择器拼错），这些断言也会全绿。
     */
    const probe = document.createElement("input")
    probe.setAttribute("aria-label", "底部安全距离")
    container.appendChild(probe)
    expect(
      container.querySelector('[aria-label="底部安全距离"]'),
      "反向控制：选择器必须能命中真实存在的控件，否则上面的断言没有鉴别力",
    ).not.toBeNull()
    probe.remove()

    // 而界面自己的字号必须**还在** —— 别把"移除正文项"做成了"整块删掉"
    expect(container.querySelector('input[aria-label="界面字号"]'), "界面字号不能被一起删掉").not.toBeNull()
    expect(container.querySelector('select[aria-label="界面字体"]'), "界面字体不能被一起删掉").not.toBeNull()
  })
})

/*
 * ── 「正文字体下拉的本机分组」那一组已**整体搬到**
 *    `body-typography-fields.spec.tsx` ──
 *
 * 它测的是正文字体下拉的本机分组 / 去重不对称 / 归一化路径。
 * 那几件事一条没少，但正文字体下拉现在只存在于共享控件里，
 * 而设置页不再渲染那个控件 —— 留在本文件里只会得到一堆
 * "找不到正文字体下拉"的红，或者（更糟）被顺手删掉。
 * 所以是**搬家**：判据在 `describe("正文字体下拉的本机分组")` 里继续生效。
 *
 * 界面字体下拉的对应判据仍留在这里（界面字体还在这页上）。
 */

describe("随包字体的第三方许可告知", () => {
  /**
   * ── 这个区块里有两种东西，义务不同 ──
   *   ① **版权清单**（折叠区里那一串）：OFL-1.1 要求保留版权声明，
   *      界面上给一个可展开的入口满足"用户能看到"。
   *   ② **显著声明**（`data-ui="prominent-font-notice"`）：只有随包字体里
   *      **存在非 OFL 字体**时才需要 —— 那种许可强制要求
   *      `make a prominent notice in the software to state that ... are used.`，
   *      关键词是 **in the software**，所以它必须在界面上，而且不许折进折叠区。
   *
   * 当前随包字体全部为 OFL-1.1（8 款族 / 10 个字重文件），故显著声明**不渲染**：
   * 渲染一句"本软件使用了某字体"就是「告知与事实不符」。
   * 下面两个方向都测 —— 数据为空 ⇒ 界面上没有那个节点；
   * 数据非空 ⇒ 那个节点必须出现且留在折叠区之外（用 mock 出的非空值做正向对照，
   * 否则第二条会退化成 `details.contains(null) === false` 的恒真断言）。
   */
  const notice = () => container.querySelector('[data-ui="prominent-font-notice"]')

  it("渲染了许可告知区", async () => {
    await renderSection()

    const section = container.querySelector('[data-ui="bundled-font-licenses"]')
    expect(section, "界面上没有随包字体许可告知区").not.toBeNull()
  })

  it("随包字体全部为 OFL-1.1 ⇒ 界面不渲染显著声明（不出现与事实不符的告知）", async () => {
    // 先钉住数据这一侧：数据非空时下面的界面断言无从谈起
    expect(
      LICENSES_JSON.prominentNotice.trim(),
      "数据里的 prominentNotice 已非空 —— 这条用例的前提变了，请按新事实重写",
    ).toBe("")

    await renderSection()

    expect(
      notice(),
      "随包字体里没有非 OFL 字体，界面上不该出现显著声明 —— 一句『本软件使用了某字体』"
      + "就是告知与事实不符",
    ).toBeNull()
  })

  it("8 款族全部列出，且每款都带版权行", async () => {
    await renderSection()
    const items = container.querySelectorAll('[data-ui="bundled-font-license-list"] li')
    expect(items).toHaveLength(BUNDLED_FONT_LICENSES.length)
    expect(items.length).toBe(8)

    // 逐条核对：显示名与版权行都要真的渲染出来，不能只列个名字
    const rendered = Array.from(items).map((li) => li.textContent ?? "")
    for (const font of BUNDLED_FONT_LICENSES) {
      const hit = rendered.some((t) => t.includes(font.display) && t.includes(font.copyright))
      expect(hit, `${font.display} 的版权行没有渲染出来：${font.copyright}`).toBe(true)
    }
  })

  it("告知的位置不依赖用户已选字体——默认设置下也必须可见", async () => {
    // 用默认草稿（uiFontFamily = "system"）渲染，告知区仍须出现。
    // 若把它塞进某个"仅在选了随包字体时才展开"的分支里，许可义务就落空了。
    await renderSection()
    expect(container.querySelector('[data-ui="bundled-font-licenses"]')).not.toBeNull()
    expect(fontSelect().value).toBe("system")
  })

  /**
   * ── 版权清单默认收起（用户第 1 条要求）──
   *
   * 用户原话：「这些不需要显示出来，隐藏起来」—— 指的是那串版权文字。
   * 清单必须**仍在界面里可达**（可展开）：OFL 要求保留版权声明，
   * 随包的 `fonts/licenses/` 满足"保留"，界面上这个入口满足"能看到"。
   */
  it("版权清单默认收起，但仍在折叠区内可达", async () => {
    await renderSection()

    const details = container.querySelector<HTMLDetailsElement>('[data-ui="bundled-font-license-details"]')
    expect(details, "版权清单应当包在一个可展开的 <details> 里（默认收起）").not.toBeNull()
    expect(details!.open, "版权清单必须**默认收起**——用户要求隐藏起来").toBe(false)

    // 清单确实在折叠区内（不是折叠了一个空壳）
    expect(
      details!.querySelector('[data-ui="bundled-font-license-list"]'),
      "许可清单必须在折叠区内，否则收起的就不是这些内容",
    ).not.toBeNull()
  })

  it("正向对照：显著声明一旦非空，必须渲染，且在默认收起的折叠区之外", async () => {
    /*
     * 这条是上一条「不渲染」的**反向控制**，也是许可义务的形状本身。
     *
     * 为什么不能省：当前数据为空，界面上没有那个节点，于是
     * 「显著声明不能被折进 <details>」只能用 `details.contains(null) === false`
     * 来"证明" —— 那在渲染位被整个删掉时**照样为真**。所以这里把声明置为非空
     * 再渲染一次，要求两件事同时成立：
     *   ① 它真的出现在界面上（渲染位还在，代码没被删）；
     *   ② 它不在那个默认收起的 <details> 里（折起来 = 用户看不到 = 义务没履行）。
     * 只断言 ① 是不够的 —— 把声明塞进 <details>，① 照样绿。
     */
    noticeHolder.value = "本软件内置并使用「示例专有字体」。"
    await renderSection()

    expect(notice(), "声明非空时界面必须渲染它 —— 渲染位可能已被删掉").not.toBeNull()
    expect(notice()!.textContent).toContain("示例专有字体")

    const details = container.querySelector<HTMLDetailsElement>('[data-ui="bundled-font-license-details"]')!
    expect(details, "版权清单的折叠区应当仍在").not.toBeNull()

    /*
     * 用 contains 判包含关系，而不是"notice 存在"——后者在声明被
     * 挪进 <details> 之后照样通过，正是这条要抓的错法。
     */
    expect(
      details.contains(notice()),
      "显著声明**不能**放进默认收起的折叠区：非 OFL 字体的许可要求该声明"
      + "出现在软件中，折起来就等于没显示",
    ).toBe(false)

    // 反向控制：contains 判据本身要有鉴别力 —— 折一个真实存在于折叠区内的
    // 元素进去，同一个断言必须翻转。否则"不在里面"可能是恒真的。
    const strip = details.querySelector('[data-ui="bundled-font-license-list"]')!
    expect(
      details.contains(strip),
      "反向控制：折叠区确实包含自己的清单，说明 contains 判据有鉴别力",
    ).toBe(true)
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
