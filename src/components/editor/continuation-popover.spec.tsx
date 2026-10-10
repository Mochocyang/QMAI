// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { ContinuationPopover, type ContinuationPopoverProps } from "./continuation-popover"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function renderPopover(overrides: Partial<ContinuationPopoverProps> = {}) {
  const props: ContinuationPopoverProps = {
    phase: "idle",
    position: { left: 10, top: 20 },
    instruction: "",
    candidate: "",
    errorMessage: "",
    truncated: false,
    onInstructionChange: vi.fn(),
    onStart: vi.fn(),
    onInsert: vi.fn(),
    onRegenerate: vi.fn(),
    onStop: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<ContinuationPopover {...props} />) })
  const button = (text: string) =>
    [...container.querySelectorAll("button")].find((el) => el.textContent === text)
  return {
    container,
    button,
    cleanup: () => { act(() => root.unmount()); document.body.removeChild(container) },
  }
}

describe("ContinuationPopover", () => {
  it("idle：有输入框和「续写」按钮，显示占位文字，没有候选区", () => {
    const { container, button, cleanup } = renderPopover()
    const input = container.querySelector<HTMLInputElement>('[data-continuation-instruction="true"]')
    expect(input).not.toBeNull()
    expect(input?.placeholder).toBe("想写什么？可留空直接续写")
    expect(input?.disabled).toBe(false)
    expect(button("续写")).toBeTruthy()
    expect(container.querySelector('[data-continuation-candidate="true"]')).toBeNull()
    cleanup()
  })

  it("idle 下输入框可以留空，直接点「续写」也回调", () => {
    const onStart = vi.fn()
    const { button, cleanup } = renderPopover({ onStart })
    act(() => { button("续写")!.click() })
    expect(onStart).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it("streaming：输入框禁用、有流式区与「停止」，没有「续写」按钮", () => {
    const { container, button, cleanup } = renderPopover({ phase: "streaming", candidate: "他推开门" })
    expect(container.querySelector<HTMLInputElement>('[data-continuation-instruction="true"]')?.disabled).toBe(true)
    expect(container.querySelector('[data-continuation-streaming="true"]')?.textContent).toContain("他推开门")
    expect(button("停止")).toBeTruthy()
    expect(button("续写")).toBeUndefined()
    cleanup()
  })

  it("done：显示候选正文与字数，按钮是「插入正文」「重新生成」", () => {
    const { container, button, cleanup } = renderPopover({ phase: "done", candidate: "　　雨还在下。" })
    expect(container.querySelector('[data-continuation-candidate="true"]')?.textContent).toContain("雨还在下。")
    expect(container.textContent).toContain("5 字")
    expect(button("插入正文")).toBeTruthy()
    expect(button("重新生成")).toBeTruthy()
    cleanup()
  })

  it("done 且被截断时给出提示", () => {
    const { container, cleanup } = renderPopover({ phase: "done", candidate: "　　雨。", truncated: true })
    expect(container.textContent).toContain("已截断")
    cleanup()
  })

  it("error：显示错误文案与「续写」重试按钮", () => {
    const { container, button, cleanup } = renderPopover({ phase: "error", errorMessage: "续写失败：模型未返回正文" })
    expect(container.querySelector('[data-continuation-error="true"]')?.textContent).toContain("模型未返回正文")
    expect(button("续写")).toBeTruthy()
    cleanup()
  })

  it("关掉浮层有回调，且浮层带 role=dialog 便于定位", () => {
    const onClose = vi.fn()
    const { container, cleanup } = renderPopover({ onClose })
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute("aria-label")).toBe("续写")
    const close = container.querySelector<HTMLButtonElement>('[aria-label="关闭续写"]')!
    act(() => { close.click() })
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
