/**
 * `streamChat` 与插件钩子的接线测试（P3：把钩子调度器接进真实请求链路）。
 *
 * 每条用例都对应一个会**真出事故**的行为：
 *   - 无钩子时必须逐字走原路径（不能悄悄改请求体、不能多打印告警）；
 *   - 请求前的改写必须真的进了请求体；
 *   - 响应后的改写必须交给 `onDone`，且**不能**在流式增量里重放；
 *   - gate 阻断必须抛可读错误并且**一个网络请求都不发**；
 *   - 钩子自己出错时必须 fail-open；
 *   - 观测钩子 fire-and-forget，绝不能挡住用户看到回复；
 *   - **重入保护**：prompt 钩子内部调模型不能再触发钩子（否则递归爆栈）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { PROMPT_HOOK_SYSTEM, runPromptHook } from "@/lib/plugins/hooks/prompt-impl"
import {
  __resetPluginHooksForTests,
  __setPluginHooksForTests,
  createHookDeps,
  setHookDepsFactory,
} from "@/lib/plugins/hooks/runtime"
import type { HookDeps, PluginHookView } from "@/lib/plugins/hooks/types"
import { streamChat } from "./llm-client"
import type { ChatMessage, RequestOverrides } from "./llm-providers"

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock("./tauri-fetch", () => ({
  getHttpFetch: vi.fn(async () => mocks.fetch),
  isFetchNetworkError: () => false,
}))

vi.mock("./local-cli-config", () => ({
  resolveRuntimeLocalCliConfig: vi.fn(async (config: LlmConfig) => config),
}))

const config: LlmConfig = {
  provider: "openai",
  apiKey: "sk-test",
  model: "gpt-test",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 128_000,
}

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join("\n")))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

function textStream(text: string, usage?: Record<string, unknown>): Response {
  return sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    ...(usage ? [`data: ${JSON.stringify({ choices: [], usage })}`] : []),
    "data: [DONE]",
    "",
  ])
}

function view(
  event: PluginHookView["hook"]["on"],
  overrides: Partial<PluginHookView["hook"]> = {},
): PluginHookView {
  return {
    pluginId: "p1",
    pluginName: "测试插件",
    hook: { on: event, impl: "process", tool: "t", ...overrides },
  }
}

function requestBody(callIndex = 0): { messages: Array<{ role: string; content: string }>; temperature?: number } {
  const init = mocks.fetch.mock.calls[callIndex]?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body))
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mocks.fetch.mockReset()
  __resetPluginHooksForTests()
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  __resetPluginHooksForTests()
  warn.mockRestore()
  vi.restoreAllMocks()
})

describe("零开销直通（无插件时逐字不变）", () => {
  it("请求体就是原始消息，且没有任何额外告警", async () => {
    mocks.fetch.mockResolvedValue(textStream("原文回复"))
    const onDone = vi.fn()

    await streamChat(config, [{ role: "user", content: "原始提问" }], {
      onToken: vi.fn(),
      onDone,
      onError: vi.fn(),
    })

    const body = requestBody()
    expect(body.messages[body.messages.length - 1]).toEqual({ role: "user", content: "原始提问" })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
    // 没有 afterLlmResponse 钩子 → 不累积正文 → onDone 不带改写文本
    expect(onDone.mock.calls[0][0]).toBeUndefined()
  })
})

describe("beforeLlmRequest", () => {
  it("钩子改写 messages / temperature 后，真正发出去的请求体是改写后的", async () => {
    mocks.fetch.mockResolvedValue(textStream("回复"))
    __setPluginHooksForTests([view("beforeLlmRequest")])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async () => ({
        patch: {
          llm: {
            messages: [
              { role: "system", content: "注入的系统提示词" },
              { role: "user", content: "改写后的提问" },
            ],
            temperature: 0.2,
          },
        },
      }),
    }))

    await streamChat(config, [{ role: "user", content: "原始提问" }], {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })

    const body = requestBody()
    expect(body.messages.map((message) => message.content)).toEqual(["注入的系统提示词", "改写后的提问"])
    expect(body.temperature).toBe(0.2)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it("gate 钩子阻断 → 抛可读错误，且一个网络请求都不发", async () => {
    __setPluginHooksForTests([view("beforeLlmRequest", { gate: true })])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async () => ({ block: { reason: "内容不合规，已拦截" } }),
    }))

    await expect(streamChat(config, [{ role: "user", content: "提问" }], {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })).rejects.toThrow("内容不合规，已拦截")

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("钩子抛错 → fail-open：用户照常收到回复，只 warn", async () => {
    mocks.fetch.mockResolvedValue(textStream("正常回复"))
    __setPluginHooksForTests([view("beforeLlmRequest")])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async () => {
        throw new Error("插件内部崩了")
      },
    }))

    const tokens: string[] = []
    const onError = vi.fn()
    await streamChat(config, [{ role: "user", content: "提问" }], {
      onToken: (token) => tokens.push(token),
      onDone: vi.fn(),
      onError,
    })

    expect(tokens.join("")).toBe("正常回复")
    expect(onError).not.toHaveBeenCalled()
    expect(requestBody().messages[requestBody().messages.length - 1]).toEqual({ role: "user", content: "提问" })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("未生效"))
  })
})

describe("afterLlmResponse", () => {
  it("改写结果通过 onDone 交付，流式增量仍然是原文（不重放）", async () => {
    mocks.fetch.mockResolvedValue(textStream("AI味很重的原文"))
    __setPluginHooksForTests([view("afterLlmResponse")])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async () => ({ patch: { response: { text: "更自然的改写后正文" } } }),
    }))

    const tokens: string[] = []
    const onDone = vi.fn()
    await streamChat(config, [{ role: "user", content: "写一段" }], {
      onToken: (token) => tokens.push(token),
      onDone,
      onError: vi.fn(),
    })

    expect(tokens.join("")).toBe("AI味很重的原文")
    expect(onDone.mock.calls[0][0]).toBe("更自然的改写后正文")
  })

  it("钩子返回空文本时按「不改」处理（空正文会清空内容）", async () => {
    mocks.fetch.mockResolvedValue(textStream("原文"))
    __setPluginHooksForTests([view("afterLlmResponse")])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async () => ({ patch: { response: { text: "   " } } }),
    }))

    const onDone = vi.fn()
    await streamChat(config, [{ role: "user", content: "写一段" }], {
      onToken: vi.fn(),
      onDone,
      onError: vi.fn(),
    })

    expect(onDone.mock.calls[0][0]).toBeUndefined()
  })
})

describe("onLlmUsage", () => {
  it("被调用且不阻塞主链路（fire-and-forget）", async () => {
    mocks.fetch.mockResolvedValue(textStream("完成", {
      prompt_tokens: 1200,
      completion_tokens: 80,
      total_tokens: 1280,
    }))

    let releaseHook: (() => void) | undefined
    const hookGate = new Promise<void>((resolve) => {
      releaseHook = resolve
    })
    const seen: Array<Record<string, unknown>> = []
    __setPluginHooksForTests([view("onLlmUsage")])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async (_entry, context) => {
        seen.push({ ...(context.usage ?? {}) })
        // 故意卡住：如果宿主 await 它，这个用例就永远不结束
        await hookGate
        return {}
      },
    }))

    const onDone = vi.fn()
    await streamChat(config, [{ role: "user", content: "提问" }], {
      onToken: vi.fn(),
      onDone,
      onError: vi.fn(),
    })

    // 主链路已经走完 —— 观察钩子还在挂着
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([{ promptTokens: 1200, completionTokens: 80, model: "gpt-test", provider: "openai" }])

    releaseHook?.()
    await hookGate
    await Promise.resolve()
  })
})

describe("重入保护（陷阱 1）", () => {
  it("prompt 钩子内部的模型调用不会再触发钩子（只跑 1 次，不是无限递归）", async () => {
    mocks.fetch
      .mockResolvedValueOnce(textStream("钩子改写结果"))  // 第 1 次：钩子自己的调用
      .mockResolvedValueOnce(textStream("正式回答"))      // 第 2 次：真正的用户请求

    let hookRuns = 0
    let deps: HookDeps
    setHookDepsFactory(() => {
      deps = createHookDeps({
        llm: {
          async call(input, _onDelta, signal) {
            // 真的绕回宿主最热的 streamChat —— 没有重入保护就会在这里递归
            let text = ""
            const innerError: { current: Error | null } = { current: null }
            await streamChat(
              config,
              [
                { role: "system", content: input.system },
                { role: "user", content: input.user },
              ] satisfies ChatMessage[],
              {
                onToken: (token) => { text += token },
                onDone: () => {},
                onError: (error) => { innerError.current = error },
              },
              signal,
              { skipUserMemory: true } satisfies RequestOverrides,
            )
            if (innerError.current) throw innerError.current
            return { text }
          },
        },
        runHookImpl: async (entry, context, signal) => {
          hookRuns += 1
          return runPromptHook(entry.hook, entry.pluginId, context, deps, signal)
        },
      })
      return deps
    })
    __setPluginHooksForTests([
      view("beforeLlmRequest", { impl: "prompt", tool: undefined, template: "去AI味：{{text}}" }),
    ])

    const tokens: string[] = []
    const onError = vi.fn()
    await streamChat(config, [{ role: "user", content: "原始提问" }], {
      onToken: (token) => tokens.push(token),
      onDone: vi.fn(),
      onError,
    })

    expect(onError).not.toHaveBeenCalled()
    // 钩子只跑了一次：内部那次 streamChat 没有再触发 beforeLlmRequest
    expect(hookRuns).toBe(1)
    // 两次真实请求：钩子那次 + 用户那次（递归的话会远超 2 次）
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    // 第 1 次是钩子的后处理请求（固定 system）
    expect(requestBody(0).messages[0]).toEqual({ role: "system", content: PROMPT_HOOK_SYSTEM })
    expect(requestBody(0).messages[1]).toEqual({ role: "user", content: "去AI味：原始提问" })
    // 第 2 次是用户请求，最后一条 user 被钩子改写成了钩子输出
    expect(requestBody(1).messages[requestBody(1).messages.length - 1]).toEqual({
      role: "user",
      content: "钩子改写结果",
    })
    expect(tokens.join("")).toBe("正式回答")
  })
})
