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

  it("fills the assistant message width instead of shrinking to stage text", () => {
    const html = renderToStaticMarkup(<AgentStageStream stages={stages} />)

    expect(html).toContain("w-full")
    expect(html).toContain("min-w-0")
    expect(html).toContain("max-w-full")
  })

  it("renders stages in canonical order and hides redundant chapter_workflow", () => {
    const disordered: AgentStageTrace[] = [
      {
        id: "final_output",
        title: "最终输出",
        status: "done",
        summary: "正文已生成",
        events: [],
        startedAt: 400,
      },
      {
        id: "chapter_workflow",
        title: "多任务写作循环",
        status: "running",
        summary: "不应展示",
        events: [],
        startedAt: 50,
      },
      {
        id: "read_context",
        title: "读取上下文",
        status: "done",
        summary: "已读",
        events: [],
        startedAt: 100,
      },
      {
        id: "generate_draft",
        title: "生成章节草稿",
        status: "done",
        summary: "草稿完成",
        events: [],
        startedAt: 200,
      },
    ]

    const html = renderToStaticMarkup(<AgentStageStream stages={disordered} />)
    const readIndex = html.indexOf("读取上下文")
    const draftIndex = html.indexOf("生成章节草稿")
    const finalIndex = html.indexOf("最终输出")

    expect(readIndex).toBeGreaterThan(-1)
    expect(draftIndex).toBeGreaterThan(readIndex)
    expect(finalIndex).toBeGreaterThan(draftIndex)
    expect(html).not.toContain("多任务写作循环")
    expect(html).toContain("(3)")
  })

  it("does not render the panel when only routine stages exist", () => {
    const routineStages: AgentStageTrace[] = [
      {
        id: "task_understanding",
        title: "任务理解",
        status: "done",
        summary: "快速模式（普通对话）",
        events: [
          {
            id: "route-1",
            stageId: "task_understanding",
            kind: "analysis",
            title: "当前执行路线",
            content: "识别任务：general_chat",
            timestamp: 100,
          },
        ],
        startedAt: 100,
      },
      {
        id: "capability_selection",
        title: "能力选择",
        status: "done",
        summary: "本次未启用 Skill：当前任务、模式或阶段没有匹配到可用技能。",
        events: [
          {
            id: "skill-1",
            stageId: "capability_selection",
            kind: "skill_used",
            title: "本次启用 Skill",
            content: "本次未启用 Skill：当前任务、模式或阶段没有匹配到可用技能。",
            timestamp: 200,
          },
        ],
        startedAt: 200,
      },
    ]

    const html = renderToStaticMarkup(<AgentStageStream stages={routineStages} />)
    expect(html).toBe("")
  })

  it("renders capability_selection when skills are actually enabled", () => {
    const skillStages: AgentStageTrace[] = [
      {
        id: "capability_selection",
        title: "能力选择",
        status: "done",
        summary: "1. 正文输出协议｜阶段：output｜类型：output｜优先级：10",
        events: [
          {
            id: "skill-1",
            stageId: "capability_selection",
            kind: "skill_used",
            title: "本次启用 Skill",
            content: "1. 正文输出协议｜阶段：output｜类型：output｜优先级：10",
            timestamp: 100,
          },
        ],
        startedAt: 100,
      },
    ]

    const html = renderToStaticMarkup(<AgentStageStream stages={skillStages} />)
    expect(html).toContain("生成过程")
    expect(html).toContain("正文输出协议")
  })
})
