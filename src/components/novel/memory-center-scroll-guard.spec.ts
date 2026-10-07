// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { scrollIntoViewIfSupported } from "./memory-center-view"

/**
 * 回归测试：jsdom 不实现 Element.prototype.scrollIntoView。
 *
 * 背景：memory-center-view 在两处 rAF 回调里调用 scrollIntoView。未做特性检测时，
 * 回调会抛未处理异常 —— 测试本身仍然"通过"，但 vitest 会报 Errors 并以非 0 退出，
 * 而且时序相关、时有时无（第一次全量跑才暴露）。浏览器里有该方法，所以不是
 * 用户可见缺陷，但必须挡住。
 *
 * 这里的断言刻意做成"调用与否"的对照，而不是只断言"不抛"：
 * 只断言不抛的话，一个永远不调用 scrollIntoView 的实现也会通过 —— 那就把
 * 真实功能一起删掉了。所以既要有"支持时确实调用"的正向用例，
 * 也要有"不支持时不抛"的防御用例。
 */
describe("scrollIntoViewIfSupported", () => {
  it("支持时按传入的选项调用 scrollIntoView", () => {
    const element = document.createElement("div")
    const spy = vi.fn()
    element.scrollIntoView = spy

    scrollIntoViewIfSupported(element, { block: "nearest", inline: "nearest" })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" })
  })

  it("元素缺少 scrollIntoView 时不抛错（jsdom 的真实形态）", () => {
    const element = document.createElement("div")
    // jsdom 下该方法本就不存在；显式删掉以固定住这个前提
    delete (element as { scrollIntoView?: unknown }).scrollIntoView
    expect(typeof element.scrollIntoView).not.toBe("function")

    expect(() => scrollIntoViewIfSupported(element, { block: "center" })).not.toThrow()
  })

  it("元素为 null / undefined 时不抛错", () => {
    expect(() => scrollIntoViewIfSupported(null, { block: "center" })).not.toThrow()
    expect(() => scrollIntoViewIfSupported(undefined, { block: "center" })).not.toThrow()
  })

  it("scrollIntoView 不是函数（被覆盖成非函数值）时不抛错", () => {
    const element = document.createElement("div")
    ;(element as { scrollIntoView?: unknown }).scrollIntoView = "not-a-function"

    expect(() => scrollIntoViewIfSupported(element, { block: "center" })).not.toThrow()
  })
})
