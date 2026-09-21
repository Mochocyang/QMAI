import { describe, expect, it } from "vitest"
import {
  clampChatWidth,
  getInitialChatWidth,
  clampSidebarWidth,
  getConversationTabTitle,
} from "./workspace-layout"

describe("workspace-layout", () => {
  it("clamps sidebar width into the supported range", () => {
    expect(clampSidebarWidth(120)).toBe(150)
    expect(clampSidebarWidth(260)).toBe(260)
    expect(clampSidebarWidth(520)).toBe(400)
  })

  it("allows the right dock chat to expand up to half of the window", () => {
    expect(clampChatWidth(900, 1600)).toBe(800)
    expect(clampChatWidth(620, 1600)).toBe(620)
    expect(clampChatWidth(200, 1600)).toBe(280)
  })

  it("uses a wider default chat dock and migrates the old narrow default", () => {
    expect(getInitialChatWidth(null, 1600)).toBe(640)
    expect(getInitialChatWidth(360, 1600)).toBe(640)
    expect(getInitialChatWidth(700, 1600)).toBe(700)
    expect(getInitialChatWidth(900, 1600)).toBe(800)
  })

  it("formats conversation titles for horizontal tabs", () => {
    expect(getConversationTabTitle("这是一个很长很长很长的历史对话标题", 10)).toBe("这是一个很长很长很…")
    expect(getConversationTabTitle("短标题", 10)).toBe("短标题")
  })
})