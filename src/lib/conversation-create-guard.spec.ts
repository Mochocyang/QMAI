import { describe, expect, it } from "vitest"

import {
  canCreateNewConversation,
  EMPTY_CONVERSATION_CREATE_REASON,
} from "./conversation-create-guard"

describe("conversation create guard", () => {
  it("allows the first conversation when no active conversation exists", () => {
    expect(canCreateNewConversation(null, false)).toBe(true)
  })

  it("blocks another conversation until the active conversation has a sent user message", () => {
    expect(canCreateNewConversation("empty", false)).toBe(false)
    expect(canCreateNewConversation("sent", true)).toBe(true)
  })

  it("provides the approved Chinese disabled reason", () => {
    expect(EMPTY_CONVERSATION_CREATE_REASON).toBe(
      "请先发送当前会话内容，再新建对话。",
    )
  })
})
