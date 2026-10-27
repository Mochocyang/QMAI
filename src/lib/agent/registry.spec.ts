import { describe, expect, it, beforeEach } from "vitest"
import { ToolRegistry } from "./registry"
import type { Tool } from "./types"

function makeTool(name: string, category: "read" | "write" | "action" = "read"): Tool {
  return {
    name,
    description: `${name} description`,
    category,
    parameters: {},
    execute: async () => `${name} result`,
  }
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  it("registers and retrieves a tool by name", () => {
    const tool = makeTool("read_chapter")
    registry.register(tool)
    expect(registry.get("read_chapter")).toBe(tool)
  })

  it("has() returns true for registered tool", () => {
    registry.register(makeTool("read_chapter"))
    expect(registry.has("read_chapter")).toBe(true)
    expect(registry.has("nonexistent")).toBe(false)
  })

  it("list() returns all registered tools", () => {
    registry.register(makeTool("read_chapter"))
    registry.register(makeTool("write_chapter", "write"))
    expect(registry.list()).toHaveLength(2)
  })

  it("listByCategory() filters by category", () => {
    registry.register(makeTool("read_chapter", "read"))
    registry.register(makeTool("read_memory", "read"))
    registry.register(makeTool("write_chapter", "write"))
    expect(registry.listByCategory("read")).toHaveLength(2)
    expect(registry.listByCategory("write")).toHaveLength(1)
    expect(registry.listByCategory("action")).toHaveLength(0)
  })

  it("clear() removes all tools", () => {
    registry.register(makeTool("read_chapter"))
    registry.clear()
    expect(registry.list()).toHaveLength(0)
  })

  it("registering duplicate name overwrites", () => {
    const a = makeTool("read_chapter")
    const b = makeTool("read_chapter", "write")
    registry.register(a)
    registry.register(b)
    expect(registry.get("read_chapter")?.category).toBe("write")
  })
})

describe("ToolRegistry.unregisterPrefix", () => {
  it("只删带前缀的工具，内置工具不动", () => {
    const r = new ToolRegistry()
    r.register(makeTool("read_chapter"))
    r.register(makeTool("chapter_insights__analyze"))
    r.register(makeTool("chapter_insights__report"))
    // 近乎同名的对照：不以 `chapter_insights__` 开头，必须存活
    r.register(makeTool("chapter_insightsx__a"))

    const removed = r.unregisterPrefix("chapter_insights__")

    expect(removed).toBe(2)
    expect(r.has("read_chapter")).toBe(true)
    expect(r.has("chapter_insightsx__a")).toBe(true)
    expect(r.has("chapter_insights__analyze")).toBe(false)
    expect(r.list().map((t) => t.name).sort()).toEqual(
      ["chapter_insightsx__a", "read_chapter"],
    )
  })

  it("前缀不存在时返回 0 且不报错", () => {
    const r = new ToolRegistry()
    r.register(makeTool("read_chapter"))
    expect(r.unregisterPrefix("nope__")).toBe(0)
    expect(r.list()).toHaveLength(1)
  })

  it("空前缀不删除任何工具（防误清空）", () => {
    const r = new ToolRegistry()
    r.register(makeTool("read_chapter"))
    r.register(makeTool("chapter_insights__analyze"))
    expect(r.unregisterPrefix("")).toBe(0)
    expect(r.list()).toHaveLength(2)
  })
})
