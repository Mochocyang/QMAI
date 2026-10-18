// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FailedGenerationActions } from "./failed-generation-actions"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function mount(props: Parameters<typeof FailedGenerationActions>[0]) {
  act(() => { root.render(<FailedGenerationActions {...props} />) })
}

const buttonByLabel = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.removeChild(container)
})

describe("FailedGenerationActions", () => {
  it("同时渲染「重试」和「继续」两个按钮", () => {
    mount({ onRetry: () => {}, onContinue: () => {} })
    expect(buttonByLabel("重试")).not.toBeNull()
    expect(buttonByLabel("继续")).not.toBeNull()
  })

  /**
   * 用户明确要求的是**图标**（与旁边「保存 / 复制 / 引用资料」那一排同款），
   * 不是文字胶囊：按钮里不能有可见文字，只能有 svg。
   */
  it("是纯图标按钮，不带可见文字", () => {
    mount({ onRetry: () => {}, onContinue: () => {} })
    for (const button of container.querySelectorAll("button")) {
      expect(button.textContent?.trim()).toBe("")
      expect(button.querySelector("svg")).not.toBeNull()
      expect(button.className).toContain("h-7")
      expect(button.className).toContain("w-7")
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

  /**
   * 一个字都没生成时「继续」没有可接的断点：按钮要**在**（用户要求两个都在），
   * 但禁用，并在 title 里说明为什么点不了。
   */
  it("没有已生成内容时只禁用「继续」，「重试」仍可用", () => {
    const onRetry = vi.fn()
    const onContinue = vi.fn()
    mount({ onRetry, onContinue, continueDisabled: true })

    const retry = buttonByLabel("重试")!
    const cont = buttonByLabel("继续")!
    expect(retry.disabled).toBe(false)
    expect(cont.disabled).toBe(true)
    expect(cont.title).toContain("没有已生成的内容")

    act(() => { cont.click() })
    expect(onContinue).not.toHaveBeenCalled()
  })

  it("整体 disabled 时两个都点不动", () => {
    const onRetry = vi.fn()
    mount({ onRetry, onContinue: () => {}, disabled: true })
    const retry = buttonByLabel("重试")!
    expect(retry.disabled).toBe(true)
    act(() => { retry.click() })
    expect(onRetry).not.toHaveBeenCalled()
  })

  it("无障碍名称说明了各自的行为差别", () => {
    mount({ onRetry: () => {}, onContinue: () => {} })
    expect(buttonByLabel("重试")!.title).toContain("重新生成")
    expect(buttonByLabel("继续")!.title).toContain("接着写")
  })

  it("只给一个回调时只渲染一个按钮", () => {
    mount({ onRetry: () => {} })
    expect(buttonByLabel("重试")).not.toBeNull()
    expect(buttonByLabel("继续")).toBeNull()
  })

  it("两个回调都没有时不渲染任何东西", () => {
    mount({})
    expect(container.querySelector("[data-ui-failed-generation-actions]")).toBeNull()
    expect(container.querySelectorAll("button").length).toBe(0)
  })
})
