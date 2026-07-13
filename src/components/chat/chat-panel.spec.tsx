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

  it("uses a skill library trigger instead of the old de-AI-only label in the chat input toolbar", () => {
    expect(source).toContain("<DeAiSkillPicker")
    expect(source).toContain('buttonLabel="技能库"')
    expect(source).not.toContain('title="当前启用的 Skill"')
    expect(source).not.toContain('aria-label="当前启用的 Skill"')
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

  it("routes sends through runAiChatSession and stores reference/tool metadata", () => {
    expect(source).toContain("useAgentConfig")
    expect(source).toContain("runAiChatSession")
    expect(source).toContain("attachedReferences")
    expect(source).toContain("isAgentRunning")
    expect(source).toContain("agentToolCalls")
    expect(source).toContain("当前模型不支持工具调用，已切换为普通对话模式")
  })

  it("delegates AI execution to runAiChatSession", () => {
    expect(source).toContain("runAiChatSession")
    expect(source).not.toContain("if (novelMode && isChapterGenerationRouteIntent(effectiveTaskRoute?.intent))")
    expect(source).not.toContain("const result = await runDeepChapterGeneration(")
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

  it("uses three AI workflow modes instead of a single deep mode prompt", () => {
    expect(source).toContain("aiWorkflowMode")
    expect(source).toContain("setAiWorkflowMode")
    expect(source).toContain("快速模式")
    expect(source).toContain("标准模式")
    expect(source).toContain("严格模式")
    expect(source).toContain('label: "标准"')
    expect(source).toContain('mode: "standard"')
    expect(source).not.toContain("用户已开启深度模式，请在必要时进行更完整的章节规划和资料读取。")
  })

  it("shows route descriptions in the workflow mode menu", () => {
    expect(source).toContain("description: \"普通对话")
    expect(source).toContain("description: \"轻量直出")
    expect(source).toContain("description: \"完整质检")
    expect(source).toContain("快速模式像普通对话一样直接出结果")
    expect(source).toContain("读取上下文、生成任务书和正文初稿后直接完成")
    expect(source).toContain("workflowModeDropdownStyle.width")
    expect(source).toContain("routeDescription")
  })

  it("adds visible route and selected skill summaries to the generation process", () => {
    expect(source).toContain("buildWorkflowRouteActivityContent")
    expect(source).toContain("buildSelectedSkillsActivityContent")
    expect(source).toContain("当前执行路线")
    expect(source).toContain("本次启用 Skill")
    expect(source).toContain('kind: "skill_used"')
    expect(source).toContain("prePluginResult?.selectedSkills")
  })

  it("keeps Plan Execute as an independent switch outside fast and strict modes", () => {
    expect(source).toContain("planExecuteEnabled")
    expect(source).toContain("setPlanExecuteEnabled")
    expect(source).toContain("aiSessionPlanExecuteLabel")
    expect(source).toContain("计划")
    expect(source).toContain("aria-pressed={planExecuteEnabled && aiWorkflowMode !== \"fast\"}")
    expect(source).toContain("disabled={aiWorkflowMode === \"fast\"}")
  })

  it("injects Plan Execute policy only when the independent switch is enabled and not in fast mode", () => {
    expect(source).toContain("buildPlanExecutePolicyPrompt")
    expect(source).toContain("options.planExecuteEnabled && options.aiWorkflowMode !== \"fast\"")
    expect(source).toContain("run_chapter_workflow")
    expect(source).not.toContain("标准模式：复杂小说任务先给出简短计划")
    expect(source).not.toContain("严格模式：复杂小说任务必须先规划")
  })

  it("makes fast mode behave like ordinary chat without automatic skill or review loop", () => {
    expect(source).toContain("快速模式：像普通对话一样直接出结果")
    expect(source).toContain("不自动启用 Skill")
    expect(source).toContain("不走多任务写作循环")
    expect(source).toContain("不分析剧情走向")
    expect(source).toContain("标准模式：读取上下文，生成任务书和正文初稿后直接完成，不做正文后审核。")
  })

  it("keeps configured reasoning without imposing an app-side output token cap for chapter generation", () => {
    expect(source).not.toContain("chapterGenerationRequestOverrides")
    expect(source).not.toContain('reasoning: { mode: "off" as const }')
    expect(source).not.toContain("max_tokens: chapterGenerationLengthSpec.maxOutputTokens")
    expect(source).toContain('effectiveTaskRoute.intent === "write_chapter"')
    expect(source).toContain('effectiveTaskRoute.intent === "continue_chapter"')
    expect(source).toContain('effectiveTaskRoute.intent === "rewrite_chapter"')
  })

  it("routes chapter writing tasks through the ReAct session runner", () => {
    const sessionRunnerIndex = source.indexOf("runAiChatSession({")
    const directResultIndex = source.indexOf("const result = await runDeepChapterGeneration(")

    expect(sessionRunnerIndex).toBeGreaterThan(-1)
    expect(directResultIndex).toBe(-1)
    expect(source).toContain("aiWorkflowMode,")
  })

  it("does not bypass ReAct for chapter workflow execution", () => {
    expect(source).toContain("runAiChatSession")
    expect(source).toContain("run_chapter_workflow")
    expect(source).not.toContain("const result = await runDeepChapterGeneration(")
    expect(source).not.toContain("onWorkflowEvent: (event)")
  })

  it("maps ReAct tool events into visible agent tool calls", () => {
    expect(source).toContain("onToolEvent: (event)")
    expect(source).toContain("applyAgentToolEvent(message.agentToolCalls, event)")
    expect(source).not.toContain("chapterWorkflowEventToAgentToolEvent")
    expect(source).toContain('settleRunningAgentToolCalls(message.agentToolCalls, "error"')
  })

  it("settles visible agent stages when a session finishes, errors, or is stopped", () => {
    expect(source).toContain("settleRunningAgentStages")
    expect(source).toContain('settleRunningAgentStages(message.agentStages, "done"')
    expect(source).toContain('settleRunningAgentStages(message.agentStages, "error"')
    expect(source).toContain('settleRunningAgentStages(message.agentStages, "cancelled"')
  })

  it("shows the sent chat message before asynchronous chapter context building", () => {
    const appendIndex = source.indexOf("appendAgentChatMessages(capturedConvId, userVisibleText || plainText, tokens)")
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

    const guardIndex = source.lastIndexOf("const shouldRunNovelPrePluginChain")
    const runIndex = source.indexOf("await runNovelPrePluginChain({")
    const guardedRunIndex = source.indexOf("if (shouldRunNovelPrePluginChain && effectiveTaskRoute)")

    expect(guardIndex).toBeGreaterThan(-1)
    expect(runIndex).toBeGreaterThan(-1)
    expect(guardedRunIndex).toBeGreaterThan(guardIndex)
    expect(guardedRunIndex).toBeLessThan(runIndex)
  })

  it("does not run the novel pre-plugin chain in fast mode even when Plan Execute is enabled", () => {
    expect(source).toContain("aiWorkflowMode !== \"fast\" && planExecuteEnabled")
    const planExecuteActiveMatch = source.match(/planExecuteActive\s*=/)
    expect(planExecuteActiveMatch).not.toBeNull()
    const planExecuteActiveLine = source.slice(
      (planExecuteActiveMatch?.index ?? 0),
      (planExecuteActiveMatch?.index ?? 0) + 200,
    )
    expect(planExecuteActiveLine).toContain("aiWorkflowMode !== \"fast\"")
    expect(planExecuteActiveLine).toContain("planExecuteEnabled")
    expect(planExecuteActiveLine).toContain("planExecutionFollowup")
  })

  it("passes workflow mode and available skills into the novel pre-plugin chain", () => {
    expect(source).toContain("deAiSkillToUserSkill")
    expect(source).toContain("const availableAgentSkills")
    expect(source).toContain("agentDeAiSkills")
    expect(source).toContain("agentUserWritingSkills")
    expect(source).toContain("aiWorkflowMode,")
    expect(source).toContain("availableSkills: availableAgentSkills")
  })

  it("passes Plan Execute mode into the novel pre-plugin chain and consumes its final prompt", () => {
    expect(source).toContain("planExecuteEnabled,")
    expect(source).toContain("planExecuteEnabled: planExecuteActive")
    expect(source).toContain("if (!hasAgentError && planExecuteActive)")
    expect(source).toContain("prePluginResult?.finalSystemPrompt")
    expect(source).toContain("prePluginSystemPrompt")
  })

  it("does not show the character soul confirmation dialog in any workflow mode", () => {
    expect(source).not.toContain("pendingSoulDialog")
    expect(source).not.toContain("requestSoulDialog")
    expect(source).not.toContain("本次写作将注入角色灵魂上下文")
  })

  it("passes MCP capabilities from agent config into the novel pre-plugin chain", () => {
    expect(source).toContain("mcpCapabilities: agentMcpCapabilities")
    expect(source).not.toContain("mcpCapabilities: ([] as any[])")
    expect(source).not.toContain("mcpCapabilities: _agentMcpCapabilities")
  })

  it("passes selected capability tool names into the session runner for tool scoping", () => {
    expect(source).toContain("enabledToolNames: prePluginResult?.enabledToolNames")
    expect(source).not.toContain('import { scopeAgentConfigTools } from "@/lib/agent/tool-scope"')
    expect(source).not.toContain("scopeAgentConfigTools(agentConfig, prePluginResult?.enabledToolNames)")
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
    expect(source).not.toContain("const _settlePattern")
    expect(source).toContain("agentToolCalls: settleRunningAgentToolCalls(record?.toolCalls.length ? record.toolCalls : message.agentToolCalls)")
    expect(source).toContain('agentToolCalls: settleRunningAgentToolCalls(message.agentToolCalls, "error")')
  })

  it("settles visible tool calls when generation is cancelled from any chat confirmation path", () => {
    expect(source).toContain('agentToolCalls: settleRunningAgentToolCalls(message.agentToolCalls, "cancelled")')
    expect(source).toContain("已取消计划，未进入正文生成。")
    expect(source).toContain("已停止生成。")
  })

  it("routes normal agent sends through runAiChatSession", () => {
    const continueIndex = source.indexOf("const handleContinueUnfinished")
    const sessionRunnerIndex = source.indexOf("runAiChatSession({")

    expect(continueIndex).toBeGreaterThan(-1)
    expect(sessionRunnerIndex).toBeGreaterThan(-1)
    expect(source).not.toContain("await streamChat(")
  })

  it("passes the confirmed blueprint and captured conversation to the scoped followup run", () => {
    expect(source).toContain(
      'handleSendRef.current(followupText, [], "执行已确认计划", confirmedBlueprint, capturedConvId)',
    )
    expect(source).not.toContain("confirmedBlueprintRef")
  })

  it("routes continue-unfinished through the ReAct send path with compact display text", () => {
    const continueIndex = source.indexOf("const handleContinueUnfinished")

    expect(continueIndex).toBeGreaterThan(-1)
    expect(source).toContain('handleSendRef.current(prompt, [], "继续未完成")')
    expect(source).not.toContain('await import("@/lib/novel/deep-chapter-generation")')
    expect(source).not.toContain("await runDeepChapterGeneration(")
  })

  it("does not include write tool confirmation handlers (write tools disabled)", () => {
    expect(source).not.toContain("const handleConfirmToolSave")
    expect(source).not.toContain("extractDraftIdFromWritePreview")
    expect(source).not.toContain("confirmDraft(project.path, draftId")
    expect(source).not.toContain("onConfirmToolSave={handleConfirmToolSave}")
    expect(source).not.toContain("onRejectTool={handleRejectTool}")
  })

  it("keeps up to three working or today's conversations in the top toolbar and moves the rest into history", () => {
    expect(source).toContain("splitConversationToolbarItems")
    expect(source).toContain("isStreamingConversation")
    expect(source).toContain("topConversations")
    expect(source).toContain("historyConversations")
    expect(source).toContain("topConversations.map((conv) => renderConversationChip(conv))")
    expect(source).not.toContain("historyConversations = sorted.filter((conv) => conv.id !== activeConversationId)")
  })

  it("pins the conversation history control to the far right of the AI chat toolbar", () => {
    expect(source).toContain('className="relative ml-auto shrink-0"')
    expect(source).toContain("qmai-history-button")
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
    expect(source).toContain("pendingChapterPlans")
    expect(source).toContain("chapterPlanResolversRef")
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

  it("skips chapter plan confirmation when Plan Execute is disabled", () => {
    const runnerIndex = source.indexOf("const record = await runAiChatSession({")
    const afterRunner = source.slice(runnerIndex)
    expect(afterRunner).toContain("if (!hasAgentError && planExecuteActive)")
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

  it("waits for chapter plan confirmation outside the completed stream guard before follow-up execution", () => {
    const runnerIndex = source.indexOf("const record = await runAiChatSession({")
    const finishIndex = source.indexOf("finishAgentSession(() => {", runnerIndex)
    const planConfirmIndex = source.indexOf("await requestChapterPlanConfirm(", runnerIndex)
    const followupIndex = source.indexOf("await handleSendRef.current(followupText", runnerIndex)

    expect(runnerIndex).toBeGreaterThan(-1)
    expect(finishIndex).toBeGreaterThan(runnerIndex)
    expect(planConfirmIndex).toBeGreaterThan(finishIndex)
    expect(followupIndex).toBeGreaterThan(planConfirmIndex)

    const afterPlanConfirm = source.slice(planConfirmIndex, followupIndex)
    expect(afterPlanConfirm).not.toContain("streamSessionGuardRef.current.isActive")
    expect(afterPlanConfirm).not.toContain("setActiveConversation(capturedConvId)")
    expect(afterPlanConfirm).toContain("capturedConvId")
  })

  it("disables Plan Execute protocol for confirmed plan follow-up messages and fast mode", () => {
    expect(source).toContain("isChapterPlanExecutionFollowup")
    expect(source).toContain("aiWorkflowMode !== \"fast\" && planExecuteEnabled && !planExecutionFollowup")
    expect(source).toContain("planExecuteEnabled: planExecuteActive")
  })

  it("renders ChapterPlanConfirmDialog in JSX bound to pendingChapterPlan", () => {
    expect(source).toContain("<ChapterPlanConfirmDialog")
    expect(source).toContain("{pendingChapterPlan &&")
    expect(source).toContain("pendingChapterPlan.planContent")
  })

  it("wires dialog actions to closeChapterPlanDialog", () => {
    expect(source).toContain('closeChapterPlanDialog(pendingChapterPlan.conversationId, "confirm")')
    expect(source).toContain('closeChapterPlanDialog(pendingChapterPlan.conversationId, "skip")')
    expect(source).toContain('closeChapterPlanDialog(pendingChapterPlan.conversationId, "cancel")')
    expect(source).toContain('closeChapterPlanDialog(pendingChapterPlan.conversationId, { modify:')
  })

  it("records a visible cancellation when the chapter plan dialog is cancelled", () => {
    expect(source).toContain("recordChapterPlanExecutionCancelled")
    expect(source).toContain("已取消计划，未进入正文生成。")
    expect(source).toContain("用户取消了章节计划确认")
    expect(source).toContain('settleRunningAgentStages(message.agentStages, "cancelled")')
    expect(source).toContain('if (action === "cancel")')
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

  it("reads the final assistant content from the store before Stage D (shared with format validation)", () => {
    const stageDIndex = source.indexOf("=== Stage D: 写后剧情自检 ===")
    const beforeStageDBlock = source.slice(0, stageDIndex)
    expect(beforeStageDBlock).toContain("useChatStore.getState()")
    expect(beforeStageDBlock).toContain("lastAssistantForValidation")
    expect(beforeStageDBlock).toContain("finalContent = lastAssistantForValidation?.content ??")
    const stageDBlock = source.slice(stageDIndex, stageDIndex + 1200)
    expect(stageDBlock).toContain("const chapterContent = finalContent")
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
  it("useEffect 卸载钩子中清理章节计划 pending resolver", () => {
    expect(source).toContain("Object.values(chapterPlanResolversRef.current)")
    expect(source).toContain("chapterPlanResolversRef.current = {}")
  })
})

describe("章节计划弹窗输入框禁用一致性", () => {
  it("当前会话存在 pendingChapterPlan 时禁用主输入框", () => {
    expect(source).toMatch(/disabled=\{isStreaming \|\| Boolean\(pendingChapterPlan\)\}/)
    expect(source).not.toContain("pendingSoulDialog.open")
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

describe("断点恢复自动弹窗已移除", () => {
  it("chat-store 不再缓存 lastBreakpoint", () => {
    expect(chatStoreSource).not.toContain("lastBreakpoint")
    expect(chatStoreSource).not.toContain("setLastBreakpoint")
  })

  it("ChatPanel 挂载时不再读取断点文件", () => {
    expect(source).not.toContain("loadTaskBreakpoint")
    expect(source).not.toMatch(/loadTaskBreakpoint\(projectPath\)/)
  })

  it("ChatPanel 不再渲染继续未完成任务弹窗", () => {
    expect(source).not.toContain("检测到上次有未完成的任务")
    expect(source).not.toContain("breakpointResumeOpen")
    expect(source).not.toContain("<ModifyConfirmDialog")
  })

  it("ChatPanel 不再发送断点恢复提示词", () => {
    expect(source).not.toContain("buildBreakpointResumePrompt")
    expect(source).not.toContain("breakpointResumeContent")
    expect(source).not.toContain("handleSendRef.current(breakpointResumeContent")
  })
})
