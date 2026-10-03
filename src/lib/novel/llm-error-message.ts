/**
 * 把底层网络/HTTP 错误的原始英文文本（Rust reqwest 经 tauri-plugin-http 透传）
 * 翻译成用户能看懂、知道下一步该做什么的中文提示。
 *
 * 背景：LLM 请求走 tauri-plugin-http（内部 reqwest）。发起阶段的失败会被
 * llm-client 包装成中文，但**流式读取中途断流**等场景在某些路径会把原始
 * `error.message`（如 "error decoding response body"）一路透传到大纲面板的
 * 「生成失败：xxx」展示层。这里做最后一道归一化。
 */

/** 常见底层错误 → 中文说明的映射（按序匹配，第一条命中即用）。 */
const FRIENDLY_LLM_ERROR_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    // 流式响应读取中途断开：长输出 + 网关/网络不稳定时最常见。
    pattern: /error decoding response body/i,
    message:
      "模型接口的响应在传输中途被中断（流式输出时间较长时容易出现）。" +
      "常见原因：输出体量过大、网络或代理不稳定、服务商网关超时断流。" +
      "建议：点击重试再生成一次；若反复出现，请更换更快的模型、关闭深度思考，或分批生成（每次让 AI 少生成几个对象）。",
  },
  {
    pattern: /error sending request for url/i,
    message:
      "无法连接到模型接口。请检查网络、代理与接口地址是否可用，以及密钥是否有效。",
  },
  {
    pattern: /failed to fetch|load failed|network error/i,
    message: "网络连接失败。请检查网络、代理或接口地址后重试。",
  },
  {
    pattern: /stream (?:ended|closed) (?:early|unexpectedly)|connection (?:reset|closed)/i,
    message:
      "模型接口的连接被提前关闭。多为服务商网关超时或输出过长所致，建议重试或分批生成。",
  },
]

/**
 * 归一化面向用户展示的 LLM 错误消息：
 * 命中已知模式返回中文说明，否则原样返回（保留未知错误的真实信息便于排查）。
 */
export function friendlyLlmErrorMessage(message: string | null | undefined): string {
  const text = (message ?? "").trim()
  if (!text) return ""
  for (const { pattern, message: friendly } of FRIENDLY_LLM_ERROR_PATTERNS) {
    if (pattern.test(text)) return friendly
  }
  return text
}
