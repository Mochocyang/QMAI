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
  MissingProjectPermissionError,
  RunActionAbortedError,
  RunActionPrepareError,
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
      [], // 纯表单模板：不读项目，也就不需要 fs:project-read
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
      [],
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

    await runDeclarativeAction(action, "p1", ["fs:project-read"], {}, deps({ readProject, readChapter, getSelection }), () => {}, signal())

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
      [],
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

    await runDeclarativeAction(action, "p1", [], {}, deps({ llm, getConfig }), () => {}, signal())

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
      ["fs:project-read"],
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
    await runDeclarativeAction(titleAction(), "p1", [], {}, deps({ llm }), (delta) => seen.push(delta), signal())
    expect(seen).toEqual(["一、", "二、", "三、"])
  })

  it("已经中止的信号直接抛可识别的中止错误，不调模型", async () => {
    const llm = fakeLlm(["不该出现"])
    const controller = new AbortController()
    controller.abort()

    await expect(
      runDeclarativeAction(titleAction(), "p1", [], {}, deps({ llm }), () => {}, controller.signal),
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

    const error = await runDeclarativeAction(titleAction(), "p1", [], {}, deps({ llm }), () => {}, controller.signal).catch(
      (cause: unknown) => cause,
    )
    expect(isRunActionAborted(error)).toBe(true)
    expect(error).toBeInstanceOf(RunActionAbortedError)
  })

  it("模型没返回内容时返回 degraded，而不是抛错", async () => {
    const llm = fakeLlm([], "")
    const result = await runDeclarativeAction(titleAction(), "p1", [], {}, deps({ llm }), () => {}, signal())

    expect(result.parsed.kind).toBe("degraded")
    if (result.parsed.kind === "degraded") {
      expect(result.parsed.reason).toBe("模型没有返回内容")
    }
  })

  it("list 模式解析不出条目时仍然返回 degraded 结果", async () => {
    const llm = fakeLlm(["好的，我无法完成。"], "好的，我无法完成。")
    const result = await runDeclarativeAction(titleAction(), "p1", [], {}, deps({ llm }), () => {}, signal())
    // 「好的，我无法完成。」是一行有效文本 —— 但这里验证的是"不抛错、一定有 parsed"
    expect(result.parsed.kind === "degraded" || result.parsed.kind === "list").toBe(true)
  })

  it("正常文本按行解析成列表", async () => {
    const llm = fakeLlm(["1. 《长夜》\n2. 《归途》"], "1. 《长夜》\n2. 《归途》")
    const result = await runDeclarativeAction(titleAction(), "p1", [], {}, deps({ llm }), () => {}, signal())

    expect(result.parsed).toEqual({ kind: "list", items: ["《长夜》", "《归途》"], degraded: false })
  })

  it("createUnavailableLlmCaller 给出可读的中文原因", async () => {
    const llm = createUnavailableLlmCaller("插件生成尚未接入模型")
    await expect(
      runDeclarativeAction(titleAction(), "p1", [], {}, deps({ llm }), () => {}, signal()),
    ).rejects.toThrow("插件生成尚未接入模型")
  })
})

describe("fs:project-read 闸门（设计 §3.3）", () => {
  /** 一个引用了项目上下文的 action（`titleAction` 的表单字段保持可用）。 */
  function projectAction(user: string, system = "策划"): DeclarativeAction {
    return titleAction({ prompt: { system, user } })
  }

  it("有权限：读章节、正文进提示词，正常生成", async () => {
    const llm = fakeLlm(["《长夜》"])
    const readChapter = vi.fn(async () => ({ title: "第一章", text: "列车在雨里停了很久。" }))

    const result = await runDeclarativeAction(
      projectAction("章节正文：{{chapter.text}}"),
      "p1",
      ["fs:project-read"],
      {},
      deps({ llm, readChapter }),
      () => {},
      signal(),
    )

    expect(readChapter).toHaveBeenCalledTimes(1)
    expect(llm.calls[0].user).toContain("列车在雨里停了很久。")
    expect(result.missing).toEqual([])
  })

  it("没权限 + {{chapter.text}}：拒绝执行，且一次模型请求都没发、正文没被读", async () => {
    const llm = fakeLlm(["不该出现"])
    const readChapter = vi.fn(async () => ({ title: "第一章", text: "列车在雨里停了很久。" }))

    const error = await runDeclarativeAction(
      projectAction("章节正文：{{chapter.text}}"),
      "p1",
      [],
      {},
      deps({ llm, readChapter }),
      () => {},
      signal(),
    ).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(MissingProjectPermissionError)
    expect((error as Error).message).toContain("需要读取你的项目内容")
    expect((error as Error).message).toContain("fs:project-read")
    // 关键：闸门在 llm.call 之前 —— 省下一次真实计费请求，正文也不会出本机
    expect(llm.calls).toHaveLength(0)
    // 连"读"都不该发生：拒绝之后才读上下文，等于已经泄露给插件
    expect(readChapter).not.toHaveBeenCalled()
  })

  it("没权限 + {{project.bookTitle}}：同样拒绝", async () => {
    const llm = fakeLlm(["不该出现"])

    await expect(
      runDeclarativeAction(
        projectAction("书名：{{project.bookTitle}}"),
        "p1",
        [],
        {},
        deps({ llm }),
        () => {},
        signal(),
      ),
    ).rejects.toBeInstanceOf(MissingProjectPermissionError)
    expect(llm.calls).toHaveLength(0)
  })

  it("system 提示词里的项目变量也计入（不能只查 user）", async () => {
    const llm = fakeLlm(["不该出现"])

    await expect(
      runDeclarativeAction(
        projectAction("题材：{{genre}}", "你在为《{{project.bookTitle}}》策划"),
        "p1",
        [],
        {},
        deps({ llm }),
        () => {},
        signal(),
      ),
    ).rejects.toBeInstanceOf(MissingProjectPermissionError)
    expect(llm.calls).toHaveLength(0)
  })

  it("{{selection}} 也计入项目上下文：没权限一样拒绝", async () => {
    const llm = fakeLlm(["不该出现"])
    const getSelection = vi.fn(() => "选中的句子")

    await expect(
      runDeclarativeAction(
        projectAction("请改写：{{selection}}"),
        "p1",
        [],
        {},
        deps({ llm, getSelection }),
        () => {},
        signal(),
      ),
    ).rejects.toBeInstanceOf(MissingProjectPermissionError)
    expect(llm.calls).toHaveLength(0)
    expect(getSelection).not.toHaveBeenCalled()
  })

  it("纯表单模板 + 没权限：照常执行（不能误伤）", async () => {
    const llm = fakeLlm(["《长夜》"])
    const readProject = vi.fn(async () => ({ bookTitle: "长夜" }))

    const result = await runDeclarativeAction(
      projectAction("题材：{{genre}}"),
      "p1",
      [],
      { genre: "悬疑" },
      deps({ llm, readProject }),
      () => {},
      signal(),
    )

    expect(llm.calls).toHaveLength(1)
    expect(readProject).not.toHaveBeenCalled()
    expect(result.parsed).toEqual({ kind: "list", items: ["《长夜》"], degraded: false })
  })

  it("只认精确的权限名：其它权限不能顺带放行", async () => {
    await expect(
      runDeclarativeAction(projectAction("{{chapter.text}}"), "p1", ["net:https"], {}, deps({}), () => {}, signal()),
    ).rejects.toBeInstanceOf(MissingProjectPermissionError)
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
      runDeclarativeAction(titleAction(), "p1", [], {}, deps({ llm }), () => {}, signal(), ["p2:other"]),
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

describe("action 的准备步骤（prepare）", () => {
  /*
   * 这一组守的是「书名生成」卡了两次的那个体验问题：
   * 素材不在宿主上下文里，只能靠 prepare 现调插件工具取回来。
   * 如果这里坏了，用户看到的是一个空的大文本框 —— 功能在、但没法用。
   */

  function baseDeps(overrides: Partial<RunActionDeps> = {}): RunActionDeps {
    return {
      llm: fakeLlm(["《", "某书", "》"]),
      getConfig: async () => ({}),
      ...overrides,
    } as RunActionDeps
  }

  it("先跑工具，再把结果填进 {{material}} 交给模型", async () => {
    const invokeTool = vi.fn(async () => JSON.stringify({ status: "ok", material: "书架素材：挖矿成神" }))
    const deps = baseDeps({ invokeTool })

    const action = titleAction({
      prompt: { system: "起名", user: "素材：{{material}}" },
      prepare: [{ var: "material", tool: "collect_writing_material", args: { n: 1 } }],
    })

    const result = await runDeclarativeAction(
      action,
      "title-forge",
      [],
      {},
      deps,
      () => {},
      new AbortController().signal,
    )

    // 工具被调用一次，参数原样传下去
    expect(invokeTool).toHaveBeenCalledTimes(1)
    expect(invokeTool).toHaveBeenCalledWith("collect_writing_material", { n: 1 })
    // 取回的素材真的进了提示词（不是被丢掉）
    const llm = (deps.llm as unknown as { calls: Array<{ user: string }> }).calls
    expect(llm.at(-1)?.user).toContain("书架素材：挖矿成神")
    // 结果在 `parsed` 里（这个引擎不返回裸 text）
    expect(JSON.stringify(result.parsed)).toContain("某书")
  })

  it("工具返回纯文本（不是 JSON）时也照样用", async () => {
    const deps = baseDeps({ invokeTool: async () => "一段纯文本素材" })
    const action = titleAction({
      prompt: { system: "起名", user: "素材：{{material}}" },
      prepare: [{ var: "material", tool: "any_tool" }],
    })

    await runDeclarativeAction(action, "p", [], {}, deps, () => {}, new AbortController().signal)

    const llm = (deps.llm as unknown as { calls: Array<{ user: string }> }).calls
    expect(llm.at(-1)?.user).toContain("一段纯文本素材")
  })

  it("取素材失败时**中止**，不拿空素材去骗模型", async () => {
    const deps = baseDeps({
      invokeTool: async () => {
        throw new Error("书架是空的")
      },
    })
    const action = titleAction({
      prompt: { system: "起名", user: "素材：{{material}}" },
      prepare: [{ var: "material", tool: "collect_writing_material" }],
    })

    // 与"读项目失败静默降级"刻意相反：没有素材就生成，只会得到一批编造的书名
    await expect(
      runDeclarativeAction(action, "p", [], {}, deps, () => {}, new AbortController().signal),
    ).rejects.toBeInstanceOf(RunActionPrepareError)

    // 模型一次都不该被调用
    const llm = (deps.llm as unknown as { calls: unknown[] }).calls
    expect(llm.length).toBe(0)
  })

  it("没有 prepare 时不调用任何工具（不额外打扰插件）", async () => {
    const invokeTool = vi.fn(async () => "不该被调用")
    const deps = baseDeps({ invokeTool })

    await runDeclarativeAction(
      titleAction(),
      "p",
      [],
      { genre: "玄幻", idea: "挖矿", count: "3" },
      deps,
      () => {},
      new AbortController().signal,
    )

    expect(invokeTool).not.toHaveBeenCalled()
  })

  it("用户手填的值优先于工具输出（改过的不被覆盖）", async () => {
    const deps = baseDeps({ invokeTool: async () => "工具素材" })
    const action = titleAction({
      prompt: { system: "起名", user: "素材：{{material}}" },
      prepare: [{ var: "material", tool: "t" }],
    })

    await runDeclarativeAction(
      action,
      "p",
      [],
      { material: "我自己写的素材" },
      deps,
      () => {},
      new AbortController().signal,
    )

    const llm = (deps.llm as unknown as { calls: Array<{ user: string }> }).calls
    expect(llm.at(-1)?.user).toContain("我自己写的素材")
    expect(llm.at(-1)?.user).not.toContain("工具素材")
  })
})

describe("action 指定模型（model.target）", () => {
  /*
   * 这条链路解决的是「同一个插件，用户切了模型，产出就变了」的问题：
   * 作者想固定用某个模型（起名要风格一致），而不是碰运气跟当前模型走。
   */
  function captureLlm(): LlmCaller & { calls: Array<{ system: string; user: string; modelOverride?: string }> } {
    const calls: Array<{ system: string; user: string; modelOverride?: string }> = []
    return {
      calls,
      async call(input) {
        calls.push(input as { system: string; user: string; modelOverride?: string })
        return { text: "ok" }
      },
    } as never
  }

  const baseDeps = (llm: LlmCaller) =>
    ({ llm, getConfig: async () => ({}) }) as RunActionDeps

  it("声明了 model.target 时，把它传给 llm 调用", async () => {
    const llm = captureLlm()
    const action = titleAction({
      model: { target: "custom-abc/gemini-3.8-flash" },
    })

    await runDeclarativeAction(
      action,
      "p",
      [],
      { genre: "玄幻", idea: "挖矿", count: "3" },
      baseDeps(llm),
      () => {},
      new AbortController().signal,
    )

    expect(llm.calls.at(-1)?.modelOverride).toBe("custom-abc/gemini-3.8-flash")
  })

  it("没声明 model.target 时不传（保持用当前模型）", async () => {
    const llm = captureLlm()
    await runDeclarativeAction(
      titleAction(),
      "p",
      [],
      { genre: "玄幻", idea: "挖矿", count: "3" },
      baseDeps(llm),
      () => {},
      new AbortController().signal,
    )

    expect(llm.calls.at(-1)?.modelOverride).toBeUndefined()
  })

  it("model.target 为空串时也不传（等价于用当前模型）", async () => {
    const llm = captureLlm()
    await runDeclarativeAction(
      titleAction({ model: { target: "   " } }),
      "p",
      [],
      { genre: "玄幻", idea: "挖矿", count: "3" },
      baseDeps(llm),
      () => {},
      new AbortController().signal,
    )

    expect(llm.calls.at(-1)?.modelOverride).toBeUndefined()
  })
})
