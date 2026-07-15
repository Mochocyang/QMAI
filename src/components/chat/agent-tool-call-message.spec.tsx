// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AgentToolCallMessage, getToolCallDescription } from "./agent-tool-call-message"
import type { AgentRunRecord } from "@/lib/agent/types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

type ToolCallRecord = AgentRunRecord["toolCalls"][number]

let host: HTMLDivElement
let root: Root

const sampleCalls: ToolCallRecord[] = [
  {
    id: "call-1",
    name: "read_chapter",
    params: { name: "第1章-开篇" },
    result: "第一章内容",
    status: "done",
    startedAt: 0,
    finishedAt: 120,
  },
  {
    id: "call-2",
    name: "read_memory",
    params: { name: "主角档案" },
    result: "主角名为李明。",
    status: "done",
    startedAt: 160,
    finishedAt: 190,
  },
  {
    id: "call-3",
    name: "write_memory",
    params: { name: "写入资料", content: "主角名为李明。" },
    result: "已写入记忆「写入资料」",
    status: "done",
    startedAt: 200,
    finishedAt: 350,
  },
  {
    id: "call-4",
    name: "apply_skill",
    params: { skillName: "去AI味" },
    result: "技能模板内容",
    status: "done",
    startedAt: 400,
    finishedAt: 500,
  },
  {
    id: "call-5",
    name: "search_chapters",
    params: { keyword: "李明" },
    result: "错误：搜索失败",
    status: "error",
    startedAt: 600,
    finishedAt: 650,
  },
]

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
})

describe("AgentToolCallMessage", () => {
  it("renders event stream with tool calls and stats", async () => {
    await act(async () => {
      root.render(<AgentToolCallMessage toolCalls={sampleCalls} />)
    })

    expect(host.textContent).toContain("读取章节《第1章-开篇》")
    expect(host.textContent).toContain("读取记忆「主角档案」")
    expect(host.textContent).toContain("生成记忆写入草稿「写入资料」")
    expect(host.textContent).toContain("应用技能「去AI味」")
    expect(host.textContent).toContain("搜索章节关键词「李明」")
    expect(host.textContent).not.toContain("耗时")
    expect(host.textContent).not.toMatch(/\d+(?:\.\d+)?(?:ms|s)/)
    expect(host.textContent).toContain("工具 5 次")
    expect(host.textContent).not.toMatch(/[⏱🔢💡]/u)

    expect(host.textContent).not.toContain("read_chapter")
    expect(host.textContent).not.toContain("read_memory")
    expect(host.textContent).not.toContain("write_memory")
    expect(host.textContent).not.toContain("apply_skill")
  })

  it("shows error style for failed tool calls", async () => {
    await act(async () => {
      root.render(<AgentToolCallMessage toolCalls={[sampleCalls[4]]} />)
    })

    const html = host.innerHTML
    expect(html).toContain("text-red-500")
    expect(host.textContent).toContain("搜索章节关键词「李明」")
    expect(host.textContent).toContain("失败")
  })

  it("shows approval-required tool calls with warning status", async () => {
    await act(async () => {
      root.render(
        <AgentToolCallMessage
          toolCalls={[
            {
              id: "call-approval",
              name: "write_chapter",
              params: { name: "第1章", content: "正文" },
              result: "写入工具需要用户确认后才能执行。",
              status: "approval_required",
              startedAt: 100,
              finishedAt: 100,
            },
          ]}
        />,
      )
    })

    expect(host.textContent).toContain("生成章节写入草稿《第1章》")
    expect(host.textContent).toContain("等待确认")
    expect(host.textContent).not.toContain("write_chapter")
    const html = host.innerHTML
    expect(html).toContain("text-amber-500")
  })

  it("shows confirmation actions for approval-required write tools without opening raw details", async () => {
    const onConfirmSave = vi.fn()
    const onReject = vi.fn()
    await act(async () => {
      root.render(
        <AgentToolCallMessage
          toolCalls={[
            {
              id: "call-approval",
              name: "write_outline_node",
              params: { outlineName: "将乱天下大纲.md", nodeTitle: "人物关系", nodeContent: "正文" },
              result: "写入工具需要用户确认后才能执行。",
              status: "approval_required",
              startedAt: 100,
              finishedAt: 100,
            },
          ]}
          onConfirmSave={onConfirmSave}
          onReject={onReject}
        />,
      )
    })

    expect(host.textContent).toContain("大纲写入需要确认")
    expect(host.textContent).toContain("确认保存")
    expect(host.textContent).toContain("放弃")
    expect(host.textContent).not.toContain("write_outline_node")

    // 审批区块中的确认保存按钮（最后一个）绑定了 onConfirmSave
    const confirmButtons = Array.from(host.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("确认保存"))
    expect(confirmButtons.length).toBeGreaterThan(0)
    const confirmButton = confirmButtons[confirmButtons.length - 1]

    await act(async () => {
      confirmButton?.click()
    })

    expect(onConfirmSave).toHaveBeenCalledTimes(1)
    expect(onConfirmSave.mock.calls[0][0].name).toBe("write_outline_node")
  })

  it("shows event stream with mixed tool types", async () => {
    await act(async () => {
      root.render(
        <AgentToolCallMessage
          toolCalls={[
            {
              id: "route-1",
              name: "route_task",
              params: { userMessage: "生成第18章" },
              result: JSON.stringify({ intent: "write_chapter", confidence: 0.92, chapterNumber: 18 }),
              status: "done",
              startedAt: 0,
              finishedAt: 40,
            },
            {
              id: "outline-1",
              name: "read_outline",
              params: { name: "总大纲" },
              result: "大纲内容",
              status: "done",
              startedAt: 50,
              finishedAt: 90,
            },
            {
              id: "write-1",
              name: "write_chapter",
              params: { name: "chapter-018", content: "正文".repeat(100) },
              result: "写入工具需要用户确认后才能执行。",
              status: "approval_required",
              startedAt: 100,
              finishedAt: 100,
            },
          ]}
        />,
      )
    })

    expect(host.textContent).toContain("识别任务意图")
    expect(host.textContent).toContain("读取大纲《总大纲》")
    expect(host.textContent).toContain("生成章节写入草稿《chapter-018》")
    expect(host.textContent).not.toContain("read_outline")
    expect(host.textContent).not.toContain("write_chapter")
    expect(host.textContent).toContain("工具 3 次")
  })

  it("returns null when toolCalls is empty or undefined", async () => {
    await act(async () => {
      root.render(<AgentToolCallMessage toolCalls={[]} />)
    })
    expect(host.textContent).toBe("")

    host.innerHTML = ""
    await act(async () => {
      root.render(<AgentToolCallMessage toolCalls={undefined} />)
    })
    expect(host.textContent).toBe("")
  })

  it("keeps hook order stable when tool calls arrive after an empty render", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await act(async () => {
        root.render(<AgentToolCallMessage toolCalls={[]} />)
      })

      await act(async () => {
      root.render(<AgentToolCallMessage toolCalls={[sampleCalls[0]]} />)
    })

    expect(host.textContent).toContain("读取章节《第1章-开篇》")
    expect(host.textContent).not.toContain("read_chapter")
    expect(errorSpy.mock.calls.flat().join("\n")).not.toContain("change in the order of Hooks")
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("shows running status and an accessible description while only running animates", async () => {
    await act(async () => {
      root.render(
        <AgentToolCallMessage
          toolCalls={[
            {
              id: "running-read",
              name: "read_chapter",
              params: { name: "chapter-017" },
              result: "",
              status: "running",
              startedAt: 100,
              finishedAt: 100,
            },
          ]}
        />,
      )
    })

    expect(host.textContent).toContain("读取章节《chapter-017》")
    expect(host.textContent).toContain("运行中")
    const toolButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label*="读取章节《chapter-017》"][aria-label*="运行中"]',
    )
    expect(toolButton).not.toBeNull()
    const html = host.innerHTML
    expect(html).toContain("animate-spin")
    expect(html).toContain("text-sky-500")
    expect(html).not.toContain("🔍")
    expect(html).not.toContain("⚠️")
    expect(html).not.toContain("✓")
    expect(html).not.toContain("✗")
  })

  it("groups two completed chapter reads and expands their compact rows on click", async () => {
    await act(async () => {
      root.render(
        <AgentToolCallMessage
          toolCalls={[
            {
              id: "chapter-1",
              name: "read_chapter",
              params: { name: "第1章" },
              result: "第一章内容",
              status: "done",
              startedAt: 10,
              finishedAt: 30,
            },
            {
              id: "chapter-2",
              name: "read_chapter",
              params: { name: "第2章" },
              result: "第二章内容",
              status: "done",
              startedAt: 40,
              finishedAt: 70,
            },
          ]}
        />,
      )
    })

    expect(host.textContent).toContain("已读取章节")
    expect(host.textContent).toContain("2项")
    expect(host.textContent).not.toContain("50ms")
    expect(host.textContent).toContain("工具 2 次")
    expect(host.textContent).not.toContain("读取章节《第1章》")
    expect(host.textContent).not.toContain("读取章节《第2章》")

    const groupButton = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("已读取章节"))
    expect(groupButton?.getAttribute("aria-expanded")).toBe("false")

    await act(async () => {
      groupButton?.click()
    })

    expect(groupButton?.getAttribute("aria-expanded")).toBe("true")
    expect(host.textContent).toContain("读取章节《第1章》")
    expect(host.textContent).toContain("读取章节《第2章》")
  })

  it("keeps a chapter group expanded when another completed chapter is appended", async () => {
    const chapterCalls: ToolCallRecord[] = [
      {
        id: "chapter-1",
        name: "read_chapter",
        params: { name: "第1章" },
        result: "第一章内容",
        status: "done",
        startedAt: 10,
        finishedAt: 30,
      },
      {
        id: "chapter-2",
        name: "read_chapter",
        params: { name: "第2章" },
        result: "第二章内容",
        status: "done",
        startedAt: 40,
        finishedAt: 70,
      },
    ]

    await act(async () => {
      root.render(<AgentToolCallMessage toolCalls={chapterCalls} />)
    })
    const groupButton = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("已读取章节"))
    await act(async () => {
      groupButton?.click()
    })
    expect(host.textContent).toContain("读取章节《第1章》")

    await act(async () => {
      root.render(
        <AgentToolCallMessage
          toolCalls={[
            ...chapterCalls,
            {
              id: "chapter-3",
              name: "read_chapter",
              params: { name: "第3章" },
              result: "第三章内容",
              status: "done",
              startedAt: 80,
              finishedAt: 110,
            },
          ]}
        />,
      )
    })

    expect(host.textContent).toContain("3项")
    expect(host.textContent).toContain("读取章节《第1章》")
    expect(host.textContent).toContain("读取章节《第3章》")
  })

  it("does not expose expandable semantics when a tool has no details", async () => {
    await act(async () => {
      root.render(
        <AgentToolCallMessage
          toolCalls={[
            {
              id: "no-details",
              name: "route_task",
              params: {},
              result: "",
              status: "done",
              startedAt: 10,
              finishedAt: 20,
            },
          ]}
        />,
      )
    })

    const toolButton = host.querySelector<HTMLButtonElement>('button[aria-label*="识别任务意图"]')
    expect(toolButton).not.toBeNull()
    expect(toolButton?.hasAttribute("aria-expanded")).toBe(false)
    await act(async () => {
      toolButton?.click()
    })
    expect(toolButton?.hasAttribute("aria-expanded")).toBe(false)
    expect(host.textContent).not.toContain("参数")
    expect(host.textContent).not.toContain("结果")
  })

  it("renders undefined parameter values safely when details are expanded", async () => {
    await act(async () => {
      root.render(
        <AgentToolCallMessage
          toolCalls={[
            {
              id: "undefined-param",
              name: "apply_skill",
              params: { skillName: undefined },
              result: "",
              status: "done",
              startedAt: 10,
              finishedAt: 20,
            },
          ]}
        />,
      )
    })

    const toolButton = host.querySelector<HTMLButtonElement>('button[aria-label*="应用写作技能"]')
    expect(toolButton).not.toBeNull()
    await act(async () => {
      toolButton?.click()
    })

    expect(host.textContent).toContain("skillName:")
    expect(host.textContent).toContain("undefined")
  })

  it("shows the cancelled status in Chinese", async () => {
    await act(async () => {
      root.render(
        <AgentToolCallMessage
          toolCalls={[
            {
              id: "cancelled-call",
              name: "read_chapter",
              params: { name: "第4章" },
              result: "",
              status: "cancelled",
              startedAt: 10,
              finishedAt: 10,
            },
          ]}
        />,
      )
    })

    expect(host.textContent).toContain("已取消")
    expect(host.querySelector('button[aria-label*="已取消"]')).not.toBeNull()
  })

  it("uses wrapping tool rows with a minimum 32px height and no legacy character icons", async () => {
    await act(async () => {
      root.render(<AgentToolCallMessage toolCalls={[sampleCalls[2]]} />)
    })

    const toolButton = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("生成记忆写入草稿"))
    expect(toolButton?.className).toContain("min-h-8")
    expect(toolButton?.innerHTML).toContain("break-words")
    expect(toolButton?.innerHTML).not.toContain("truncate")
    expect(host.innerHTML).not.toContain("✏️")
    expect(host.innerHTML).not.toContain("⚙️")
    expect(host.innerHTML).not.toContain("···")
    expect(host.innerHTML).not.toContain("✓")
    expect(host.innerHTML).not.toContain("animate-spin")
  })

  it("does not use the old blue card-list wrapper for workflow steps", () => {
    const source = readFileSync(resolve(__dirname, "agent-workflow-panel.tsx"), "utf8")

    expect(source).toContain("border-l border-border/80")
    expect(source).not.toContain("border-l-4 border-blue-500")
    expect(source).not.toContain("bg-blue-50/50")
    expect(source).not.toContain("border-blue-200/70 bg-white/50")
  })

  it("expands and collapses tool call details on row click", async () => {
    await act(async () => {
      root.render(<AgentToolCallMessage toolCalls={[sampleCalls[0]]} />)
    })

    const toolItemButton = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("读取章节《第1章-开篇》"))
    expect(toolItemButton).not.toBeUndefined()
    expect(toolItemButton?.getAttribute("aria-expanded")).toBe("false")
    expect(host.textContent).not.toContain("第一章内容")

    await act(async () => {
      toolItemButton?.click()
    })

    expect(toolItemButton?.getAttribute("aria-expanded")).toBe("true")
    expect(host.textContent).toContain("第一章内容")

    await act(async () => {
      toolItemButton?.click()
    })

    expect(toolItemButton?.getAttribute("aria-expanded")).toBe("false")
    expect(host.textContent).not.toContain("第一章内容")
  })
})

describe("getToolCallDescription", () => {
  it("covers all registered built-in tool names", () => {
    const names = [
      "read_chapter",
      "read_outline",
      "read_memory",
      "read_deduction",
      "read_chat_history",
      "read_outline_history",
      "search_chapters",
      "list_chapters",
      "list_outlines",
      "list_memories",
      "list_deductions",
      "write_chapter",
      "write_outline_node",
      "write_memory",
      "apply_skill",
    ] as const

    for (const name of names) {
      const desc = getToolCallDescription(name, { name: "测试", keyword: "测试", skillName: "测试" })
      expect(desc).not.toBe(name)
      expect(desc.length).toBeGreaterThan(0)
    }
  })

  it("falls back to tool name for unknown tools", () => {
    expect(getToolCallDescription("unknown_tool", {})).toBe("unknown_tool")
  })
})

describe("outline workflow integration", () => {
  it("uses one shared workflow panel while preserving thinking and write confirmation callbacks", () => {
    const source = readFileSync(resolve(__dirname, "../sources/outline-chat-panel.tsx"), "utf8")
    const start = source.indexOf("function OutlineAssistantMessage")
    const end = source.indexOf("function ", start + 1)
    const component = source.slice(start, end === -1 ? source.length : end)

    expect(component).not.toContain("<OutlineWorkflowStages")
    expect(component).toContain("thinkingContent={thinking || undefined}")
    expect(component).toContain("thinkingStreaming={messageIsStreaming}")
    expect(component).toContain("onConfirmSave={onConfirmToolSave}")
    expect(component).toContain("onReject={onRejectTool}")
  })
})
describe("tool call timeline layout", () => {
  it("wraps tool rows so long tool names and descriptions do not squeeze the chat panel", () => {
    const source = readFileSync(resolve(__dirname, "tool-call-timeline.tsx"), "utf8")

    expect(source).toContain("max-w-full overflow-hidden")
    expect(source).toContain("grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto]")
    expect(source).toContain("w-full max-w-full min-w-0")
    expect(source).toContain("break-words")
    expect(source).toContain("overflow-x-hidden")
    expect(source).not.toContain("overflow-x-auto")
    expect(source).not.toContain('className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"')
    expect(source).not.toContain('className="min-w-0 flex-1 truncate text-muted-foreground"')
  })
})
