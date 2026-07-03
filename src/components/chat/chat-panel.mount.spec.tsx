// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { renderChatPanel } from "@/test/chat-panel-mount"

describe("ChatPanel mount 基础设施", () => {
  it("基础渲染：chat-panel mount 成功并显示空会话入口", async () => {
    const view = await renderChatPanel()

    expect(view.container.textContent).toContain("novel.chat.startNewConversation")

    await view.unmount()
  })

  it("Agent skill 配置为空时仍可打开 ChatPanel", async () => {
    const view = await renderChatPanel({ agentSkillConfig: null })

    expect(view.container.textContent).toContain("novel.chat.startNewConversation")

    await view.unmount()
  })

  it.todo("PrePlugin 链触发：发送消息后 pipeline 执行")
  it.todo("Stage C 对话框：standard 模式 chapter_plan 触发对话框")
  it.todo("Stage C 跳过：fast 模式直接生成正文")
  it.todo("Stage D 自检：章节写完后 PostWriteCheck 写入 trace")
  it.todo("Stage D 降级：无模型时降级到规则检查")
  it.todo("断点恢复：检测到断点弹对话框")
})
