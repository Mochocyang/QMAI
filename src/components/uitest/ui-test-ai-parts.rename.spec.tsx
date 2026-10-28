// @vitest-environment jsdom
/**
 * 会话标题重命名的交互契约：
 * - 点铅笔（或双击标题）进入输入框；
 * - Enter 提交、Esc 取消、失焦提交；
 * - 空白不提交，没改动也不提交；
 * - 没有 onRename 时不出现铅笔按钮（只读标题）。
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { UiTestAiIdentity } from "./ui-test-ai-parts"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(onRename?: (next: string) => void, title = "大纲对话 10:30") {
  act(() => {
    root.render(<UiTestAiIdentity conversationTitle={title} onRename={onRename} />)
  })
}

function pencil() {
  return host.querySelector<HTMLButtonElement>('button[aria-label="重命名会话"]')
}

function input() {
  return host.querySelector<HTMLInputElement>('input[aria-label="会话标题"]')
}

function type(value: string) {
  const el = input()!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  act(() => {
    setter.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function press(key: string) {
  act(() => {
    input()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
  })
}

describe("会话标题重命名", () => {
  it("没有 onRename 时不显示铅笔按钮", () => {
    render(undefined)
    expect(pencil()).toBeNull()
  })

  it("点铅笔进入编辑，Enter 提交清洗后的标题", () => {
    const onRename = vi.fn()
    render(onRename, "大纲对话 10:30")

    act(() => pencil()!.click())
    expect(input()?.value).toBe("大纲对话 10:30")

    type("  第 23 章   空位  ")
    press("Enter")

    expect(onRename).toHaveBeenCalledWith("第 23 章 空位")
    expect(input()).toBeNull()
  })

  it("Esc 取消，不提交", () => {
    const onRename = vi.fn()
    render(onRename)

    act(() => pencil()!.click())
    type("改了一半")
    press("Escape")

    expect(onRename).not.toHaveBeenCalled()
    expect(input()).toBeNull()
  })

  it("空白标题不提交，标题保持原样", () => {
    const onRename = vi.fn()
    render(onRename, "大纲对话 10:30")

    act(() => pencil()!.click())
    type("   ")
    press("Enter")

    expect(onRename).not.toHaveBeenCalled()
    expect(host.textContent).toContain("大纲对话")
  })

  it("没改动就 Enter 不触发回调", () => {
    const onRename = vi.fn()
    render(onRename, "章节对话 09:00")

    act(() => pencil()!.click())
    press("Enter")

    expect(onRename).not.toHaveBeenCalled()
  })

  it("双击标题也能进入编辑", () => {
    const onRename = vi.fn()
    render(onRename)

    const strong = host.querySelector("strong")!
    act(() => {
      strong.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })

    expect(input()).not.toBeNull()
  })
})
