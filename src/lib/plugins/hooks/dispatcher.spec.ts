/**
 * 调度器行为的测试（设计 §5.3 / §5.4 / §5.6）。
 *
 * 覆盖的是**契约**而不是实现细节：任务书列的 10 条行为 + 6 条补充，每条都在这里
 * 有一个用例。全部用注入的假 deps，不打真模型、不碰 Tauri。
 *
 * 两个反复出现的观察手段：
 *   - 用模板前缀当"谁跑了"的指纹（`input.user` 以插件 id 开头）；
 *   - 用 `deps.runHookImpl` 注入结构化结果（`block` / 自定义 patch），
 *     因为 prompt/process 两个默认实现只能返回文本或抛错。
 */
import { describe, expect, it, vi } from "vitest"
import { compareHookEntries, runHooks, selectEventHooks } from "./dispatcher"
import type { HookContext, HookDeps, HookEvent, PluginHookDeclaration, PluginHookView } from "./types"

/** 造一条钩子视图；模板带插件 id 前缀，便于回推"谁执行了"。 */
function view(
  pluginId: string,
  hook: Partial<PluginHookDeclaration> & { on: HookEvent },
  pluginName = `插件-${pluginId}`,
): PluginHookView {
  return {
    pluginId,
    pluginName,
    hook: { impl: "prompt", template: `${pluginId}：{{text}}`, ...hook },
  }
}

function context(event: HookEvent, overrides: Partial<HookContext> = {}): HookContext {
  return { event, ...overrides }
}

/** 一个 beforeLlmRequest 的典型上下文（有 llm、没有 response）。 */
function requestContext(overrides: Partial<HookContext> = {}): HookContext {
  return context("beforeLlmRequest", {
    llm: {
      provider: "openai",
      model: "gpt-test",
      messages: [
        { role: "system", content: "系统提示词" },
        { role: "user", content: "原文" },
      ],
      temperature: 0.7,
      maxTokens: 100,
    },
    ...overrides,
  })
}

/** 一个 afterLlmResponse 的典型上下文。 */
function responseContext(text = "上游原文"): HookContext {
  return context("afterLlmResponse", { response: { text } })
}

function makeDeps(overrides: Partial<HookDeps> = {}): { deps: HookDeps; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn()
  const deps: HookDeps = {
    llm: { call: async () => ({ text: "默认改写" }) },
    invokePluginTool: async () => "工具改写",
    getConfig: async () => ({}),
    onWarn: warn,
    ...overrides,
  }
  return { deps, warn }
}

/** 记录每次模型调用的 user 文本，用于判定执行顺序/次数。 */
function recordingLlm(order: string[], reply = "改写结果"): HookDeps["llm"] {
  return {
    call: async (input) => {
      order.push(input.user)
      return { text: reply }
    },
  }
}

describe("1. 过滤：只跑 on === context.event 的钩子", () => {
  it("其它事件的钩子完全不执行", async () => {
    const order: string[] = []
    const { deps } = makeDeps({ llm: recordingLlm(order) })

    const outcome = await runHooks(
      [view("a", { on: "beforeLlmRequest" }), view("b", { on: "afterLlmResponse" }), view("c", { on: "onLlmUsage" })],
      requestContext(),
      deps,
    )

    expect(order).toHaveLength(1)
    expect(order[0].startsWith("a：")).toBe(true)
    expect(outcome.ran).toBe(1)
    expect(outcome.failures).toEqual([])
  })

  it("没有匹配的钩子时原样返回上下文", async () => {
    const order: string[] = []
    const ctx = requestContext()
    const { deps } = makeDeps({ llm: recordingLlm(order) })

    const outcome = await runHooks([], ctx, deps)

    expect(order).toEqual([])
    expect(outcome.context).toBe(ctx)
    expect(outcome.ran).toBe(0)
    expect(outcome.blocked).toBeUndefined()
  })
})

describe("2. 排序：priority 升序，同 priority 按 pluginId 字典序", () => {
  it("小的 priority 先跑", async () => {
    const order: string[] = []
    const { deps } = makeDeps({ llm: recordingLlm(order) })

    await runHooks(
      [
        view("late", { on: "beforeLlmRequest", priority: 10 }),
        view("early", { on: "beforeLlmRequest", priority: -5 }),
        view("middle", { on: "beforeLlmRequest", priority: 0 }),
      ],
      requestContext(),
      deps,
    )

    expect(order.map((text) => text.split("：")[0])).toEqual(["early", "middle", "late"])
  })

  it("同 priority 由 pluginId 决定（连跑 5 次结果一致）", async () => {
    const entries = [
      view("zeta", { on: "beforeLlmRequest", priority: 1 }),
      view("alpha", { on: "beforeLlmRequest", priority: 1 }),
      view("mike", { on: "beforeLlmRequest", priority: 1 }),
    ]
    const seen: string[][] = []

    for (let round = 0; round < 5; round += 1) {
      const order: string[] = []
      const { deps } = makeDeps({ llm: recordingLlm(order) })
      // 每一轮都打乱输入顺序：顺序只由 priority+pluginId 决定，与清单顺序无关
      const shuffled = round % 2 === 0 ? entries : [...entries].reverse()
      await runHooks(shuffled, requestContext(), deps)
      seen.push(order.map((text) => text.split("：")[0]))
    }

    for (const run of seen) expect(run).toEqual(["alpha", "mike", "zeta"])
  })

  it("非法 priority（NaN / 字符串）按 0 处理，不破坏排序", async () => {
    const order: string[] = []
    const { deps } = makeDeps({ llm: recordingLlm(order) })

    await runHooks(
      [
        view("b", { on: "beforeLlmRequest", priority: Number.NaN }),
        view("a", { on: "beforeLlmRequest", priority: "3" as unknown as number }),
      ],
      requestContext(),
      deps,
    )

    expect(order.map((text) => text.split("：")[0])).toEqual(["a", "b"])
  })
})

describe("3. 串行：一个跑完再跑下一个", () => {
  it("同一时刻最多一个钩子在执行", async () => {
    let active = 0
    let maxActive = 0
    const { deps } = makeDeps({
      llm: {
        call: async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise((resolve) => setTimeout(resolve, 5))
          active -= 1
          return { text: "结果" }
        },
      },
    })

    const outcome = await runHooks(
      [
        view("a", { on: "beforeLlmRequest", priority: 1 }),
        view("b", { on: "beforeLlmRequest", priority: 2 }),
        view("c", { on: "beforeLlmRequest", priority: 3 }),
      ],
      requestContext(),
      deps,
    )

    expect(maxActive).toBe(1)
    expect(outcome.ran).toBe(3)
  })

  it("后一个钩子看到的是前一个钩子改过的上下文", async () => {
    const seen: string[] = []
    const { deps } = makeDeps({
      runHookImpl: async (entry, ctx) => {
        seen.push(`${entry.pluginId}:${ctx.llm?.temperature ?? "-"}`)
        return { patch: { llm: { temperature: 0.1 } } }
      },
    })

    await runHooks(
      [view("a", { on: "beforeLlmRequest", priority: 1 }), view("b", { on: "beforeLlmRequest", priority: 2 })],
      requestContext(),
      deps,
    )

    expect(seen).toEqual(["a:0.7", "b:0.1"])
  })
})

describe("4/14. 观测事件：patch 一律忽略并警告", () => {
  it("onLlmUsage 返回 patch 被忽略，且 warn 被调用一次", async () => {
    const { deps, warn } = makeDeps({
      runHookImpl: async () => ({ patch: { response: { text: "被观测钩子改了" } } }),
    })

    const outcome = await runHooks(
      [view("meter", { on: "onLlmUsage" })],
      context("onLlmUsage", {
        response: { text: "原文" },
        usage: { promptTokens: 10, completionTokens: 20, model: "m", provider: "p" },
      }),
      deps,
    )

    expect(outcome.context.response?.text).toBe("原文")
    expect(outcome.ran).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("观测事件")
  })

  it("onChapterCompleted 的 block 也被忽略（观测事件只通知不决策）", async () => {
    const { deps, warn } = makeDeps({
      runHookImpl: async () => ({ block: { reason: "我想拦一下" } }),
    })

    const outcome = await runHooks(
      [view("meter", { on: "onChapterCompleted", gate: true })],
      context("onChapterCompleted", { chapter: { id: "c1", title: "第一章", text: "正文" } }),
      deps,
    )

    expect(outcome.blocked).toBeUndefined()
    expect(outcome.failures).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it("观测事件的 gate 钩子超时也不阻断（只记 failures）", async () => {
    const { deps } = makeDeps({
      runHookImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40))
        return {}
      },
    })

    const outcome = await runHooks([view("slow", { on: "onLlmUsage", gate: true })], context("onLlmUsage"), deps, {
      timeoutMsOverride: { onLlmUsage: 10 },
    })

    expect(outcome.blocked).toBeUndefined()
    expect(outcome.failures).toHaveLength(1)
  })
})

describe("5. patch 合并：messages 替换、temperature/maxTokens 覆盖、response.text 覆盖", () => {
  it("temperature / maxTokens 覆盖原值", async () => {
    const { deps } = makeDeps({
      runHookImpl: async () => ({ patch: { llm: { temperature: 0.2, maxTokens: 4096 } } }),
    })

    const outcome = await runHooks([view("preset", { on: "beforeLlmRequest" })], requestContext(), deps)

    expect(outcome.context.llm?.temperature).toBe(0.2)
    expect(outcome.context.llm?.maxTokens).toBe(4096)
    // 没被 patch 的字段原样保留
    expect(outcome.context.llm?.messages).toHaveLength(2)
  })

  it("response.text 覆盖原值", async () => {
    const { deps } = makeDeps({
      runHookImpl: async () => ({ patch: { response: { text: "改过的文本" } } }),
    })

    const outcome = await runHooks([view("polish", { on: "afterLlmResponse" })], responseContext(), deps)

    expect(outcome.context.response?.text).toBe("改过的文本")
  })

  it("不入参引用：钩子返回的数组不会被上下文持有", async () => {
    const messages = [{ role: "user", content: "钩子给的" }]
    const { deps } = makeDeps({ runHookImpl: async () => ({ patch: { llm: { messages } } }) })

    const outcome = await runHooks([view("mut", { on: "beforeLlmRequest" })], requestContext(), deps)
    messages[0].content = "事后偷偷改"

    expect(outcome.context.llm?.messages[0].content).toBe("钩子给的")
  })

  it("空 messages / 空 response.text 被忽略并警告（不允许静默清空）", async () => {
    const { deps, warn } = makeDeps({
      runHookImpl: async () => ({ patch: { llm: { messages: [] }, response: { text: "" } } }),
    })

    const outcome = await runHooks([view("broken", { on: "beforeLlmRequest" })], requestContext(), deps)

    expect(outcome.context.llm?.messages).toHaveLength(2)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("非法的 llm patch 字段被忽略", async () => {
    const { deps, warn } = makeDeps({
      runHookImpl: async () => ({
        patch: { llm: { temperature: Number.NaN, maxTokens: -1 } },
      }),
    })

    const outcome = await runHooks([view("bad", { on: "beforeLlmRequest" })], requestContext(), deps)

    expect(outcome.context.llm?.temperature).toBe(0.7)
    expect(outcome.context.llm?.maxTokens).toBe(100)
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe("6. 超时：hook.timeoutMs → override → 事件默认值", () => {
  it("hook.timeoutMs 优先于 timeoutMsOverride", async () => {
    const { deps } = makeDeps({
      runHookImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return {}
      },
    })

    const outcome = await runHooks(
      [view("gated", { on: "beforeLlmRequest", gate: true, timeoutMs: 15 })],
      requestContext(),
      deps,
      { timeoutMsOverride: { beforeLlmRequest: 5_000 } },
    )

    expect(outcome.blocked).toBeDefined()
    expect(outcome.blocked?.reason).toContain("15ms")
  })

  it("没写 timeoutMs 时用 override（测试专用入口）", async () => {
    const { deps } = makeDeps({
      runHookImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return {}
      },
    })

    const outcome = await runHooks([view("slow", { on: "beforeLlmRequest", gate: true })], requestContext(), deps, {
      timeoutMsOverride: { beforeLlmRequest: 12 },
    })

    expect(outcome.blocked?.reason).toContain("12ms")
  })

  it("两者都没有时用事件默认值（不与 override 混用）", async () => {
    // 直接断言默认值的解析结果，避免为了验证 8000ms 而让测试真等 8 秒
    const { resolveHookTimeoutMs } = await import("./types")
    expect(resolveHookTimeoutMs("beforeLlmRequest", undefined, undefined)).toBe(8_000)
    expect(resolveHookTimeoutMs("beforeLlmRequest", undefined, { beforeLlmRequest: 0 })).toBe(8_000)
    expect(resolveHookTimeoutMs("beforeLlmRequest", Number.NaN, { beforeLlmRequest: 30 })).toBe(30)
    expect(resolveHookTimeoutMs("beforeChapterDraft", 20_000, undefined)).toBe(20_000)
  })
})

describe("7/12. 超时与抛错：非 gate 跳过继续，gate 阻断", () => {
  it("非 gate 超时 → 记 failures 并继续跑后面的钩子", async () => {
    const handled: string[] = []
    const { deps } = makeDeps({
      llm: {
        call: (input, _onDelta, _signal) => {
          if (input.user.startsWith("slow：")) {
            return new Promise((resolve) => setTimeout(() => resolve({ text: "迟到的结果" }), 60))
          }
          handled.push(input.user)
          return Promise.resolve({ text: "后面的结果" })
        },
      },
    })

    const outcome = await runHooks(
      [view("slow", { on: "beforeLlmRequest", priority: 1 }), view("fast", { on: "beforeLlmRequest", priority: 2 })],
      requestContext(),
      deps,
      { timeoutMsOverride: { beforeLlmRequest: 10 } },
    )

    expect(handled).toHaveLength(1)
    expect(handled[0].startsWith("fast：")).toBe(true)
    expect(outcome.ran).toBe(1)
    expect(outcome.blocked).toBeUndefined()
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0].pluginId).toBe("slow")
    expect(outcome.failures[0].reason).toContain("超时")
  })

  it("gate 超时 → 返回 blocked（fail-closed）", async () => {
    const { deps } = makeDeps({
      llm: {
        call: () => new Promise((resolve) => setTimeout(() => resolve({ text: "迟到" }), 60)),
      },
    })

    const outcome = await runHooks(
      [view("gatekeeper", { on: "beforeLlmRequest", gate: true, priority: 1 }), view("later", { on: "beforeLlmRequest", priority: 2 })],
      requestContext(),
      deps,
      { timeoutMsOverride: { beforeLlmRequest: 10 } },
    )

    expect(outcome.blocked).toEqual({ reason: expect.stringContaining("超时"), pluginId: "gatekeeper" })
    expect(outcome.ran).toBe(0)
    expect(outcome.failures).toHaveLength(1)
  })

  it("非 gate 抛错 → 继续；gate 抛错 → 阻断", async () => {
    const entries = [
      view("thrower", { on: "beforeLlmRequest", priority: 1 }),
      view("after", { on: "beforeLlmRequest", priority: 2 }),
    ]
    const llm: HookDeps["llm"] = {
      call: (input) => {
        if (input.user.startsWith("thrower：")) return Promise.reject(new Error("模板写错了"))
        return Promise.resolve({ text: "后面的结果" })
      },
    }

    const open = await runHooks(entries, requestContext(), makeDeps({ llm }).deps)
    expect(open.blocked).toBeUndefined()
    expect(open.ran).toBe(1)
    expect(open.failures[0].reason).toBe("模板写错了")

    const closed = await runHooks(
      [view("thrower", { on: "beforeLlmRequest", gate: true, priority: 1 })],
      requestContext(),
      makeDeps({ llm }).deps,
    )
    expect(closed.blocked?.pluginId).toBe("thrower")
  })

  it("模板缺 {{text}} 被当作可读错误，而不是静默不生效", async () => {
    const { deps } = makeDeps()
    const outcome = await runHooks(
      [view("noText", { on: "beforeLlmRequest", template: "只要一段总结" })],
      requestContext(),
      deps,
    )

    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0].reason).toContain("{{text}}")
  })
})

describe("8. block 语义：只有 gate 钩子的阻断生效", () => {
  it("gate 钩子返回 block → blocked，后续钩子不执行", async () => {
    const executed: string[] = []
    const { deps } = makeDeps({
      runHookImpl: async (entry) => {
        executed.push(entry.pluginId)
        return entry.pluginId === "gate" ? { block: { reason: "字数不足 3000" } } : { patch: { response: { text: "不该跑到" } } }
      },
    })

    const outcome = await runHooks(
      [view("gate", { on: "beforeReview", gate: true, priority: 1 }), view("tail", { on: "beforeReview", priority: 2 })],
      context("beforeReview", { chapter: { id: "c", title: "t", text: "正文" } }),
      deps,
    )

    expect(outcome.blocked).toEqual({ reason: "字数不足 3000", pluginId: "gate" })
    expect(executed).toEqual(["gate"])
  })

  it("非 gate 钩子返回 block → 忽略并 warn，流程继续", async () => {
    const { deps, warn } = makeDeps({
      runHookImpl: async () => ({ block: { reason: "我觉得不行" }, patch: { response: { text: "仍应生效" } } }),
    })

    const outcome = await runHooks(
      [view("nosy", { on: "beforeReview" })],
      context("beforeReview", { chapter: { id: "c", title: "t", text: "正文" } }),
      deps,
    )

    expect(outcome.blocked).toBeUndefined()
    expect(outcome.context.response?.text).toBe("仍应生效")
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("不是门禁钩子")
  })
})

describe("9/15. 外部取消：一个钩子都不跑", () => {
  it("signal 已 abort → 立即返回，blocked 不设置，failures 记一条已取消", async () => {
    const order: string[] = []
    const { deps } = makeDeps({ llm: recordingLlm(order) })
    const controller = new AbortController()
    controller.abort()

    const outcome = await runHooks([view("a", { on: "beforeLlmRequest" })], requestContext(), deps, {
      signal: controller.signal,
    })

    expect(order).toEqual([])
    expect(outcome.ran).toBe(0)
    expect(outcome.blocked).toBeUndefined()
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0].reason).toContain("已取消")
  })

  it("跑到一半被取消 → 后续钩子不再执行，当前钩子的结果也不采纳", async () => {
    const controller = new AbortController()
    const executed: string[] = []
    const { deps } = makeDeps({
      runHookImpl: async (entry) => {
        executed.push(entry.pluginId)
        controller.abort()
        return {}
      },
    })

    const outcome = await runHooks(
      [view("a", { on: "beforeLlmRequest", priority: 1 }), view("b", { on: "beforeLlmRequest", priority: 2 })],
      requestContext(),
      deps,
      { signal: controller.signal },
    )

    expect(executed).toEqual(["a"])
    // 取消即"整次生成不要了"：已完成的这个钩子的结果也不再采纳（ran 不计数），
    // 否则界面会显示"跑了 1 个钩子"，与用户看到的"已取消"矛盾。
    expect(outcome.ran).toBe(0)
    expect(outcome.failures.some((failure) => failure.reason.includes("已取消"))).toBe(true)
  })
})

describe("10. ran：只数真正成功应用结果的钩子", () => {
  it("三个钩子中间一个失败 → ran 为 2", async () => {
    const llm: HookDeps["llm"] = {
      call: (input) => {
        if (input.user.startsWith("boom：")) return Promise.reject(new Error("坏了"))
        return Promise.resolve({ text: "好" })
      },
    }

    const outcome = await runHooks(
      [
        view("a", { on: "beforeLlmRequest", priority: 1 }),
        view("boom", { on: "beforeLlmRequest", priority: 2 }),
        view("c", { on: "beforeLlmRequest", priority: 3 }),
      ],
      requestContext(),
      makeDeps({ llm }).deps,
    )

    expect(outcome.ran).toBe(2)
    expect(outcome.failures).toHaveLength(1)
  })
})

describe("13. beforeLlmRequest 多钩子改 messages：后者替换前者（不拼接）", () => {
  it("最终 messages 只有后者那一版，长度不增长", async () => {
    const hookInputs: string[] = []
    const { deps } = makeDeps({
      runHookImpl: async (entry, ctx) => {
        hookInputs.push(`${entry.pluginId}:${ctx.llm?.messages.length}:${ctx.llm?.messages.at(-1)?.content}`)
        const replacement = entry.pluginId === "first" ? "第一版" : "第二版"
        const messages = (ctx.llm?.messages ?? []).map((message) =>
          message.role === "user" ? { ...message, content: replacement } : message,
        )
        return { patch: { llm: { messages } } }
      },
    })

    const outcome = await runHooks(
      [view("first", { on: "beforeLlmRequest", priority: 1 }), view("second", { on: "beforeLlmRequest", priority: 2 })],
      requestContext(),
      deps,
    )

    const messages = outcome.context.llm?.messages ?? []
    expect(messages).toHaveLength(2) // 两个钩子各改一次，长度仍是"系统+用户"两条
    expect(messages.at(-1)?.content).toBe("第二版")
    expect(hookInputs).toEqual(["first:2:原文", "second:2:第一版"])
  })
})

describe("超时真取消：AbortController 的信号确实送到模型调用", () => {
  it("超时后假模型收到 abort", async () => {
    let aborted = false
    const { deps } = makeDeps({
      llm: {
        call: (_input, _onDelta, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              aborted = true
              const error = new Error("aborted")
              error.name = "AbortError"
              reject(error)
            })
          }),
      },
    })

    const outcome = await runHooks(
      [view("hang", { on: "beforeLlmRequest" })],
      requestContext(),
      deps,
      { timeoutMsOverride: { beforeLlmRequest: 10 } },
    )

    expect(aborted).toBe(true)
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0].reason).toContain("超时")
  })

  it("外部取消时在跑的钩子也收到 abort", async () => {
    const controller = new AbortController()
    let aborted = false
    const { deps } = makeDeps({
      llm: {
        call: (_input, _onDelta, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              aborted = true
              reject(new Error("aborted"))
            })
            setTimeout(() => controller.abort(), 5)
          }),
      },
    })

    const outcome = await runHooks([view("wait", { on: "beforeLlmRequest" })], requestContext(), deps, {
      signal: controller.signal,
      timeoutMsOverride: { beforeLlmRequest: 5_000 },
    })

    expect(aborted).toBe(true)
    expect(outcome.failures[0].reason).toContain("已取消")
  })
})

describe("process 实现", () => {
  it("调插件工具并把返回文本写回 response", async () => {
    const calls: Array<{ pluginId: string; tool: string; args: Record<string, unknown> }> = []
    const { deps } = makeDeps({
      invokePluginTool: async (pluginId, tool, args) => {
        calls.push({ pluginId, tool, args })
        return "工具改过的文本"
      },
    })

    const outcome = await runHooks(
      [view("coder", { on: "afterLlmResponse", impl: "process", tool: "rewrite_style" })],
      responseContext("上游原文"),
      deps,
    )

    expect(calls).toEqual([
      { pluginId: "coder", tool: "rewrite_style", args: expect.objectContaining({ event: "afterLlmResponse", text: "上游原文" }) },
    ])
    expect(outcome.context.response?.text).toBe("工具改过的文本")
    expect(outcome.ran).toBe(1)
  })

  it("缺 tool → failures（可读错误），流程继续", async () => {
    const { deps } = makeDeps()
    const outcome = await runHooks(
      [view("coder", { on: "afterLlmResponse", impl: "process" })],
      responseContext(),
      deps,
    )

    expect(outcome.failures[0].reason).toContain("tool")
    expect(outcome.ran).toBe(0)
  })

  it("工具返回空文本 → failures（不把空文本当改写）", async () => {
    const { deps } = makeDeps({ invokePluginTool: async () => "" })
    const outcome = await runHooks(
      [view("coder", { on: "afterLlmResponse", impl: "process", tool: "t" })],
      responseContext(),
      deps,
    )

    expect(outcome.failures[0].reason).toContain("空")
  })

  it("未知 impl → failures，不崩", async () => {
    const { deps } = makeDeps()
    const outcome = await runHooks(
      [view("weird", { on: "afterLlmResponse", impl: "magic" as unknown as "prompt" })],
      responseContext(),
      deps,
    )

    expect(outcome.failures[0].reason).toContain("未知的钩子实现")
  })
})

describe("selectEventHooks / compareHookEntries（纯函数）", () => {
  it("过滤 + 排序一次完成", () => {
    const selected = selectEventHooks(
      [
        view("b", { on: "beforeLlmRequest", priority: 2 }),
        view("x", { on: "afterLlmResponse" }),
        view("a", { on: "beforeLlmRequest", priority: 1 }),
      ],
      "beforeLlmRequest",
    )
    expect(selected.map((entry) => entry.pluginId)).toEqual(["a", "b"])
  })

  it("比较函数与 locale 无关：ASCII 前缀按码元排序", () => {
    const upper = view("Z", { on: "beforeLlmRequest" })
    const lower = view("a", { on: "beforeLlmRequest" })
    // 'Z'(0x5A) < 'a'(0x61)：码元序，不随系统 locale 变化
    expect(compareHookEntries(upper, lower)).toBeLessThan(0)
    expect(compareHookEntries(lower, lower)).toBe(0)
  })
})
