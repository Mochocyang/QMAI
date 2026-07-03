import { beforeEach, describe, expect, it, vi } from "vitest"
import { resolveReference } from "./resolve"
import type { ReferenceToken } from "./types"

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  readFile: mocks.readFile,
}))

function token(overrides: Partial<ReferenceToken>): ReferenceToken {
  return {
    id: "r1",
    category: "chapter",
    title: "第一章",
    displayTitle: "第一章",
    ...overrides,
  }
}

describe("resolveReference", () => {
  beforeEach(() => {
    mocks.readFile.mockReset()
  })

  it("reads file-backed references and returns metadata", async () => {
    mocks.readFile.mockResolvedValue("正文内容")

    const result = await resolveReference(token({ path: "C:/Novel/wiki/chapters/第一章.md" }))

    expect(mocks.readFile).toHaveBeenCalledWith("C:/Novel/wiki/chapters/第一章.md")
    expect(result.content).toBe("正文内容")
    expect(result.metadata).toEqual({
      byteLength: new TextEncoder().encode("正文内容").length,
      charCount: 4,
    })
  })

  it("returns a readable placeholder for conversation references", async () => {
    const result = await resolveReference(token({
      category: "chat_history",
      conversationId: "c1",
      title: "历史对话",
    }))

    expect(result.content).toBe("[跨会话引用: 历史对话, id=c1]")
    expect(result.metadata).toEqual({ byteLength: 0, charCount: 0 })
    expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it("returns a readable placeholder for skill references", async () => {
    const result = await resolveReference(token({
      category: "skill",
      skillId: "s1",
      title: "润色技能",
    }))

    expect(result.content).toBe("[技能引用: 润色技能]")
    expect(result.metadata).toEqual({ byteLength: 0, charCount: 0 })
  })

  it("returns a Chinese error placeholder when a file cannot be read", async () => {
    mocks.readFile.mockRejectedValue(new Error("missing"))

    const result = await resolveReference(token({ path: "C:/missing.md" }))

    expect(result.content).toBe("[无法读取: C:/missing.md]")
    expect(result.metadata).toEqual({ byteLength: 0, charCount: 0 })
  })
})
