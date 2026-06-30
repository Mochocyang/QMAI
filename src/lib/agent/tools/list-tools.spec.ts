import { describe, expect, it, vi, beforeEach } from "vitest"
import { createListChaptersTool } from "./list-chapters"
import { createListMemoriesTool } from "./list-memories"

vi.mock("@/commands/fs", () => ({ listDirectory: vi.fn() }))
import { listDirectory } from "@/commands/fs"

describe("list tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("list_chapters returns file list from chapters dir", async () => {
    vi.mocked(listDirectory).mockResolvedValue([
      { name: "第1章-无我绝响.md", path: "/p/第1章-无我绝响.md", is_dir: false },
      { name: "第2章.md", path: "/p/第2章.md", is_dir: false },
    ])
    const tool = createListChaptersTool("/project/wiki/chapters")
    const result = await tool.execute({})
    expect(result).toContain("第1章-无我绝响")
    expect(result).toContain("第2章")
  })

  it("list_memories returns file list from memory dir", async () => {
    vi.mocked(listDirectory).mockResolvedValue([
      { name: "曙光组织.md", path: "/p/曙光组织.md", is_dir: false },
    ])
    const tool = createListMemoriesTool("/project/wiki/memory")
    const result = await tool.execute({})
    expect(result).toContain("曙光组织")
  })

  it("handles listDirectory error gracefully", async () => {
    vi.mocked(listDirectory).mockRejectedValue(new Error("dir not found"))
    const tool = createListChaptersTool("/missing")
    const result = await tool.execute({})
    expect(result).toContain("错误")
  })
})
