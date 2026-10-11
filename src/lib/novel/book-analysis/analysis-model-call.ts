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

/**
 * 关掉思考重试一次仍拿不到正文时的终态文案。
 *
 * ⚠️ 这段文案刻意用「没有**返回**正文」，而不是「没有**输出**正文」：
 * 它**绝不能**匹配 reasoning-retry.ts:4 的 REASONING_ONLY_RESPONSE_RE。
 * 因为上层（agent/runner.ts:378、sources/outline-chat-panel.tsx:428）都用同一个
 * 判定函数决定要不要再重试一次，一旦匹配上，「已经关思考重试过的终态」
 * 会被当成可重试错误再重发一次整个 prompt，token 白白翻倍。
 * analysis-model-call.spec.ts 有专门用例钉住这个性质，改文案前先看那条。
 */
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
   *
   * 契约：
   * 1. **每次失败的非取消尝试各回调一次**，最后一次一定是文本最新的那一版
   *    （重试也吐了半截就用重试那版）。
   * 2. **用户取消（signal 已 abort）时不回调。** 取消不算「值得留存的失败」，
   *    这样调用点无需自己再查一遍 signal.aborted，也不会把取消写成草稿。
   * 3. 文本**可能是空串**（模型一个正文字符都没吐），落盘前自行 trim 判空。
   * 4. 回调只负责把文本交回给调用点，落盘时机由调用点决定 ——
   *    重试成功时本函数会正常返回，调用点应以返回值为准，
   *    不要因为回调先触发过就把那半截内容当成最终结果。
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
    // 每次 attempt 都从空串重新累积：上一轮收到的半截正文绝不能算进本轮结果。
    let output = ""
    let streamError: Error | null = null
    try {
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
    } finally {
      // 放在 finally 里：streamChat 既有「走 onError 回调后正常 resolve」的失败，
      // 也有直接抛的失败（本地 CLI 传输见 llm-client.ts:401；
      // 本地 provider 拿不到 URL/headers 见 :423）。
      // 只在 await 之后赋值的话，直接抛的那条路会丢掉本轮已收到的半截正文，
      // 让 onPartialText 交出上一轮（甚至空串）的内容。
      lastAttemptOutput = output
    }
    if (signal?.aborted) throw new Error(cancelMessage)
    if (streamError) throw streamError
    return output.trim()
  }

  try {
    return await attempt(false)
  } catch (error) {
    const first = error instanceof Error ? error : new Error(String(error))
    // 用户取消不回调：取消不是「值得留存的失败」。否则调用点把 onPartialText
    // 接到落盘上时，用户每点一次取消都会写出一份垃圾草稿。
    if (!signal?.aborted) onPartialText?.(lastAttemptOutput)
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
      // 重试这一轮也可能「吐了半截再失败」；把最新一版的半截文本交出去，
      // 否则调用点（workbench 的 v1 文风草案）会丢掉这份草稿。
      // 同样地，重试途中被取消就不回调。
      if (!signal?.aborted) onPartialText?.(lastAttemptOutput)
      if (isReasoningOnlyResponseError(second)) throw new Error(REASONING_ONLY_ANALYSIS_MESSAGE)
      throw second
    }
  }
}
