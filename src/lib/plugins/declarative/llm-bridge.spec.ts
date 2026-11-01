/**
 * 模型适配层的测试：钉住四件"看起来能跑、其实已经错了"的事。
 *
 *   1. 只发 system + user 两条消息（多一条历史/工具消息都可能让模型跑偏）；
 *   2. 不带 tools（带 tools = 把聊天的能力面借给第三方插件）；
 *   3. delta 按序回调（顺序错了用户看到的就是乱码）；
 *   4. `signal` 真的一路传到底层（否则"停止"只是本地闭嘴，请求还在烧钱）。
 */
import { describe, expect, it, vi } from "vitest"
import type { RunActionDeps } from "./run"
import { DEFAULT_MAX_OUTPUT_TOKENS, createStreamChatLlmCaller, type StreamChatFn } from "./llm-bridge"
import { runDeclarativeAction } from "./run"
import type { DeclarativeAction } from "./types"

const CONFIG = { provider: "openai", model: "gpt-test", maxContextSize: 128000 } as never

/** 假 streamChat：记录入参，按给定 chunk 依次回调。 */
function fakeStream(chunks: string[] = ["《长", "夜》"]) {
  const calls: Array<{
    config: unknown
    messages: Array<{ role: string; content: unknown }>
    callbacks: unknown
    signal: AbortSignal | undefined
    overrides: Record<string, unknown> | undefined
  }> = []

  const stream: StreamChatFn = async (config, messages, callbacks, signal, overrides) => {
    calls.push({ config, messages, callbacks, signal, overrides })
    for (const chunk of chunks) (callbacks as { onToken: (t: string) => void }).onToken(chunk)
    ;(callbacks as { onDone: () => void }).onDone()
  }

  return { stream, calls }
}

describe("createStreamChatLlmCaller", () => {
  it("只发 system + user 两条消息，且不带 tools", async () => {
    const { stream, calls } = fakeStream()
    const llm = createStreamChatLlmCaller({ streamChat: stream, getConfig: () => CONFIG })

    await llm.call({ system: "你是书名策划", user: "给三个书名" }, () => {}, new AbortController().signal)

    expect(calls).toHaveLength(1)
    expect(calls[0].messages).toEqual([
      { role: "system", content: "你是书名策划" },
      { role: "user", content: "给三个书名" },
    ])
    expect(calls[0].overrides?.tools).toBeUndefined()
  })

  it("delta 按序回调，返回值是完整拼接文本", async () => {
    const { stream } = fakeStream(["一", "二", "三"])
    const llm = createStreamChatLlmCaller({ streamChat: stream, getConfig: () => CONFIG })

    const seen: string[] = []
    const result = await llm.call({ system: "s", user: "u" }, (delta) => seen.push(delta), new AbortController().signal)

    expect(seen).toEqual(["一", "二", "三"])
    expect(result).toEqual({ text: "一二三" })
  })

  it("abort 信号真的传到底层；中止后抛可识别的中止错误", async () => {
    const controller = new AbortController()
    const { stream, calls } = fakeStream([])
    const llm = createStreamChatLlmCaller({ streamChat: stream, getConfig: () => CONFIG })

    const pending = llm.call({ system: "s", user: "u" }, () => {}, controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: "RunActionAbortedError" })
    // 同一个 AbortSignal 实例一路传到底（不是另造一个）
    expect(calls[0].signal).toBe(controller.signal)
  })

  it("maxOutputTokens 缺省给 2000，传了就照传", async () => {
    const first = fakeStream()
    await createStreamChatLlmCaller({ streamChat: first.stream, getConfig: () => CONFIG }).call(
      { system: "s", user: "u" },
      () => {},
      new AbortController().signal,
    )
    expect(first.calls[0].overrides?.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(2000)

    const second = fakeStream()
    await createStreamChatLlmCaller({ streamChat: second.stream, getConfig: () => CONFIG }).call(
      { system: "s", user: "u", maxOutputTokens: 512 },
      () => {},
      new AbortController().signal,
    )
    expect(second.calls[0].overrides?.max_tokens).toBe(512)
  })

  it("没选模型 → 「当前模型不可用」；请求出错 → 「请求失败：…」", async () => {
    const llm = createStreamChatLlmCaller({
      streamChat: fakeStream().stream,
      getConfig: () => ({ provider: "openai", model: "", maxContextSize: 128000 } as never),
    })
    await expect(
      llm.call({ system: "s", user: "u" }, () => {}, new AbortController().signal),
    ).rejects.toThrow("当前模型不可用")

    const failing = createStreamChatLlmCaller({
      streamChat: async (_config, _messages, callbacks) => {
        callbacks.onError(new Error("接口返回 401：密钥无效"))
      },
      getConfig: () => CONFIG,
    })
    await expect(
      failing.call({ system: "s", user: "u" }, () => {}, new AbortController().signal),
    ).rejects.toThrow("请求失败：接口返回 401：密钥无效")
  })
})

describe("接到 runDeclarativeAction 上", () => {
  it("表单值插值后整段交给模型，解析结果照常返回", async () => {
    const { stream, calls } = fakeStream(["《长夜》\n《归途》"])
    const llm = createStreamChatLlmCaller({ streamChat: stream, getConfig: () => CONFIG })
    const deps: RunActionDeps = { llm, getConfig: vi.fn(async () => ({})) }
    const action: DeclarativeAction = {
      id: "generate-titles",
      title: "生成书名",
      prompt: { system: "你是书名策划", user: "题材：{{genre}}" },
      output: { mode: "list", targets: [] },
    }

    const result = await runDeclarativeAction(
      action,
      "p1",
      [], // 纯表单提示词（只有 {{genre}}）：不需要 fs:project-read
      { genre: "悬疑" },
      deps,
      () => {},
      new AbortController().signal,
    )

    expect(calls[0].messages[1]).toEqual({ role: "user", content: "题材：悬疑" })
    expect(result.parsed).toEqual({ kind: "list", items: ["《长夜》", "《归途》"], degraded: false })
  })
})
