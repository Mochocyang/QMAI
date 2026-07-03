import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "chat-panel.tsx"), "utf8")
const chatStoreSource = readFileSync(resolve(__dirname, "../../stores/chat-store.ts"), "utf8")

describe("chat-panel de-AI skill handling", () => {
  it("loads the chat de-AI skill safely and surfaces a warning without aborting send", () => {
    expect(source).toContain("loadEffectiveDeAiSkillSafely")
    expect(source).toContain("deAiSkillWarning")
    expect(source).toContain("deAiSkillWarningMessage")
    expect(source).toContain("setDeAiSkillWarningMessage(deAiSkillWarning)")
    expect(source).not.toContain("setChapterSaveStatus(deAiSkillWarning)")
  })

  it("uses an icon-only de-AI skill trigger in the chat input toolbar", () => {
    expect(source).toContain("<DeAiSkillPicker")
    expect(source).toContain("iconOnly")
  })

  it("uses an icon-only accent new conversation button", () => {
    expect(source).toContain("qmai-new-conversation-button")
    expect(source).toContain('aria-label={t(novelMode ? "novel.chat.newChat" : "chat.newChat")}')
    expect(source).not.toContain('          {t(novelMode ? "novel.chat.newChat" : "chat.newChat")}')
  })
})

describe("chat-panel agent reference integration", () => {
  it("replaces the legacy chat input with the reference input and picker", () => {
    expect(source).toContain("<ReferenceInput")
    expect(source).toContain("<ReferencePickerDialog")
    expect(source).toContain("insertTokensRef")
    expect(source).not.toContain("<ChatInput")
    expect(source).not.toContain('from "./chat-input"')
  })

  it("routes sends through AgentRunner and stores reference/tool metadata", () => {
    expect(source).toContain("useAgentConfig")
    expect(source).toContain("new AgentRunner()")
    expect(source).toContain("attachedReferences")
    expect(source).toContain("isAgentRunning")
    expect(source).toContain("agentToolCalls")
    expect(source).toContain("当前模型不支持工具调用，已切换为普通对话模式")
  })

  it("scopes reference input drafts to the active conversation", () => {
    expect(source).toContain("setConversationInputDraft")
    expect(source).toContain("getReferenceTokensForConversation")
    expect(source).toContain("setReferenceTokensForConversation")
    expect(source).not.toContain('const [referenceText, setReferenceText] = useState("")')
    expect(source).not.toContain("const [currentTokens, setCurrentTokens] = useState<ReferenceToken[]>([])")
  })

  it("stores successful Agent read tool calls as assistant message references", () => {
    expect(source).toContain("agentToolCallsToMessageReferences")
    expect(source).toContain("references:")
  })

  it("keeps model and stop controls in the reference input footer", () => {
    expect(source).toContain("rightControls={")
    expect(source).toContain("<ChatModelSelector")
    expect(source).toContain("isStreaming={isStreaming}")
    expect(source).toContain("onStop={handleStop}")
  })

  it("consumes externally queued reference tokens into the active chat draft", () => {
    expect(source).toContain("pendingReferenceTokens")
    expect(source).toContain("consumePendingReferenceTokens")
    expect(source).toContain("setReferenceTokensForConversation(drafts, targetConversationId")
  })

  it("keeps chapter-generation replies limited to chapter body", () => {
    expect(source).toContain("章节生成、续写或改写任务的最终回复必须只包含章节正文")
    expect(source).toContain("不要输出读取说明、执行总结、完成目标表格、章节结构、后续建议")
  })

  it("uses the three-level AI workflow mode instead of a single deep mode prompt", () => {
    expect(source).toContain("aiWorkflowMode")
    expect(source).toContain("setAiWorkflowMode")
    expect(source).toContain("快速模式")
    expect(source).toContain("标准模式")
    expect(source).toContain("严格模式")
    expect(source).not.toContain("用户已开启深度模式，请在必要时进行更完整的章节规划和资料读取。")
  })

  it("disables model reasoning and reserves enough output tokens for chapter generation", () => {
    expect(source).toContain("chapterGenerationRequestOverrides")
    expect(source).toContain('reasoning: { mode: "off" as const }')
    expect(source).toContain("max_tokens: chapterGenerationLengthSpec.maxOutputTokens")
    expect(source).toContain('effectiveTaskRoute.intent === "write_chapter"')
    expect(source).toContain('effectiveTaskRoute.intent === "continue_chapter"')
    expect(source).toContain('effectiveTaskRoute.intent === "rewrite_chapter"')
  })

  it("shows the sent chat message before asynchronous chapter context building", () => {
    const appendIndex = source.indexOf("appendAgentChatMessages(capturedConvId, plainText, tokens)")
    const prePluginIndex = source.indexOf("await runNovelPrePluginChain({")

    expect(appendIndex).toBeGreaterThan(-1)
    expect(prePluginIndex).toBeGreaterThan(-1)
    expect(appendIndex).toBeLessThan(prePluginIndex)
  })

  it("downgrades low-confidence clarification requests to normal chat without a dialog", () => {
    expect(source).toContain("let prePluginResult")
    expect(source).toContain('prePluginResult && prePluginResult.stopReason === "clarification_needed"')
    expect(source).toContain("effectiveTaskRoute = null")
    expect(source).toContain("contextPack = prePluginResult.contextPack || null")
    expect(source).not.toContain("IntentClarificationDialog")
    expect(source).not.toContain("requestClarification")
  })

  it("keeps low-information general chat out of the novel context loading chain", () => {
    expect(source).toContain("shouldRunNovelPrePluginChain")
    expect(source).toContain('rawTaskRoute.intent !== "general_chat"')
    expect(source).toContain("const taskRoute = shouldRunNovelPrePluginChain ? rawTaskRoute : null")

    const guardIndex = source.indexOf("const shouldRunNovelPrePluginChain")
    const runIndex = source.indexOf("await runNovelPrePluginChain({")
    const virtualRouteIndex = source.indexOf("if (novelMode && effectiveTaskRoute)")

    expect(guardIndex).toBeGreaterThan(-1)
    expect(runIndex).toBeGreaterThan(-1)
    expect(virtualRouteIndex).toBeLessThan(runIndex)
  })

  it("passes workflow mode and available skills into the novel pre-plugin chain", () => {
    expect(source).toContain("deAiSkillToUserSkill")
    expect(source).toContain("const availableAgentSkills")
    expect(source).toContain("agentWritingSkills")
    expect(source).toContain("aiWorkflowMode,")
    expect(source).toContain("availableSkills: availableAgentSkills")
  })

  it("passes MCP capabilities from agent config into the novel pre-plugin chain", () => {
    expect(source).toContain("mcpCapabilities: _agentMcpCapabilities")
  })

  it("adds selected skill prompts from the pre-plugin result into the agent system prompt", () => {
    expect(source).toContain("buildSelectedSkillsPrompt")
    expect(source).toContain("prePluginResult?.selectedSkills")
    expect(source).toContain("selectedSkillsPrompt")
  })

  it("requires external search requests to use web_search instead of pretending", () => {
    expect(source).toContain("web_search")
    expect(source).toContain("不得声称已经搜索")
    expect(source).toContain("未使用联网资料")
  })

  it("records web_search tool results into context trace", () => {
    expect(source).toContain("appendWebSearchTrace")
    expect(source).toContain('event.name !== "web_search"')
    expect(source).toContain("webSearches")
  })

  it("records result protocol validation into context trace", () => {
    expect(source).toContain("buildResultProtocolTrace")
    expect(source).toContain("resultProtocol:")
  })

  it("settles running tool calls when the agent session finishes", () => {
    expect(source).toContain("settleRunningAgentToolCalls")
    expect(source).toContain("settleRunningAgentToolCalls(record?.toolCalls.length ? record.toolCalls : message.agentToolCalls")
    expect(source).toContain('settleRunningAgentToolCalls(message.agentToolCalls, "error"')
  })

  it("routes continue-unfinished normal path through AgentRunner", () => {
    const continueIndex = source.indexOf("const handleContinueUnfinished")
    const agentRunnerIndex = source.indexOf("new AgentRunner().run(")
    const streamChatIndex = source.indexOf("await streamChat(")

    expect(continueIndex).toBeGreaterThan(-1)
    expect(agentRunnerIndex).toBeGreaterThan(-1)
    expect(streamChatIndex === -1 || agentRunnerIndex < streamChatIndex).toBe(true)
  })

  it("routes continue-unfinished context loading through the novel pre-plugin chain", () => {
    const continueIndex = source.indexOf("const handleContinueUnfinished")
    const chainIndex = source.indexOf("runNovelPrePluginChain({")
    const promptIndex = source.indexOf("contextPackToPrompt")

    expect(continueIndex).toBeGreaterThan(-1)
    expect(chainIndex).toBeGreaterThan(-1)
    expect(chainIndex).toBeLessThan(promptIndex)
  })

  it("validates chapter content before confirming draft saves", () => {
    const confirmIndex = source.indexOf("const handleConfirmToolSave")
    const validationIndex = source.indexOf("validateChapterBeforeSave", confirmIndex)
    const confirmDraftIndex = source.indexOf("confirmDraft(project.path", confirmIndex)

    expect(confirmIndex).toBeGreaterThan(-1)
    expect(validationIndex).toBeGreaterThan(confirmIndex)
    expect(validationIndex).toBeLessThan(confirmDraftIndex)
  })
})

describe("chat-panel chapter plan confirm integration (Stage C)", () => {
  it("imports ChapterPlanConfirmDialog and helper functions", () => {
    expect(source).toContain("ChapterPlanConfirmDialog")
    expect(source).toContain("extractChapterPlan")
    expect(source).toContain("buildPlanConfirmMessage")
    expect(source).toContain("buildPlanSkipMessage")
    expect(source).toContain('from "./chapter-plan-confirm-dialog"')
  })

  it("declares pendingChapterPlan state with planContent, fullContent and conversationId", () => {
    expect(source).toContain("pendingChapterPlan")
    expect(source).toContain("planContent")
    expect(source).toContain("fullContent")
    expect(source).toContain("conversationId")
    expect(source).toContain("chapterPlanResolverRef")
  })

  it("provides closeChapterPlanDialog and requestChapterPlanConfirm helpers", () => {
    expect(source).toContain("closeChapterPlanDialog")
    expect(source).toContain("requestChapterPlanConfirm")
    expect(source).toContain('new Promise<"confirm" | "skip" | "cancel" | { modify: string }>')
  })

  it("detects chapter_plan marker inside onDone callback", () => {
    const onDoneIndex = source.indexOf("onDone: () => {")
    expect(onDoneIndex).toBeGreaterThan(-1)

    const afterOnDone = source.slice(onDoneIndex)
    expect(afterOnDone).toContain("extractChapterPlan")
  })

  it("skips chapter plan confirmation in fast mode", () => {
    const onDoneIndex = source.indexOf("onDone: () => {")
    const afterOnDone = source.slice(onDoneIndex)
    expect(afterOnDone).toContain('"fast"')
  })

  it("calls requestChapterPlanConfirm when a plan marker is found", () => {
    const onDoneIndex = source.indexOf("onDone: () => {")
    const afterOnDone = source.slice(onDoneIndex)
    expect(afterOnDone).toContain("requestChapterPlanConfirm")
  })

  it("builds confirm and skip followup messages using the helper functions", () => {
    const onDoneIndex = source.indexOf("onDone: () => {")
    const afterOnDone = source.slice(onDoneIndex)
    expect(afterOnDone).toContain("buildPlanConfirmMessage")
    expect(afterOnDone).toContain("buildPlanSkipMessage")
  })

  it("renders ChapterPlanConfirmDialog in JSX bound to pendingChapterPlan", () => {
    expect(source).toContain("<ChapterPlanConfirmDialog")
    expect(source).toContain("pendingChapterPlan.open")
    expect(source).toContain("pendingChapterPlan.planContent")
  })

  it("wires dialog actions to closeChapterPlanDialog", () => {
    expect(source).toContain('closeChapterPlanDialog("confirm")')
    expect(source).toContain('closeChapterPlanDialog("skip")')
    expect(source).toContain('closeChapterPlanDialog("cancel")')
    expect(source).toContain('closeChapterPlanDialog({ modify:')
  })
})

describe("chat-panel post-write check integration (Stage D)", () => {
  it("imports runPostWriteCheckAI from the post-write-check-ai module", () => {
    expect(source).toContain('import { runPostWriteCheckAI } from "@/lib/agent/plugins/post-write-check-ai"')
  })

  it("declares a Stage D block inside the trace-building section", () => {
    expect(source).toContain("=== Stage D: 写后剧情自检 ===")
  })

  it("scopes the check to write_chapter and continue_chapter tasks only", () => {
    const stageDIndex = source.indexOf("=== Stage D: 写后剧情自检 ===")
    expect(stageDIndex).toBeGreaterThan(-1)
    const stageDBlock = source.slice(stageDIndex, stageDIndex + 1200)
    expect(stageDBlock).toContain('effectiveTaskRoute.intent === "write_chapter"')
    expect(stageDBlock).toContain('effectiveTaskRoute.intent === "continue_chapter"')
    // 不应对 rewrite_chapter 或其他意图触发
    expect(stageDBlock).not.toContain("rewrite_chapter")
  })

  it("reads the final assistant content from the store (same as Stage C)", () => {
    const stageDIndex = source.indexOf("=== Stage D: 写后剧情自检 ===")
    const stageDBlock = source.slice(stageDIndex, stageDIndex + 1200)
    expect(stageDBlock).toContain("useChatStore.getState()")
    expect(stageDBlock).toContain("lastAssistant")
  })

  it("excludes content carrying the chapter_plan marker", () => {
    const stageDIndex = source.indexOf("=== Stage D: 写后剧情自检 ===")
    const stageDBlock = source.slice(stageDIndex, stageDIndex + 1200)
    expect(stageDBlock).toContain('chapterContent.includes("chapter_plan")')
    expect(stageDBlock).toContain("hasChapterPlanMarker")
  })

  it("skips empty content to avoid false reports", () => {
    const stageDIndex = source.indexOf("=== Stage D: 写后剧情自检 ===")
    const stageDBlock = source.slice(stageDIndex, stageDIndex + 1200)
    expect(stageDBlock).toContain("if (chapterContent && !hasChapterPlanMarker)")
  })

  it("writes the check result and meta into contextTrace.contextInfo", () => {
    const stageDIndex = source.indexOf("=== Stage D: 写后剧情自检 ===")
    const stageDBlock = source.slice(stageDIndex, stageDIndex + 2000)
    expect(stageDBlock).toContain("runPostWriteCheckAI({")
    expect(stageDBlock).toContain("postWriteCheck")
    expect(stageDBlock).toContain("postWriteCheckMeta")
    expect(stageDBlock).toContain("setContextInfo(contextTrace,")
  })

  it("places Stage D after result protocol and before finishTrace", () => {
    const traceBlockIndex = source.indexOf("if (contextTrace && effectiveTaskRoute) {")
    expect(traceBlockIndex).toBeGreaterThan(-1)
    const traceBlock = source.slice(traceBlockIndex, traceBlockIndex + 3000)
    const protocolIndex = traceBlock.indexOf("buildResultProtocolTrace")
    const stageDIndex = traceBlock.indexOf("=== Stage D: 写后剧情自检 ===")
    const finishIndex = traceBlock.indexOf('finishTrace(contextTrace, "done")')
    expect(protocolIndex).toBeGreaterThan(-1)
    expect(stageDIndex).toBeGreaterThan(protocolIndex)
    expect(finishIndex).toBeGreaterThan(stageDIndex)
  })

  it("does not block saving: the check only writes to contextTrace, no return or throw", () => {
    const stageDIndex = source.indexOf("=== Stage D: 写后剧情自检 ===")
    const stageDBlock = source.slice(stageDIndex, stageDIndex + 1200)
    // 自检结果仅展示，不应阻止后续保存流程
    expect(stageDBlock).not.toContain("throw ")
    expect(stageDBlock).not.toContain("return")
  })
})

describe("aiWorkflowMode store 读取", () => {
  it("不再使用局部 useState 持有 aiWorkflowMode，改为从 store 读取", () => {
    expect(source).not.toContain("useState<AiWorkflowMode>(DEFAULT_AI_WORKFLOW_MODE)")
    expect(source).toMatch(/useWikiStore\(\(s\) => s\.aiWorkflowMode\)/)
    expect(source).toMatch(/useWikiStore\(\(s\) => s\.setAiWorkflowMode\)/)
  })
})

describe("resolver 卸载清理", () => {
  it("useEffect 卸载钩子中清理 pending resolver", () => {
    expect(source).toMatch(/soulDialogResolverRef\.current = null/)
    expect(source).toMatch(/chapterPlanResolverRef\.current = null/)
    expect(source).toMatch(/return \(\) => \{[\s\S]*?ResolverRef\.current/)
  })
})

describe("SoulDialog 输入框禁用一致性", () => {
  it("pendingSoulDialog.open 时禁用主输入框", () => {
    expect(source).toMatch(/disabled=\{isStreaming \|\| pendingChapterPlan\.open \|\| pendingSoulDialog\.open\}/)
  })
})

describe("Stage D AI 推理集成", () => {
  it("import runPostWriteCheckAI 替代 runPostWriteCheck", () => {
    expect(source).toContain("runPostWriteCheckAI")
    expect(source).not.toMatch(/import \{ runPostWriteCheck \} from/)
  })

  it("异步调用 runPostWriteCheckAI 并写入 postWriteCheckMeta", () => {
    expect(source).toMatch(/runPostWriteCheckAI\(\{/)
    expect(source).toMatch(/postWriteCheckMeta/)
  })
})

describe("Stage F 断点恢复", () => {
  it("chat-store 缓存 lastBreakpoint", () => {
    expect(chatStoreSource).toContain("lastBreakpoint")
    expect(chatStoreSource).toContain("setLastBreakpoint")
  })

  it("挂载时调用 loadTaskBreakpoint", () => {
    expect(source).toContain("loadTaskBreakpoint")
    expect(source).toMatch(/loadTaskBreakpoint\(projectPath\)/)
  })

  it("检测到断点时弹确认对话框", () => {
    expect(source).toContain("检测到上次有未完成的任务")
    expect(source).toContain("breakpointResumeOpen")
    expect(source).toContain("<ModifyConfirmDialog")
  })

  it("用户确认时调用 buildBreakpointResumePrompt 并发送恢复内容", () => {
    expect(source).toContain("buildBreakpointResumePrompt")
    expect(source).toContain("breakpointResumeContent")
    expect(source).toContain("handleSendRef.current(breakpointResumeContent")
  })
})
