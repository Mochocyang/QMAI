// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ConversationRunState } from "@/lib/conversation-run-state"
import { ConversationRunStatusIcon } from "./conversation-run-status-icon"

let host: HTMLDivElement
let root: Root
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

async function renderState(state: ConversationRunState) {
  await act(async () => { root.render(<ConversationRunStatusIcon state={state} />) })
}

describe("ConversationRunStatusIcon", () => {
  it.each([
    ["running", "正在生成"],
    ["completed_unread", "已完成，点击查看"],
    ["failed", "生成失败：接口错误"],
    ["interrupted", "任务已中断，可重新发送"],
  ] as const)("renders %s with Chinese accessible status", async (status, label) => {
    await renderState({ status, updatedAt: 1, error: "接口错误" })
    const icon = host.querySelector(`[aria-label="${label}"]`)
    expect(icon).not.toBeNull()
    expect(icon?.querySelector("svg")).not.toBeNull()
  })

  it("does not render idle status", async () => {
    await renderState({ status: "idle", updatedAt: 1 })
    expect(host.innerHTML).toBe("")
  })
})