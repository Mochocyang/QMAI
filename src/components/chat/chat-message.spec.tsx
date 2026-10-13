import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { ChatMessage, StreamingMessage } from "./chat-message"
import { getWorkflowModeButtonClass } from "./chat-panel"
import { WAITING_HINTS } from "@/lib/novel/waiting-hints"
import type { DisplayMessage } from "@/stores/chat-store"

vi.mock("@/lib/novel/agent-parser", () => ({
  parseAgentResponse: (content: string) => ({
    textContent: content,
    hasEdits: false,
    edits: [],
  }),
}))

function tenThinkingLines(): string {
  return Array.from({ length: 10 }, (_value, index) => `stage line ${index + 1}`).join("\n")
}

describe("chat thinking display", () => {
  it("keeps completed thinking content in a fixed scrollable panel", () => {
    const thinking = tenThinkingLines()
    const html = renderToStaticMarkup(
      <StreamingMessage content={`<think>\n${thinking}\n</think>\n\nfinal answer`} />,
    )

    expect(html).toContain("stage line 1")
    expect(html).toContain("stage line 10")
    expect(html).toContain("max-h-")
    expect(html).toContain("overflow-y-auto")
    expect(html).not.toContain("Thought for")
  })

  it("keeps streaming thinking content in a fixed scrollable panel", () => {
    const thinking = tenThinkingLines()
    const html = renderToStaticMarkup(<StreamingMessage content={`<think>\n${thinking}`} />)

    expect(html).toContain("stage line 1")
    expect(html).toContain("stage line 10")
    expect(html).not.toContain("h-[5lh]")
    expect(html).toContain("max-h-")
    expect(html).toContain("overflow-y-auto")
  })

  it("labels fragmented model reasoning as 思考过程 instead of hundreds of workflow stages", () => {
    const fragmentedReasoning = ["好的，", "用户", "问", "的是", "当前", "情节", "中", "的人物"]
      .join("\n\n")
    const html = renderToStaticMarkup(
      <StreamingMessage content={`<think>\n${fragmentedReasoning}\n</think>\n\n回答正文`} />,
    )

    expect(html).toContain("思考过程")
    expect(html).not.toContain("工作流阶段")
    expect(html).not.toContain("个阶段")
    expect(html).toContain("好的，用户问的是当前情节中的人物")
  })
})

describe("AI workflow mode toggle style", () => {
  it("uses a clear selected state for the active workflow mode", () => {
    const activeClassName = getWorkflowModeButtonClass(true)
    const inactiveClassName = getWorkflowModeButtonClass(false)

    expect(activeClassName).toContain("bg-primary")
    expect(activeClassName).toContain("text-primary-foreground")
    expect(inactiveClassName).not.toContain("bg-primary")
  })
})

describe("chat message references", () => {
  it("renders attached reference chips on user messages", () => {
    const message: DisplayMessage = {
      id: "msg-1",
      role: "user",
      content: "请参考这一章",
      timestamp: 1,
      conversationId: "conv-1",
      attachedReferences: [{
        id: "ref-1",
        category: "chapter",
        title: "第一章",
        path: "C:/Novel/wiki/chapters/第一章.md",
        displayTitle: "第一章",
      }],
    }

    const html = renderToStaticMarkup(<ChatMessage message={message} />)

    expect(html).toContain("请参考这一章")
    expect(html).toContain("@第一章")
    expect(html).toContain('data-reference-id="ref-1"')
    expect(html).not.toContain("移除引用")
  })
})

describe("chapter co-creation rendering", () => {
  it("hides the chapter_discuss protocol block from the assistant bubble", () => {
    const message: DisplayMessage = {
      id: "msg-discuss",
      role: "assistant",
      content: [
        "关键判断：第三章需要一个爆发点。",
        "<!-- chapter_discuss -->",
        '{"status":"needs_choice","module":"第3章","directions":[]}',
        "<!-- /chapter_discuss -->",
      ].join("\n"),
      timestamp: 1,
      conversationId: "conv-1",
      chapterDiscussPhase: "decision",
    }

    const html = renderToStaticMarkup(<ChatMessage message={message} />)

    expect(html).not.toContain("chapter_discuss")
    expect(html).toContain("关键判断")
  })
})

describe("agent stage stream integration", () => {
  it("renders structured generation process above final assistant content", () => {
    const message: DisplayMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "这是最终正文。",
      timestamp: 1,
      conversationId: "conv-1",
      agentStages: [
        {
          id: "generate_draft",
          title: "生成章节草稿",
          status: "running",
          summary: "正在生成正文初稿",
          events: [
            {
              id: "event-1",
              stageId: "generate_draft",
              kind: "stage_input",
              title: "接收内容",
              content: "章节生成约束包",
              timestamp: 1,
            },
          ],
        },
      ],
    }

    const html = renderToStaticMarkup(<ChatMessage message={message} />)

    expect(html).toContain("生成过程")
    expect(html).toContain("章节生成约束包")
    expect(html).toContain("这是最终正文。")
  })

  it("keeps write approval actions visible when structured stages are present", () => {
    const message: DisplayMessage = {
      id: "assistant-approval",
      role: "assistant",
      content: "等待确认保存。",
      timestamp: 1,
      conversationId: "conv-1",
      agentStages: [
        {
          id: "write_confirmation",
          title: "写入确认",
          status: "approval_required",
          summary: "等待用户确认写入。",
          events: [],
        },
      ],
      agentToolCalls: [
        {
          id: "write-approval",
          name: "write_chapter",
          params: { name: "第1章", content: "正文" },
          result: "预览内容",
          status: "approval_required",
          startedAt: 1,
          finishedAt: 2,
        },
      ],
    }

    const html = renderToStaticMarkup(
      <ChatMessage
        message={message}
        onConfirmToolSave={() => {}}
        onRejectTool={() => {}}
      />,
    )

    expect(html).toContain("写入确认")
    expect(html).toContain("确认保存")
    expect(html).toContain("放弃")
  })

  it("shows event stream when tool calls are present", () => {
    const message: DisplayMessage = {
      id: "assistant-2",
      role: "assistant",
      content: "完成。",
      timestamp: 1,
      conversationId: "conv-1",
      agentToolCalls: [
        {
          id: "tool-1",
          name: "read_chapter",
          params: { chapter: "第1章" },
          result: "章节内容",
          status: "done",
          startedAt: 1,
          finishedAt: 2,
        },
      ],
    }

    const html = renderToStaticMarkup(<ChatMessage message={message} />)

    expect(html).toContain("读取章节")
    expect(html).toContain("完成。")
    expect(html).not.toContain("耗时")
    expect(html).not.toContain("1ms")
  })
})

describe("AI 对话上下文中控入口", () => {
  it("只有中控快照时仍显示生成详情入口", () => {
    const message: DisplayMessage = {
      id: "assistant-context-hub",
      role: "assistant",
      content: "回答正文",
      timestamp: 10,
      conversationId: "chat-1",
      contextHubSnapshot: {
        id: "assistant-context-hub",
        surface: "ai-chat",
        createdAt: 10,
        stats: {
          cacheHits: 2, reloaded: 1, empty: 0, fallbackUsed: 0, readFailed: 0, writeFailed: 0,
          stableTokens: 100, summaryTokens: 20, dynamicTokens: 30,
          candidateTokens: 300, estimatedSavedTokens: 150, estimatedSavedPercent: 50,
          expanded: false, providerCacheEnabled: true,
        },
      },
    }

    const html = renderToStaticMarkup(<ChatMessage message={message} />)

    expect(html).not.toContain("查看生成详情")
    expect(html).toContain("查看本轮用量")
  })
})

describe("chat message width", () => {
  it("lets chat bubbles expand to half of the window without overflowing narrow panels", () => {
    const source = readFileSync(resolve(__dirname, "chat-message.tsx"), "utf8")

    expect(source).toContain("lg:max-w-[50vw]")
    expect(source).toContain("max-w-full")
    expect(source).not.toContain("max-w-[80%]")
  })

  it("lets assistant messages use the available chat column width for generation process cards", () => {
    const source = readFileSync(resolve(__dirname, "chat-message.tsx"), "utf8")

    expect(source).toContain('className={`flex w-full min-w-0 gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}')
    expect(source).toContain('isUser ? "w-fit max-w-full lg:max-w-[50vw]" : "min-w-0 flex-1 max-w-full"')
    expect(source).toContain('className="flex w-full min-w-0 gap-2 flex-row"')
    expect(source).toContain('className="min-w-0 flex-1 max-w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"')
  })
})

describe("chapter save preview sync regression", () => {
  it("always routes AI chapter saves to the next chapter instead of reusing the current chapter", () => {
    const source = readFileSync(resolve(__dirname, "chat-panel.tsx"), "utf8")

    expect(source).toContain('strategy.action === "direct_explicit_target_new"')
    expect(source).toContain("await getNextChapterNumber(pp)")
    expect(source).toContain("setChapterSaveStatus(`已保存为${chapterTitle}`)")
  })

  it("no longer uses the pending chapter save dialog flow", () => {
    const source = readFileSync(resolve(__dirname, "chat-panel.tsx"), "utf8")

    expect(source).not.toContain("pendingChapterSaveDialog")
    expect(source).not.toContain("applyPendingChapterSave")
    expect(source).not.toContain("保存到章节后面")
  })

  it("clears chapter save status on new send and conversation switch", () => {
    const panelSource = readFileSync(resolve(__dirname, "chat-panel.tsx"), "utf8")
    const messageSource = readFileSync(resolve(__dirname, "chat-message.tsx"), "utf8")

    expect(panelSource).toContain('setChapterSaveStatus("")')
    expect(panelSource).toMatch(/setDeAiSkillWarningMessage\(""\)[\s\S]*?setChapterSaveStatus\(""\)/)
    expect(panelSource).toMatch(/userScrolledUpRef\.current = false[\s\S]*?setChapterSaveStatus\(""\)[\s\S]*?\}, \[activeConversationId\]\)/)
    expect(panelSource).toContain("saveStatus={isLastAssistant ? chapterSaveStatus : undefined}")
    expect(messageSource).toContain("isLastAssistant && saveStatus")
  })
})

describe("deep chapter unfinished continuation action", () => {
  it("shows a continuation button and explanation for failed deep chapter thinking", () => {
    const source = readFileSync(resolve(__dirname, "chat-message.tsx"), "utf8")

    expect(source).toContain("onContinueUnfinished")
    expect(source).toContain("继续未完成")
    expect(source).toContain("节省 token")
    expect(source).toContain("canContinueUnfinishedDeepChapter")
  })

  it("wires the continuation action through chat panel without rerunning regenerate", () => {
    const source = readFileSync(resolve(__dirname, "chat-panel.tsx"), "utf8")

    expect(source).toContain("handleContinueUnfinished")
    expect(source).toContain("buildContinueUnfinishedDeepChapterPrompt")
    expect(source).toContain("extractContinueUnfinishedDeepChapterContext")
    expect(source).toContain('handleSendRef.current(prompt, [], "继续未完成")')
    expect(source).not.toContain('addMessage("user", "继续未完成")')
    expect(source).not.toContain("resolveNovelModel")
    expect(source).toContain("onContinueUnfinished={isLastAssistant ? () => handleContinueUnfinished(msg) : undefined}")
  })

  it("keeps the ai chat footer labels as readable Chinese text", () => {
    const source = readFileSync(resolve(__dirname, "chat-panel.tsx"), "utf8")

    expect(source).toContain("AI 会话执行模式")
    expect(source).toContain("快速")
    expect(source).toContain("标准")
    expect(source).toContain("严格")
    expect(source).toContain("编辑章节")
    expect(source).toContain("继续未完成")
  })
})

describe("生成期间始终显示等待文案", () => {
  const runningMessage = (content: string, isAgentRunning: boolean): DisplayMessage => ({
    id: "assistant-hint",
    role: "assistant",
    content,
    timestamp: 1,
    conversationId: "conv-1",
    isAgentRunning,
  })

  const hasWaitingHint = (html: string) => WAITING_HINTS.some((hint) => html.includes(hint))

  it("正文已经在生成时，等待文案仍然显示在正文下面", () => {
    const html = renderToStaticMarkup(
      <ChatMessage message={runningMessage("这是最终正文。", true)} />,
    )

    expect(html).toContain("这是最终正文。")
    expect(hasWaitingHint(html)).toBe(true)
  })

  it("还没有正文时同样显示等待文案", () => {
    const html = renderToStaticMarkup(<ChatMessage message={runningMessage("", true)} />)

    expect(hasWaitingHint(html)).toBe(true)
  })

  it("生成完全结束后不再显示等待文案", () => {
    const html = renderToStaticMarkup(
      <ChatMessage message={runningMessage("这是最终正文。", false)} />,
    )

    expect(html).toContain("这是最终正文。")
    expect(hasWaitingHint(html)).toBe(false)
  })

  it("等待文案渲染在正文之后，确保始终在最下面", () => {
    const html = renderToStaticMarkup(
      <ChatMessage message={runningMessage("这是最终正文。", true)} />,
    )

    const contentIndex = html.indexOf("这是最终正文。")
    const hintIndex = WAITING_HINTS.reduce((found, hint) => {
      const index = html.indexOf(hint)
      return index >= 0 && (found < 0 || index < found) ? index : found
    }, -1)
    expect(contentIndex).toBeGreaterThanOrEqual(0)
    expect(hintIndex).toBeGreaterThan(contentIndex)
  })
})

/*
 * 事件细纲：章节工具栏那枚「生成章节细纲」现在把请求发进 AI 对话
 * （用户要求「生成的内容在 AI 对话框中显示」），所以写作助手这一侧也必须
 * 认得出细纲并把裸 JSON 收起来 —— 否则用户看到的是一大坨 `eventOutlineData`。
 */
describe("事件细纲卡片（写作助手侧）", () => {
  const outline = {
    version: 1,
    chapterNumber: 12,
    title: "第12章 · 令牌初现",
    targetWords: 3000,
    events: [1, 2, 3, 4].map((id) => ({
      id,
      title: `事件${id} 一句话事件`,
      points: ["关键台词：你来啦", "神情动作：她手一抖"],
    })),
    endingHook: "令牌上的四个字亮起时，院外传来脚步声。",
  }

  const assistantWithOutline = (patch: Partial<DisplayMessage> = {}): DisplayMessage => ({
    id: "msg-event-outline",
    role: "assistant",
    content: [
      "# 事件细纲 · 第12章 令牌初现",
      "",
      "## 事件1 楚白翻出令牌",
      "- 关键台词：你来啦",
      "",
      "```json",
      JSON.stringify({ eventOutlineData: outline }),
      "```",
    ].join("\n"),
    timestamp: 1,
    conversationId: "conv-1",
    ...patch,
  })

  it("把 eventOutlineData 渲染成卡片，并且不再显示裸 JSON", () => {
    const html = renderToStaticMarkup(<ChatMessage message={assistantWithOutline()} />)

    expect(html).toContain("data-event-outline-card")
    expect(html).toContain("第12章 · 令牌初现")
    expect(html).toContain("用这份细纲写这一章")
    // 卡片已经把同一份数据渲染成可读结构，围栏里的裸 JSON 是纯噪声。
    expect(html).not.toContain("eventOutlineData")
  })

  it("生成过程中不解析：逐 token 重渲染时不做括号配平，卡片等收尾后再出", () => {
    const html = renderToStaticMarkup(
      <ChatMessage message={assistantWithOutline({ isAgentRunning: true })} />,
    )

    expect(html).not.toContain("data-event-outline-card")
  })

  it("用户消息里粘贴的同样 JSON 不渲染卡片（那不是生成结果）", () => {
    const html = renderToStaticMarkup(
      <ChatMessage message={assistantWithOutline({ role: "user" })} />,
    )

    expect(html).not.toContain("data-event-outline-card")
  })

  it("普通助手回复不长出卡片", () => {
    const html = renderToStaticMarkup(
      <ChatMessage message={assistantWithOutline({ content: "这一章我建议这样走。", id: "msg-plain" })} />,
    )

    expect(html).not.toContain("data-event-outline-card")
  })

  /*
   * ── 2026-10-13 用户实测的那个组合 ──
   *
   * 共创判「前文不足以推演」的那一轮，模型经常**顺手把整章事件细纲也一起给出来**
   * （只是没给多向分支）。于是同一条回复里既有 `chapter_discuss` 协议块、
   * 又有 `eventOutlineData` 围栏，用户看到的是：
   *   · 气泡里漏着一大坨裸 JSON（两条剥离被写成互斥三元，那一支只剥协议块）；
   *   · 细纲卡 + 一张说「前文不足以推演」的琥珀卡并排，两张卡各带一枚「换一批」。
   *
   * 现在：裸 JSON 必须收起来，且只剩**一张**卡 —— 原因与三枚动作都并进细纲卡。
   */
  const insufficientProtocol = {
    status: "insufficient" as const,
    module: "第12章",
    judgment: "原回复只给了固定情节，未提供可供挑选的多向剧情分支。",
    directions: [],
    preferenceId: "",
    preferenceReason: "",
  }

  /** 同一条回复：细纲（Markdown + JSON 围栏）+ 共创协议块。 */
  const assistantWithOutlineAndInsufficient = (patch: Partial<DisplayMessage> = {}): DisplayMessage => ({
    ...assistantWithOutline(),
    content: [
      "# 事件细纲 · 第12章 令牌初现",
      "",
      "## 事件1 楚白翻出令牌",
      "- 关键台词：你来啦",
      "",
      "<!-- chapter_discuss -->",
      JSON.stringify({ status: "insufficient", module: "第12章", directions: [] }),
      "<!-- /chapter_discuss -->",
      "",
      "```json",
      JSON.stringify({ eventOutlineData: outline }),
      "```",
    ].join("\n"),
    chapterDiscussProtocol: insufficientProtocol,
    chapterDiscussPhase: "decision",
    ...patch,
  })

  it("共创判「前文不足以推演」又给了细纲时：裸 JSON 收起来，只剩一张卡", () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        message={assistantWithOutlineAndInsufficient()}
        onSelectChapterDiscussDirection={() => {}}
        onRegenerateChapterDiscuss={() => {}}
        onCustomChapterDiscuss={() => {}}
      />,
    )

    // 1) 裸 JSON 一个字都不许露（两条剥离必须都跑，不能二选一）
    expect(html).not.toContain("eventOutlineData")
    expect(html).not.toContain("chapter_discuss")
    // 2) 细纲卡还在，且只有一张（两张卡时这枚按钮会出现两次）
    expect(html.match(/用这份细纲写这一章/g)).toHaveLength(1)
    expect(html.match(/换一批/g)).toHaveLength(1)
    // 3) 那张「前文不足以推演」的独立卡整张退场，原因搬进细纲卡
    expect(html).not.toContain("data-chapter-discuss-card")
    expect(html).toContain("data-event-outline-discuss-note")
    expect(html).toContain("未提供可供挑选的多向剧情分支")
  })

  it("没有细纲时那一轮「前文不足以推演」照旧单独成卡（合并只发生在有细纲时）", () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        message={insufficientOnlyMessage()}
        onSelectChapterDiscussDirection={() => {}}
        onRegenerateChapterDiscuss={() => {}}
        onCustomChapterDiscuss={() => {}}
      />,
    )

    expect(html).toContain("data-chapter-discuss-card")
    expect(html).toContain("前文不足以推演")
    expect(html).not.toContain("用这份细纲写这一章")
  })

  it("共创给的是多向方向（needs_choice）时，即便同一条回复带了细纲也照常出方向卡", () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        message={assistantWithOutlineAndInsufficient({
          chapterDiscussProtocol: {
            ...insufficientProtocol,
            status: "needs_choice",
            directions: [{
              id: "d1",
              storyType: "复仇线",
              title: "藏起来，然后反杀回收队",
              summary: "主角先躲进废车场，等那队人进来再突然动手。",
            }],
          },
        })}
        onSelectChapterDiscussDirection={() => {}}
        onRegenerateChapterDiscuss={() => {}}
        onCustomChapterDiscuss={() => {}}
      />,
    )

    expect(html).toContain("data-chapter-discuss-card")
    // 反向控制：细纲卡也在（两张是两件不同的事，不能互相顶掉）
    expect(html).toContain("data-event-outline-card")
  })
})

/** 只有共创协议、没有事件细纲的那一轮。 */
function insufficientOnlyMessage(): DisplayMessage {
  return {
    id: "msg-discuss-only",
    role: "assistant",
    content: [
      "关键判断：前文给不出可挑选的多向分支。",
      "<!-- chapter_discuss -->",
      JSON.stringify({ status: "insufficient", module: "第12章", judgment: "前文不足以推演。" }),
      "<!-- /chapter_discuss -->",
    ].join("\n"),
    timestamp: 1,
    conversationId: "conv-1",
    chapterDiscussPhase: "decision",
    chapterDiscussProtocol: {
      status: "insufficient",
      module: "第12章",
      judgment: "前文不足以推演。",
      directions: [],
      preferenceId: "",
      preferenceReason: "",
    },
  }
}
