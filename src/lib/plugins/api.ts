import { invoke } from "@tauri-apps/api/core"
import type {
  PluginProviderEndpoint,
  PluginProviderModel,
  PluginProviderView,
  PluginSummary,
  PluginToolWireDescriptor,
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
  // 本地目录安装：插件作者不推 GitHub 也能在本机迭代，验收时也用它装测试插件。
  installLocal: (path: string) => invoke<PluginSummary>("plugins_install_local", { path }),
  enable: (id: string, granted: string[]) => invoke<void>("plugins_enable", { id, granted }),
  disable: (id: string) => invoke<void>("plugins_disable", { id }),
  uninstall: (id: string, deleteData: boolean) =>
    invoke<void>("plugins_uninstall", { id, deleteData }),
  // 注意：Rust 的 `parameters` 字段装的是 inputSchema 原文，见 PluginToolWireDescriptor。
  tools: () => invoke<PluginToolWireDescriptor[]>("plugins_tools"),
  invokeTool: (pluginId: string, toolName: string, args: Record<string, unknown>) =>
    invoke<string>("plugins_invoke_tool", { pluginId, toolName, arguments: args }),
  // provider：列表不含 token；token 只有 providerAuth 能取到（不落盘，见 v2.0 计划第 0 节）。
  providers: () => invoke<PluginProviderView[]>("plugins_providers"),
  providerAuth: (providerId: string) => invoke<string>("plugins_provider_auth", { providerId }),
  refreshProviderModels: (providerId: string) =>
    invoke<PluginProviderModel[]>("plugins_provider_refresh_models", { providerId }),
  /**
   * 打开插件的受控登录窗口（设计 §5：插件自托管页面 + 宿主受控窗口）。
   *
   * 为什么前端只传 `providerId` 而不传 URL：`settingsPagePath` 的拼接、导航白名单
   * （`authDomains`）、临时数据目录都在 Rust 侧做。URL 一旦由前端拼，白名单就退化成
   * 「前端说了算」，插件能借一次参数注入把窗口变成任意浏览器（设计 §5.2）。
   *
   * 返回 `void`：窗口关闭后 Rust 会自己重探活 + 重抓模型。
   */
  providerOpenLogin: (providerId: string) =>
    invoke<void>("plugins_provider_open_login", { providerId }),
  /**
   * 打插件的可选扩展端点（`capabilities` 驱动，设计 §4.4）。
   *
   * 返回值**故意是 `unknown`**：结构由各插件决定，宿主只负责渲染，归一化放在
   * 卡片里做（`parseBalance` / `parseCheckin`），脏数据在入口处收住。
   */
  providerCall: (providerId: string, endpoint: PluginProviderEndpoint, body?: unknown) =>
    body === undefined
      ? invoke<unknown>("plugins_provider_call", { providerId, endpoint })
      : invoke<unknown>("plugins_provider_call", { providerId, endpoint, body }),
  shutdownAll: () => invoke<void>("plugins_shutdown_all"),
}
