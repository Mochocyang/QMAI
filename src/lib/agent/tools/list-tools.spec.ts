import { describe, expect, it, vi, beforeEach } from "vitest"
import { createListChaptersTool } from "./list-chapters"
import { createListOutlinesTool } from "./list-outlines"
import { createListMemoriesTool } from "./list-memories"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))
import { listDirectory, readFile } from "@/commands/fs"

describe("list tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("list_chapters returns file list and latest chapter number", async () => {
    vi.mocked(listDirectory).mockResolvedValue([
      { name: "第1章-无我绝响.md", path: "/p/第1章-无我绝响.md", is_dir: false },
      { name: "第166章-账本.md", path: "/p/第166章-账本.md", is_dir: false },
      { name: "第2章.md", path: "/p/第2章.md", is_dir: false },
      { name: "backup-2024.md", path: "/p/backup-2024.md", is_dir: false },
    ])
    const tool = createListChaptersTool("/project/wiki/chapters")
    const result = await tool.execute({})
    expect(result).toContain("第1章-无我绝响")
    expect(result).toContain("第166章-账本")
    expect(result).toContain("最新已写章节：第 166 章")
    expect(result).toContain("目标为第 167 章")
    expect(result).not.toContain("最新已写章节：第 2024 章")
  })

  it("list_outlines uses default chapterNumber when param omitted", async () => {
    vi.mocked(listDirectory).mockResolvedValue([
      { name: "总纲.md", path: "/project/wiki/outlines/总纲.md", is_dir: false },
    ])
    vi.mocked(readFile).mockResolvedValue(`---\ntype: outline\n---\n`)
    const tool = createListOutlinesTool("/project/wiki/outlines", {
      readTextFile: readFile,
      getDefaultChapterNumber: () => 167,
    })
    const result = await tool.execute({})
    expect(result).toContain("本次目标章号：第 167 章")
  })

  it("list_outlines recursively lists files with folder-first annotations", async () => {
    vi.mocked(listDirectory).mockImplementation(async (path: string) => {
      if (path.endsWith("/outlines")) {
        return [
          { name: "全局设定.md", path: `${path}/全局设定.md`, is_dir: false },
          { name: "卷纲", path: `${path}/卷纲`, is_dir: true },
          { name: "章纲", path: `${path}/章纲`, is_dir: true },
        ]
      }
      if (path.endsWith("/卷纲")) {
        return [
          { name: "第三卷大纲.md", path: `${path}/第三卷大纲.md`, is_dir: false },
        ]
      }
      if (path.endsWith("/章纲")) {
        return [
          { name: "第52章-条件.md", path: `${path}/第52章-条件.md`, is_dir: false },
        ]
      }
      return []
    })
    vi.mocked(readFile).mockImplementation(async (path: string) => {
      if (path.includes("全局设定")) {
        return `---\ntype: overview\ntitle: "全局设定"\n---\n`
      }
      if (path.includes("第三卷大纲")) {
        return `---\ntype: outline\ntitle: "第三卷"\n---\n`
      }
      return "# 纯 Markdown 章纲\n"
    })

    const tool = createListOutlinesTool("/project/wiki/outlines")
    const result = await tool.execute({ chapterNumber: 167 })
    expect(result).toContain("全局设定.md  type=overview")
    expect(result).toContain("卷纲/第三卷大纲.md  folder=卷纲  type=outline")
    expect(result).toContain("章纲/第52章-条件.md  folder=章纲")
    expect(result).toContain("本次目标章号：第 167 章")
    expect(result).toContain("优先按文件夹（folder）分流")
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
