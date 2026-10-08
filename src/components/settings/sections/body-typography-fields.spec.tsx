// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  BodyTypographyFields,
  type BodyTypographyValue,
} from "@/components/settings/sections/body-typography-fields"
// 兜底边距不在这里定义，它和其余范围常量同住 font-settings（单一来源）。
// 本文件测的是"控件用了它"，不是"它算得对"——后者已在任务 1 的
// font-settings.spec.ts 里测过，不要在这里再抄一遍期望值。
import {
  BODY_FONT_PX_MIN,
  BODY_FONT_PX_MAX,
  BODY_LINE_HEIGHT_MIN,
  BODY_LINE_HEIGHT_MAX,
  BODY_LETTER_SPACING_MIN,
  BODY_LETTER_SPACING_MAX,
  BODY_MARGIN_X_MIN,
  BODY_MARGIN_X_MAX,
  BODY_SAFE_BOTTOM_MIN,
  BODY_SAFE_BOTTOM_MAX,
  defaultBodyMarginXForViewport,
} from "@/lib/font-settings"

/*
 * React 19 需要这个全局，act(...) 才会正常工作且不刷警告。
 * 同目录另外四个手写 createRoot+act 的 spec 都设了它
 * （data-management-section / user-memory-section / interface-section /
 *  uitest/ui-test-tools），这个文件原先漏了 —— 每条用例都会往 stderr 打
 * `The current testing environment is not configured to support act(...)`。
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const BASE: BodyTypographyValue = {
  fontFamily: "serif-default",
  fontPx: 18,
  lineHeight: 1.95,
  letterSpacing: 0,
  marginX: null,
  safeBottom: 51,
}

/*
 * 这个回调类型必须与控件 prop 上的**泛型**签名同形。
 *
 * 不能写成 `onChange = () => {}` 让 TS 自己推断 —— 那样推断出来的是
 * `() => void`，于是每个 `render(BASE, (key, next) => …)` 都会变成
 * 「目标签名参数太少」的类型错误，而且 `key` / `next` 会落到隐式 any。
 * （任务简报原稿就是裸默认值，`npm run typecheck:tests` 会因此报错。）
 */
type ChangeHandler = <K extends keyof BodyTypographyValue>(
  key: K,
  next: BodyTypographyValue[K],
) => void

/*
 * dense 必须**可选**地传：写成 `dense={dense}` 会让每次渲染都显式传值，
 * 于是组件自己的默认值（dense = false）永远走不到 —— 变异验证实测：
 * 把默认值改成 true，全部用例照样绿（M12）。调用方（设置页，任务 9）是
 * **省略**这个 prop 的，所以"省略时表现为非紧凑"必须真的被覆盖。
 * 用条件展开而不是 `dense={dense ?? false}`：后者同样会把默认值架空。
 */
function render(value: BodyTypographyValue, onChange: ChangeHandler = () => {}, dense?: boolean) {
  act(() => {
    root.render(
      <BodyTypographyFields
        value={value}
        onChange={onChange}
        idPrefix="t"
        {...(dense === undefined ? {} : { dense })}
      />,
    )
  })
  return container
}

function input(label: string) {
  const el = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!el) throw new Error(`找不到控件：${label}`)
  return el
}

/** jsdom 下的 React onChange：必须用原生 setter 再派发 input 事件。 */
function setRange(el: HTMLInputElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
  setter?.call(el, next)
  act(() => { el.dispatchEvent(new window.Event("input", { bubbles: true })) })
}

// 注意：这里不再单独测「兜底边距算得对不对」—— 那是 font-settings 的
// 职责，已在任务 1 的 font-settings.spec.ts 里用字面量钉住。
// 本文件只负责证明「控件用的确实是那一个来源」。

describe("BodyTypographyFields", () => {
  it("6 个参数各有一个可访问的控件，标签互不重复", () => {
    render(BASE)
    for (const label of ["正文字体", "正文字号预设", "正文字号", "行间距", "字间距", "左右边距", "底部安全距离"]) {
      const found = container.querySelectorAll(`[aria-label="${label}"]`)
      // ① 存在性
      expect(found.length, `缺少控件：${label}`).toBeGreaterThan(0)
      /*
       * ② 唯一性 —— 标题承诺的"互不重复"。
       * 原稿只做 querySelector + not.toBeNull()，那是**只查存在性**：
       * 变异验证实测（M11b：把 aria-label="正文字体" 也挂到根 div 上，
       * 7 个标签一个不少），8 条用例**全绿** —— 重复完全抓不住。
       * 重复的 aria-label 会让读屏用户听到两个同名控件、也让测试的
       * 选择器变得不确定，所以这条补上。
       */
      expect(found.length, `标签重复：${label} 匹配到 ${found.length} 个元素`).toBe(1)
    }
  })

  /*
   * 这一条**不在任务的 6 条里**，是我补的（本文件因此是 7 条，不是 6 条）。
   * 理由：简报那 6 条里没有一条能抓住根节点 data-ui 被改名 ——
   * 变异验证实测（M9：把它换成 data-ui="body-typography-fields"，同时跳过本条），
   * 简报的 6 条**全绿**。而它的后果正是本任务要防的腐坏：
   * ui-test-tools.css 里 ui-test-interface-row / -size / label / p / select / range
   * 的样式全部是 [data-ui="interface-fields"] 的后代选择器
   * （ui-test-tools.css:1851 / 1858 / 1862 / 1868 / 1880 / 1886），
   * 改名后设置页与写作现场浮层的布局与字号会**静默全丢**，没有任何用例会红。
   */
  it("根元素保留 data-ui=\"interface-fields\"，样式所依赖的类名挂在它的后代上", () => {
    render(BASE)
    const host = container.querySelector('[data-ui="interface-fields"]')
    expect(
      host,
      '根元素缺少 data-ui="interface-fields"，ui-test-tools.css 里的两列/滑块样式会全部失效',
    ).not.toBeNull()
    // 属性留着还不够：那两个类名必须真的出现在它的后代里，否则同样拿不到样式
    expect(host?.querySelector(".ui-test-interface-row")).not.toBeNull()
    expect(host?.querySelector(".ui-test-interface-size")).not.toBeNull()
  })

  /*
   * 这一条也不在任务的 6 条里。变异验证实测：把 `dense` 的默认值从 false 改成
   * true（M12）、或把 `dense ? null : <p>{hint}</p>` 里的分支删掉（M15），
   * 任务的 6 条**全绿**。而 dense 是写作现场浮层（任务 11）唯一的高度开关：
   * 它失灵时浮层会带着 5 段说明文字挤在预览区里，没有任何用例会红。
   */
  it("dense 模式省掉说明段落，但控件一个不少", () => {
    /*
     * 刻意**不**把选择器限定成 [data-ui="interface-fields"] p：那样一来
     * 根节点的 data-ui 被改名时，这条会以"非紧凑模式应当有说明段落"报红 ——
     * 把一个属性改名说成 dense 失灵（变异验证实测 M9a 确实如此）。
     * 每条用例只该为自己的那件事报红，所以这里按文档作用域数 <p>。
     */
    const hints = () => container.querySelectorAll("p").length

    render(BASE)
    expect(hints(), "非紧凑模式应当有说明段落").toBeGreaterThan(0)

    render(BASE, () => {}, true)
    expect(hints(), "紧凑模式应当省掉所有说明段落").toBe(0)
    // 省说明不能连控件一起省：浮层里 6 个参数必须照旧可操作
    for (const label of ["正文字体", "正文字号预设", "正文字号", "行间距", "字间距", "左右边距", "底部安全距离"]) {
      expect(container.querySelector(`[aria-label="${label}"]`), `紧凑模式缺少控件：${label}`).not.toBeNull()
    }
    // 显示值那一行不能被当成"说明段落"一起省掉，否则用户拖动时看不到当前值
    expect(container.querySelector('[data-ui-typography-value="左右边距"]')?.textContent).toBe("跟随窗口")
  })

  it("6 个滑块的范围与单一来源常量一致（不在组件里重写数字）", () => {
    render(BASE)
    const cases: [string, string, string][] = [
      ["正文字号", String(BODY_FONT_PX_MIN), String(BODY_FONT_PX_MAX)],
      ["行间距", String(BODY_LINE_HEIGHT_MIN), String(BODY_LINE_HEIGHT_MAX)],
      ["字间距", String(BODY_LETTER_SPACING_MIN), String(BODY_LETTER_SPACING_MAX)],
      ["左右边距", String(BODY_MARGIN_X_MIN), String(BODY_MARGIN_X_MAX)],
      ["底部安全距离", String(BODY_SAFE_BOTTOM_MIN), String(BODY_SAFE_BOTTOM_MAX)],
    ]
    for (const [label, min, max] of cases) {
      const el = input(label)
      expect(el.min, label).toBe(min)
      expect(el.max, label).toBe(max)
    }

    /*
     * 光比属性值还不够 —— 上面那一段只能抓住"常量本身被改了"，
     * 抓不住标题承诺的"不在组件里重写数字"：
     * 把 min={BODY_LINE_HEIGHT_MIN} 改成 min={1.2} 时，
     * 只要 1.2 恰好等于 BODY_LINE_HEIGHT_MIN，属性比较照样通过。
     * 所以再补一条源码文本守卫：这个组件里不许出现字面量 min=/max=。
     * （与 Task 9 守 interface-section.tsx 的手法一致。）
     */
    const source = readFileSync(resolve(__dirname, "body-typography-fields.tsx"), "utf8")
    for (const [prop, constName] of [
      ["min", "BODY_FONT_PX_MIN"], ["max", "BODY_FONT_PX_MAX"],
      ["min", "BODY_LINE_HEIGHT_MIN"], ["max", "BODY_LINE_HEIGHT_MAX"],
      ["min", "BODY_LETTER_SPACING_MIN"], ["max", "BODY_LETTER_SPACING_MAX"],
      ["min", "BODY_MARGIN_X_MIN"], ["max", "BODY_MARGIN_X_MAX"],
      ["min", "BODY_SAFE_BOTTOM_MIN"], ["max", "BODY_SAFE_BOTTOM_MAX"],
    ]) {
      expect(source, `范围必须引用 ${constName} 而不是写字面量`).toContain(`${prop}={${constName}}`)
    }
  })

  it("拖动滑块把新值交给调用方，且只交自己那一个键", () => {
    const seen: [string, unknown][] = []
    render(BASE, (key, next) => { seen.push([key, next]) })
    /*
     * 五个滑块必须**逐个**拖一遍。
     * 只挑两个测的话，把 onChange("letterSpacing", next) 误写成
     * onChange("fontPx", next) 这种串味不会被任何断言抓住 ——
     * 而"串味"正是这类"一个 onChange 按 key 分发"的写法最容易犯的错。
     * 每个四元组 = [控件标签, 拖到的值, 期望交给调用方的键, 期望的值]。
     */
    const drags: [string, string, string, unknown][] = [
      ["正文字号", "22", "fontPx", 22],
      ["行间距", "2.2", "lineHeight", 2.2],
      ["字间距", "1.5", "letterSpacing", 1.5],
      ["左右边距", "60", "marginX", 60],
      ["底部安全距离", "120", "safeBottom", 120],
    ]
    for (const [label, raw, key, want] of drags) {
      seen.length = 0
      setRange(input(label), raw)
      expect(seen, `拖「${label}」应只交 ${key} 一个键`).toEqual([[key, want]])
    }
  })

  it("左右边距为 null 时显示「跟随窗口」，提供按钮切回 null", () => {
    const seen: [string, unknown][] = []

    /*
     * ── 本用例与原稿有三处出入，三处都是**实测出来的**，不是设计变更 ──
     *
     * ① 原稿 `expect(container.textContent).not.toContain("跟随窗口")`
     *    在 marginX=40 下必然失败，而且与实现无关：hint 原文
     *    「未调整时跟随窗口宽度」与按钮文案「改回跟随窗口」都含这四个字。
     *    实测报错：
     *      AssertionError: expected '正文字体只影响…未调整时跟随窗口宽度，调整后固定。40px改回跟随窗口…'
     *      not to contain '跟随窗口'
     *    也就是说这条**恒假**（恒假的代价比恒真更大：它会让人去改没坏的东西）。
     *    要断言"显示的是 40px 而不是跟随窗口"，只能对准**显示值那一个元素**，
     *    不能扫整个容器的文本。
     * ② 原稿 `first.unmount()` 是 TypeError：render() 返回的是 container
     *    （HTMLDivElement），不是 root。实测报错：
     *      TypeError: first.unmount is not a function
     *    同一行的第二段 render 本来就会复用同一个 root，不需要先卸载。
     * ③ 原稿在 marginX=null 那一档点击按钮并期望它交出 null，但 null 档的按钮是
     *    `disabled` 的，而 jsdom 按规范不对 disabled 表单控件执行 click() 的
     *    激活行为。实测报错：
     *      AssertionError: expected [] to deeply equal [ [ 'marginX', null ] ]
     *    「切回跟随窗口」这个动作只在**非 null** 档才有意义（null 档已经在那里了），
     *    所以点击移到非 null 档，并显式钉住两档的 disabled 状态。
     */
    const marginDisplay = () => {
      const el = container.querySelector('[data-ui-typography-value="左右边距"]')
      if (!el) throw new Error("找不到左右边距的显示值")
      return el.textContent
    }
    const backButton = () => {
      const el = container.querySelector<HTMLButtonElement>('[aria-label="左右边距跟随窗口"]')
      if (!el) throw new Error("找不到「左右边距跟随窗口」按钮")
      return el
    }

    // ① 非 null：显示具体像素值（不是「跟随窗口」），按钮可用，点一下才交出 null
    render({ ...BASE, marginX: 40 }, (key, next) => { seen.push([key, next]) })
    expect(marginDisplay()).toBe("40px")
    expect(backButton().disabled).toBe(false)
    act(() => { backButton().click() })
    expect(seen).toEqual([["marginX", null]])

    // ② null：显示「跟随窗口」，按钮已处于目标状态故禁用，且渲染本身不发出任何改动
    seen.length = 0
    render({ ...BASE, marginX: null }, (key, next) => { seen.push([key, next]) })
    expect(marginDisplay()).toBe("跟随窗口")
    expect(backButton().disabled).toBe(true)
    expect(seen).toEqual([])
  })

  it("左右边距为 null 时，滑块停在当前真正生效的位置", () => {
    render(BASE)
    // BASE.marginX 是 null：滑块不能显示 0，那会让用户以为边距被设成了 0
    expect(input("左右边距").value).toBe(String(defaultBodyMarginXForViewport(window.innerWidth)))
  })

  it("字号下拉的预设来自单一来源，且选中态能匹配上", () => {
    render({ ...BASE, fontPx: 21 })
    const select = container.querySelector<HTMLSelectElement>('[aria-label="正文字号预设"]')
    expect(select).not.toBeNull()
    expect(select?.value).toBe("21")
  })
})
