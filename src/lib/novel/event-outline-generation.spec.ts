import { describe, expect, it, vi } from "vitest"
import type { StreamCallbacks } from "@/lib/llm-client"
import { USER_ABORT_MESSAGE } from "@/lib/user-abort"
import type { LlmConfig } from "@/stores/wiki-store"
import { SourceCanonOverflowError } from "@/lib/novel/context-engine"
import { PersonalityConstraintError } from "@/lib/novel/portable-personality"
import type { EventOutlineRequest } from "@/lib/novel/event-outline"
import {
  EVENT_OUTLINE_CHAPTER_SYSTEM_PROMPT,
  buildEventOutlineMessages,
  generateEventOutline,
  type EventOutlineGenerationDeps,
} from "@/lib/novel/event-outline-generation"

const llmConfig = { provider: "openai", model: "gpt-test", maxContextSize: 204800 } as unknown as LlmConfig

function request(overrides: Partial<EventOutlineRequest> = {}): EventOutlineRequest {
  return { chapterNumber: 7, eventCount: 4, targetWords: 3000, requirement: "", ...overrides }
}

/** 一份能被 extractEventOutlineData 解析的最小模型回复。 */
const VALID_REPLY = [
  "# 事件细纲 · 第7章 雨夜递刀",
  "",
  "## 事件1 楚白在巷口截住骆轻竹",
  "- 关键台词：…",
  "",
  "```json",
  JSON.stringify({
    eventOutlineData: {
      version: 1,
      chapterNumber: 7,
      title: "第7章 · 雨夜递刀",
      targetWords: 3000,
      events: [
        { id: 1, title: "楚白在巷口截住骆轻竹", points: ["关键台词：别回头", "神情动作：手按刀柄"] },
        { id: 2, title: "两人对上暗号", points: ["关键台词：三更", "环境物件：灯笼"] },
        { id: 3, title: "追兵赶到", points: ["关键动作：翻墙", "环境物件：雨"] },
        { id: 4, title: "骆轻竹留下断后", points: ["关键台词：走", "推进：钩子"] },
      ],
      endingHook: "刀落下的声音从身后传来。",
    },
  }),
  "```",
].join("\n")

type StreamChatLike = EventOutlineGenerationDeps["streamChat"]

/**
 * 造一个假的 streamChat。
 *
 * 用真 StreamCallbacks 类型而不是手写 any：本模块的分支几乎全在
 * 「回调被怎么调用」上（onDone / onError / 一个都不调），
 * 参数写错类型就测不到想测的那条分支了。
 */
function fakeStreamChat(script: (callbacks: StreamCallbacks) => void): StreamChatLike {
  const impl = async (
    _config: Parameters<StreamChatLike>[0],
    _messages: Parameters<StreamChatLike>[1],
    callbacks: StreamCallbacks,
  ) => { script(callbacks) }
  return impl as unknown as StreamChatLike
}

function deps(overrides: Partial<EventOutlineGenerationDeps> = {}): EventOutlineGenerationDeps {
  return {
    streamChat: fakeStreamChat((callbacks) => {
      callbacks.onToken(VALID_REPLY)
      callbacks.onDone()
    }),
    buildContextPack: (async () => ({ sourceCanon: "" })) as unknown as EventOutlineGenerationDeps["buildContextPack"],
    contextPackToPrompt: (() => "（前文资料）") as unknown as EventOutlineGenerationDeps["contextPackToPrompt"],
    ...overrides,
  }
}

describe("buildEventOutlineMessages", () => {
  it("资料在要求之前，并要求模型不要调工具", () => {
    const messages = buildEventOutlineMessages("（前文资料）", request({ requirement: "让楚白动用令牌" }))
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: "system" })
    expect(messages[0].content).toBe(EVENT_OUTLINE_CHAPTER_SYSTEM_PROMPT)
    const user = messages[1].content as string
    // 资料在前、生成要求在后的顺序是有意的，这里钉住它
    expect(user.indexOf("（前文资料）")).toBeGreaterThanOrEqual(0)
    expect(user.indexOf("（前文资料）")).toBeLessThan(user.indexOf("请为第 7 章生成"))
    expect(user).toContain("让楚白动用令牌")
  })

  it("没有资料时不留下空的一节，也不留分隔线", () => {
    const messages = buildEventOutlineMessages("   ", request())
    const user = messages[1].content as string
    expect(user).not.toContain("以下是本章相关的既有资料")
    expect(user.startsWith("请为第 7 章生成")).toBe(true)
  })
})

describe("generateEventOutline", () => {
  it("正常路径：把模型回复解析成事件细纲", async () => {
    const result = await generateEventOutline("/p", request(), llmConfig, {}, undefined, deps())
    expect(result.error).toBeNull()
    expect(result.outline?.chapterNumber).toBe(7)
    expect(result.outline?.events).toHaveLength(4)
    expect(result.outline?.title).toBe("第7章 · 雨夜递刀")
  })

  it("把向导里填的要求补进解析结果，不指望模型回抄", async () => {
    // 模型回复里**没有**要求（VALID_REPLY 的 JSON 不含 requirement 字段）
    const result = await generateEventOutline(
      "/p",
      request({ requirement: "必须交代骆轻竹为什么失望" }),
      llmConfig,
      {},
      undefined,
      deps(),
    )
    expect(result.outline?.requirement).toBe("必须交代骆轻竹为什么失望")
  })

  it("流式进度回调带上累计字数", async () => {
    const onToken = vi.fn()
    await generateEventOutline("/p", request(), llmConfig, { onToken }, undefined, deps())
    expect(onToken).toHaveBeenCalledTimes(1)
    expect(onToken.mock.calls[0][1]).toBe(VALID_REPLY.length)
  })

  it("模型回复里没有可解析的 JSON 时给出可操作的中文错误，并保留原文", async () => {
    const result = await generateEventOutline("/p", request(), llmConfig, {}, undefined, deps({
      streamChat: fakeStreamChat((callbacks) => {
        callbacks.onToken("抱歉，我不明白你的意思。")
        callbacks.onDone()
      }),
    }))
    expect(result.outline).toBeNull()
    expect(result.error).toContain("没有找到可解析的事件细纲 JSON")
    expect(result.rawContent).toBe("抱歉，我不明白你的意思。")
  })

  it("模型一个字都没返回时错误文案不同（区分「模型坏了」与「格式不对」）", async () => {
    const result = await generateEventOutline("/p", request(), llmConfig, {}, undefined, deps({
      streamChat: fakeStreamChat((callbacks) => {
        callbacks.onDone()
      }),
    }))
    expect(result.outline).toBeNull()
    expect(result.error).toContain("没有返回任何内容")
  })

  it("流式报错时把模型的错误信息交出来", async () => {
    const result = await generateEventOutline("/p", request(), llmConfig, {}, undefined, deps({
      streamChat: fakeStreamChat((callbacks) => {
        callbacks.onError(new Error("网络连接中断"))
      }),
    }))
    expect(result.outline).toBeNull()
    expect(result.error).toBe("网络连接中断")
  })

  /*
   * 下面这条是本模块**唯一**一个"该停机而不是降级"的分支。
   *
   * 正典溢出被吞掉的后果特别隐蔽：细纲照常产出，但 materials 是空字符串，
   * 而用户以为原作正典被遵守了。所以这里用**反向控制**钉住它：
   * 同一个 catch 里，普通错误必须降级（上一条），正典溢出必须上抛（这一条）。
   */
  it("正典溢出必须上抛，不能降级成零资料生成", async () => {
    const buildContextPack = (async () => ({ sourceCanon: "原作：斗气分九段" })) as unknown as EventOutlineGenerationDeps["buildContextPack"]
    const streamChat = vi.fn()
    const contextPackToPrompt = (() => {
      throw new SourceCanonOverflowError()
    }) as unknown as EventOutlineGenerationDeps["contextPackToPrompt"]

    await expect(generateEventOutline("/p", request(), llmConfig, {}, undefined, {
      streamChat: streamChat as unknown as EventOutlineGenerationDeps["streamChat"],
      buildContextPack,
      contextPackToPrompt,
    })).rejects.toBeInstanceOf(SourceCanonOverflowError)
    // 而且根本没有发起生成 —— 不是"先生成再报错"
    expect(streamChat).not.toHaveBeenCalled()
  })

  it("给 buildContextPack 的是短检索查询，不是整份提示词", async () => {
    /*
     * task 有**两个**身份：contextPackToPrompt 会把它渲染成「当前任务」写进资料区
     * （context-engine.ts:1176-1177），它同时又是检索查询（:864 tokenizeQuery）。
     * 而完整提示词已经由 buildEventOutlineMessages 追加进 user 消息了，
     * 所以传整份提示词会重复注入 + 用 JSON 骨架污染检索。
     */
    const buildContextPack = vi.fn(async () => ({ sourceCanon: "" })) as unknown as EventOutlineGenerationDeps["buildContextPack"]
    await generateEventOutline(
      "/p",
      request({ requirement: "让楚白动用令牌" }),
      llmConfig,
      {},
      undefined,
      deps({ buildContextPack }),
    )

    const query = (buildContextPack as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as string
    // 只带真正有检索价值的词
    expect(query).toContain("第7章")
    expect(query).toContain("事件细纲")
    expect(query).toContain("4 个事件")
    expect(query).toContain("让楚白动用令牌")
    // 绝不能把提示词的骨架一起带进去
    expect(query).not.toContain("## 输出格式")
    expect(query).not.toContain("## 硬要求")
    expect(query).not.toContain("eventOutlineData")
    expect(query).not.toContain("```")
  })

  it("给 buildContextPack 的 chapterNumber 仍然是目标章号", async () => {
    const buildContextPack = vi.fn(async () => ({ sourceCanon: "" })) as unknown as EventOutlineGenerationDeps["buildContextPack"]
    await generateEventOutline("/p", request({ chapterNumber: 12 }), llmConfig, {}, undefined, deps({ buildContextPack }))
    const call = (buildContextPack as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(call[2]).toBe(12)
  })

  it("资料装配的普通失败则降级继续，不让用户什么都拿不到", async () => {
    const contextPackToPrompt = (() => {
      throw new Error("检索索引损坏")
    }) as unknown as EventOutlineGenerationDeps["contextPackToPrompt"]
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const result = await generateEventOutline("/p", request(), llmConfig, {}, undefined, deps({
      contextPackToPrompt,
    }))
    expect(result.error).toBeNull()
    expect(result.outline?.events).toHaveLength(4)
  })

  /*
   * ── 人格规则 = 必保项，与正典同级 fail-closed ──
   *
   * 两个来源：buildContextPack 侧抛 PersonalityConstraintError（人格绑定**损坏**），
   * contextPackToPrompt 侧抛普通 Error（预算装不下人格规则）。
   * 两者若被降级吞掉，用户会拿到一份零上下文的细纲，而没有任何地方告诉他要修绑定。
   * 既有先例：deep-chapter-generation.ts:2640 对前者就是 `throw error`。
   */
  it("人格绑定损坏（buildContextPack 抛 PersonalityConstraintError）原样抛出", async () => {
    const streamChat = vi.fn() as unknown as EventOutlineGenerationDeps["streamChat"]
    const promise = generateEventOutline("/p", request(), llmConfig, {}, undefined, deps({
      buildContextPack: (async () => {
        throw new PersonalityConstraintError("「楚白」绑定的人格规则损坏，请重新生成或修复后再写作")
      }) as unknown as EventOutlineGenerationDeps["buildContextPack"],
      streamChat,
    }))
    await expect(promise).rejects.toBeInstanceOf(PersonalityConstraintError)
    // 与正典溢出同一条纪律：停机，不是「先出一份零资料的再报错」
    expect(streamChat).not.toHaveBeenCalled()
  })

  it("预算装不下人格规则（contextPackToPrompt 抛普通 Error）也原样抛出", async () => {
    const streamChat = vi.fn() as unknown as EventOutlineGenerationDeps["streamChat"]
    const promise = generateEventOutline("/p", request(), llmConfig, {}, undefined, deps({
      contextPackToPrompt: (() => {
        // 与 context-engine.ts:1130 的文案一致
        throw new Error("上下文预算不足，角色人格规则未完整保留。请缩小本次章节范围或选择更大上下文模型，已停止生成。")
      }) as unknown as EventOutlineGenerationDeps["contextPackToPrompt"],
      streamChat,
    }))
    await expect(promise).rejects.toThrow("角色人格规则未完整保留")
    expect(streamChat).not.toHaveBeenCalled()
  })

  it("文风画像那条溢出仍然降级（它与人格规则不同级）", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = await generateEventOutline("/p", request(), llmConfig, {}, undefined, deps({
      contextPackToPrompt: (() => {
        throw new Error("上下文预算不足，已启用的文风画像未完整保留。请减少本次参考内容或选择更大上下文模型，已停止生成。")
      }) as unknown as EventOutlineGenerationDeps["contextPackToPrompt"],
    }))
    // 丢掉文风提示不影响细纲作为「事件列表」的可用性
    expect(result.error).toBeNull()
    expect(result.outline?.events).toHaveLength(4)
  })

  /*
   * 上面那条人格判定靠**消息文本**匹配（context-engine.ts 是守门文件，
   * 不能在里面新增专用错误类）。字面量一旦被改写，判定就会静默失效 ——
   * 这条源码扫描测试就是防它腐烂的：改文案必须同步改判定。
   */
  it("context-engine.ts 里仍保留着被匹配的那句人格提示（消息匹配不能腐烂）", async () => {
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    // fileURLToPath 而不是手写 pathname 处理：Windows 上盘符与中文路径都会被它正确处理
    const sourcePath = fileURLToPath(new URL("./context-engine.ts", import.meta.url))
    const source = await readFile(sourcePath, "utf8")
    /*
     * 断言**完整字面量**而不只是子串：子串断言无法区分「这句还在被 throw」
     * 与「这句只留在注释里」。整句一起对，改文案时（无论改哪半句）都会红。
     * 注意它必须与 context-engine.ts 里抛出的那句逐字一致。
     */
    expect(source).toContain(
      "上下文预算不足，角色人格规则未完整保留。请缩小本次章节范围或选择更大上下文模型，已停止生成。",
    )
    // 反向控制：确认扫的确实是那份文件（否则路径写错也会「通过」）
    expect(source).toContain("assertSourceCanonPreserved")
  })

  it("用户取消时原样抛出，不会被当成「生成成功但解析失败」", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" })
    const promise = generateEventOutline("/p", request(), llmConfig, {}, undefined, deps({
      streamChat: (async () => {
        throw abortError
      }) as unknown as EventOutlineGenerationDeps["streamChat"],
    }))
    // 必须 reject：若被吞掉就会 resolve 成 { outline: null, error: "…" }，
    // 卡片上出现一条用户看不懂的红色报错（他明明是自己按的取消）。
    await expect(promise).rejects.toBe(abortError)
  })

  it("取消以 Tauri 的资源失效字符串形态归来时也抛出，不会退化成「解析失败」", async () => {
    /*
     * 这条钉的是 catch 里那句 `if (isUserAbortError(error)) throw error` 的
     * **独有职责**（不是与下面 `if (isUserAbortError(failure)) throw failure`
     * 重复的死重）：plugin-http 在 abort 时的 rejection 是**字符串或对象**，
     * 不是 Error（见 tauri-resource-error.ts 的注释）。
     *
     * 区别就在这里：`isUserAbortError` 认这种形态（它调
     * isTauriInvalidResourceIdError），而下面的兜底会把非 Error 包成
     * `new Error(String(error))` —— 包完就再也认不出来了，
     * 于是用户自己按的取消变成一条红色「模型回复里没有找到可解析的事件细纲 JSON」。
     * 删掉那句 throw，这条用例即变红。
     */
    const abortLike = "The resource id 7 is invalid"
    const promise = generateEventOutline("/p", request(), llmConfig, {}, undefined, deps({
      streamChat: (async () => {
        throw abortLike
      }) as unknown as EventOutlineGenerationDeps["streamChat"],
    }))
    await expect(promise).rejects.toBe(abortLike)
  })

  /*
   * 这条钉的是最容易漏掉的取消路径：**流式阶段的取消**。
   *
   * streamChat 在用户取消时并不 reject —— 它调用 onDone() 后正常返回
   * （llm-client.ts 请求阶段与读取流阶段各一处）。所以下面的假 streamChat
   * 故意「先取消、再照常 onToken + onDone」，完全照抄真实行为。
   * 若模块不在 await 之后自查信号，它就会拿着一份半截内容去解析，
   * 最终 resolve 成 { outline: null, error: "…没有找到可解析的事件细纲 JSON…" }——
   * 用户自己按的取消，却收到一条「模型格式不对」的报错。
   */
  /*
   * 取消发生在 buildContextPack 期间（那一步不吃 signal）时，signal 进入流式阶段
   * 就已经是 aborted 状态。此时**不能**真的发起请求：
   *
   * llm-client.ts:449 是在 signal 上 addEventListener("abort", …)，而按 DOM 规范，
   * 对已经 aborted 的 signal 注册监听器永远不会被触发 —— combinedSignal 不会 abort，
   * fetch 会照常发出去。也就是用户为一次已被取消的生成付费，结果还会被丢掉。
   * 所以模块必须在 await 之前自查一次信号。下面这条断言的就是「请求压根没发」。
   */
  it("buildContextPack 期间被取消：不再发起 streamChat（不为取消的生成付费）", async () => {
    const controller = new AbortController()
    const streamChat = vi.fn() as unknown as EventOutlineGenerationDeps["streamChat"]
    const promise = generateEventOutline("/p", request(), llmConfig, {}, controller.signal, deps({
      // 装配阶段就取消
      buildContextPack: (async () => {
        controller.abort()
        return { sourceCanon: "" }
      }) as unknown as EventOutlineGenerationDeps["buildContextPack"],
      streamChat,
    }))

    await expect(promise).rejects.toThrow(USER_ABORT_MESSAGE)
    // 这条是重点：不是「发了请求再丢掉」，而是根本没发
    expect(streamChat).not.toHaveBeenCalled()
  })

  it("传进来的 signal 已经 aborted：压根不发起 streamChat", async () => {
    /*
     * 设计 §4.1（D1/D2）要求的就是这一条的**字面形态**：进来时 signal 已是
     * aborted。它与下面那条「在 buildContextPack 内部 abort」覆盖等价
     * （删掉模块里那次 throwIfAborted 两条都会红），但字面形态更贴近
     * llm-client.ts 的 addEventListener 语义：对已经 aborted 的 signal
     * 注册监听器永远不会触发，所以请求会真的发出去。
     */
    const controller = new AbortController()
    controller.abort()
    const streamChat = vi.fn() as unknown as EventOutlineGenerationDeps["streamChat"]
    const promise = generateEventOutline("/p", request(), llmConfig, {}, controller.signal, deps({
      streamChat,
    }))

    await expect(promise).rejects.toThrow(USER_ABORT_MESSAGE)
    expect(streamChat).not.toHaveBeenCalled()
  })

  it("流式阶段取消（streamChat 照常 onDone 返回）也抛出 USER_ABORT_MESSAGE", async () => {
    const controller = new AbortController()
    const promise = generateEventOutline("/p", request(), llmConfig, {}, controller.signal, deps({
      streamChat: fakeStreamChat((callbacks) => {
        // 模拟「用户取消 → streamChat 照常 onDone 返回」
        controller.abort()
        callbacks.onToken(VALID_REPLY.slice(0, 30))
        callbacks.onDone()
      }),
    }))
    // 关键：不是 resolve 成一条「解析失败」，而是抛出取消
    await expect(promise).rejects.toThrow(USER_ABORT_MESSAGE)
  })
})
