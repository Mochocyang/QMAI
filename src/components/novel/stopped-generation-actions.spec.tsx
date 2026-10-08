// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { StoppedGenerationActions } from "./stopped-generation-actions"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function mount(props: Parameters<typeof StoppedGenerationActions>[0]) {
  act(() => { root.render(<StoppedGenerationActions {...props} />) })
}

const buttonByLabel = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.removeChild(container)
})

describe("StoppedGenerationActions", () => {
  it("同时渲染「重试」和「继续」两个按钮", () => {
    mount({ onRetry: () => {}, onContinue: () => {} })
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent?.trim())
    expect(labels).toEqual(["重试", "继续"])
  })

  it("按钮上带图标，不是纯文字", () => {
    mount({ onRetry: () => {}, onContinue: () => {} })
    for (const button of container.querySelectorAll("button")) {
      expect(button.querySelector("svg")).not.toBeNull()
    }
  })

  it("点「重试」只触发重试回调", () => {
    const onRetry = vi.fn()
    const onContinue = vi.fn()
    mount({ onRetry, onContinue })
    act(() => { buttonByLabel("重试")!.click() })
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onContinue).not.toHaveBeenCalled()
  })

  it("点「继续」只触发继续回调", () => {
    const onRetry = vi.fn()
    const onContinue = vi.fn()
    mount({ onRetry, onContinue })
    act(() => { buttonByLabel("继续")!.click() })
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it("流式生成中禁用时按钮点不动", () => {
    const onRetry = vi.fn()
    mount({ onRetry, onContinue: () => {}, disabled: true })
    const retry = buttonByLabel("重试")!
    expect(retry.disabled).toBe(true)
    act(() => { retry.click() })
    expect(onRetry).not.toHaveBeenCalled()
  })

  /**
   * 无障碍名称里要把"重试会重新生成整条回复"说清楚：这两个按钮差别细微，
   * 只念"重试/继续"用户分不出哪个会丢掉已有内容。
   */
  it("无障碍名称说明了各自的行为差别", () => {
    mount({ onRetry: () => {}, onContinue: () => {} })
    expect(buttonByLabel("重试")!.getAttribute("aria-label")).toContain("重新生成")
    expect(buttonByLabel("继续")!.getAttribute("aria-label")).toContain("接着写")
  })

  it("只给一个回调时只渲染一个按钮", () => {
    mount({ onRetry: () => {} })
    expect(buttonByLabel("重试")).not.toBeNull()
    expect(buttonByLabel("继续")).toBeNull()
  })

  it("两个回调都没有时不渲染任何东西", () => {
    mount({})
    expect(container.querySelector('[data-ui-stopped-generation-actions]')).toBeNull()
    expect(container.querySelectorAll("button").length).toBe(0)
  })
})
