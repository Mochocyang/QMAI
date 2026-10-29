// QMAI 插件 SDK · provider 助手类型定义。
//
// 与 qmai-plugin.d.ts 一样刻意保守：作者读得懂比"类型系统很酷"重要。

/** `/v1/models` 里的单个模型声明（作者写在 `models()` 返回值里）。 */
export interface ProviderModel {
  id: string;
  /** 显示名；同时会写进 `_qmai.displayName`。 */
  name?: string;
  /**
   * 真实的**输入**窗口（token）。**必填、必真**：
   * 缺了宿主会丢弃这个模型；虚高会让宿主按假窗口塞上下文、上游直接 400。
   */
  maxInputTokens?: number;
  /** 真实的**输出**窗口（token），宿主用它规划输出预算。 */
  maxOutputTokens?: number;
  supportsToolCall?: boolean;
  supportsVision?: boolean;
  /** 仅用于展示的倍率（有些渠道按它折算额度）。 */
  creditMultiplier?: number;
  _qmai?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 归一化后的请求。`raw` 保留原始请求体，OpenAI 的扩展参数不必等 SDK 支持。 */
export interface ProviderChatRequest {
  model: string;
  messages: Array<Record<string, unknown>>;
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  raw: Record<string, unknown>;
  /** 客户端断开时触发；把它透传给你的上游请求（fetch 的 `signal`）。 */
  signal: AbortSignal;
}

export interface ProviderChatContext {
  /** 推一段增量文本（流式时。非流式时 SDK 会把它拼成完整回复）。 */
  onDelta: (text: string) => void;
  /** **同一个** signal：客户端断开（用户点「停止」）时立即 abort —— 别忽略它。 */
  signal: AbortSignal;
}

export interface ProviderChatResult {
  /** 用量；缺了 QMAI 的用量统计会记为 0。 */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  /** 非流式时的完整回复；不给则用 `onDelta` 拼出来的文本。 */
  text?: string;
}

/** 宿主交给 `onCredential` 的一次用户输入。 */
export interface ProviderCredential {
  /** `"paste-token"`（卡片上贴令牌）或 `"import-file"`（选了一个文本文件）。 */
  kind: string;
  /** 用户输入的原文 / 文件内容。**不要写进日志、不要拼进错误信息。** */
  value: string;
  /** 仅 `import-file` 有：原文件名（只是名字，不是路径）。 */
  filename?: string;
}

/** `onCredential` 的返回值：原样回给宿主，`message` 会显示在卡片上。 */
export interface ProviderCredentialResult {
  ok?: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface ProviderDefinition {
  /** 仅用于日志与 `/health` 的 `provider` 字段。 */
  id?: string;
  models: () => ProviderModel[] | Promise<ProviderModel[]>;
  chat: (request: ProviderChatRequest, context: ProviderChatContext) => Promise<ProviderChatResult | void>;
  /**
   * `POST /login/credential` 的实现：`authKind` 是 `paste-token` / `import-file` 时必须提供。
   *
   * - 返回值原样回给宿主（`message` 显示在卡片上）；返回 `undefined` 按 `{ ok: true }`。
   * - **抛错 → 400 + `error.message`**：这是表达"这次输入不合法"的唯一正确方式
   *   （返回 `{ ok: false }` 仍然是 200，宿主会当成成功）。
   * - 不提供这个回调 → 端点回 404（明确告诉作者"你还没实现"）。
   */
  onCredential?: (credential: ProviderCredential) => Promise<ProviderCredentialResult | void> | ProviderCredentialResult | void;
}

/** 仅供测试/自测覆盖端口与令牌；生产环境走 `QMAI_PROVIDER_PORT` / `QMAI_PROVIDER_TOKEN`。 */
export interface ServeProviderOptions {
  port?: number;
  token?: string;
  env?: Record<string, string | undefined>;
  stderr?: { write: (chunk: string) => boolean | void };
  exit?: (code: number) => void;
}

export interface ProviderHandle {
  server: import("node:http").Server;
  /** 监听成功后 resolve 成真实端口（`port: 0` 时由内核分配）。 */
  ready: Promise<number>;
  port: () => number | undefined;
  close: () => Promise<void>;
}

export function serveProvider(
  provider: ProviderDefinition,
  options?: ServeProviderOptions,
): ProviderHandle | undefined;
