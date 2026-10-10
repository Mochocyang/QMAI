import { describe, expect, it, vi } from "vitest"
import type { StreamCallbacks } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import { SourceCanonOverflowError } from "@/lib/novel/context-engine"
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
})
