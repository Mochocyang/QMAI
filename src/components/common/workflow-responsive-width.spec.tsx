import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
}

describe("普通 AI 会话与 AI 大纲思考流程框宽度", () => {
  it("共享工作流与事件流根容器全宽、可收缩且隐藏横向溢出", () => {
    const workflow = source("../chat/agent-workflow-panel.tsx")
    const eventStream = source("./event-stream.tsx")
    expect(workflow).toContain("w-full min-w-0 max-w-full overflow-hidden")
    expect(eventStream).toContain("relative w-full min-w-0 max-w-full overflow-x-hidden")
    expect(eventStream).toContain("w-full min-w-0 max-w-full")
    expect(eventStream).toContain("overflow-x-hidden overflow-y-auto")
  })

  it("普通 AI 消息列全宽且不会被长内容撑开", () => {
    const panel = source("../chat/chat-panel.tsx")
    expect(panel).toContain("min-w-0 flex-1 overflow-y-auto overflow-x-hidden")
    expect(panel).toContain("flex w-full min-w-0 max-w-full flex-col")
  })

  it("AI 大纲仅用户气泡使用内容宽度，助手工作流始终占满消息列", () => {
    const panel = source("../sources/outline-chat-panel.tsx")
    expect(panel).toContain("h-full w-full min-w-0 max-w-full")
    expect(panel).toContain("flex w-full min-w-0 max-w-full")
    expect(panel).toContain('msg.role === "user" ? "w-fit max-w-full lg:max-w-[50vw]" : "w-full min-w-0 max-w-full"')
  })
})
