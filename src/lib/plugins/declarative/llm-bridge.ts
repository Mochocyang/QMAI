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
import { resolveModelConfig } from "@/lib/novel/model-resolver"
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
 * 插件动作用哪个模型。
 *
 * **这里曾经读 `llmConfig`，但那是错的**：用户在软件里选模型选的是 `aiChatModel`
 * （`providerId/modelId` 复合键），而 `llmConfig` 往往只有 provider 级默认值、
 * `provider`/`model` 甚至为空 —— 于是插件一律报「当前模型不可用」，
 * 而用户明明在设置里配好了一堆自定义渠道。
 *
 * 正确做法与 AI 对话一致：先取 `aiChatModel`，再用 `resolveModelConfig` 把它
 * 解析成完整配置（带 provider 的 apiKey / baseUrl 等）。没选时才退回 `llmConfig`。
 */
function defaultModelConfig(): LlmConfig {
  const state = useWikiStore.getState()
  const target = typeof state.aiChatModel === "string" ? state.aiChatModel.trim() : ""
  if (target) {
    return resolveModelConfig(target, state.llmConfig, state.providerConfigs ?? {})
  }
  return state.llmConfig
}

/**
 * 把 `providerId/modelId` 复合键解析成完整配置。
 *
 * 与 `defaultModelConfig` 同源（都走 `resolveModelConfig`），但目标模型由调用方给定 ——
 * 这是插件「自己选模型」的基础：action 声明了 `model.target` 时，用它替代当前模型。
 */
export function resolveConfigForModelKey(target: string): LlmConfig {
  const state = useWikiStore.getState()
  const key = typeof target === "string" ? target.trim() : ""
  if (!key) return defaultModelConfig()
  return resolveModelConfig(key, state.llmConfig, state.providerConfigs ?? {})
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


  const getConfig = options.getConfig ?? defaultModelConfig

  return {
    async call(input, onDelta, signal) {
      if (signal.aborted) throw new RunActionAbortedError()

      /*
       * 插件指定了模型就解析它，否则用当前模型。
       *
       * 为什么要支持指定：`strategy: "current"` 意味着跟随用户在聊天里选的模型，
       * 而用户随时会切换 —— 同一个插件昨天生成的书名和今天不是一个味道，
       * 作者无法复现问题，用户也会觉得\"这插件时好时坏\"。
       */
      const config = input.modelOverride
        ? resolveConfigForModelKey(input.modelOverride)
        : getConfig()
      if (input.modelOverride && !hasUsableModel(config)) {
        throw new Error(
          `插件指定的模型不可用：${input.modelOverride}。请确认这个模型在你的渠道里存在，或在插件设置里改用当前模型。`,
        )
      }
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
