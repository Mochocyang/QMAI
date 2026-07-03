import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AgentStageStream } from "./agent-stage-stream"
import type { AgentStageTrace } from "@/lib/agent/types"

const stages: AgentStageTrace[] = [
  {
    id: "read_context",
    title: "读取上下文",
    status: "done",
    summary: "已读取上一章结尾",
    startedAt: 100,
    finishedAt: 200,
    events: [
      {
        id: "read-1",
        stageId: "read_context",
        kind: "extract_result",
        title: "提取结果",
        content: "上一章结尾：铜铃线索未揭示。",
        timestamp: 150,
      },
    ],
  },
  {
    id: "generate_draft",
    title: "生成章节草稿",
    status: "running",
    summary: "正在生成正文初稿",
    startedAt: 210,
    events: [
      {
        id: "draft-1",
        stageId: "generate_draft",
        kind: "stage_input",
        title: "接收内容",
        content: "章节生成约束包\n写作任务书",
        timestamp: 220,
      },
    ],
  },
]

describe("AgentStageStream", () => {
  it("renders a Chinese stage stream with current stage expanded", () => {
    const html = renderToStaticMarkup(<AgentStageStream stages={stages} />)

    expect(html).toContain("生成过程")
    expect(html).toContain("读取上下文")
    expect(html).toContain("生成章节草稿")
    expect(html).toContain("接收内容")
    expect(html).toContain("章节生成约束包")
    expect(html).toContain("overflow-y-auto")
    expect(html).not.toContain("undefined")
  })

  it("keeps completed stage detail out of default static markup while preserving the summary", () => {
    const html = renderToStaticMarkup(<AgentStageStream stages={stages} />)

    expect(html).toContain("已读取上一章结尾")
    expect(html).not.toContain("上一章结尾：铜铃线索未揭示。")
  })
})
