import type { Tool, ToolCategory } from "./types"

export class ToolRegistry {
  private tools = new Map<string, Tool>()

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  list(): Tool[] {
    return Array.from(this.tools.values())
  }

  listByCategory(category: ToolCategory): Tool[] {
    return this.list().filter((t) => t.category === category)
  }

  clear(): void {
    this.tools.clear()
  }
}
