import { describe, expect, it } from "vitest"
import type { AgentRunRecord } from "@/lib/agent/types"
import type { ReferenceToken } from "@/lib/reference/types"
import {
  agentToolCallsToMessageReferences,
  getReferenceTokensForConversation,
  normalizeReferencePath,
  setReferenceTokensForConversation,
} from "./agent-message-metadata"

function toolCall(
  name: string,
  params: Record<string, unknown>,
  status: "done" | "error" = "done",
  result = status === "done" ? "ok" : "错误",
): AgentRunRecord["toolCalls"][number] {
  return {
    id: `${name}-${String(params.name ?? params.path ?? params.conversationId ?? "x")}`,
    name,
    params,
    result,
    status,
    startedAt: 1,
    finishedAt: 2,
  }
}

describe("normalizeReferencePath", () => {
  it("maps QM knowledge-dir segments to wiki for UI virtualization", () => {
    expect(normalizeReferencePath("C:/Book/QM/outlines/设定/写作通则.md")).toBe(
      "wiki/outlines/设定/写作通则.md",
    )
    expect(normalizeReferencePath("/Users/a/QM/outlines/章纲/第1章.md")).toBe(
      "wiki/outlines/章纲/第1章.md",
    )
  })
})

describe("agentToolCallsToMessageReferences", () => {
  it("converts successful Agent read tools into assistant message references", () => {
    const references = agentToolCallsToMessageReferences([
      toolCall("read_chapter", {
        name: "第40章-三百人",
        path: "/Users/omi/book/QM/chapters/第40章-三百人.md",
      }),
      toolCall("read_outline", { path: "C:/Book/wiki/outlines/主线.md" }),
      toolCall("read_memory", { name: "主角记忆" }),
      toolCall("read_deduction", { name: "framework_1" }),
      toolCall("write_memory", { name: "不会进入引用" }),
      toolCall("read_memory", { name: "失败记忆" }, "error"),
    ])

    expect(references).toEqual([
      { title: "第40章-三百人", path: "wiki/chapters/第40章-三百人.md" },
      { title: "主线", path: "wiki/outlines/主线.md" },
      { title: "主角记忆", path: "wiki/memory/主角记忆.md" },
      { title: "framework_1", path: ".qmai/simulations/framework_1.json" },
    ])
  })

  it("does not invent a shallow chapter path from a bare chapter number name", () => {
    const references = agentToolCallsToMessageReferences([
      toolCall("read_chapter", { name: "第40章" }, "done", "# 第40章-三百人\n正文"),
    ])
    expect(references).toEqual([])
  })

  it("skips outline snapshot fallback results that are not a single file", () => {
    const references = agentToolCallsToMessageReferences([
      toolCall(
        "read_outline",
        { path: "大纲/章纲" },
        "done",
        "未找到 wiki/outlines 下的独立大纲文件，已读取大纲快照：\n\n## outline-1.snapshot.md\n\n# 快照",
      ),
    ])
    expect(references).toEqual([])
  })

  it("keeps nested outline folders from resolved absolute paths", () => {
    const references = agentToolCallsToMessageReferences([
      toolCall("read_outline", {
        name: "写作通则",
        path: "/Users/omi/book/QM/outlines/设定/写作通则.md",
      }),
    ])

    expect(references).toEqual([
      { title: "写作通则", path: "wiki/outlines/设定/写作通则.md" },
    ])
  })

  it("skips directory-only outline reads such as 卷纲/章纲", () => {
    const references = agentToolCallsToMessageReferences([
      toolCall(
        "read_outline",
        { name: "卷纲" },
        "done",
        "「卷纲」是目录，不是单个大纲。可读取以下条目：\n1. 第一卷",
      ),
      toolCall(
        "read_outline",
        { name: "章纲", path: "/Users/omi/book/QM/outlines/章纲" },
        "done",
        "「章纲」是目录，不是单个大纲。可读取以下条目：\n1. 第1章-分手",
      ),
    ])

    expect(references).toEqual([])
  })

  it("does not invent a shallow outline path from a bare name", () => {
    const references = agentToolCallsToMessageReferences([
      toolCall("read_outline", { name: "写作通则" }, "done", "# 通则正文"),
    ])
    expect(references).toEqual([])
  })

  it("deduplicates references by path", () => {
    const references = agentToolCallsToMessageReferences([
      toolCall("read_chapter", { path: "C:/Book/wiki/chapters/第一章.md", name: "第一章" }),
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
