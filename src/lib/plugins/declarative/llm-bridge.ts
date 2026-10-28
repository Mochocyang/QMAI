/**
 * 把宿主的**流式聊天链路**接成声明式 action 需要的 `LlmCaller`（三行接口）。
 *
 * ## 为什么复用 `streamChat` 而不是自己发 HTTP
 *
 * `src/lib/llm-client.ts` 的 `streamChat` 是用户平常聊天走的那条链路：它已经处理了
 * provider 线格式差异（OpenAI / Anthropic / Gemini / 本地 CLI）、上下文预算裁剪、
 * 超时与重试、思考 token、用量计费与中止。插件生成另起一条 HTTP 等于把这些
 * 再实现一遍 —— 而且第一版就会漏掉"当前选中的模型"这件事本身。
 *
 * ## 为什么请求**不带 tools**
 *
 * 声明式动作是"给定提示词 → 要一段文本"。带上 tools 会带来三个纯损失：
 *   1. **跑偏**：模型会去调工具、回一段"我准备调用某工具"，而不是只交结果；
 *   2. **变贵**：工具定义本身占大量 input token，且每轮可能触发额外请求；
 *   3. **越权**：工具白名单是**聊天**的能力面。插件是本可卸载的第三方声明，
 *      让它通过聊天工具间接获得宿主动作能力，等于把 Tier 1 的安全边界绕过去了。
 * 所以这里只发 `system` + `user` 两条消息，别的什么都不加。
 *
 * ## 为什么 `signal` 必须一路传到底
 *
 * `signal` 一路传到 `streamChat(..., signal)` → `fetch(..., { signal })`。用户点
 * 「停止」时，如果只是本地忽略后续 delta、请求本身还在跑，就等于**边停止边计费**，
 * 而且长输出会把 webview 的连接占住。
 */
import { streamChat, type StreamCallbacks } from "@/lib/llm-client"
import type { ChatMessage, RequestOverrides } from "@/lib/llm-providers"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import { RunActionAbortedError, isRunActionAborted, type LlmCaller } from "./run"

/** 声明里没写 `limits.maxOutputTokens` 时的上限。 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2000

/** `streamChat` 的形状（单独声明以便测试注入假实现）。 */
export type StreamChatFn = (
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  requestOverrides?: RequestOverrides,
) => Promise<void>

export interface StreamChatLlmCallerOptions {
  /** 注入点（测试用）；默认是真 `streamChat`。 */
  streamChat?: StreamChatFn
  /** 读当前模型配置（测试用）；默认读 `useWikiStore` 里的 `llmConfig`。 */
  getConfig?: () => LlmConfig | null | undefined
}

function describeFailure(cause: unknown): string {
  if (typeof cause === "string" && cause.trim()) return cause
  if (cause instanceof Error && cause.message.trim()) return cause.message
  if (cause === null || cause === undefined) return "未知错误"
  try {
    return JSON.stringify(cause)
  } catch {
    return String(cause)
  }
}

/** 当前模型是否"明显不可用"：没选 provider / 没选 model 时不必浪费一次请求。 */
function hasUsableModel(config: LlmConfig | null | undefined): boolean {
  if (!config) return false
  const provider = typeof config.provider === "string" ? config.provider.trim() : ""
  const model = typeof config.model === "string" ? config.model.trim() : ""
  return provider !== "" && provider !== "none" && model !== ""
}

/**
 * 造一个"用当前选中模型流式生成"的 `LlmCaller`。
 *
 * 错误口径（会显示在 `ActionDialog` 的错误态里，必须是中文人话）：
 *   - 没选模型 → 「当前模型不可用：……」（用户去设置里选模型就好了）
 *   - 请求失败 → 「请求失败：<provider 原文>」（原文往往就是最准确的诊断）
 *   - 用户点停止 → `RunActionAbortedError`（UI 显示"已停止"而不是"生成失败"）
 */
export function createStreamChatLlmCaller(options: StreamChatLlmCallerOptions = {}): LlmCaller {
  const stream = options.streamChat ?? (streamChat as StreamChatFn)
  const getConfig = options.getConfig ?? (() => useWikiStore.getState().llmConfig)

  return {
    async call(input, onDelta, signal) {
      if (signal.aborted) throw new RunActionAbortedError()

      const config = getConfig()
      if (!hasUsableModel(config)) {
        throw new Error("当前模型不可用：还没有选择可用的模型。请在设置里选好模型后重试。")
      }

      let text = ""
      let failure: Error | null = null

      // 只发两条消息、不带 tools（理由见文件头注释）
      const messages: ChatMessage[] = [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ]
      const overrides: RequestOverrides = {
        max_tokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        /*
         * 不注入全局用户记忆：
         * 声明式动作的提示词与输出格式是**插件声明**的一部分，往里静默塞入用户的
         * 全局习惯会让"同一个插件在别人机器上产出不同结构"，作者无法复现问题；
         * 而且那些记忆是给聊天用的，不是给插件用的。
         */
        skipUserMemory: true,
      }

      try {
        await stream(
          config as LlmConfig,
          messages,
          {
            onToken: (token) => {
              if (!token) return
              text += token
              onDelta(token)
            },
            onDone: () => {},
            onError: (error) => {
              failure = error instanceof Error ? error : new Error(String(error))
            },
          },
          signal,
          overrides,
        )
      } catch (cause) {
        if (signal.aborted || isRunActionAborted(cause)) throw new RunActionAbortedError()
        throw new Error(`请求失败：${describeFailure(cause)}`)
      }

      // 中止时 streamChat 会走 onDone（不抛错），所以这里必须再判一次 signal。
      if (signal.aborted) throw new RunActionAbortedError()
      if (failure) {
        if (isRunActionAborted(failure)) throw new RunActionAbortedError()
        throw new Error(`请求失败：${describeFailure(failure)}`)
      }

      return { text }
    },
  }
}
