// ChatMessage / RequestOverrides 都由 llm-client 转出（见 llm-client.ts:48），
// 所以这里只引一个模块。
import { streamChat, type ChatMessage, type RequestOverrides } from "@/lib/llm-client"
import {
  isReasoningDisabled,
  isReasoningOnlyResponseError,
  withReasoningDisabled,
} from "@/lib/reasoning-retry"
import type { LlmRequestCacheTrace } from "@/lib/llm-request-trace"

/** 与既有 adapter 一致：直接取 streamChat 首参类型，不另引配置类型。 */
type AnalysisLlmConfig = Parameters<typeof streamChat>[0]

/** 关掉思考重试一次仍拿不到正文时的终态文案。 */
export const REASONING_ONLY_ANALYSIS_MESSAGE =
  "模型只输出了思考内容，没有返回正文；已关闭思考重试一次仍未成功。请换用非推理模型，或缩小分析范围后重试。"

export interface AnalysisModelCallOptions {
  signal?: AbortSignal
  onRequestTrace?: (trace: LlmRequestCacheTrace) => void
  /** 保留调用点原有的请求覆盖项（如 skipUserMemory / max_tokens / temperature）。 */
  baseOverrides?: RequestOverrides
  /** 用户取消时抛出的文案；各分析器原有文案不同，需保留。 */
  cancelMessage?: string
  /**
   * 失败时交出「本次尝试已收到的文本」。
   * 有的调用点会把半截输出落盘（workbench-adapter 的 v1 文风草案），
   * 所以不能只靠抛错把它丢掉。
   */
  onPartialText?: (text: string) => void
}

/**
 * 拆书库统一的一次性文本调用。
 *
 * 存在理由：模型可能把预算全烧在思考上、一个正文字符都不吐，llm-client 会抛
 * 「模型只输出了 N 字符的思考内容，但没有输出正文」。那条流在 HTTP 层是成功的
 * （流干净结束、没有报错），所以 llm-client 内部那两处 withReasoningDisabled
 * ——请求前置降级（:304-314）与请求被接口拒绝后重发（:669-692）——都覆盖不到它。
 * 只有调用方「丢掉已收内容 → 关掉思考 → 整轮重发」才能救，这也是把它放在这里
 * 而不是塞进 streamChat 的原因：streamChat 内部无法重跑自己，且会与
 * agent runner 自己的重试叠成双重重试、token 翻倍。runner 与大纲链路各自实现过
 * 同一件事，这里是拆书库的第三份，故抽成共享实现。
 */
export async function callAnalysisModelText(
  llmConfig: AnalysisLlmConfig,
  messages: ChatMessage[],
  options: AnalysisModelCallOptions = {},
): Promise<string> {
  const {
    signal,
    onRequestTrace,
    baseOverrides,
    cancelMessage = "用户取消分析",
    onPartialText,
  } = options

  let lastAttemptOutput = ""

  const attempt = async (reasoningOff: boolean): Promise<string> => {
    // 每次 attempt 都从空串重新累积：上一轮收到的半截思考绝不能算进正文。
    let output = ""
    let streamError: Error | null = null
    await streamChat(
      llmConfig,
      messages,
      {
        onToken: (token) => { output += token },
        onDone: () => {},
        onError: (error) => { streamError = error },
        onRequestTrace,
      },
      signal,
      reasoningOff ? withReasoningDisabled(baseOverrides) : baseOverrides,
    )
    lastAttemptOutput = output
    if (signal?.aborted) throw new Error(cancelMessage)
    if (streamError) throw streamError
    return output.trim()
  }

  try {
    return await attempt(false)
  } catch (error) {
    const first = error instanceof Error ? error : new Error(String(error))
    onPartialText?.(lastAttemptOutput)
    // 只在「确实是思考-only」且「原本没关思考」时才值得重发整个 prompt；
    // 否则就是把一模一样的请求再发一遍。
    if (
      signal?.aborted
      || isReasoningDisabled(llmConfig, baseOverrides)
      || !isReasoningOnlyResponseError(first)
    ) {
      throw first
    }
    try {
      return await attempt(true)
    } catch (retryError) {
      const second = retryError instanceof Error ? retryError : new Error(String(retryError))
      if (isReasoningOnlyResponseError(second)) throw new Error(REASONING_ONLY_ANALYSIS_MESSAGE)
      throw second
    }
  }
}
