import { invoke } from "@tauri-apps/api/core"
import type {
  PluginProviderEndpoint,
  PluginProviderModel,
  PluginProviderView,
  PluginSummary,
  PluginToolWireDescriptor,
} from "./types"

/**
 * 凭据类型（设计 §5.3 的 `authKind` 里需要用户输入的两种）。
 *
 * 与 Rust 侧 `providers::CREDENTIAL_KINDS` 逐字对应：那边是白名单（不在表里的 kind 直接
 * `Err`），这边收窄成字面量联合，让拼错在**编译期**就暴露 —— 否则用户看到的是一句
 * 「不支持的凭据类型：paset-token」，得靠肉眼比对才能发现是前端打错了字。
 *
 * 为什么没有 `none` / `browser-login`：那两种不经过这条命令（前者不需要登录入口，
 * 后者走受控登录窗口）。把它们放进联合类型，只会让调用方以为可以往这里传。
 */
export type PluginCredentialKind = "paste-token" | "import-file"

/**
 * `plugins_provider_submit_credential` 的返回（插件侧 `POST /login/credential` 的原文）。
 *
 * 全部可选：插件可以只回 `{"ok":true}`，也可以什么都不回（200 + 空 body，Rust 侧会
 * 补成 `{ok:true}`）。界面上的 `message` 缺省时由卡片兜底成「已保存」——
 * 「点了保存但什么都没显示」是最容易让用户以为没生效的形态。
 */
export interface PluginProviderCredentialResult {
  ok?: boolean
  message?: string
}

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
  /**
   * 把用户输入的凭据（粘贴的令牌 / 选中的文件内容）转交给插件（设计 §5.3）。
   *
   * **QMAI 不落盘、不缓存、不写日志**：这段文本只在这一次请求里经过内存，插件侧
   * 端点固定为 `POST /login/credential`。所以这里**故意不提供任何"读取已保存凭据"
   * 的接口** —— 宿主手里根本没有这个值，卡片也因此无法把已保存的令牌回填出来。
   *
   * 成功后 Rust 侧会自己重探活 + 重抓模型，并 emit `plugin-provider-models-refreshed`；
   * 调用方再补一次 `syncPluginProviders()` 就能让卡片立刻看到新模型。
   */
  submitProviderCredential: (
    providerId: string,
    kind: PluginCredentialKind,
    value: string,
    filename?: string,
  ) =>
    invoke<PluginProviderCredentialResult>("plugins_provider_submit_credential", {
      providerId,
      kind,
      value,
      // `import-file` 才传原文件名；`paste-token` 不传（因此没有"凭空造一个文件名"的路径）。
      filename,
    }),
  shutdownAll: () => invoke<void>("plugins_shutdown_all"),
}
