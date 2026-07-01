import { describe, expect, it } from "vitest"
import type { AgentRunRecord } from "@/lib/agent/types"
import type { ReferenceToken } from "@/lib/reference/types"
import {
  agentToolCallsToMessageReferences,
  getReferenceTokensForConversation,
  setReferenceTokensForConversation,
} from "./agent-message-metadata"

function toolCall(
  name: string,
  params: Record<string, unknown>,
  status: "done" | "error" = "done",
): AgentRunRecord["toolCalls"][number] {
  return {
    id: `${name}-${String(params.name ?? params.path ?? params.conversationId ?? "x")}`,
    name,
    params,
    result: status === "done" ? "ok" : "错误",
    status,
    startedAt: 1,
    finishedAt: 2,
  }
}

describe("agentToolCallsToMessageReferences", () => {
  it("converts successful Agent read tools into assistant message references", () => {
    const references = agentToolCallsToMessageReferences([
      toolCall("read_chapter", { name: "第一章" }),
      toolCall("read_outline", { path: "C:/Book/wiki/outlines/主线.md" }),
      toolCall("read_memory", { name: "主角记忆" }),
      toolCall("read_deduction", { name: "framework_1" }),
      toolCall("write_memory", { name: "不会进入引用" }),
      toolCall("read_memory", { name: "失败记忆" }, "error"),
    ])

    expect(references).toEqual([
      { title: "第一章", path: "wiki/chapters/第一章.md" },
      { title: "主线", path: "wiki/outlines/主线.md" },
      { title: "主角记忆", path: "wiki/memory/主角记忆.md" },
      { title: "framework_1", path: ".qmai/simulations/framework_1.json" },
    ])
  })

  it("deduplicates references by path", () => {
    const references = agentToolCallsToMessageReferences([
      toolCall("read_chapter", { name: "第一章" }),
      toolCall("read_chapter", { path: "C:/Book/wiki/chapters/第一章.md" }),
    ])

    expect(references).toEqual([
      { title: "第一章", path: "wiki/chapters/第一章.md" },
    ])
  })
})

describe("reference token drafts by conversation", () => {
  const token: ReferenceToken = {
    id: "ref-1",
    category: "chapter",
    title: "第一章",
    displayTitle: "第一章",
    path: "C:/Book/wiki/chapters/第一章.md",
  }

  it("stores and clears draft reference tokens without touching other conversations", () => {
    const withFirst = setReferenceTokensForConversation({}, "conv-1", [token])
    const withSecond = setReferenceTokensForConversation(withFirst, "conv-2", [{ ...token, id: "ref-2", title: "第二章" }])
    const clearedFirst = setReferenceTokensForConversation(withSecond, "conv-1", [])

    expect(getReferenceTokensForConversation(withSecond, "conv-1")).toEqual([token])
    expect(getReferenceTokensForConversation(withSecond, "conv-2")).toHaveLength(1)
    expect(getReferenceTokensForConversation(clearedFirst, "conv-1")).toEqual([])
    expect(getReferenceTokensForConversation(clearedFirst, "conv-2")).toHaveLength(1)
  })
})
