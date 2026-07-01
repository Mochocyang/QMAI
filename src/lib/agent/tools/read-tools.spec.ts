import { describe, expect, it, vi, beforeEach } from "vitest"
import { createReadChapterTool } from "./read-chapter"
import { createReadMemoryTool } from "./read-memory"
import { createReadOutlineTool } from "./read-outline"
import { createReadDeductionTool } from "./read-deduction"
import { createReadChatHistoryTool } from "./read-chat-history"
import { createReadOutlineHistoryTool } from "./read-outline-history"
import { createSearchChaptersTool } from "./search-chapters"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
}))

import { readFile } from "@/commands/fs"

describe("read tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("read_chapter reads file from chapters dir", async () => {
    vi.mocked(readFile).mockResolvedValue("chapter content")
    const tool = createReadChapterTool("/project/wiki/chapters")
    const result = await tool.execute({ name: "第1章" })
    expect(result).toBe("chapter content")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/chapters/第1章.md")
  })

  it("read_memory reads from memory dir", async () => {
    vi.mocked(readFile).mockResolvedValue("memory content")
    const tool = createReadMemoryTool("/project/wiki/memory")
    const result = await tool.execute({ name: "曙光组织" })
    expect(result).toBe("memory content")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/memory/曙光组织.md")
  })

  it("read_memory reads an explicit nested memory path", async () => {
    vi.mocked(readFile).mockResolvedValue("nested memory content")
    const tool = createReadMemoryTool("/project/wiki/memory")
    const result = await tool.execute({ path: "/project/wiki/memory/角色/主角.md" })
    expect(result).toBe("nested memory content")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/memory/角色/主角.md")
  })

  it("read_outline reads from outlines dir", async () => {
    vi.mocked(readFile).mockResolvedValue("outline content")
    const tool = createReadOutlineTool("/project/wiki/outlines")
    const result = await tool.execute({ path: "/project/wiki/outlines/main.md" })
    expect(result).toBe("outline content")
  })

  it("read_deduction reads from simulations dir", async () => {
    vi.mocked(readFile).mockResolvedValue('{"result":"sim data"}')
    const tool = createReadDeductionTool("/project/.qmai/simulations")
    const result = await tool.execute({ name: "framework_1" })
    expect(result).toContain("sim data")
  })

  it("read_deduction reads an explicit framework or result path", async () => {
    vi.mocked(readFile).mockResolvedValue("# framework")
    const tool = createReadDeductionTool("/project/.qmai/simulations")
    const result = await tool.execute({ path: "/project/.qmai/simulations/frameworks/main.md" })
    expect(result).toBe("# framework")
    expect(readFile).toHaveBeenCalledWith("/project/.qmai/simulations/frameworks/main.md")
  })

  it("search_chapters searches by keyword", async () => {
    const tool = createSearchChaptersTool("/project/wiki/chapters")
    const result = await tool.execute({ keyword: "无我" })
    expect(result).toContain("搜索")
  })

  it("read_chat_history reads from provided conversations", async () => {
    const conversations = [{ id: "conv1", title: "Test", messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello!" }] }]
    const tool = createReadChatHistoryTool(conversations as any)
    const result = await tool.execute({ conversationId: "conv1" })
    expect(result).toContain("Hi")
    expect(result).toContain("Hello!")
  })

  it("read_chat_history returns error for unknown conversation", async () => {
    const tool = createReadChatHistoryTool([])
    const result = await tool.execute({ conversationId: "missing" })
    expect(result).toContain("未找到")
  })

  it("read_outline_history reads from provided conversations", async () => {
    const conversations = [{ id: "oc1", title: "Outline", messages: [{ role: "user", content: "plan" }] }]
    const tool = createReadOutlineHistoryTool(conversations as any)
    const result = await tool.execute({ conversationId: "oc1" })
    expect(result).toContain("plan")
  })
})
