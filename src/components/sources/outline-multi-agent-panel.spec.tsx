import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { OutlineMultiAgentRunState } from "@/stores/outline-chat-store"
import { OutlineMultiAgentPanel } from "./outline-multi-agent-panel"

describe("OutlineMultiAgentPanel", () => {
  it("展示多 Agent 总状态、子 Agent 任务、Skill、摘要和回退原因", () => {
    const run: OutlineMultiAgentRunState = {
      mode: "single-agent-fallback",
      status: "fallback",
      maxConcurrency: 3,
      fallbackReason: "多 Agent 失败数量超过阈值：2/3",
      failureDetails: ["题材 Agent：结构化输出 JSON 解析失败"],
      agents: [
        {
          id: "outline-agent",
          name: "大纲 Agent",
          kind: "outline",
          skillNames: ["outline-master-builder"],
          taskPrompt: "负责主线结构、卷纲和章节骨架。",
          status: "done",
          summary: "已完成主线大纲骨架。",
        },
        {
          id: "topic-agent",
          name: "题材 Agent",
          kind: "topic",
          skillNames: ["male-xuanhuan-xianxia"],
          taskPrompt: "负责题材卖点、爽点和读者预期。",
          status: "error",
          error: "结构化输出 JSON 解析失败",
        },
      ],
      merge: {
        status: "skipped",
        summary: "已回退为单 Agent 生成。",
      },
    }

    const html = renderToStaticMarkup(<OutlineMultiAgentPanel run={run} />)

    expect(html).toContain("多 Agent 大纲生成")
    expect(html).toContain("已回退")
    expect(html).toContain("最大并发：3")
    expect(html).toContain("大纲 Agent")
    expect(html).toContain("负责主线结构、卷纲和章节骨架。")
    expect(html).toContain("outline-master-builder")
    expect(html).toContain("已完成主线大纲骨架。")
    expect(html).toContain("题材 Agent")
    expect(html).toContain("male-xuanhuan-xianxia")
    expect(html).toContain("结构化输出 JSON 解析失败")
    expect(html).toContain("回退原因")
    expect(html).toContain("多 Agent 失败数量超过阈值：2/3")
    expect(html).toContain("题材 Agent：结构化输出 JSON 解析失败")
  })
  it("显示等待和重试状态，不显示槽位", () => {
    const run: OutlineMultiAgentRunState = {
      mode: "multi-agent",
      status: "running",
      maxConcurrency: 3,
      agents: [
        {
          id: "waiting-agent",
          name: "人物关系 Agent",
          kind: "character",
          skillNames: ["人物设计"],
          taskPrompt: "等待世界观 Agent 完成",
          status: "waiting",
        },
        {
          id: "retry-agent",
          name: "伏笔审查 Agent",
          kind: "foreshadowing",
          skillNames: ["伏笔审查"],
          taskPrompt: "审查伏笔回收",
          status: "retrying",
          retryCount: 1,
        },
      ],
      merge: { status: "pending" },
    }

    const html = renderToStaticMarkup(<OutlineMultiAgentPanel run={run} />)
    expect(html).toContain("等待中")
    expect(html).toContain("重试中")
    expect(html).toContain("（1/1）")
    expect(html).not.toContain("槽位")
  })

})
