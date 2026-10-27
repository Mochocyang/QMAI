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

  /**
   * 按前缀注销工具，返回删除数量。
   *
   * 插件工具统一带 `<pluginId 下划线化>__` 前缀（见设计文档 9.2），
   * 插件停用/卸载时只清自己那一批，不碰内置工具。
   */
  unregisterPrefix(prefix: string): number {
    let removed = 0
    for (const name of [...this.tools.keys()]) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name)
        removed += 1
      }
    }
    return removed
  }

  clear(): void {
    this.tools.clear()
  }
}
