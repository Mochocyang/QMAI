/**
 * 工作流钩子（`beforeChapterDraft` / `afterChapterDraft` / `beforeReview` /
 * `afterReview` / `beforePolish` / `afterPolish` / `onChapterCompleted`）的接线测试。
 *
 * 与 `deep-chapter-generation.spec.ts` 同一风格：整条管线用注入的 deps 驱动，
 * 不碰真模型。这里只验证"钩子接缝"这一层的四条纪律：
 *   - 无钩子 → 零开销直通（结果与改动前一致）；
 *   - 有改写 → 改写真的进了下游阶段；
 *   - gate 阻断 → 抛可读错误；
 *   - 钩子出错 → fail-open，用户照样拿到正文。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage, StreamCallbacks } from "@/lib/llm-client"
import {
  __resetPluginHooksForTests,
  __setPluginHooksForTests,
  createHookDeps,
  setHookDepsFactory,
} from "@/lib/plugins/hooks/runtime"
import type { PluginHookView } from "@/lib/plugins/hooks/types"
import type { ContextPack } from "./context-engine"
import type { NovelReviewResult } from "./review-adapter"
import { runDeepChapterGeneration, type DeepChapterGenerationDeps } from "./deep-chapter-generation"

const llmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 120000,
} satisfies LlmConfig

const contextPack: ContextPack = {
  task: "生成第3章",
  chapterGoal: "第3章目标：主角进入雨夜旧屋，发现第一条线索。",
  outline: "第3章：雨夜旧屋，发现线索，结尾留下危险钩子。",
  recentSummaries: ["第1章：主角收到匿名信。"],
  previousChapterEnding: "门缝里传来金属拖拽声。",
  characterStates: "主角谨慎，但急于确认真相。",
  soulDoc: "",
  characterAuras: "",
  storyFrameworkBinding: "",
  cognitionStates: "主角不知道旧屋主人真实身份。",
  foreshadowingStates: "匿名信、锈钥匙尚未回收。",
  timeline: "雨夜，当晚十点。",
  relatedSettings: "旧屋位于停电后的城区边缘。",
  canonRules: "主角不能凭空知道旧屋主人身份。",
  writingStyle: "悬疑、克制、画面感强。",
  searchResults: "旧屋相关记忆片段。",
  graphSearchResults: "匿名信 -> 旧屋 -> 锈钥匙。",
  mustDo: "承接上一章门缝声，推进锈钥匙线索。",
  mustAvoid: "不要提前揭露旧屋主人身份。",
  nextChapterAdvice: "结尾引出屋内第二个人影。",
  revisionDirectives: "",
}

const leftoverWarning: NovelReviewResult = {
  severity: "warning",
  type: "plot",
  message: "结尾钩子偏弱",
  evidence: "正文",
  relatedMemory: "",
  suggestion: "补强钩子",
}

function taskBriefText(): string {
  return [
    "写作任务书",
    "本章目标：承接上一章门缝声并推进旧屋线索，让主角在雨夜里完成一次有代价的搜查。",
    "S1门口试探：确认金属拖拽声来源，主角先观察再行动，避免正面冲突。",
    "S2进屋搜查：发现浸软旧信与第二把钥匙，线索之间要形成互相印证。",
    "必须执行：主角进入旧屋，推进锈钥匙线索，并让旧信与匿名信呼应。",
    "禁止违背：不得提前揭露旧屋主人身份，不得让主角凭空获得关键信息。",
    "章末钩子：门外出现第二个人影，气氛必须收在悬念上而不是解释上。",
  ].join("")
}

function chapterBody(prefix: string, count = 3000): string {
  const scenes = [
    "雨水沿着瓦檐落下，旧屋里的灯影忽明忽暗，主角先确认门缝后的动静。",
    "他没有急着开口，而是把锈钥匙压在掌心，听见墙后传来短促的摩擦声。",
    "小晴醒来时仍有些发冷，她的回答补上了上一章留下的疑点，却也带出新的矛盾。",
    "两人沿着走廊往里走，地板下的空响让他们意识到这间屋子被人提前动过手脚。",
  ]
  let text = prefix
  let index = 0
  while (text.length < count) {
    text += `${scenes[index % scenes.length]}第${index + 1}个细节把人物选择继续往前推。`
    index += 1
  }
  return text.slice(0, count)
}

/** 拍平成 prompt 文本（跳过 system：仓库里那份 system 常量含阶段词，会误判阶段）。 */
function messagesPromptText(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
    )
    .join("\n")
}

function createDeps(reviewResults: NovelReviewResult[] = []): DeepChapterGenerationDeps {
  return {
    buildContextPack: vi.fn(async () => contextPack),
    contextPackToPrompt: vi.fn(() => "上下文包内容"),
    reviewChapter: vi.fn(async () => reviewResults),
    streamChat: vi.fn(async (_config: LlmConfig, messages: ChatMessage[], callbacks: StreamCallbacks) => {
      const prompt = messagesPromptText(messages)
      const content = prompt.includes("只输出任务书")
        ? taskBriefText()
        : prompt.includes("简单审查") || prompt.includes("局部修改")
          ? chapterBody("局部修改后正文")
          : chapterBody("初稿正文内容")
      callbacks.onToken(content)
      callbacks.onDone()
    }),
  }
}

function hook(
  event: PluginHookView["hook"]["on"],
  overrides: Partial<PluginHookView["hook"]> = {},
): PluginHookView {
  return {
    pluginId: "p1",
    pluginName: "测试插件",
    hook: { on: event, impl: "process", tool: "t", ...overrides },
  }
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  __resetPluginHooksForTests()
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  __resetPluginHooksForTests()
  warn.mockRestore()
})

describe("无钩子：零开销直通", () => {
  it("快速模式的结果与改动前一致，且没有任何钩子告警", async () => {
    const deps = createDeps()
    const onFinalContent = vi.fn()

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "写第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "fast" },
      { onFinalContent },
      deps,
    )

    expect(result.finalContent).toBe(chapterBody("初稿正文内容"))
    expect(result.draftContent).toBe(chapterBody("初稿正文内容"))
    // 任务书 + 初稿，两次模型调用，一次都不多
    expect(deps.streamChat).toHaveBeenCalledTimes(2)
    expect(warn).not.toHaveBeenCalled()
    expect(onFinalContent).toHaveBeenCalledWith(chapterBody("初稿正文内容"))
  })
})

describe("草稿接缝", () => {
  it("afterChapterDraft 改写草稿 → 最终正文就是改写后的（下游都看到新正文）", async () => {
    const deps = createDeps()
    __setPluginHooksForTests([hook("afterChapterDraft")])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async () => ({ patch: { response: { text: "插件改写后的草稿正文" } } }),
    }))

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "写第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "fast" },
      {},
      deps,
    )

    expect(result.draftContent).toBe("插件改写后的草稿正文")
    expect(result.finalContent).toBe("插件改写后的草稿正文")
  })

  it("beforeChapterDraft 返回正文 → 作为初稿使用并跳过生成", async () => {
    const deps = createDeps()
    const provided = chapterBody("钩子提供的初稿")
    __setPluginHooksForTests([hook("beforeChapterDraft")])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async () => ({ patch: { response: { text: provided } } }),
    }))

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "写第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "fast" },
      {},
      deps,
    )

    expect(result.draftContent).toBe(provided)
    // 只剩任务书那一次模型调用：草稿阶段被钩子接管了
    expect(deps.streamChat).toHaveBeenCalledTimes(1)
  })

  it("gate 钩子阻断 → 抛可读错误（不是静默跳过）", async () => {
    const deps = createDeps()
    __setPluginHooksForTests([hook("afterChapterDraft", { gate: true })])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async () => ({ block: { reason: "本章包含敏感内容" } }),
    }))

    await expect(runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "写第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "fast" },
      {},
      deps,
    )).rejects.toThrow("本章包含敏感内容")
  })

  it("钩子抛错 → fail-open，用户照样拿到正文", async () => {
    const deps = createDeps()
    __setPluginHooksForTests([hook("afterChapterDraft")])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async () => {
        throw new Error("插件内部出错")
      },
    }))

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "写第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "fast" },
      {},
      deps,
    )

    expect(result.finalContent).toBe(chapterBody("初稿正文内容"))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("未生效"))
  })
})

describe("审稿与润色接缝（严格模式）", () => {
  it("beforeReview / afterReview / beforePolish / afterPolish 依次生效", async () => {
    const deps = createDeps([leftoverWarning])
    const events: string[] = []
    __setPluginHooksForTests([
      hook("beforeReview"),
      hook("afterReview"),
      hook("beforePolish"),
      hook("afterPolish"),
    ])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async (_entry, context) => {
        events.push(context.event)
        return { patch: { response: { text: `${context.event}改写` } } }
      },
    }))

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "写第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "strict" },
      {},
      deps,
    )

    expect(events).toEqual(["beforeReview", "afterReview", "beforePolish", "afterPolish"])
    // 每个接缝的改写都会传给下一个阶段，最终正文 = 最后一次改写
    expect(result.finalContent).toBe("afterPolish改写")
  })
})

describe("onChapterCompleted（观测）", () => {
  it("章节完成时通知一次，且不阻塞交付", async () => {
    const deps = createDeps()
    const seen: Array<string | undefined> = []
    __setPluginHooksForTests([hook("onChapterCompleted")])
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async (_entry, context) => {
        seen.push(context.chapter?.text)
        return {}
      },
    }))

    const result = await runDeepChapterGeneration(
      { projectPath: "E:/Novel", userRequest: "写第三章", chapterNumber: 3, llmConfig, aiWorkflowMode: "fast" },
      {},
      deps,
    )

    // 主流程已经返回（fire-and-forget），再等一个宏任务让观测钩子跑完
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(result.finalContent).toBe(chapterBody("初稿正文内容"))
    expect(seen).toEqual([chapterBody("初稿正文内容")])
  })
})
