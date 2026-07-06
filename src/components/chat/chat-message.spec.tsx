import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { ChatMessage, StreamingMessage } from "./chat-message"
import { getWorkflowModeButtonClass } from "./chat-panel"
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

  it("keeps old tool workflow fallback when structured stages are absent", () => {
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

    expect(html).toContain("思考过程")
    expect(html).toContain("完成。")
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
