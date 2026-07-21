import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))
vi.mock("@/lib/search", () => ({
  searchWiki: vi.fn(),
  tokenizeQuery: vi.fn(() => []),
}))

import { listDirectory, readFile } from "@/commands/fs"
import { searchWiki } from "@/lib/search"
import { readOutlineContent } from "./context-engine"

describe("纯 Markdown 大纲上下文读取", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(searchWiki).mockResolvedValue([])
  })

  it("搜索索引没有 type:outline 时从大纲目录读取并剥离历史 YAML", async () => {
    vi.mocked(listDirectory).mockResolvedValue([{
      name: "章纲",
      path: "C:/book/wiki/outlines/章纲",
      is_dir: true,
      children: [{
        name: "第001章.md",
        path: "C:/book/wiki/outlines/章纲/第001章.md",
        is_dir: false,
      }],
    }])
    vi.mocked(readFile).mockResolvedValue([
      "---",
      "type: outline",
      "outline_type: chapter-outline",
      "---",
      "",
      "# 第001章章纲",
      "",
      "- 主角进入旧城",
    ].join("\n"))

    const result = await readOutlineContent("C:/book")

    expect(listDirectory).toHaveBeenCalledWith("C:/book/wiki/outlines")
    expect(result).toContain("# 第001章章纲")
    expect(result).toContain("主角进入旧城")
    expect(result).not.toContain("type: outline")
    expect(result).not.toContain("outline_type:")
  })
})
