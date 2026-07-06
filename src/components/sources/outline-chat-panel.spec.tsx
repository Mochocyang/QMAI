import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "outline-chat-panel.tsx"), "utf8")
const outlineGenerationSource = readFileSync(resolve(__dirname, "../../lib/novel/outline-generation.ts"), "utf8")

describe("OutlineChatPanel controls", () => {
  it("uses the shared accent new conversation button style", () => {
    expect(source).toContain("qmai-new-conversation-button")
    expect(source).toContain('aria-label="新建大纲对话"')
    expect(source).not.toContain("border-emerald-300")
    expect(source).not.toContain("bg-emerald-50")
    expect(source).not.toContain("text-emerald-700")
  })

  it("uses the same top conversation/history split as AI chat", () => {
    expect(source).toContain("splitConversationToolbarItems")
    expect(source).toContain("topConversations")
    expect(source).toContain("historyConversations")
    expect(source).toContain("qmai-outline-history-button")
    expect(source).toContain('aria-label="大纲会话历史"')
    expect(source).not.toContain("conversations.map((conv) => (")
  })

  it("passes confirm and reject handlers into the outline tool workflow", () => {
    expect(source).toContain("handleConfirmToolSave")
    expect(source).toContain("handleRejectTool")
    expect(source).toContain("createWriteOutlineNodeTool")
    expect(source).toContain("onConfirmToolSave={handleConfirmToolSave}")
    expect(source).toContain("onRejectTool={handleRejectTool}")
    expect(source).toContain("onConfirmSave={onConfirmToolSave}")
    expect(source).toContain("onReject={onRejectTool}")
  })

  it("uses the shared reference input and picker for @ references", () => {
    expect(source).toContain("ReferenceInput")
    expect(source).toContain("ReferencePickerDialog")
    expect(source).toContain("InsertReferenceTokens")
    expect(source).toContain("outlineReferenceTokens")
    expect(source).toContain("onAtTrigger={() => setReferencePickerOpen(true)}")
    expect(source).toContain("onSubmit={handleSend}")
    expect(source).not.toContain("<ChatInput")
    expect(source).not.toContain('from "@/components/chat/chat-input"')
  })

  it("keeps dock controls before outline generation and model selection around the reference input", () => {
    expect(source).toContain("qmai-outline-bottom-left-controls")
    expect(source).toContain("<ChatDockControls />")
    expect(source).toContain("<OutlineGenerationMenu")
    expect(source).toContain("<ChatModelSelector")

    const dockIndex = source.indexOf("<ChatDockControls />")
    const outlineIndex = source.indexOf("<OutlineGenerationMenu")
    const modelIndex = source.indexOf("<ChatModelSelector")

    expect(dockIndex).toBeGreaterThan(-1)
    expect(outlineIndex).toBeGreaterThan(dockIndex)
    expect(modelIndex).toBeGreaterThan(outlineIndex)
  })

  it("renders outline generation from an icon button and keeps the menu backed by existing configs", () => {
    expect(source).toContain("ListPlus")
    expect(source).toContain('aria-label="生成大纲模块"')
    expect(source).toContain("qmai-outline-generation-menu")
    expect(source).toContain('className="qmai-outline-generation-menu fixed')
    expect(source).toContain("OUTLINE_SECTION_GENERATION_CONFIGS.map")
    expect(source).toContain("onGenerate(config.title, config.requestHint)")
    expect(source).toContain("onGenerate={handleGenerateSection}")
  })

  it("adds selected references to the outline agent request instead of only storing chips", () => {
    expect(source).toContain("buildOutlineAgentUserContent")
    expect(source).toContain("本条消息附带的 @ 引用")
    expect(source).toContain("请优先使用工具读取引用内容")
  })

  it("routes outline chat sends through AgentRunner with built-in tools", () => {
    expect(source).toContain("AgentRunner")
    expect(source).toContain("buildAgentConfig")
    expect(source).toContain("ToolRegistry")
    expect(source).toContain("read_outline")
    expect(source).toContain("read_chapter")
    expect(source).toContain("read_memory")
    expect(source).toContain("read_deduction")
    expect(source).not.toContain("runDeepOutlineGeneration(")
  })

  it("settles running outline tool calls when generation finishes", () => {
    expect(source).toContain("settleRunningAgentToolCalls")
    expect(source).toMatch(/settleRunningAgentToolCalls\(\s*record\.toolCalls\.length\s*\?\s*record\.toolCalls\s*:\s*message\.agentToolCalls/s)
    expect(source).toMatch(/settleRunningAgentToolCalls\(\s*message\.agentToolCalls,\s*"error"/s)
  })

  it("uses an outline-only tool set that cannot write chapters or memory", () => {
    expect(source).toContain("OUTLINE_CHAT_DISABLED_TOOLS")
    expect(source).toContain('"write_chapter"')
    expect(source).toContain('"write_memory"')
    expect(source).toContain("disabledTools: OUTLINE_CHAT_DISABLED_TOOLS")
    expect(source).toContain("需要保存大纲时只能使用 write_outline_node")
  })

  it("keeps outline reference chips as tool-readable hints instead of preloading file contents", () => {
    expect(source).toContain("buildOutlineAgentUserContent")
    expect(source).toContain("请优先使用工具读取引用内容")
    expect(source).not.toContain("loadReferenceTokenContext(tokens)")
  })

  it("renders sent @ references in outline chat user messages", () => {
    expect(source).toContain('import { ReferenceChip } from "@/components/reference/ReferenceChip"')
    expect(source).toContain("msg.attachedReferences")
    expect(source).toContain("<ReferenceChip")
    expect(source).toContain("readonly")
  })

  it("forces outline chat through a dedicated list-read-analyze-generate workflow", () => {
    expect(source).toContain("## AI大纲固定分析流程")
    expect(source).toContain("先调用 list_outlines、list_chapters、list_memories、list_deductions")
    expect(source).toContain("再调用 read_outline、read_chapter、read_memory、read_deduction")
    expect(source).toContain("分析冲突、缺口、伏笔、角色动机和章节承接")
    expect(source).toContain("最后再生成大纲建议")
  })

  it("routes every outline generation menu item through the PRD 3.1 content workflow", () => {
    expect(source).toContain("buildOutlineSectionGenerationPrompt")
    expect(source).toContain("## AI大纲生成工作流")
    expect(source).toContain("提取请求关键词")
    expect(source).toContain("识别用户意图")
    expect(source).toContain("提取对小说创作有用的关键内容")
    expect(source).toContain("结合用户要用的 skill + soul.md 约束")
    expect(source).toContain("最终回复只输出大纲标题和大纲正文")
    expect(source).toContain("禁止输出工具调用报告、分析过程、完成报告、下一步行动")

    for (const title of ["章节细纲", "人物小传", "组织势力设定", "金手指与能力体系", "伏笔计划", "地点设定"]) {
      expect(outlineGenerationSource).toContain(title)
    }
  })

  it("lets outline chat bubbles expand to half of the window without overflowing narrow panels", () => {
    expect(source).toContain("lg:max-w-[50vw]")
    expect(source).toContain("max-w-full")
    expect(source).not.toContain("max-w-[85%]")
  })
})
