import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Send, X, Download } from "lucide-react"

import { useWikiStore } from "@/stores/wiki-store"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import { extractStoryContent } from "@/lib/novel/story-simulation/story-extractor"
import { generateStoryFramework } from "@/lib/novel/story-simulation/story-framework-generator"
import { buildAgents } from "@/lib/novel/story-simulation/agent-profile-builder"
import {
  runSimulation,
  type SimulationCallbacks,
} from "@/lib/novel/story-simulation/simulation-engine"
import { generateSimulationReport } from "@/lib/novel/story-simulation/simulation-report-agent"
import { generateStoryDraft } from "@/lib/novel/story-simulation/story-draft-generator"
import { saveFramework } from "@/lib/novel/story-simulation/framework-store"
import { resolveDefaultModel } from "@/lib/novel/model-resolver"
import { interviewAgent } from "@/lib/novel/story-simulation/agent-interview"
import { exportInterview } from "@/lib/novel/story-simulation/interview-export"
import type {
  AgentChatMessage,
  ExtractionResult,
  NovelAgent,
  SimulationState,
  StoryBranch,
  StoryFramework,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"

import { SimulationConfigPanel } from "./simulation-config-panel"
import { FrameworkConfirmPanel } from "./framework-confirm-panel"
import { SimulationReportView } from "./simulation-report-view"
import { StoryDraftView } from "./story-draft-view"
import { Button } from "@/components/ui/button"

const PROGRESS_PHASES = [
  "extracting",
  "framework-generating",
  "simulating",
  "report-generating",
  "draft-generating",
] as const

/** 将 actionType 映射为中文动词短语（不含角色名，用于实时事件流展示） */
function actionPhrase(type: string, targetName?: string): string {
  switch (type) {
    case "evaluate":
      return "心中评价"
    case "pushPlot":
      return "推动事态"
    case "observe":
      return "观察到"
    case "react":
      return targetName
        ? `对 ${targetName} 的反应`
        : "做出反应"
    case "speak":
      return targetName
        ? `对 ${targetName} 说`
        : "说"
    case "ally":
      return targetName
        ? `向 ${targetName} 示好`
        : "寻求合作"
    case "confront":
      return targetName
        ? `与 ${targetName} 对抗`
        : "采取对抗姿态"
    case "conceal":
      return "隐瞒内心"
    case "investigate":
      return "调查"
    default:
      return "行动"
  }
}

/**
 * 故事推演室主视图（重构后）。
 *
 * 单栏全宽布局：框架列表已迁移到左侧 SidebarPanel。
 * 主区域根据 phase 切换：配置 → 框架确认 → 推演（实时事件流）→ 报告 → 草稿。
 * 报告阶段可弹出 Agent 采访面板与角色对话。
 */
export function StorySimulationView() {
  const { t } = useTranslation()
  const projectPath = useWikiStore((s) => s.project?.path)
  const baseLlmConfig = useWikiStore((s) => s.llmConfig)

  const phase = useStorySimulationStore((s) => s.phase)
  const mode = useStorySimulationStore((s) => s.mode)
  const userIdea = useStorySimulationStore((s) => s.userIdea)
  const targetWords = useStorySimulationStore((s) => s.targetWords)
  const sourceChapters = useStorySimulationStore((s) => s.sourceChapters)
  const simulationRounds = useStorySimulationStore((s) => s.simulationRounds)
  const extractionResult = useStorySimulationStore((s) => s.extractionResult)
  const currentFramework = useStorySimulationStore((s) => s.currentFramework)
  const currentReport = useStorySimulationStore((s) => s.currentReport)
  const error = useStorySimulationStore((s) => s.error)
  const progress = useStorySimulationStore((s) => s.progress)
  const progressLabel = useStorySimulationStore((s) => s.progressLabel)
  const timelineEvents = useStorySimulationStore((s) => s.timelineEvents)
  const activeChatAgent = useStorySimulationStore((s) => s.activeChatAgent)

  const setPhase = useStorySimulationStore((s) => s.setPhase)
  const setExtractionResult = useStorySimulationStore(
    (s) => s.setExtractionResult,
  )
  const setCurrentFramework = useStorySimulationStore(
    (s) => s.setCurrentFramework,
  )
  const setCurrentReport = useStorySimulationStore((s) => s.setCurrentReport)
  const setCurrentDraft = useStorySimulationStore((s) => s.setCurrentDraft)
  const setError = useStorySimulationStore((s) => s.setError)
  const setProgress = useStorySimulationStore((s) => s.setProgress)
  const setTimelineEvents = useStorySimulationStore((s) => s.setTimelineEvents)
  const addTimelineEvent = useStorySimulationStore((s) => s.addTimelineEvent)
  const setActiveChatAgent = useStorySimulationStore((s) => s.setActiveChatAgent)
  const addAgentChatMessage = useStorySimulationStore((s) => s.addAgentChatMessage)
  const agentChatMessages = useStorySimulationStore((s) => s.agentChatMessages)
  const clearAgentChat = useStorySimulationStore((s) => s.clearAgentChat)
  const bumpListRefresh = useStorySimulationStore((s) => s.bumpListRefresh)

  // 保存仿真后的 agents 和 state 供采访使用
  const lastAgentsRef = useRef<NovelAgent[]>([])
  const lastSimulationStateRef = useRef<SimulationState | null>(null)

  // 采访输入框
  const [chatInput, setChatInput] = useState("")
  const [chatSending, setChatSending] = useState(false)
  const [chatExporting, setChatExporting] = useState(false)
  const chatStreamRef = useRef("")
  const chatLogRef = useRef<HTMLDivElement | null>(null)

  // 当前阶段的进度基线
  const phaseBaseProgressRef = useRef(0)

  // 采访面板打开时自动滚动到底部
  useEffect(() => {
    if (activeChatAgent && chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight
    }
  }, [agentChatMessages, activeChatAgent])

  // ── 核心流程 ──

  /** 提取内容并生成故事框架，进入框架确认阶段。 */
  const handleStart = async () => {
    if (!projectPath) {
      setError("请先打开一个项目")
      return
    }
    setError(null)
    setCurrentFramework(null)
    setTimelineEvents([])
    try {
      // 1. 提取内容
      setPhase("extracting")
      phaseBaseProgressRef.current = 0
      setProgress(0, t("storySimulation.extracting"))
      const extraction: ExtractionResult = await extractStoryContent(
        projectPath,
        {
          sourceChapters,
          onProgress: (p, label) => setProgress(p, label),
        },
      )
      setExtractionResult(extraction)

      // 2. 生成框架
      setPhase("framework-generating")
      phaseBaseProgressRef.current = 30
      setProgress(30, "正在生成故事框架...")
      const llmConfig = resolveDefaultModel(baseLlmConfig)
      const framework: StoryFramework = await generateStoryFramework({
        extraction,
        mode,
        targetWords,
        userIdea: userIdea || undefined,
        llmConfig,
        onProgress: (label) =>
          setProgress(phaseBaseProgressRef.current, label),
      })
      setCurrentFramework(framework)
      setPhase("framework-confirming")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase("configuring")
    }
  }

  /** 保存当前框架到磁盘，并刷新侧边栏列表。 */
  const handleSaveFramework = async () => {
    if (!projectPath || !currentFramework) return
    try {
      await saveFramework(projectPath, currentFramework)
      bumpListRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** 确认框架：必要时先保存 → 构建角色 → 仿真 → 生成报告。 */
  const handleConfirmFramework = async () => {
    if (!projectPath || !currentFramework) {
      setError("缺少项目路径或故事框架")
      return
    }
    setError(null)
    setTimelineEvents([])
    try {
      // 若尚无提取结果（如从历史框架进入），先提取
      let extraction = extractionResult
      if (!extraction) {
        setPhase("extracting")
        phaseBaseProgressRef.current = 0
        setProgress(0, t("storySimulation.extracting"))
        extraction = await extractStoryContent(projectPath, {
          sourceChapters,
          onProgress: (p, label) => setProgress(p, label),
        })
        setExtractionResult(extraction)
      }

      // 开始推演前，若框架尚未保存到磁盘则先保存
      // 简单判断：检查 frameworks 列表里是否有当前 id
      const existing = useStorySimulationStore
        .getState()
        .frameworks.find((f) => f.id === currentFramework.id)
      if (!existing) {
        await saveFramework(projectPath, currentFramework)
        bumpListRefresh()
      }

      // 构建角色并运行仿真
      setPhase("simulating")
      phaseBaseProgressRef.current = 50
      setProgress(50, t("storySimulation.simulating"))
      const agents = buildAgents(extraction, currentFramework)
      lastAgentsRef.current = agents
      const llmConfig = resolveDefaultModel(baseLlmConfig)

      const collectedTimeline: TimelineEvent[] = []

      const callbacks: SimulationCallbacks = {
        onEvent: () => {},
        onProgress: (p, label) =>
          setProgress(50 + Math.floor(p / 2), label),
        onComplete: () => {},
        onError: () => {},
        onTimelineEvent: (event) => {
          collectedTimeline.push(event)
          addTimelineEvent(event)
        },
      }
      const events = await runSimulation(
        {
          agents,
          framework: currentFramework,
          mode,
          wordBudget: targetWords,
          llmConfig,
          userIdea: userIdea || undefined,
          maxRoundsPerNode: simulationRounds > 0 ? simulationRounds : undefined,
        },
        extraction,
        callbacks,
      )

      // 保存仿真状态供采访使用
      lastSimulationStateRef.current = {
        currentRound: 0,
        timelineEvents: collectedTimeline,
        activeAgents: new Map(agents.map((a) => [a.characterId, a])),
        worldState: {},
      }

      // 生成推演报告
      setPhase("report-generating")
      phaseBaseProgressRef.current = 80
      setProgress(80, "正在生成推演报告...")
      const report = await generateSimulationReport({
        events,
        framework: currentFramework,
        mode,
        llmConfig,
        onProgress: (label) =>
          setProgress(phaseBaseProgressRef.current, label),
      })
      setCurrentReport(report)
      setPhase("report-viewing")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase("framework-confirming")
    }
  }

  /** 重新生成框架（重新提取 + 生成）。 */
  const handleRegenerateFramework = () => {
    void handleStart()
  }

  /** 重新推演：回退到框架确认阶段。 */
  const handleResimulate = () => {
    setTimelineEvents([])
    setCurrentReport(null)
    setPhase("framework-confirming")
  }

  /** 选择走向分支并生成故事草稿。 */
  const handleGenerateDraft = async (branch: StoryBranch) => {
    if (!currentFramework || !currentReport) {
      setError("缺少故事框架或推演报告")
      return
    }
    setError(null)
    try {
      setPhase("draft-generating")
      phaseBaseProgressRef.current = 90
      setProgress(90, "正在生成故事草稿...")
      const llmConfig = resolveDefaultModel(baseLlmConfig)
      const draft = await generateStoryDraft({
        framework: currentFramework,
        report: currentReport,
        selectedBranch: branch,
        llmConfig,
        onProgress: (label) =>
          setProgress(phaseBaseProgressRef.current, label),
      })
      setCurrentDraft(draft)
      setPhase("draft-viewing")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase("report-viewing")
    }
  }

  /** 草稿视图返回报告视图。 */
  const handleBackToReport = () => {
    setPhase("report-viewing")
  }

  /** 打开 Agent 采访面板。 */
  const handleInterviewAgent = (agentId: string, agentName: string) => {
    clearAgentChat()
    setActiveChatAgent({ id: agentId, name: agentName })
  }

  /** 关闭采访面板。 */
  const handleCloseChat = () => {
    clearAgentChat()
  }

  /** 导出对话记录为MD。 */
  const handleExportChat = async () => {
    if (!activeChatAgent || !projectPath || agentChatMessages.length === 0) return
    setChatExporting(true)
    try {
      const filePath = await exportInterview(
        projectPath,
        activeChatAgent.name,
        agentChatMessages,
      )
      setError(`对话已导出到：${filePath}`)
      setTimeout(() => setError(null), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败")
    } finally {
      setChatExporting(false)
    }
  }

  /** 发送采访消息。 */
  const handleSendChat = async () => {
    const text = chatInput.trim()
    if (!text || chatSending || !activeChatAgent) return
    if (!lastSimulationStateRef.current) {
      setError("没有可用的仿真状态，无法采访")
      return
    }
    const llmConfig = resolveDefaultModel(baseLlmConfig)
    const agent = lastAgentsRef.current.find(
      (a) => a.characterId === activeChatAgent.id,
    )
    if (!agent) {
      setError(`找不到角色：${activeChatAgent.name}`)
      return
    }

    setChatInput("")
    setChatSending(true)
    chatStreamRef.current = ""

    // 先添加一条占位的 agent 消息，流式更新
    const placeholderId = `msg_${Date.now()}_stream`
    const placeholder: AgentChatMessage = {
      id: placeholderId,
      role: "agent",
      agentId: agent.characterId,
      agentName: agent.name,
      content: "",
      timestamp: new Date().toISOString(),
    }

    try {
      // 把已有消息（除 placeholder）组织成 session
      const existingMessages = agentChatMessages
      const session = {
        agentId: agent.characterId,
        agentName: agent.name,
        messages: [...existingMessages],
      }

      addAgentChatMessage({
        id: `msg_${Date.now()}_user`,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      })
      addAgentChatMessage(placeholder)

      await interviewAgent({
        llmConfig,
        agent,
        simulationState: lastSimulationStateRef.current,
        userPrompt: text,
        session,
        onToken: (token) => {
          chatStreamRef.current += token
          // 直接更新最后一条消息：通过替换 store 中的消息
          // 简化：用 setAgentChatMessages 替换整条消息；这里用 addAgentChatMessage 不好做增量
          // 我们用一个小技巧：拿到当前消息列表，替换最后一条 content
          const state = useStorySimulationStore.getState()
          const msgs = [...state.agentChatMessages]
          const lastIdx = msgs.length - 1
          if (lastIdx >= 0 && msgs[lastIdx].id === placeholderId) {
            msgs[lastIdx] = { ...msgs[lastIdx], content: chatStreamRef.current }
            useStorySimulationStore.setState({ agentChatMessages: msgs })
          }
        },
        onDone: () => {},
        onError: (err) => {
          setError(err.message)
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChatSending(false)
    }
  }

  // ── 渲染 ──

  const isProgressPhase = (
    PROGRESS_PHASES as readonly string[]
  ).includes(phase)

  const progressTitle = (() => {
    switch (phase) {
      case "extracting":
        return t("storySimulation.extracting")
      case "framework-generating":
        return "正在生成故事框架..."
      case "simulating":
        return t("storySimulation.simulating")
      case "report-generating":
        return "正在生成推演报告..."
      case "draft-generating":
        return "正在生成故事草稿..."
      default:
        return ""
    }
  })()

  return (
    <div className="flex h-full">
      {/* 主区域：单栏全宽 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div className="flex items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">
            <span>
              {t("storySimulation.error")}: {error}
            </span>
            <button
              type="button"
              className="shrink-0 text-xs underline"
              onClick={() => setError(null)}
            >
              {t("storySimulation.back")}
            </button>
          </div>
        )}

        {isProgressPhase && phase !== "simulating" ? (
          <ProgressPanel
            progress={progress}
            label={progressLabel || progressTitle}
          />
        ) : phase === "simulating" ? (
          <SimulatingTimelinePanel
            progress={progress}
            label={progressLabel || progressTitle}
            events={timelineEvents}
          />
        ) : phase === "framework-confirming" ? (
          <div className="flex-1 overflow-y-auto p-4">
            <FrameworkConfirmPanel
              onConfirm={() => void handleConfirmFramework()}
              onRegenerate={handleRegenerateFramework}
              onSave={() => void handleSaveFramework()}
            />
          </div>
        ) : phase === "report-viewing" ? (
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-hidden">
              <SimulationReportView
                onResimulate={handleResimulate}
                onGenerateDraft={(branch) => void handleGenerateDraft(branch)}
                onInterviewAgent={(id, name) => handleInterviewAgent(id, name)}
              />
            </div>
            {activeChatAgent && (
              <AgentChatPanel
                agentName={activeChatAgent.name}
                messages={agentChatMessages}
                input={chatInput}
                onInputChange={setChatInput}
                onSend={() => void handleSendChat()}
                onClose={handleCloseChat}
                onExport={() => void handleExportChat()}
                sending={chatSending}
                exporting={chatExporting}
                chatLogRef={chatLogRef}
              />
            )}
          </div>
        ) : phase === "draft-viewing" ? (
          <StoryDraftView onBack={handleBackToReport} />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <SimulationConfigPanel onStart={() => void handleStart()} />
          </div>
        )}
      </div>
    </div>
  )
}

/** 进度展示面板：文字 + 进度条。 */
function ProgressPanel({
  progress,
  label,
}: {
  progress: number
  label: string
}) {
  const clamped = Math.min(100, Math.max(0, progress))
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="text-base font-medium">{label}</div>
      <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground">{clamped}%</div>
    </div>
  )
}

/** 仿真中面板：进度条 + 实时时间线事件流（带筛选）。 */
function SimulatingTimelinePanel({
  progress,
  label,
  events,
}: {
  progress: number
  label: string
  events: TimelineEvent[]
}) {
  const clamped = Math.min(100, Math.max(0, progress))
  const logRef = useRef<HTMLDivElement | null>(null)

  // 筛选状态
  const [filterActor, setFilterActor] = useState<string>("all")
  const [filterType, setFilterType] = useState<string>("all")

  // 从事件中提取所有角色和行动类型
  const actors = Array.from(new Set(events.map((e) => e.actorName))).sort()
  const actionTypes = Array.from(new Set(events.map((e) => e.actionType))).sort()

  // 过滤事件
  const filteredEvents = events.filter((e) => {
    if (filterActor !== "all" && e.actorName !== filterActor) return false
    if (filterType !== "all" && e.actionType !== filterType) return false
    return true
  })

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [filteredEvents.length])

  // 行动类型中文标签
  const actionTypeLabel = (type: string): string => {
    const map: Record<string, string> = {
      evaluate: "评价",
      pushPlot: "推动",
      observe: "观察",
      react: "反应",
      speak: "对话",
      ally: "示好",
      confront: "对抗",
      conceal: "隐瞒",
      investigate: "调查",
      act: "行动",
      decide: "决策",
      conflict: "冲突",
      cooperate: "合作",
      withhold: "隐瞒",
    }
    return map[type] || type
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-4 flex flex-col items-center gap-2">
        <div className="text-base font-medium">{label}</div>
        <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${clamped}%` }}
          />
        </div>
        <div className="text-xs text-muted-foreground">{clamped}%</div>
      </div>

      {/* 筛选栏 */}
      {events.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">筛选：</span>
          <select
            value={filterActor}
            onChange={(e) => setFilterActor(e.target.value)}
            className="h-7 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">全部角色</option>
            {actors.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="h-7 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">全部行为</option>
            {actionTypes.map((type) => (
              <option key={type} value={type}>{actionTypeLabel(type)}</option>
            ))}
          </select>
          {(filterActor !== "all" || filterType !== "all") && (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => {
                setFilterActor("all")
                setFilterType("all")
              }}
            >
              清除筛选
            </button>
          )}
          <span className="ml-auto text-muted-foreground">
            显示 {filteredEvents.length}/{events.length} 条
          </span>
        </div>
      )}

      <div
        ref={logRef}
        className="flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm"
      >
        {filteredEvents.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {events.length === 0 ? "等待角色行动..." : "没有符合筛选条件的事件"}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredEvents.map((ev) => (
              <div key={ev.id} className="leading-relaxed">
                <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  {ev.nodeIndex + 1}-{ev.round + 1}
                </span>
                <span className="font-medium">{ev.actorName}</span>
                <span className="text-muted-foreground">
                  {" "}
                  {actionPhrase(ev.actionType, ev.targetName)}：
                </span>
                <span>{ev.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Agent 采访对话面板（右侧内联面板）。 */
function AgentChatPanel({
  agentName,
  messages,
  input,
  onInputChange,
  onSend,
  onClose,
  onExport,
  sending,
  exporting,
  chatLogRef,
}: {
  agentName: string
  messages: AgentChatMessage[]
  input: string
  onInputChange: (v: string) => void
  onSend: () => void
  onClose: () => void
  onExport: () => void
  sending: boolean
  exporting: boolean
  chatLogRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="flex w-80 shrink-0 flex-col border-l">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-semibold">与 {agentName} 对话</div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onExport}
            title="导出对话为MD"
            disabled={exporting || messages.length === 0}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onClose}
            title="关闭对话"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div
        ref={chatLogRef}
        className="flex-1 space-y-2 overflow-y-auto p-3 text-sm"
      >
        {messages.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            你可以向 {agentName} 提问，了解他/她的想法。
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {msg.content || (sending && msg.role === "agent" ? "..." : "")}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="shrink-0 border-t p-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                onSend()
              }
            }}
            placeholder="输入你的问题..."
            className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            disabled={sending}
          />
          <Button
            type="button"
            size="icon"
            className="h-8 w-8"
            onClick={onSend}
            disabled={sending || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
