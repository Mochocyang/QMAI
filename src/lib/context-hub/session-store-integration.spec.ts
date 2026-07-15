import { beforeEach, describe, expect, it } from "vitest"
import { useChatStore } from "@/stores/chat-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"

const summary = {
  text: "已确认主角不能提前知道真相。",
  dependencies: { "E:/Novel/wiki/outlines/main.md": 2 },
  updatedAt: 100,
}

describe("session summary store isolation", () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [
        { id: "chat-a", title: "A", createdAt: 1, updatedAt: 1, deAiMode: false },
        { id: "chat-b", title: "B", createdAt: 1, updatedAt: 1, deAiMode: false },
      ],
    })
    useOutlineChatStore.setState({
      conversations: [
        { id: "outline-a", title: "A", createdAt: 1, updatedAt: 1, messages: [] },
        { id: "outline-b", title: "B", createdAt: 1, updatedAt: 1, messages: [] },
      ],
    })
  })

  it("updates only the selected AI chat conversation", () => {
    useChatStore.getState().setConversationContextSummary("chat-a", summary)

    expect(useChatStore.getState().conversations[0].contextSummary).toEqual(summary)
    expect(useChatStore.getState().conversations[1].contextSummary).toBeUndefined()
  })

  it("updates only the selected AI outline conversation", () => {
    useOutlineChatStore.getState().setConversationContextSummary("outline-a", summary)

    expect(useOutlineChatStore.getState().conversations[0].contextSummary).toEqual(summary)
    expect(useOutlineChatStore.getState().conversations[1].contextSummary).toBeUndefined()
  })
})
