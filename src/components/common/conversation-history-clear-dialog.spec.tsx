// @vitest-environment jsdom

import "@/i18n"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConversationHistoryClearDialog } from "./conversation-history-clear-dialog"

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

function findButton(text: string) {
  return Array.from(document.body.querySelectorAll("button"))
    .find((button) => button.textContent?.includes(text))
}

describe("ConversationHistoryClearDialog", () => {
  it("shows the irreversible deletion count and handles cancel", async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    await act(async () => root.render(
      <ConversationHistoryClearDialog open count={3} onCancel={onCancel} onConfirm={onConfirm} />,
    ))

    expect(document.body.textContent).toContain("清理会话历史？")
    expect(document.body.textContent).toContain("将永久删除 3 条历史会话及其消息，此操作无法撤销。")
    await act(async () => findButton("取消")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("confirms clearing history", async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    await act(async () => root.render(
      <ConversationHistoryClearDialog open count={2} onCancel={onCancel} onConfirm={onConfirm} />,
    ))

    await act(async () => findButton("确认清理")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })
})
