// @vitest-environment jsdom
//
// 为什么必须声明 jsdom：vite.config.ts 全局是 environment: "node",
// node 下没有 localStorage，这些用例会全部以 "localStorage is not defined" 失败。
//
// 为什么全部用动态 import 而不是静态 import：
// 下面有迁移用例要用 vi.resetModules() 重放"模块加载时读 localStorage"。
// 若顶部同时有一句静态 import，它与 resetModules 之后的动态 import 会是
// 两个模块实例，读到的 state 陈旧 —— 表现为看似无关的失败。
import { beforeEach, describe, expect, it, vi } from "vitest"

// 范围常量从 font-settings 导入 —— 断言里要用它们，不能自己抄一遍数字：
// 抄一遍的话，改范围时测试照样绿（"单一来源"也包括测试里不许有第二份数字）。
import {
  BODY_FONT_PX_MAX,
  BODY_FONT_PX_MIN,
  BODY_LETTER_SPACING_MAX,
  BODY_LETTER_SPACING_MIN,
  BODY_LINE_HEIGHT_MAX,
  BODY_LINE_HEIGHT_MIN,
  BODY_MARGIN_X_MAX,
  BODY_SAFE_BOTTOM_MAX,
  BODY_SAFE_BOTTOM_MIN,
  DEFAULT_BODY_FONT_PX,
} from "@/lib/font-settings"

describe("正文排版参数（store 侧）", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  /** 取一个"刚加载"的 store（初值来自 localStorage）。 */
  async function freshStore() {
    return (await import("@/stores/wiki-store")).useWikiStore
  }

  it("5 个参数各自一个独立的 localStorage 键", async () => {
    // 用 store 本体而不是 state 快照：zustand 5 的 set 是
    // Object.assign({}, state, partial)，快照在第一次 set 之后就失效了。
    const store = await freshStore()
    const s = store.getState()
    s.setUiBodyFontPx(20)
    s.setUiBodyLineHeight(2.2)
    s.setUiBodyLetterSpacing(1.5)
    s.setUiBodyMarginX(64)
    s.setUiBodySafeBottom(100)

    expect(localStorage.getItem("qmai-body-font-px")).toBe("20")
    expect(localStorage.getItem("qmai-body-line-height")).toBe("2.2")
    expect(localStorage.getItem("qmai-body-letter-spacing")).toBe("1.5")
    expect(localStorage.getItem("qmai-body-margin-x")).toBe("64")
    expect(localStorage.getItem("qmai-body-safe-bottom")).toBe("100")

    /*
     * 只落盘、忘了写 store 的 setter 会让界面不刷新 —— 必须逐条读**实时** state。
     * 为什么这五条不能省：beforeEach 清空 localStorage 后，五个字段的初值
     * 恰好都等于默认值，只读快照或只读 localStorage 都分辨不出 setter 写没写
     * store（实测：删掉 setUiBodyLetterSpacing / setUiBodyMarginX 里的 set()，
     * 其余 11 条断言全绿）。这五条就是那个缺口的守卫。
     */
    expect(store.getState().uiBodyFontPx).toBe(20)
    expect(store.getState().uiBodyLineHeight).toBe(2.2)
    expect(store.getState().uiBodyLetterSpacing).toBe(1.5)
    expect(store.getState().uiBodyMarginX).toBe(64)
    expect(store.getState().uiBodySafeBottom).toBe(100)
  })

  it("改一个参数不会动到其它参数（键独立性的真正含义）", async () => {
    const s = (await freshStore()).getState()
    s.setUiBodyFontPx(20)
    s.setUiBodyLineHeight(2.2)
    const before = (await freshStore()).getState()
    const snapshot = {
      fontPx: before.uiBodyFontPx,
      lineHeight: before.uiBodyLineHeight,
      letterSpacing: before.uiBodyLetterSpacing,
      marginX: before.uiBodyMarginX,
      safeBottom: before.uiBodySafeBottom,
    }
    s.setUiBodyLetterSpacing(2)
    const after = (await freshStore()).getState()
    expect(after.uiBodyFontPx).toBe(snapshot.fontPx)
    expect(after.uiBodyLineHeight).toBe(snapshot.lineHeight)
    expect(after.uiBodyMarginX).toBe(snapshot.marginX)
    expect(after.uiBodySafeBottom).toBe(snapshot.safeBottom)
  })

  it("写入的值经过钳制（范围是单一来源，不在 store 里各写一遍）", async () => {
    // 必须每次重新 getState()：zustand 5 的 set 走 Object.assign({}, state, partial)，
    // 先生成的 state 快照在 set 之后就失效了 —— 读陈旧快照会永远读到初值，
    // 这条断言就变成了"什么都没测"。
    const store = await freshStore()
    store.getState().setUiBodyFontPx(9999)
    expect(store.getState().uiBodyFontPx).toBe(BODY_FONT_PX_MAX)
    store.getState().setUiBodyLineHeight(0)
    expect(store.getState().uiBodyLineHeight).toBe(BODY_LINE_HEIGHT_MIN)
    store.getState().setUiBodySafeBottom(-5)
    expect(store.getState().uiBodySafeBottom).toBe(BODY_SAFE_BOTTOM_MIN)
    store.getState().setUiBodyMarginX(9999)
    expect(store.getState().uiBodyMarginX).toBe(BODY_MARGIN_X_MAX)
    expect(localStorage.getItem("qmai-body-margin-x")).toBe(String(BODY_MARGIN_X_MAX))

    /*
     * 必须同时断言**落盘的值**也是钳制后的。
     *
     * 只断言 state 的话，「钳制 state、但把原值写进 localStorage」
     * （set({x: clamped}) + setItem(KEY, String(value))）会存活 ——
     * 变异实测 fontPx / safeBottom / letterSpacing / marginX 四个都存活。
     * 读取侧钳制（见下面那条用例）会在下次启动把它夹回来，
     * 所以这是"纵深防御少一层"，不是线上缺陷 —— 但 setter 上方的注释
     * 声称守住了这条，注释与守备范围必须一致。
     */
    expect(localStorage.getItem("qmai-body-font-px")).toBe(String(BODY_FONT_PX_MAX))
    expect(localStorage.getItem("qmai-body-line-height")).toBe(String(BODY_LINE_HEIGHT_MIN))
    expect(localStorage.getItem("qmai-body-safe-bottom")).toBe(String(BODY_SAFE_BOTTOM_MIN))
  })

  it("左右边距可以存成「跟随窗口」(null)，且读回还是 null", async () => {
    const store = await freshStore()
    // 先设一个非 null 值，再设回 null：这样"setter 没写"或"把 null 写成 0"
    // 都会红。若只断言初值就是 null，那它证明不了任何事（初值本来就是 null）。
    store.getState().setUiBodyMarginX(40)
    expect(store.getState().uiBodyMarginX).toBe(40)
    expect(localStorage.getItem("qmai-body-margin-x")).toBe("40")

    // 顺手放一个别的键，用来证明 null 分支不会误删其它键。
    // （变异实测：null 分支 removeItem(错键) 会静默删掉用户的行距设置。）
    localStorage.setItem("qmai-body-line-height", "1.8")

    store.getState().setUiBodyMarginX(null)
    expect(store.getState().uiBodyMarginX).toBeNull()

    /*
     * ⚠ 这里必须**正面断言键不存在**，不能只断言"不是字符串 null"。
     *
     * 原来只写 .not.toBe("null")，它只挡「恰好写成字符串 "null"」这一种写法。
     * 变异实测四种写法**全部存活**（13 passed）：
     *   · null 落成 "0"        · null 落成 ""
     *   · removeItem(错键)     · null 分支什么都不做
     * 症状都是「用户点了跟随窗口，界面看着对了，重开软件又变回去」，
     * 其中删错键还会连带删掉行距设置。这就是"否定排除法代替正面断言"的陷阱：
     * 断言"不是甲"对乙丙丁毫无约束力，读起来却像在保护这件事。
     */
    expect(localStorage.getItem("qmai-body-margin-x")).toBeNull()
    expect(localStorage.getItem("qmai-body-line-height")).toBe("1.8")

    // 设回去还能读回 —— 防止"永远不写这个键"骗过上面那条
    store.getState().setUiBodyMarginX(64)
    expect(store.getState().uiBodyMarginX).toBe(64)
    expect(localStorage.getItem("qmai-body-margin-x")).toBe("64")
  })

  /*
   * ── 迁移用例：这是本任务唯一的"会读用户既存数据并据此改写行为"的代码 ──
   *
   * 为什么必须在这里测，而不是推给任务 12 的静态守卫：
   * 静态守卫只能证明"读回函数先看新键、再看旧键"，证明不了**乘没乘界面字号**。
   * 而改造前正文的实际渲染高度 = 18px × 界面倍数 × 正文倍数（rem 基准被 App
   * 设成界面倍数×100%），只乘正文倍数的话，界面 150% 的老用户一升级
   * 正文就从 27px 掉到 18px。这件事只有这一层能钉住。
   *
   * 做法：vi.resetModules() 后重新 import，模块求值期会重新读 localStorage ——
   * 这正是"首次启动"的时机。
   */
  it("迁移：旧倍数 1.25（界面 100%）→ 23px", async () => {
    localStorage.setItem("qmai-ui-body-font-scale", "1.25")
    localStorage.setItem("qmai-ui-font-size-scale", "1")
    expect((await freshStore()).getState().uiBodyFontPx).toBe(23)
  })

  it("迁移：旧倍数 0.85（界面 100%）→ 15px", async () => {
    localStorage.setItem("qmai-ui-body-font-scale", "0.85")
    localStorage.setItem("qmai-ui-font-size-scale", "1")
    expect((await freshStore()).getState().uiBodyFontPx).toBe(15)
  })

  it("迁移必须把界面字号乘进去：旧倍数 1 + 界面 150% → 27px", async () => {
    // 只乘正文倍数会得到 18 —— 老用户一升级正文就变小。
    // 这条断言就是那个缺陷的守卫。
    localStorage.setItem("qmai-ui-body-font-scale", "1")
    localStorage.setItem("qmai-ui-font-size-scale", "1.5")
    expect((await freshStore()).getState().uiBodyFontPx).toBe(27)
  })

  it("迁移：乘积超过 32px 上限时被夹住（有意，不是 bug）", async () => {
    // 18 × 1.25 × 1.5 = 33.75 → 32。
    // 改造前是 28.1px 且没有上限概念，所以这里确实变小了一点 ——
    // 钉住它是为了让这个取舍是"决定"而不是"意外"。
    localStorage.setItem("qmai-ui-body-font-scale", "1.25")
    localStorage.setItem("qmai-ui-font-size-scale", "1.5")
    expect((await freshStore()).getState().uiBodyFontPx).toBe(BODY_FONT_PX_MAX)
  })

  it("没存过正文倍数但界面字号非默认 → 按界面字号补种，否则正文凭空变小", async () => {
    localStorage.setItem("qmai-ui-font-size-scale", "1.5")
    expect((await freshStore()).getState().uiBodyFontPx).toBe(27)
  })

  it("什么都没存且界面字号为默认 → 落在默认值，不写新键", async () => {
    // resolveMigratedBodyFontPx 在"没存过 + 界面倍数 1"时返回 null
    // （让"未设置"保持未设置，日后改默认值对新用户仍然有效）。
    // 但 store 的 state 类型是 number，所以这里落成默认值；
    // 真正把 null 传到持久化层的是任务 4 的 loadUiBodyFontPx。
    expect((await freshStore()).getState().uiBodyFontPx).toBe(DEFAULT_BODY_FONT_PX)
    expect(localStorage.getItem("qmai-body-font-px")).toBeNull()
  })

  it("新键优先于旧键：迁移只发生一次", async () => {
    localStorage.setItem("qmai-ui-body-font-scale", "0.85")
    localStorage.setItem("qmai-body-font-px", "24")
    expect((await freshStore()).getState().uiBodyFontPx).toBe(24)
  })

  it("存储里被改坏的越界数值读回时被钳制（存储不可信）", async () => {
    // 补这条的理由：删掉读回函数里的 clamp（`return clampBodyFontPx(raw)` → `Number(raw)`）
    // 时，原有 12 条断言全绿 —— 它们只覆盖 setter 的写入侧钳制，
    // 没有一条覆盖**读取侧**。localStorage 是用户能手工改的，读取侧同样不可信。
    localStorage.setItem("qmai-body-font-px", "9999")
    localStorage.setItem("qmai-body-line-height", "99")
    localStorage.setItem("qmai-body-letter-spacing", "99")
    localStorage.setItem("qmai-body-margin-x", "9999")
    localStorage.setItem("qmai-body-safe-bottom", "9999")
    const s = (await freshStore()).getState()
    expect(s.uiBodyFontPx).toBe(BODY_FONT_PX_MAX)
    expect(s.uiBodyLineHeight).toBe(BODY_LINE_HEIGHT_MAX)
    expect(s.uiBodyLetterSpacing).toBe(BODY_LETTER_SPACING_MAX)
    expect(s.uiBodyMarginX).toBe(BODY_MARGIN_X_MAX)
    expect(s.uiBodySafeBottom).toBe(BODY_SAFE_BOTTOM_MAX)
  })

  it("存储里被改坏的**下界越界**数值也被钳制（只钳上界会漏）", async () => {
    /*
     * 上一条只覆盖了上限。变异实测：把读取函数改成只钳上界
     * （`Math.min(MAX, Number(raw))`）会**存活** ——
     * 那样存储被改成 "0" / "-5" 时字号会真的变成 0px / 负值，
     * 而 0px 的正文在界面上就是"字没了"。
     */
    localStorage.setItem("qmai-body-font-px", "-5")
    localStorage.setItem("qmai-body-line-height", "-3")
    localStorage.setItem("qmai-body-letter-spacing", "-99")
    localStorage.setItem("qmai-body-safe-bottom", "-99")
    const s = (await freshStore()).getState()
    expect(s.uiBodyFontPx).toBe(BODY_FONT_PX_MIN)
    expect(s.uiBodyLineHeight).toBe(BODY_LINE_HEIGHT_MIN)
    expect(s.uiBodyLetterSpacing).toBe(BODY_LETTER_SPACING_MIN)
    expect(s.uiBodySafeBottom).toBe(BODY_SAFE_BOTTOM_MIN)

    // 非数字垃圾也不能漏成 NaN（NaN 会让后续计算全部失效且不报错）。
    // 必须显式 resetModules：resetModules 只在 beforeEach 跑，
    // 同一个用例内第二次 freshStore() 会拿到**同一个模块实例**（state 已被上面的
    // "-5" 初始化成 12），读的就不是新写入的 "abc" 了。
    localStorage.setItem("qmai-body-font-px", "abc")
    vi.resetModules()
    expect((await freshStore()).getState().uiBodyFontPx).toBe(DEFAULT_BODY_FONT_PX)
  })

  it("旧倍数键迁移后不被删除（回滚到旧版本仍可用）", async () => {
    localStorage.setItem("qmai-ui-body-font-scale", "1.25")
    localStorage.setItem("qmai-ui-font-size-scale", "1")
    await freshStore()
    expect(localStorage.getItem("qmai-ui-body-font-scale")).toBe("1.25")
  })
})
