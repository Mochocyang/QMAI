import { beforeEach, describe, expect, it, vi } from "vitest"
import { ToolRegistry } from "@/lib/agent/registry"
import { registerAllBuiltInTools } from "@/lib/agent/tools"

const listDirectory = vi.hoisted(() => vi.fn())

vi.mock("@/commands/fs", () => ({
  listDirectory,
  readFile: vi.fn(async () => { throw new Error("不应调用默认读取") }),
  writeFile: vi.fn(),
  createDirectory: vi.fn(),
}))

describe("context hub read tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listDirectory.mockResolvedValue([])
  })

  it("routes chapter, outline, memory and deduction reads through the injected reader", async () => {
    const readTextFile = vi.fn(async (path: string) => `缓存内容:${path}`)
    const registry = new ToolRegistry()
    registerAllBuiltInTools(registry, {
      wikiPath: "/project/wiki",
      getSkillConfig: () => null,
      getChatConversations: () => [],
      getOutlineConversations: () => [],
      readTextFile,
      enabledToolNames: ["read_chapter", "read_outline", "read_memory", "read_deduction"],
    })

    await registry.get("read_chapter")!.execute({ path: "/project/wiki/chapters/1.md" })
    await registry.get("read_outline")!.execute({ path: "/project/wiki/outlines/main.md" })
    await registry.get("read_memory")!.execute({ path: "/project/wiki/memory/clue.md" })
    await registry.get("read_deduction")!.execute({ path: "/project/.qmai/simulations/run.json" })

    expect(readTextFile.mock.calls.map(([path]) => path)).toEqual([
      "/project/wiki/chapters/1.md",
      "/project/wiki/outlines/main.md",
      "/project/wiki/memory/clue.md",
      "/project/.qmai/simulations/run.json",
    ])
  })

  it("routes chapter search content reads through the injected reader", async () => {
    const readTextFile = vi.fn(async () => "车站里留下了旧车票。")
    listDirectory.mockResolvedValue([
      { name: "第1章.md", path: "/project/wiki/chapters/第1章.md", is_dir: false },
    ])
    const registry = new ToolRegistry()
    registerAllBuiltInTools(registry, {
      wikiPath: "/project/wiki",
      getSkillConfig: () => null,
      getChatConversations: () => [],
      getOutlineConversations: () => [],
      readTextFile,
      enabledToolNames: ["search_chapters"],
    })

    const result = await registry.get("search_chapters")!.execute({ keyword: "旧车票" })

    expect(result).toContain("旧车票")
    expect(readTextFile).toHaveBeenCalledWith("/project/wiki/chapters/第1章.md")
  })
})
