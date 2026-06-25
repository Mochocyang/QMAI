import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { StreamingMessage } from "./chat-message"
import { getDeepChapterToggleButtonClass } from "./chat-panel"

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

describe("deep chapter thinking toggle style", () => {
  it("uses a clear dark selected state when deep chapter generation is enabled", () => {
    const activeClassName = getDeepChapterToggleButtonClass(true)
    const inactiveClassName = getDeepChapterToggleButtonClass(false)

    expect(activeClassName).toContain("bg-primary")
    expect(activeClassName).toContain("text-primary-foreground")
    expect(activeClassName).toContain("border-primary")
    expect(inactiveClassName).not.toContain("bg-primary")
  })
})

describe("chapter save preview sync regression", () => {
  it("always routes AI chapter saves to the next chapter instead of reusing the current chapter", () => {
    const source = readFileSync(resolve(__dirname, "chat-panel.tsx"), "utf8")

    expect(source).toContain('if (strategy.action === "direct_explicit_target_new")')
    expect(source).toContain("const nextNum = await getNextChapterNumber(pp)")
    expect(source).toContain("setChapterSaveStatus(`已保存为第${nextNum}章草稿`)")
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
    expect(source).toContain("appendContinueUnfinishedDeepChapterContext")
    expect(source).toContain("extractContinueUnfinishedDeepChapterContext")
    expect(source).toContain("contextPackToPrompt")
    expect(source).toContain('addMessage("user", "继续未完成")')
    expect(source).toContain("resolveNovelModel")
    expect(source).toContain("onContinueUnfinished={isLastAssistant ? () => handleContinueUnfinished(msg) : undefined}")
  })

  it("keeps the ai chat footer labels as readable Chinese text", () => {
    const source = readFileSync(resolve(__dirname, "chat-panel.tsx"), "utf8")

    expect(source).toContain("深度模式")
    expect(source).toContain("编辑章节")
    expect(source).toContain("继续未完成")
  })
})
