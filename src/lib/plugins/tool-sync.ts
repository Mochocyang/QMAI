/**
 * 把运行中插件贡献的工具同步到前端缓存。
 *
 * 为什么需要这层缓存：`buildAgentConfig` 是**同步**函数、要在渲染路径上被调用
 * （`use-agent-config` 的 useMemo、大纲聊天面板里点发送的那一刻），拿不到 await；
 * 所以这里做「异步拉取 → 同步读缓存」，与 `provider-sync` 同一形态。
 *
 * 与 provider-sync 的分工：provider 同步写 zustand（模型列表本来就读 store），
 * 工具同步只维护一个模块级快照 —— 工具不落盘、也不需要跨页面共享状态，
 * 唯一的消费者是 `buildAgentConfig` 的调用点。
 *
 * 两条护栏：
 *   1. **只在内容变化时**替换缓存并通知。启动 + 设置页 + 每次启停都会调同步，
 *      免费重渲染会让聊天页反复重建 agent config（每次都要 registry.clear() 重注册）。
 *   2. 拉取失败**保留旧缓存**。一次 IPC 抖动不该让已经可用的工具从模型列表里消失，
 *      那会把「插件偶发同步失败」放大成「模型忽然不会用工具了」。
 */
import { pluginsApi } from "./api"
import { inputSchemaToParameters, pluginToolPrefix } from "./tool-bridge"
import type { PluginToolDescriptor, PluginToolInvoker, PluginToolWireDescriptor } from "./types"

/** 最近一次同步的成果，供 `buildAgentConfig` 同步读取。 */
let descriptors: PluginToolDescriptor[] = []

const listeners = new Set<() => void>()

/** 同步读：给 `buildAgentConfig` 用。引用稳定，内容不变时不会变。 */
export function getPluginToolDescriptors(): PluginToolDescriptor[] {
  return descriptors
}

/** 订阅快照变化（供 `useSyncExternalStore` 使用）。 */
export function subscribePluginTools(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 原始返回项 → 内部描述符。
 *
 * 字段名错位见 `PluginToolWireDescriptor` 的注释：Rust 的 `parameters` 装的是
 * inputSchema 原文，这里把它当 `inputSchema` 收下，并顺手算好内部映射形状。
 */
function toDescriptor(raw: PluginToolWireDescriptor): PluginToolDescriptor | null {
  // 没名字的工具注册不进 registry（与 Rust 侧 describe_tool 的取舍一致）
  if (!raw || typeof raw.name !== "string" || !raw.name) return null
  if (typeof raw.pluginId !== "string" || !raw.pluginId) return null
  return {
    pluginId: raw.pluginId,
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : "",
    inputSchema: raw.parameters,
    parameters: inputSchemaToParameters(raw.parameters),
  }
}

/**
 * 同步一次插件工具列表。
 *
 * 调用时机：应用启动（与 provider 同步同一个 try/catch）、插件启用/停用/卸载后、
 * 模型设置页挂载时。
 *
 * 失败**不抛**：调用点都在用户操作/启动路径上，工具同步失败不该让「启用插件成功」
 * 被报成「启用失败」，也不该挡住应用启动。这里只 warn 并保留旧缓存。
 */
export async function syncPluginTools(): Promise<void> {
  let raw: unknown
  try {
    raw = await pluginsApi.tools()
  } catch (error) {
    console.warn("[plugins] 同步插件工具失败，沿用上次结果：", error)
    return
  }

  const list = Array.isArray(raw) ? raw : []
  const next = list
    .map((item) => toDescriptor(item as PluginToolWireDescriptor))
    .filter((descriptor): descriptor is PluginToolDescriptor => descriptor !== null)

  // 免费同步（启动、设置页、启停各一次）不该每次都通知订阅者重渲染
  if (JSON.stringify(next) === JSON.stringify(descriptors)) return
  descriptors = next
  for (const listener of listeners) listener()
}

/**
 * 给 `buildAgentConfig` 用的调用实现。
 *
 * 名字还原成插件内原名：插件只认自己 `tools/list` 报过的名字，不认识宿主注入的
 * `<pluginId>__` 前缀。`registerPluginTools` 传下来的本来就是原名，但调用链上任何
 * 一环把宿主名漏下来，插件都会报「未知工具」，所以这里再兜一层。
 */
export function invokePluginToolViaTauri(): PluginToolInvoker {
  return async (pluginId, toolName, args) => {
    const prefix = pluginToolPrefix(pluginId)
    const originalName = toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName
    return pluginsApi.invokeTool(pluginId, originalName, args)
  }
}
