import { invoke } from "@tauri-apps/api/core"
import type {
  PluginProviderModel,
  PluginProviderView,
  PluginSummary,
  PluginToolDescriptor,
} from "./types"

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
  // provider：列表不含 token；token 只有 providerAuth 能取到（不落盘，见 v2.0 计划第 0 节）。
  providers: () => invoke<PluginProviderView[]>("plugins_providers"),
  providerAuth: (providerId: string) => invoke<string>("plugins_provider_auth", { providerId }),
  refreshProviderModels: (providerId: string) =>
    invoke<PluginProviderModel[]>("plugins_provider_refresh_models", { providerId }),
  shutdownAll: () => invoke<void>("plugins_shutdown_all"),
}
