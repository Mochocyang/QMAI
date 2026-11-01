/**
 * 声明式钩子实现（`impl: "prompt"`）的测试。
 *
 * 观察点都是"用户能感觉到的后果"：模板错了必须报人话错误、改写结果必须落在正确的
 * 字段上、空文本绝不能当成有效改写、`{{text}}` 只有一处规则。
 */
import { describe, expect, it, vi } from "vitest"
import { PROMPT_HOOK_SYSTEM, buildHookTextPatch, resolveHookText, runPromptHook } from "./prompt-impl"
import type { HookContext, HookDeps, PluginHookDeclaration, PluginHookView } from "./types"

function hook(overrides: Partial<PluginHookDeclaration> = {}): PluginHookView["hook"] {
  return { on: "afterLlmResponse", impl: "prompt", template: "去 AI 味：{{text}}", ...overrides }
}

function requestContext(userText = "上游原文"): HookContext {
  return {
    event: "beforeLlmRequest",
    llm: {
      provider: "openai",
      model: "gpt-test",
      messages: [
        { role: "system", content: "系统" },
        { role: "assistant", content: "上一轮回答" },
        { role: "user", content: userText },
      ],
    },
  }
}

function responseContext(text = "上游正文"): HookContext {
  return { event: "afterLlmResponse", response: { text } }
}

function deps(overrides: Partial<HookDeps> = {}): HookDeps {
  return {
    llm: { call: async () => ({ text: "改写后的文本" }) },
    invokePluginTool: async () => "",
    getConfig: async () => ({}),
    onWarn: vi.fn(),
    ...overrides,
  }
}

describe("runPromptHook：配置错误必须报人话", () => {
  it("模板缺 {{text}} → 抛错", async () => {
    await expect(
      runPromptHook(hook({ template: "帮我润色这段文字" }), "p1", responseContext(), deps(), new AbortController().signal),
    ).rejects.toThrow("必须包含 {{text}}")
  })

  it("转义的 \\{{text}} 不算（等于没写）→ 抛错", async () => {
    await expect(
      runPromptHook(hook({ template: "字面量 \\{{text}}" }), "p1", responseContext(), deps(), new AbortController().signal),
    ).rejects.toThrow("必须包含 {{text}}")
  })

  it("没有 template → 抛错", async () => {
    await expect(
      runPromptHook(hook({ template: "" }), "p1", responseContext(), deps(), new AbortController().signal),
    ).rejects.toThrow("template")
  })

  it("观测事件不支持 prompt 实现 → 抛错（不花冤枉钱）", async () => {
    const ctx: HookContext = { event: "onLlmUsage", usage: { promptTokens: 1 } }
    await expect(runPromptHook(hook(), "p1", ctx, deps(), new AbortController().signal)).rejects.toThrow("观测事件")
  })

  it("上下文没有原文 → 抛错", async () => {
    const ctx: HookContext = { event: "afterLlmResponse" }
    await expect(runPromptHook(hook(), "p1", ctx, deps(), new AbortController().signal)).rejects.toThrow("没有可处理的原文")
  })
})

describe("runPromptHook：两种事件的 patch 形状", () => {
  it("beforeLlmRequest → 替换最后一条 user 消息，其余消息保留", async () => {
    const seen: Array<{ system: string; user: string }> = []
    const { signal } = new AbortController()
    const result = await runPromptHook(
      hook({ on: "beforeLlmRequest", template: "改写：{{text}}" }),
      "p1",
      requestContext("原文"),
      deps({
        llm: {
          call: async (input, _onDelta, callSignal) => {
            seen.push(input)
            // 真取消的前提：调度器的 signal 必须原样到达这里
            expect(callSignal).toBe(signal)
            return { text: "新原文" }
          },
        },
      }),
      signal,
    )

    expect(seen).toEqual([{ system: PROMPT_HOOK_SYSTEM, user: "改写：原文" }])
    const messages = result.patch?.llm?.messages
    expect(messages).toHaveLength(3)
    expect(messages?.map((message) => message.role)).toEqual(["system", "assistant", "user"])
    expect(messages?.at(-1)).toEqual({ role: "user", content: "新原文" })
    expect(messages?.[1]).toEqual({ role: "assistant", content: "上一轮回答" })
  })

  it("afterLlmResponse → patch.response.text", async () => {
    const result = await runPromptHook(hook(), "p1", responseContext("上游正文"), deps(), new AbortController().signal)

    expect(result.patch).toEqual({ response: { text: "改写后的文本" } })
    expect(result.block).toBeUndefined()
  })

  it("工作流事件（beforeChapterDraft）→ 取章节正文", async () => {
    const seen: string[] = []
    const ctx: HookContext = {
      event: "beforeChapterDraft",
      chapter: { id: "c1", title: "第一章", text: "章节正文" },
    }

    const result = await runPromptHook(
      hook({ on: "beforeChapterDraft", template: "扩写：{{text}}" }),
      "p1",
      ctx,
      deps({
        llm: {
          call: async (input) => {
            seen.push(input.user)
            return { text: "扩写后正文" }
          },
        },
      }),
      new AbortController().signal,
    )

    expect(seen).toEqual(["扩写：章节正文"])
    expect(result.patch).toEqual({ response: { text: "扩写后正文" } })
  })

  it("输出为空字符串 → 抛错（不把空文本当作有效改写）", async () => {
    await expect(
      runPromptHook(hook(), "p1", responseContext(), deps({ llm: { call: async () => ({ text: "   " }) } }), new AbortController().signal),
    ).rejects.toThrow("空结果")
  })
})

describe("runPromptHook：插值复用 declarative/interpolate", () => {
  it("模板可用 config.* / project.* / chapter.*", async () => {
    const seen: string[] = []
    const ctx: HookContext = {
      event: "afterLlmResponse",
      response: { text: "正文" },
      project: { bookTitle: "长夜", bookTags: ["科幻", "末世"] },
      chapter: { title: "第一章", text: "正文" },
    }

    await runPromptHook(
      hook({ template: "书名={{project.bookTitle}} 标签={{project.bookTags}} 章={{chapter.title}} 语气={{config.tone}}：{{text}}" }),
      "p1",
      ctx,
      deps({
        getConfig: async () => ({ tone: "克制" }),
        llm: {
          call: async (input) => {
            seen.push(input.user)
            return { text: "结果" }
          },
        },
      }),
      new AbortController().signal,
    )

    // 数组按中文顿号连接（沿用 interpolate 的规则，不在这里另立一套）
    expect(seen[0]).toBe("书名=长夜 标签=科幻、末世 章=第一章 语气=克制：正文")
  })

  it("模板没用到 config.* 时不读配置（少一次 IPC，也少一分权限面）", async () => {
    const getConfig = vi.fn(async () => ({}))
    await runPromptHook(hook(), "p1", responseContext(), deps({ getConfig }), new AbortController().signal)
    expect(getConfig).not.toHaveBeenCalled()
  })

  it("读配置失败不打断钩子，只 warn", async () => {
    const warn = vi.fn()
    const seen: string[] = []
    const result = await runPromptHook(
      hook({ template: "{{config.missing}}：{{text}}" }),
      "p1",
      responseContext("正文"),
      deps({
        onWarn: warn,
        getConfig: async () => {
          throw new Error("配置读不到")
        },
        llm: {
          call: async (input) => {
            seen.push(input.user)
            return { text: "结果" }
          },
        },
      }),
      new AbortController().signal,
    )

    expect(warn).toHaveBeenCalled()
    expect(seen[0]).toBe("：正文")
    expect(result.patch).toEqual({ response: { text: "结果" } })
  })

  it("signal 已 abort 时根本不发请求", async () => {
    const call = vi.fn()
    const controller = new AbortController()
    controller.abort()

    await expect(
      runPromptHook(hook(), "p1", responseContext(), deps({ llm: { call } }), controller.signal),
    ).rejects.toThrow("已取消")
    expect(call).not.toHaveBeenCalled()
  })
})

describe("取值/写回规则（纯函数）", () => {
  it("resolveHookText：按事件取值，不随字段存在性漂移", () => {
    const both: HookContext = {
      event: "afterLlmResponse",
      response: { text: "响应" },
      llm: { provider: "p", model: "m", messages: [{ role: "user", content: "消息" }] },
      chapter: { text: "章节" },
    }
    expect(resolveHookText(both)).toBe("响应")
    expect(resolveHookText({ ...both, event: "beforeLlmRequest" })).toBe("消息")
    expect(resolveHookText({ event: "afterChapterDraft", chapter: { text: "章节" } })).toBe("章节")
    expect(resolveHookText({ event: "afterLlmResponse" })).toBeUndefined()
  })

  it("buildHookTextPatch：请求前改 messages，其余改 response", () => {
    const request = buildHookTextPatch(requestContext(), "新")
    expect(request.llm?.messages?.at(-1)?.content).toBe("新")

    const after = buildHookTextPatch(responseContext(), "新")
    expect(after).toEqual({ response: { text: "新" } })
  })
})
