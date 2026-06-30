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
