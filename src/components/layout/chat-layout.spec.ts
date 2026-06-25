import { describe, expect, it } from "vitest"
import {
  getChatBarVisibility,
  shouldShowRightDockChat,
  shouldShowWritingChat,
} from "./chat-layout"

describe("chat layout docking", () => {
  it("shows the writing chat in the bottom dock by default", () => {
    expect(getChatBarVisibility(true, "bottom")).toBe("expanded")
    expect(shouldShowWritingChat(true, "bottom")).toBe(true)
    expect(shouldShowRightDockChat(true, "bottom")).toBe(false)
  })

  it("moves the writing chat to the right dock when configured", () => {
    expect(getChatBarVisibility(true, "right")).toBe("hidden")
    expect(shouldShowWritingChat(true, "right")).toBe(false)
    expect(shouldShowRightDockChat(true, "right")).toBe(true)
  })

  it("keeps every dock hidden when chat is collapsed", () => {
    expect(getChatBarVisibility(false, "bottom")).toBe("hidden")
    expect(shouldShowWritingChat(false, "bottom")).toBe(false)
    expect(shouldShowRightDockChat(false, "right")).toBe(false)
  })
})
