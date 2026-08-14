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
import { readOutlineContent } from "./context-engine"

describe("纯 Markdown 大纲上下文读取", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("只加载总纲和设定，不把章纲混入 outline", async () => {
    vi.mocked(listDirectory).mockResolvedValue([{
      name: "大纲",
      path: "C:/book/wiki/outlines/大纲",
      is_dir: true,
      children: [{
        name: "总纲.md",
        path: "C:/book/wiki/outlines/大纲/总纲.md",
        is_dir: false,
      }],
    }, {
      name: "章纲",
      path: "C:/book/wiki/outlines/章纲",
      is_dir: true,
      children: [{
        name: "第001章.md",
        path: "C:/book/wiki/outlines/章纲/第001章.md",
        is_dir: false,
      }],
    }])
    vi.mocked(readFile).mockImplementation(async (path) => path.includes("总纲")
      ? "---\ntype: outline\n---\n# 总纲\n主线内容"
      : "---\ntype: outline\noutline_type: chapter-outline\n---\n# 第001章章纲\n不应混入")

    const result = await readOutlineContent("C:/book")

    expect(listDirectory).toHaveBeenCalledWith("C:/book/wiki/outlines")
    expect(result).toContain("# 总纲")
    expect(result).toContain("主线内容")
    expect(result).not.toContain("第001章章纲")
    expect(result).not.toContain("不应混入")
    expect(result).not.toContain("type: outline")
  })
})
