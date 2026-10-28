import type { ToolParameter } from "@/lib/agent/types"

/** 后端 plugins_list 返回的一项（任务 10 的命令层会填充真实数据） */
export interface PluginSummary {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  /**
   * 进程状态（Rust `plugins_list` 原样透传）。
   *
   * `"declarative"`（Rust 侧 `1310f37a` 起）表示**纯声明式插件**：清单里没有
   * `runtime`，也没声明 tools / providers / process-hook，宿主于是根本不启动进程，
   * 只读清单渲染配置与能力。
   *
   * 它不是 `"stopped"`：`stopped` 是"该跑却没跑"（用户没启用、被停用），
   * `declarative` 是"不需要跑"。两者混用会让用户以为插件没启用成功，
   * 所以前端任何按状态的展示都必须把这一档单独认出来，不能靠兜底。
   */
  processState:
    | "stopped"
    | "starting"
    | "running"
    | "failed"
    | "crashed"
    | "disabled_by_crash"
    | "declarative"
  grantedPermissions: string[]
  toolCount: number
  sourceRepo: string
  sourceCommit: string
  /**
   * 清单里声明的 provider id（`contributes.providers[].id`）。
   *
   * 空数组/缺失 = 纯工具插件。启用确认层靠它判断要不要换成
   * 「它将成为你的模型供应商」那段高危文案（设计 §7）。
   */
  providerIds?: string[]
  /**
   * 清单里的静态声明面（`preview`，设计 §8），**原样透传**的 JSON。
   *
   * 只用于展示：让插件中心在不启动插件进程的前提下就有东西可渲染
   * （例如按 `hasConfig` 决定要不要显示「设置」按钮）。调用真源仍是运行期，
   * 两边不一致时以运行期为准。形状由各消费方自己收窄，不在这里定死 ——
   * 定死加一个展示字段就要改一遍契约。
   */
  preview?: unknown
}

/** 一次工具注入要用到的描述符（来自插件运行期 tools/list） */
export interface PluginToolDescriptor {
  pluginId: string
  name: string
  description: string
  /** 宿主内部参数映射（若给了就用它；缺省时由 inputSchema 转换而来） */
  parameters?: Record<string, ToolParameter>
  /** 插件原样透传的 JSON Schema（优先用它做无损序列化，见 `Tool.inputSchema`） */
  inputSchema?: unknown
}

/**
 * `plugins_tools()` 的原始返回项。
 *
 * 字段名历史（重要，别「顺手统一」掉）：Rust 侧这个字段叫 `parameters`，但
 * `describe_tool` 装进去的是 `decl.input_schema`，也就是插件 `tools/list` 报上来的
 * **inputSchema 原文**（`{type:"object", properties, required}`），不是宿主内部的
 * `{参数名: ToolParameter}` 映射。为了 Rust 零改动，前端在这里显式承认这个错位：
 * 读到 `parameters` 就当成 `inputSchema`，再由 `tool-sync` 顺手算出映射形状。
 */
export interface PluginToolWireDescriptor {
  pluginId: string
  name: string
  description: string
  /** 实际内容是 inputSchema（JSON Schema 原文），见上面字段名历史 */
  parameters?: unknown
}

/** 调用插件工具：返回文本结果 */
export type PluginToolInvoker = (
  pluginId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<string>

/** 插件 `GET /v1/models` 返回的一个模型（宿主已丢弃缺上下文窗口的项，见设计 3.4）。 */
export interface PluginProviderModel {
  id: string
  name: string
  /** 上下文窗口，单位 token。剪裁依赖它，所以宿主侧是必填。 */
  maxInputTokens: number
  maxOutputTokens: number
  supportsToolCall: boolean
  supportsVision: boolean
  /** 只用于界面显示上游倍率，QMAI 不参与计费。 */
  creditMultiplier?: number
}

/**
 * `plugins_providers()` 返回的 provider 视图。
 *
 * 与 Rust 的 `ProviderView` 逐字段对应（camelCase）。**没有 token** —— token 只能
 * 通过 `plugins_provider_auth` 现取（计划第 0 节：token 不落盘）。
 */
export interface PluginProviderView {
  pluginId: string
  /** 运行期 provider id，形如 `wb-connect`；模型复合键的前缀就是它。 */
  providerId: string
  name: string
  /** `http://127.0.0.1:<port>`，端口由宿主分配（设计 D4）。 */
  baseUrl: string
  authKind: "none" | "browser-login" | "paste-token" | "import-file"
  capabilities: string[]
  settingsPage?: string
  models: PluginProviderModel[]
  ready: boolean
  lastError?: string
}
