import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { getNextChatExpanded } from "./chat-layout"

const chatPanelSource = readFileSync(resolve(__dirname, "..", "chat", "chat-panel.tsx"), "utf8")
const previewPanelSource = readFileSync(resolve(__dirname, "preview-panel.tsx"), "utf8")

describe("chat layout", () => {
  it("左侧主导航 AI会话按钮可以切换打开和关闭", () => {
    expect(getNextChatExpanded(false)).toBe(true)
    expect(getNextChatExpanded(true)).toBe(false)
  })

  it("预览面板源碼包含 handleDeAiSaveDraft 表明另存草稿存在", () => {
    expect(previewPanelSource).toContain("handleDeAiSaveDraft")
  })

  it("发送消息时接入去AI味默认模式", () => {
    expect(chatPanelSource).toContain("injectDeAiDirective")
    expect(chatPanelSource).toContain("deAiMode")
  })

  it("章节生成类对话会接入 QM-QUAI skill", () => {
    expect(chatPanelSource).toContain("buildQmQuaiSystemPrompt")
    expect(chatPanelSource).toContain("routeTask")
    expect(chatPanelSource).toContain("effectiveTaskRoute")
    expect(chatPanelSource).toContain('effectiveTaskRoute.intent === "write_chapter"')
    expect(chatPanelSource).toContain('effectiveTaskRoute.intent === "continue_chapter"')
    expect(chatPanelSource).toContain('effectiveTaskRoute.intent === "rewrite_chapter"')
  })

  it("小说写作不再弹出角色灵魂确认窗口", () => {
    expect(chatPanelSource).not.toContain("pendingSoulDialog")
    expect(chatPanelSource).not.toContain("本次写作将注入角色灵魂上下文")
    expect(chatPanelSource).not.toContain("requestSoulDialog")
    expect(chatPanelSource).toContain("pendingChapterPlan")
    expect(chatPanelSource).toContain("ChapterPlanConfirmDialog")
    expect(chatPanelSource).not.toContain("window.confirm")
  })

  it("预览面板中去AI味按钮出现在AI会话按钮后面", () => {
    const aiSessionIdx = previewPanelSource.indexOf("AI会话")
    const deAiIdx = previewPanelSource.lastIndexOf("去AI味")
    expect(aiSessionIdx).toBeGreaterThan(-1)
    expect(deAiIdx).toBeGreaterThan(-1)
    expect(deAiIdx).toBeGreaterThan(aiSessionIdx)
  })

  it("去AI味按钮点击后打开 Skill 选择，不再显示旧下拉菜单项", () => {
    expect(previewPanelSource).toContain("openDeAiSkillPicker")
    expect(previewPanelSource).toContain("openDeAiSkillPicker(null, e.currentTarget)")
    expect(previewPanelSource).toContain("选择去AI味技能")
    expect(previewPanelSource).not.toContain("处理当前内容")
    expect(previewPanelSource).not.toContain("设为默认")
  })
})
