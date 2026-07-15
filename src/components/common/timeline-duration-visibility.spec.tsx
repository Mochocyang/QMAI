import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ToolCallTimeline } from "@/components/chat/tool-call-timeline"
import { EventStream } from "./event-stream"
import type { TimelineEvent, ToolCallEventItem } from "./timeline-types"

function readEvent(id: string, startedAt: number, finishedAt: number): ToolCallEventItem {
  return {
    id,
    name: "read_chapter",
    description: `读取章节《${id}》`,
    category: "read",
    status: "done",
    startedAt,
    finishedAt,
  }
}

describe("AI 对话与 AI 大纲耗时展示", () => {
  it("共享事件流不显示单项、分组或总耗时", () => {
    const singleEvents: TimelineEvent[] = [
      { kind: "tool_call", data: readEvent("第一章", 100, 105) },
    ]
    const groupedEvents: TimelineEvent[] = [
      { kind: "tool_call", data: readEvent("第一章", 100, 105) },
      { kind: "tool_call", data: readEvent("第二章", 106, 119) },
    ]

    const singleHtml = renderToStaticMarkup(
      <EventStream events={singleEvents} isStreaming={false} totalDurationMs={19} />,
    )
    const groupedHtml = renderToStaticMarkup(
      <EventStream events={groupedEvents} isStreaming={false} totalDurationMs={19} />,
    )

    expect(singleHtml).toContain("读取章节《第一章》")
    expect(singleHtml).not.toContain("5ms")
    expect(singleHtml).not.toContain("耗时")
    expect(groupedHtml).toContain("2项")
    expect(groupedHtml).not.toContain("18ms")
    expect(groupedHtml).not.toContain("19ms")
    expect(groupedHtml).not.toContain("耗时")
  })

  it("AI 对话旧工具时间线不显示耗时", () => {
    const html = renderToStaticMarkup(
      <ToolCallTimeline
        toolCalls={[{
          id: "tool-1",
          name: "read_chapter",
          params: { chapter: "第一章" },
          result: "章节内容",
          status: "done",
          startedAt: 100,
          finishedAt: 1100,
        }]}
      />,
    )

    expect(html).toContain("读取章节")
    expect(html).not.toContain("1.0s")
  })
})
