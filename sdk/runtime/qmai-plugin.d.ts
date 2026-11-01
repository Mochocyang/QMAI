// QMAI 插件 SDK · Tier 2 运行时助手类型定义
//
// 只描述 `qmai-plugin.mjs` 的公开面。写法刻意保守（不用泛型体操）：
// 作者大多不是 TypeScript 用户，这份类型的主要价值是编辑器里的补全与参数提示。

/** JSON Schema 子集：结构不在这里收窄，宿主会把 `inputSchema` 原样转给模型。 */
export type JsonSchema = Record<string, unknown>;

/** `tools/call` 里的 content 片段（MCP 形状）。 */
export interface TextContent {
  type: "text";
  text: string;
}

/**
 * 工具实现可以返回的三类值。
 *
 * - `string`：最常见，SDK 包成 `content[0].text`
 * - `{ text, isError }`：工具级失败**用它**，不要 throw、也不要用 JSON-RPC error ——
 *   `isError` 的文本会送到模型眼前，模型能自己改正重试
 * - `{ content }`：需要多段内容时直接给 MCP 形状
 */
export type ToolReturn =
  | string
  | { text: string; isError?: boolean }
  | { content: Array<TextContent | Record<string, unknown>>; isError?: boolean }
  | null
  | undefined;

/** `tools/call` 的 result。 */
export interface ToolCallResult {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
}

/** handler 的第二个参数：由 SDK 注入的运行期上下文。 */
export interface PluginContext {
  /** 宿主分配的插件 id（环境变量 `QMAI_PLUGIN_ID` 优先，其次 `info.id`）。 */
  pluginId: string;
  /** 日志出口。**一定**写 stderr，绝不会污染 stdout 的协议帧。 */
  log: (message: unknown) => void;
  /** 宿主通过 `QMAI_CONFIG` 注入的配置对象；解析失败时是 `{}`（并在 stderr 记一条 warn）。 */
  config: Record<string, unknown>;
  /** 宿主分配给本插件的 provider 端口（仅 provider 插件有）。 */
  providerPort: number | undefined;
  /** 宿主分配给本插件的 provider 令牌（仅 provider 插件有）。**不要落盘**。 */
  providerToken: string | undefined;
}

/** 一个工具的声明。 */
export interface ToolDeclaration {
  /** 给模型看的说明：什么时候该用它、不该用它。 */
  description?: string;
  /** JSON Schema。宿主原样转给模型，写错模型会拒绝调用且**不会报错**。 */
  inputSchema?: JsonSchema;
  /** 工具实现。抛错会被 SDK 转成 `isError: true`，进程不会死。 */
  handler: (args: Record<string, unknown>, ctx: PluginContext) => ToolReturn | Promise<ToolReturn>;
}

export interface PluginInfo {
  /** 建议与 `plugin.json` 的 `id` 一致，便于日志对得上。 */
  id?: string;
  /** 界面上显示的名字。 */
  name: string;
  /** 三段 SemVer，如 `1.0.0`。 */
  version: string;
}

export interface PluginDefinition {
  info: PluginInfo;
  tools?: Record<string, ToolDeclaration>;
}

/** 仅供测试/自测注入；生产环境不要传。 */
export interface DefinePluginOptions {
  stdin?: NodeJS.ReadableStream;
  stdout?: { write: (chunk: string) => boolean | void };
  stderr?: { write: (chunk: string) => boolean | void };
  env?: Record<string, string | undefined>;
  exit?: (code: number) => void;
}

export interface PluginHandle {
  ctx: PluginContext;
  /** 已注册的工具名（用于自测断言）。 */
  tools: string[];
  /** 解绑监听；正常插件由 stdin EOF 结束，不需要调用。 */
  stop: () => void;
}

export const PROTOCOL_VERSION: string;

/** 注册插件并立刻开始跑 MCP stdio 循环。 */
export function definePlugin(plugin: PluginDefinition, options?: DefinePluginOptions): PluginHandle;
