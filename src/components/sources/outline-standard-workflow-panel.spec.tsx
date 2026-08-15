// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AgentRunRecord } from "@/lib/agent/types"
import {
  OutlineStandardWorkflowPanel,
  shouldUseOutlineStandardWorkflowCard,
} from "./outline-standard-workflow-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

type ToolCallRecord = AgentRunRecord["toolCalls"][number]

const sampleCalls: ToolCallRecord[] = [
  {
    id: "call-1",
    name: "read_outline",
    params: { name: "第47章" },
    result: "章纲内容",
    status: "done",
    startedAt: 0,
    finishedAt: 120,
  },
  {
    id: "call-2",
    name: "write_outline_node",
    params: { outlineName: "第47章", content: "草稿" },
    result: "已写入",
    status: "running",
    startedAt: 160,
  },
]

let host: HTMLDivElement
let root: Root

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

describe("shouldUseOutlineStandardWorkflowCard", () => {
  it("仅标准模式的意图分析/生成使用卡片，快速模式和多 Agent 不套一层", () => {
    expect(shouldUseOutlineStandardWorkflowCard({
      fastMode: false,
      intentPhase: "generation",
      hasMultiAgentRun: false,
    })).toBe(true)
    expect(shouldUseOutlineStandardWorkflowCard({
      fastMode: false,
      intentPhase: "intent_analysis",
      hasMultiAgentRun: false,
    })).toBe(true)
    expect(shouldUseOutlineStandardWorkflowCard({
      fastMode: true,
      intentPhase: "generation",
      hasMultiAgentRun: false,
    })).toBe(false)
    expect(shouldUseOutlineStandardWorkflowCard({
      fastMode: false,
      intentPhase: "generation",
      hasMultiAgentRun: true,
    })).toBe(false)
    expect(shouldUseOutlineStandardWorkflowCard({
      fastMode: false,
      intentPhase: "waiting_user_input",
      hasMultiAgentRun: false,
    })).toBe(false)
    expect(shouldUseOutlineStandardWorkflowCard({
      fastMode: false,
      hasMultiAgentRun: false,
    })).toBe(false)
  })
})

describe("OutlineStandardWorkflowPanel", () => {
  it("用与多 Agent 面板相同的天空色卡片展示标题、状态和工具完成数", async () => {
    await act(async () => {
      root.render(
        <OutlineStandardWorkflowPanel
          intentPhase="generation"
          isRunning
          toolCalls={sampleCalls}
        />,
      )
    })

    expect(host.textContent).toContain("大纲生成工作流")
    expect(host.textContent).toContain("运行中")
    expect(host.textContent).toContain("完成：1/2")
    expect(host.textContent).toContain("工具执行")
    expect(host.innerHTML).toContain("border-sky-200/70")
    expect(host.innerHTML).toContain("bg-sky-50/45")
    expect(host.innerHTML).not.toContain("border-l border-border/80")
    expect(host.textContent).not.toContain("思考 0 段")
    expect(host.textContent).not.toContain("多 Agent 大纲生成")
  })

  it("意图分析阶段使用对应标题，完成后显示完成状态", async () => {
    await act(async () => {
      root.render(
        <OutlineStandardWorkflowPanel
          intentPhase="intent_analysis"
          toolCalls={[{ ...sampleCalls[0], status: "done" }]}
        />,
      )
    })

    expect(host.textContent).toContain("意图分析工作流")
    expect(host.textContent).toContain("完成")
    expect(host.textContent).toContain("完成：1/1")
  })

  it("没有工具、思考或运行状态时不渲染空卡片", async () => {
    await act(async () => {
      root.render(<OutlineStandardWorkflowPanel intentPhase="generation" toolCalls={[]} />)
    })

    expect(host.textContent).toBe("")
  })
})
