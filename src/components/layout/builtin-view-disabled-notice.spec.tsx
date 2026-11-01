// @vitest-environment jsdom
/**
 * 「功能已被关闭」提示页的测试。
 *
 * 它存在的唯一理由是：关闭内置插件后，用户仍可能落到那个视图
 * （上一会话恢复的 activeView、或别处 setActiveView）。这时如果画一片空白，
 * 用户会以为软件坏了。所以这里要钉住三件事：
 *   1. 明确说清是**哪个**功能被关了；
 *   2. 说清关闭的后果（不能只说"不可用"）；
 *   3. 给一个能恢复的操作入口。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const setActiveViewMock = vi.hoisted(() => vi.fn())

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: (selector: (state: { setActiveView: typeof setActiveViewMock }) => unknown) =>
    selector({ setActiveView: setActiveViewMock }),
}))

import { BuiltinViewDisabledNotice } from "./builtin-view-disabled-notice"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  setActiveViewMock.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

function render(view: Parameters<typeof BuiltinViewDisabledNotice>[0]["view"]) {
  act(() => {
    root.render(<BuiltinViewDisabledNotice view={view} />)
  })
}

const text = () => host.textContent ?? ""

describe("BuiltinViewDisabledNotice", () => {
  it("说清是哪个功能被关闭，而不是一句「不可用」", () => {
    render("reviewCenter")
    expect(text()).toContain("审查中心")
    expect(text()).toContain("已关闭")
  })

  it("说清关闭的后果（来自内置插件清单里的 offEffect）", () => {
    render("storySimulation")
    expect(text()).toContain("剧情推演室")
    // 清单里写的是「入口从创作工具中消失，已保存的推演结果不会被删除」
    expect(text()).toContain("不会被删除")
  })

  it("给出「打开插件页」的恢复入口，点击后切到插件页", () => {
    render("search")

    const button = [...host.querySelectorAll("button")].find((item) =>
      (item.textContent ?? "").includes("插件"),
    )
    expect(button).toBeTruthy()

    act(() => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(setActiveViewMock).toHaveBeenCalledWith("plugins")
  })

  it("未知视图也不崩，退回一句通用说明", () => {
    render("wiki")
    expect(text()).toContain("这个功能")
    expect(text()).toContain("内置插件")
  })

  it("带 data-ui-page 标记，便于路由测试识别这是「已关闭」页而不是真页面", () => {
    render("reviewCenter")
    expect(host.querySelector('[data-ui-page="builtin-disabled"]')).not.toBeNull()
  })
})
