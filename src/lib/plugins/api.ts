import { invoke } from "@tauri-apps/api/core"
import type { PluginSummary, PluginToolDescriptor } from "./types"

/**
 * 插件管理的 Tauri 命令封装。
 *
 * 全部命令都直接返回 Rust 侧的错误字符串（中文文案），调用方原样展示即可；
 * 这里不再包一层错误码，避免把可读原因吞成笼统的「操作失败」。
 */
export const pluginsApi = {
  list: () => invoke<PluginSummary[]>("plugins_list"),
  install: (source: string) => invoke<PluginSummary>("plugins_install", { source }),
  enable: (id: string, granted: string[]) => invoke<void>("plugins_enable", { id, granted }),
  disable: (id: string) => invoke<void>("plugins_disable", { id }),
  uninstall: (id: string, deleteData: boolean) =>
    invoke<void>("plugins_uninstall", { id, deleteData }),
  tools: () => invoke<PluginToolDescriptor[]>("plugins_tools"),
  invokeTool: (pluginId: string, toolName: string, args: Record<string, unknown>) =>
    invoke<string>("plugins_invoke_tool", { pluginId, toolName, arguments: args }),
  shutdownAll: () => invoke<void>("plugins_shutdown_all"),
}
