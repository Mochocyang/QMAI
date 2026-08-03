import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
}))

import { listDirectory } from "@/commands/fs"
import {
  detectLocalEntityMiss,
  hasLocalEntityMention,
  listLocalEntityNames,
} from "./local-entity-names"

describe("local-entity-names", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists markdown stems from entities/characters/concepts without reading content", async () => {
    vi.mocked(listDirectory).mockImplementation(async (path: string) => {
      if (path.endsWith("wiki/entities")) {
        return [
          { name: "黄蓉.md", path: "/project/wiki/entities/黄蓉.md", is_dir: false },
          { name: "a.md", path: "/project/wiki/entities/a.md", is_dir: false },
        ]
      }
      if (path.endsWith("wiki/characters")) {
        return [{ name: "郭靖.md", path: "/project/wiki/characters/郭靖.md", is_dir: false }]
      }
      if (path.endsWith("wiki/concepts")) {
        return [{ name: "降龙十八掌.md", path: "/project/wiki/concepts/降龙十八掌.md", is_dir: false }]
      }
      throw new Error(`missing dir: ${path}`)
    })

    const names = await listLocalEntityNames("/project")

    expect(names).toHaveLength(3)
    expect(names).toEqual(expect.arrayContaining(["郭靖", "黄蓉", "降龙十八掌"]))
    expect(names).not.toContain("a")
  })

  it("returns empty list when entity directories are missing", async () => {
    vi.mocked(listDirectory).mockRejectedValue(new Error("ENOENT"))
    await expect(listLocalEntityNames("/project")).resolves.toEqual([])
  })

  it("detects local entity mention by substring and ignores short names", () => {
    expect(hasLocalEntityMention("黄蓉是谁", ["黄蓉", "郭靖"])).toBe(true)
    expect(hasLocalEntityMention("洪七公怎么样", ["黄蓉", "郭靖"])).toBe(false)
    expect(hasLocalEntityMention("查一下 a", ["a", "黄蓉"])).toBe(false)
    expect(hasLocalEntityMention("黄蓉是谁", [])).toBe(false)
  })

  it("treats empty table or unmatched message as local entity miss", async () => {
    vi.mocked(listDirectory).mockResolvedValue([])
    await expect(detectLocalEntityMiss("/project", "黄蓉是谁")).resolves.toBe(true)

    vi.mocked(listDirectory).mockImplementation(async (path: string) => {
      if (path.endsWith("wiki/entities")) {
        return [{ name: "郭靖.md", path: "/project/wiki/entities/郭靖.md", is_dir: false }]
      }
      return []
    })
    await expect(detectLocalEntityMiss("/project", "黄蓉是谁")).resolves.toBe(true)
    await expect(detectLocalEntityMiss("/project", "郭靖的性格")).resolves.toBe(false)
  })
})
