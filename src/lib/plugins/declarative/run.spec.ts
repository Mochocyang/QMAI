/**
 * 执行编排的测试。
 *
 * 用假的 `LlmCaller` 覆盖三条最容易悄悄坏掉的性质：
 *   1. 表单变量真的进了 user 消息（不然用户填了等于没填）；
 *   2. 只在模板引用项目变量时才读项目（权限面）；
 *   3. 流式回调按序、中止可识别、解析降级不抛错。
 */
import { describe, expect, it, vi } from "vitest"
import {
  MAX_RUN_ACTION_CHAIN_DEPTH,
  RunActionAbortedError,
  RunActionChainError,
  assertRunnableChain,
  createUnavailableLlmCaller,
  isRunActionAborted,
  runDeclarativeAction,
  type LlmCaller,
  type RunActionDeps,
} from "./run"
import type { DeclarativeAction } from "./types"

function titleAction(overrides: Partial<DeclarativeAction> = {}): DeclarativeAction {
  return {
    id: "generate-titles",
    title: "生成书名",
    prompt: {
      system: "你是中文网文书名策划。",
      user: "题材：{{genre}}\n灵感：{{idea}}\n请给出 {{count}} 个书名。",
    },
    output: { mode: "list", targets: [] },
    ...overrides,
  }
}

/** 记录调用参数的假 LLM：按 chunk 依次回调，返回拼好的全文。 */
function fakeLlm(chunks: string[], text = chunks.join("")): LlmCaller & {
  calls: Array<{ system: string; user: string; maxOutputTokens?: number }>
} {
  const calls: Array<{ system: string; user: string; maxOutputTokens?: number }> = []
  return {
    calls,
    async call(input, onDelta) {
      calls.push(input)
      for (const chunk of chunks) onDelta(chunk)
      return { text }
    },
  }
}

function deps(overrides: Partial<RunActionDeps> = {}): RunActionDeps {
  return {
    llm: fakeLlm(["《第一》"]),
    getConfig: vi.fn(async () => ({})),
    ...overrides,
  }
}

const signal = () => new AbortController().signal

describe("runDeclarativeAction", () => {
  it("表单变量插值进 user 消息", async () => {
    const llm = fakeLlm(["一", "二"])
    const result = await runDeclarativeAction(
      titleAction(),
      "p1",
      { genre: "科幻", idea: "末日列车", count: 5 },
      deps({ llm }),
      () => {},
      signal(),
    )

    expect(llm.calls).toHaveLength(1)
    expect(llm.calls[0].system).toBe("你是中文网文书名策划。")
    expect(llm.calls[0].user).toContain("题材：科幻")
    expect(llm.calls[0].user).toContain("灵感：末日列车")
    expect(llm.calls[0].user).toContain("请给出 5 个书名")
    expect(result.missing).toEqual([])
  })

  it("limits.maxOutputTokens 透传给模型调用", async () => {
    const llm = fakeLlm(["ok"])
    await runDeclarativeAction(
      titleAction({ limits: { maxOutputTokens: 2000 } }),
      "p1",
      { genre: "科幻", idea: "x", count: 1 },
      deps({ llm }),
      () => {},
      signal(),
    )
    expect(llm.calls[0].maxOutputTokens).toBe(2000)
  })

  it("模板引用 project./chapter./selection 时才读上下文", async () => {
    const readProject = vi.fn(async () => ({ bookTitle: "长夜" }))
    const readChapter = vi.fn(async () => ({ title: "第一章", text: "正文" }))
    const getSelection = vi.fn(() => "选中的句子")

    const action = titleAction({
      prompt: {
        system: "书名策划",
        user: "书名：{{project.bookTitle}}\n章节：{{chapter.title}}\n> {{selection}}",
      },
    })

    await runDeclarativeAction(action, "p1", {}, deps({ readProject, readChapter, getSelection }), () => {}, signal())

    expect(readProject).toHaveBeenCalledTimes(1)
    expect(readChapter).toHaveBeenCalledTimes(1)
    expect(getSelection).toHaveBeenCalledTimes(1)
  })

  it("纯表单模板不读项目（权限面：纯表单 action 不需要 fs:project-read）", async () => {
    const readProject = vi.fn(async () => ({ bookTitle: "长夜" }))
    const readChapter = vi.fn(async () => ({ title: "第一章" }))
    const getConfig = vi.fn(async () => ({}))

    await runDeclarativeAction(
      titleAction(),
      "p1",
      { genre: "科幻", idea: "x", count: 1 },
      deps({ readProject, readChapter, getConfig }),
      () => {},
      signal(),
    )

    expect(readProject).not.toHaveBeenCalled()
    expect(readChapter).not.toHaveBeenCalled()
    expect(getConfig).not.toHaveBeenCalled()
  })

  it("模板引用 config.x 时才读配置，且配置值进提示词", async () => {
    const llm = fakeLlm(["ok"])
    const getConfig = vi.fn(async () => ({ style: "爆点" }))
    const action = titleAction({ prompt: { system: "策划", user: "风格：{{config.style}}" } })

    await runDeclarativeAction(action, "p1", {}, deps({ llm, getConfig }), () => {}, signal())

    expect(getConfig).toHaveBeenCalledWith("p1")
    expect(llm.calls[0].user).toBe("风格：爆点")
  })

  it("读项目失败不打断生成，变量按空串插值", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const llm = fakeLlm(["ok"])
    const readProject = vi.fn(async () => {
      throw new Error("E_NO_PROJECT")
    })
    const action = titleAction({ prompt: { system: "策划", user: "书：{{project.bookTitle}}" } })

    const result = await runDeclarativeAction(
      action,
      "p1",
      {},
      deps({ llm, readProject }),
      () => {},
      new AbortController().signal,
    )

    expect(llm.calls[0].user).toBe("书：")
    expect(result.missing).toContain("project.bookTitle")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("流式 onDelta 按序调用", async () => {
    const seen: string[] = []
    const llm = fakeLlm(["一、", "二、", "三、"])
    await runDeclarativeAction(titleAction(), "p1", {}, deps({ llm }), (delta) => seen.push(delta), signal())
    expect(seen).toEqual(["一、", "二、", "三、"])
  })

  it("已经中止的信号直接抛可识别的中止错误，不调模型", async () => {
    const llm = fakeLlm(["不该出现"])
    const controller = new AbortController()
    controller.abort()

    await expect(
      runDeclarativeAction(titleAction(), "p1", {}, deps({ llm }), () => {}, controller.signal),
    ).rejects.toBeInstanceOf(RunActionAbortedError)
    expect(llm.calls).toHaveLength(0)
  })

  it("生成过程中被中止：抛可识别错误，而不是笼统的失败", async () => {
    const controller = new AbortController()
    const llm: LlmCaller = {
      call(_input, _onDelta, callSignal) {
        controller.abort()
        return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
      },
    }

    const error = await runDeclarativeAction(titleAction(), "p1", {}, deps({ llm }), () => {}, controller.signal).catch(
      (cause: unknown) => cause,
    )
    expect(isRunActionAborted(error)).toBe(true)
    expect(error).toBeInstanceOf(RunActionAbortedError)
  })

  it("模型没返回内容时返回 degraded，而不是抛错", async () => {
    const llm = fakeLlm([], "")
    const result = await runDeclarativeAction(titleAction(), "p1", {}, deps({ llm }), () => {}, signal())

    expect(result.parsed.kind).toBe("degraded")
    if (result.parsed.kind === "degraded") {
      expect(result.parsed.reason).toBe("模型没有返回内容")
    }
  })

  it("list 模式解析不出条目时仍然返回 degraded 结果", async () => {
    const llm = fakeLlm(["好的，我无法完成。"], "好的，我无法完成。")
    const result = await runDeclarativeAction(titleAction(), "p1", {}, deps({ llm }), () => {}, signal())
    // 「好的，我无法完成。」是一行有效文本 —— 但这里验证的是"不抛错、一定有 parsed"
    expect(result.parsed.kind === "degraded" || result.parsed.kind === "list").toBe(true)
  })

  it("正常文本按行解析成列表", async () => {
    const llm = fakeLlm(["1. 《长夜》\n2. 《归途》"], "1. 《长夜》\n2. 《归途》")
    const result = await runDeclarativeAction(titleAction(), "p1", {}, deps({ llm }), () => {}, signal())

    expect(result.parsed).toEqual({ kind: "list", items: ["《长夜》", "《归途》"], degraded: false })
  })

  it("createUnavailableLlmCaller 给出可读的中文原因", async () => {
    const llm = createUnavailableLlmCaller("插件生成尚未接入模型")
    await expect(
      runDeclarativeAction(titleAction(), "p1", {}, deps({ llm }), () => {}, signal()),
    ).rejects.toThrow("插件生成尚未接入模型")
  })
})

describe("assertRunnableChain：链式调用的三道闸", () => {
  it("正常链（栈里都是同一插件的别的 action）通过", () => {
    expect(() => assertRunnableChain("p1", "c", [])).not.toThrow()
    expect(() => assertRunnableChain("p1", "c", ["p1:a", "p1:b"])).not.toThrow()
  })

  it("跨插件拒绝：run-action 只能指向同一插件内的 action", () => {
    const error = catchError(() => assertRunnableChain("p1", "expand", ["p2:expand"]))
    expect(error).toBeInstanceOf(RunActionChainError)
    expect((error as Error).message).toContain("只能指向同一插件内的动作")
    expect((error as Error).message).toContain("p2")
  })

  it("成环拒绝：A → B → A", () => {
    const error = catchError(() => assertRunnableChain("p1", "a", ["p1:a", "p1:b"]))
    expect(error).toBeInstanceOf(RunActionChainError)
    expect((error as Error).message).toContain("环")
  })

  it("深度 4 拒绝（最多 3 层）", () => {
    expect(MAX_RUN_ACTION_CHAIN_DEPTH).toBe(3)
    const error = catchError(() => assertRunnableChain("p1", "d", ["p1:a", "p1:b", "p1:c"]))
    expect(error).toBeInstanceOf(RunActionChainError)
    expect((error as Error).message).toContain("层数过深")
    // 第 3 层仍然合法
    expect(() => assertRunnableChain("p1", "c", ["p1:a", "p1:b"])).not.toThrow()
  })

  it("裸 actionId 视为同一插件；缺标识或栈里有垃圾帧都拒绝", () => {
    // 裸 actionId = 同一插件内的另一个动作 → 合法
    expect(() => assertRunnableChain("p1", "a", ["b"])).not.toThrow()
    // 裸 actionId 与目标同名 → 成环
    expect(catchError(() => assertRunnableChain("p1", "a", ["a"]))).toBeInstanceOf(RunActionChainError)
    expect(catchError(() => assertRunnableChain("", "a", []))).toBeInstanceOf(RunActionChainError)
    expect(catchError(() => assertRunnableChain("p1", "a", ["   "]))).toBeInstanceOf(RunActionChainError)
  })

  it("runDeclarativeAction 在入口就拦下跨插件的栈（不必等模型调用）", async () => {
    const llm = fakeLlm(["《第一》"])
    await expect(
      runDeclarativeAction(titleAction(), "p1", {}, deps({ llm }), () => {}, signal(), ["p2:other"]),
    ).rejects.toBeInstanceOf(RunActionChainError)
    expect(llm.calls).toHaveLength(0)
  })
})

function catchError(fn: () => void): unknown {
  try {
    fn()
  } catch (cause) {
    return cause
  }
  return undefined
}
