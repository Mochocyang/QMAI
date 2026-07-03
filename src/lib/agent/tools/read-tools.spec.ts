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
  listDirectory: vi.fn(),
}))

import { listDirectory, readFile } from "@/commands/fs"

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

  it("read_chapter falls back to matching available chapter names when the model uses a natural title", async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/project/wiki/chapters/第20章 兄弟.md") return "第20章正文"
      throw new Error("missing")
    })
    vi.mocked(listDirectory).mockResolvedValue([
      { name: "第20章 兄弟.md", path: "/project/wiki/chapters/第20章 兄弟.md", is_dir: false },
    ])

    const tool = createReadChapterTool("/project/wiki/chapters")
    const result = await tool.execute({ name: "第20章-兄弟" })

    expect(result).toBe("第20章正文")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/chapters/第20章-兄弟.md")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/chapters/第20章 兄弟.md")
  })

  it("read_chapter matches Chinese chapter requests to zero-padded English chapter files", async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/project/wiki/chapters/chapter-020.md") return "第二十章正文"
      throw new Error("missing")
    })
    vi.mocked(listDirectory).mockResolvedValue([
      { name: "chapter-018.md", path: "/project/wiki/chapters/chapter-018.md", is_dir: false },
      { name: "chapter-019.md", path: "/project/wiki/chapters/chapter-019.md", is_dir: false },
      { name: "chapter-020.md", path: "/project/wiki/chapters/chapter-020.md", is_dir: false },
    ])

    const tool = createReadChapterTool("/project/wiki/chapters")
    const result = await tool.execute({ name: "第20章-众生相" })

    expect(result).toBe("第二十章正文")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/chapters/chapter-020.md")
  })

  it("read_memory reads from memory dir", async () => {
    vi.mocked(readFile).mockResolvedValue("memory content")
    const tool = createReadMemoryTool("/project/wiki/memory")
    const result = await tool.execute({ name: "曙光组织" })
    expect(result).toBe("memory content")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/memory/曙光组织.md")
  })

  it("read_memory reads a nested memory entry by matching available files", async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/project/wiki/memory/人物状态/主角状态.md") return "主角状态内容"
      throw new Error("missing")
    })
    vi.mocked(listDirectory).mockImplementation(async (path) => {
      if (path === "/project/wiki/memory") {
        return [{ name: "人物状态", path: "/project/wiki/memory/人物状态", is_dir: true }]
      }
      if (path === "/project/wiki/memory/人物状态") {
        return [{ name: "主角状态.md", path: "/project/wiki/memory/人物状态/主角状态.md", is_dir: false }]
      }
      return []
    })

    const tool = createReadMemoryTool("/project/wiki/memory")
    const result = await tool.execute({ name: "主角状态" })

    expect(result).toBe("主角状态内容")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/memory/主角状态.md")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/memory/人物状态/主角状态.md")
  })

  it("read_memory resolves Chinese combined memory aliases to structured memory files", async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/project/wiki/memory/character-states.md") return "# 人物状态记忆"
      if (path === "/project/wiki/memory/foreshadowing-tracker.md") return "# 伏笔追踪记忆"
      throw new Error("missing")
    })

    const tool = createReadMemoryTool("/project/wiki/memory")
    const result = await tool.execute({ name: "人物状态与伏笔" })

    expect(result).toContain("人物状态记忆")
    expect(result).toContain("伏笔追踪记忆")
    expect(result).not.toContain("请确认文件存在")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/memory/character-states.md")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/memory/foreshadowing-tracker.md")
  })

  it("read_memory reports nested candidates when the requested name is a directory category", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("missing"))
    vi.mocked(listDirectory).mockImplementation(async (path) => {
      if (path === "/project/wiki/memory") {
        return [{ name: "人物状态", path: "/project/wiki/memory/人物状态", is_dir: true }]
      }
      if (path === "/project/wiki/memory/人物状态") {
        return [
          { name: "主角状态.md", path: "/project/wiki/memory/人物状态/主角状态.md", is_dir: false },
          { name: "反派状态.md", path: "/project/wiki/memory/人物状态/反派状态.md", is_dir: false },
        ]
      }
      return []
    })

    const tool = createReadMemoryTool("/project/wiki/memory")
    const result = await tool.execute({ name: "人物状态" })

    expect(result).toContain("「人物状态」是目录")
    expect(result).toContain("主角状态")
    expect(result).toContain("反派状态")
    expect(result).not.toContain("请确认文件存在")
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

  it("read_outline matches punctuation-insensitive outline names", async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/project/wiki/outlines/他只想活着大纲.md") return "大纲内容"
      throw new Error("missing")
    })
    vi.mocked(listDirectory).mockResolvedValue([
      { name: "他只想活着大纲.md", path: "/project/wiki/outlines/他只想活着大纲.md", is_dir: false },
    ])

    const tool = createReadOutlineTool("/project/wiki/outlines")
    const result = await tool.execute({ name: "他，只想活着-大纲" })

    expect(result).toBe("大纲内容")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/outlines/他，只想活着-大纲.md")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/outlines/他只想活着大纲.md")
  })

  it("read_outline falls back to outline snapshots when wiki outlines are empty", async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/project/.novel/snapshots/outline-312.snapshot.md") return "# 大纲快照一"
      if (path === "/project/.novel/snapshots/outline-765.snapshot.md") return "# 大纲快照二"
      throw new Error("missing")
    })
    vi.mocked(listDirectory).mockImplementation(async (path) => {
      if (path === "/project/wiki/outlines") return []
      if (path === "/project/.novel/snapshots") {
        return [
          { name: "outline-312.snapshot.md", path: "/project/.novel/snapshots/outline-312.snapshot.md", is_dir: false },
          { name: "outline-765.snapshot.md", path: "/project/.novel/snapshots/outline-765.snapshot.md", is_dir: false },
        ]
      }
      return []
    })

    const tool = createReadOutlineTool("/project/wiki/outlines")
    const result = await tool.execute({ name: "他，只想活着-大纲" })

    expect(result).toContain("已读取大纲快照")
    expect(result).toContain("大纲快照一")
    expect(result).toContain("大纲快照二")
    expect(result).not.toContain("请确认文件存在")
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

  it("search_chapters searches chapter contents by keyword", async () => {
    vi.mocked(listDirectory).mockResolvedValue([
      { name: "第19章.md", path: "/project/wiki/chapters/第19章.md", is_dir: false },
      { name: "第20章.md", path: "/project/wiki/chapters/第20章.md", is_dir: false },
      { name: "notes.txt", path: "/project/wiki/chapters/notes.txt", is_dir: false },
    ])
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/project/wiki/chapters/第20章.md") {
        return "上一章余波未平，归元魄第一次在夜色中显露出真正的裂痕。"
      }
      return "这一章没有目标关键词。"
    })

    const tool = createSearchChaptersTool("/project/wiki/chapters")
    const result = await tool.execute({ keyword: "归元魄" })

    expect(result).toContain("搜索章节内容中匹配「归元魄」的结果")
    expect(result).toContain("第20章")
    expect(result).toContain("归元魄第一次")
    expect(result).toContain("命中片段")
    expect(result).not.toContain("基础实现")
    expect(listDirectory).toHaveBeenCalledWith("/project/wiki/chapters")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/chapters/第19章.md")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/chapters/第20章.md")
    expect(readFile).not.toHaveBeenCalledWith("/project/wiki/chapters/notes.txt")
  })

  it("search_chapters matches chapter filename keywords", async () => {
    vi.mocked(listDirectory).mockResolvedValue([
      { name: "第20章.md", path: "/project/wiki/chapters/第20章.md", is_dir: false },
    ])
    vi.mocked(readFile).mockResolvedValue("她回头望向城门，知道这一夜会改变所有人的命运。")

    const tool = createSearchChaptersTool("/project/wiki/chapters")
    const result = await tool.execute({ keyword: "第20章" })

    expect(result).toContain("第20章")
    expect(result).toContain("命中位置：文件名")
    expect(result).toContain("她回头望向城门")
    expect(result).not.toContain("基础实现")
  })

  it("search_chapters reports no matches without placeholder text", async () => {
    vi.mocked(listDirectory).mockResolvedValue([
      { name: "第1章.md", path: "/project/wiki/chapters/第1章.md", is_dir: false },
    ])
    vi.mocked(readFile).mockResolvedValue("这一章没有搜索目标。")

    const tool = createSearchChaptersTool("/project/wiki/chapters")
    const result = await tool.execute({ keyword: "不存在的关键词" })

    expect(result).toContain("未找到匹配章节")
    expect(result).not.toContain("基础实现")
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
