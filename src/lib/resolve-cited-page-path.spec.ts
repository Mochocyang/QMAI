import { beforeEach, describe, expect, it, vi } from "vitest"
import { listDirectory, readFile } from "@/commands/fs"
import { resolveCitedPagePath } from "./resolve-cited-page-path"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  listDirectory: vi.fn(),
}))

describe("resolveCitedPagePath", () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset()
    vi.mocked(listDirectory).mockReset()
  })

  it("finds nested outline files when the citation dropped the folder", async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/book/QM/outlines/设定/写作通则.md") return "# 通则"
      throw new Error("missing")
    })
    vi.mocked(listDirectory).mockImplementation(async (path) => {
      if (path === "/book/wiki/outlines" || path === "/book/QM/outlines") {
        return [
          { name: "设定", path: `${path}/设定`, is_dir: true },
          { name: "卷纲", path: `${path}/卷纲`, is_dir: true },
        ]
      }
      if (path.endsWith("/设定")) {
        return [
          { name: "写作通则.md", path: `${path}/写作通则.md`, is_dir: false },
        ]
      }
      return []
    })

    await expect(
      resolveCitedPagePath("/book", "wiki/outlines/写作通则.md"),
    ).resolves.toBe("/book/QM/outlines/设定/写作通则.md")
  })

  it("does not treat outline folders as openable files", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("is a directory"))
    vi.mocked(listDirectory).mockResolvedValue([
      { name: "第一卷.md", path: "/book/QM/outlines/卷纲/第一卷.md", is_dir: false },
    ])

    await expect(
      resolveCitedPagePath("/book", "wiki/outlines/卷纲.md"),
    ).resolves.toBeNull()
    await expect(
      resolveCitedPagePath("/book", "大纲/章纲"),
    ).resolves.toBeNull()
  })

  it("resolves bare chapter numbers to titled chapter files", async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/book/QM/chapters/第40章-三百人.md") return "# 第40章"
      throw new Error("missing")
    })
    vi.mocked(listDirectory).mockImplementation(async (path) => {
      if (path === "/book/wiki/chapters" || path === "/book/QM/chapters") {
        return [
          { name: "第39章-发布.md", path: `${path}/第39章-发布.md`, is_dir: false },
          { name: "第40章-三百人.md", path: `${path}/第40章-三百人.md`, is_dir: false },
        ]
      }
      return []
    })

    await expect(
      resolveCitedPagePath("/book", "wiki/chapters/第40章.md"),
    ).resolves.toBe("/book/QM/chapters/第40章-三百人.md")
    await expect(
      resolveCitedPagePath("/book", "wiki/chapters/第 40 章.md"),
    ).resolves.toBe("/book/QM/chapters/第40章-三百人.md")
  })

  it("resolves chapter outlines nested under 章纲/", async () => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/book/QM/outlines/章纲/第41章-暑假不是假期.md") return "# 章纲"
      throw new Error("missing")
    })
    vi.mocked(listDirectory).mockImplementation(async (path) => {
      if (path === "/book/wiki/outlines" || path === "/book/QM/outlines") {
        return [{ name: "章纲", path: `${path}/章纲`, is_dir: true }]
      }
      if (path.endsWith("/章纲")) {
        return [
          {
            name: "第41章-暑假不是假期.md",
            path: `${path}/第41章-暑假不是假期.md`,
            is_dir: false,
          },
        ]
      }
      return []
    })

    await expect(
      resolveCitedPagePath("/book", "wiki/outlines/第41章.md"),
    ).resolves.toBe("/book/QM/outlines/章纲/第41章-暑假不是假期.md")
  })
})
