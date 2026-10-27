import type { ToolRegistry } from "@/lib/agent/registry"
import type { Tool } from "@/lib/agent/types"
import type { PluginToolDescriptor, PluginToolInvoker } from "./types"

/**
 * 插件工具名一律加前缀再进 registry。
 *
 * `ToolRegistry.register` 内部是 `Map.set`，同名会**静默覆盖**；内置工具已占用
 * `read_chapter` / `search_chapters` 这类通用名，不加前缀时一个同名的插件工具
 * 就能悄悄顶掉内置能力。
 */
const HOST_NAME_SEPARATOR = "__"

/** pluginId 里的 `-` 换成 `_`，拼上 `__` 与工具名 */
export function toHostToolName(pluginId: string, toolName: string): string {
  return `${pluginId.replace(/-/g, "_")}${HOST_NAME_SEPARATOR}${toolName}`
}

/** 反向还原；不是插件工具名（不含 `__`）时返回 null */
export function toPluginToolName(hostName: string): string | null {
  const idx = hostName.indexOf(HOST_NAME_SEPARATOR)
  // 用 indexOf 而不是 split：工具名自身可能含 `__`（如 a__b），只切第一个分隔符
  return idx < 0 ? null : hostName.slice(idx + HOST_NAME_SEPARATOR.length)
}

export function pluginToolPrefix(pluginId: string): string {
  return `${pluginId.replace(/-/g, "_")}${HOST_NAME_SEPARATOR}`
}

/**
 * 把插件工具注入 registry。
 *
 * 已存在同名工具时**不覆盖**——插件的工具必须让位于宿主已注册的同名工具，
 * 否则一次插件安装就能替换掉内置能力（register 内部是 Map.set，覆盖是静默的）。
 */
export function registerPluginTools(
  registry: ToolRegistry,
  descriptors: PluginToolDescriptor[],
  invoke: PluginToolInvoker,
): void {
  for (const d of descriptors) {
    const hostName = toHostToolName(d.pluginId, d.name)
    if (registry.has(hostName)) continue
    const tool: Tool = {
      name: hostName,
      description: d.description,
      category: "action",
      // 第三方代码写用户项目，默认要人工确认，不做静默执行
      permission: "confirm",
      parameters: d.parameters,
      // 发给插件的必须是插件内的原名：插件不认识带宿主前缀的名字
      execute: async (params) => invoke(d.pluginId, d.name, params),
    }
    registry.register(tool)
  }
}

export function unregisterPluginTools(registry: ToolRegistry, pluginId: string): number {
  return registry.unregisterPrefix(pluginToolPrefix(pluginId))
}
