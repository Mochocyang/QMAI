// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConversationDeleteConfirmDialog } from "./conversation-delete-confirm-dialog"

let host: HTMLDivElement
let root: Root
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

function findButton(text: string) {
  return Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.includes(text))
}

describe("ConversationDeleteConfirmDialog", () => {
  it("shows Chinese warning and handles cancel", async () => {
    const onCancel = vi.fn(); const onConfirm = vi.fn()
    await act(async () => root.render(<ConversationDeleteConfirmDialog open onCancel={onCancel} onConfirm={onConfirm} />))
    expect(document.body.textContent).toContain("停止并删除会话？")
    expect(document.body.textContent).toContain("该会话仍在生成。确认后将先停止任务，再删除会话。")
    await act(async () => findButton("取消")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("confirms stop and delete", async () => {
    const onCancel = vi.fn(); const onConfirm = vi.fn()
    await act(async () => root.render(<ConversationDeleteConfirmDialog open onCancel={onCancel} onConfirm={onConfirm} />))
    await act(async () => findButton("停止并删除")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })
})