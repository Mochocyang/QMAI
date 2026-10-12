import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Brain, Copy, Download, FilePlus2, Loader2, Send, Square, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { scenarioToMarkdown } from "@/lib/novel/story-simulation/scenario-export"
import {
  SCENARIO_FORMAT_INFO,
  type ScenarioMessage,
  type ScenarioSession,
  type ScenarioStreamingState,
} from "@/lib/novel/story-simulation/scenario-types"

export interface ScenarioRoomViewProps {
  session: ScenarioSession
  running: boolean
  streaming: ScenarioStreamingState | null
  progress: { done: number; total: number } | null
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onExport: () => void
  /** 将本场情景导入为一章草稿（可选）。 */
  onInsertToChapters?: () => void
  onCancel: () => void
  onBack: () => void
  exporting?: boolean
  inserting?: boolean
}

/**
 * 「舞台情景」房间视图（第 3 步）
 * 以类似群组的方式展示主持人与各角色的对话流，并允许用户随时插话。
 */
export function ScenarioRoomView({
  session,
  running,
  streaming,
  progress,
  input,
  onInputChange,
  onSend,
  onExport,
  onInsertToChapters,
  onCancel,
  onBack,
  exporting,
  inserting,
}: ScenarioRoomViewProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(scenarioToMarkdown(session))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  // 新消息 / 流式内容变化时自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [session.messages.length, streaming?.content])

  const formatInfo = SCENARIO_FORMAT_INFO[session.setup.format]
  const canSend = !running && input.trim().length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 顶部信息条 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {session.setup.title}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[0.625rem] text-muted-foreground">
              {formatInfo.icon} {formatInfo.name}
            </span>
            {/* 「停止」之后最要紧的一件事：这场是跑完的还是被中断的 */}
            {session.status === "cancelled" && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.625rem] font-medium text-amber-700 dark:text-amber-300">
                {t("storySimulation.scenarioStatusCancelled")}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {session.setup.participants
              .map((p) => `${p.name}${p.isModerator ? "(主持)" : ""}`)
              .join("、")}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {progress && running && (
            <span className="text-xs text-muted-foreground">
              {progress.done}/{progress.total}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => void handleCopyAll()}>
            {copied ? (
              <Check className="mr-1 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-1 h-3.5 w-3.5" />
            )}
            {copied
              ? t("storySimulation.scenarioCopied")
              : t("storySimulation.scenarioCopyAll")}
          </Button>
          <Button variant="outline" size="sm" onClick={onExport} disabled={exporting}>
            <Download className="mr-1 h-3.5 w-3.5" />
            {exporting
              ? t("storySimulation.scenarioExporting")
              : t("storySimulation.scenarioExport")}
          </Button>
          {onInsertToChapters && (
            <Button
              variant="outline"
              size="sm"
              onClick={onInsertToChapters}
              disabled={inserting || session.messages.length === 0}
            >
              <FilePlus2 className="mr-1 h-3.5 w-3.5" />
              {inserting
                ? t("storySimulation.scenarioInserting")
                : t("storySimulation.scenarioInsertToChapter")}
            </Button>
          )}
          {running ? (
            <Button variant="outline" size="sm" onClick={onCancel}>
              <Square className="mr-1 h-3.5 w-3.5" />
              {t("storySimulation.scenarioStop")}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onBack}>
              {t("storySimulation.scenarioReset")}
            </Button>
          )}
        </div>
      </div>

      {/* 对话流 */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {session.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {streaming && (
          <MessageBubble
            message={{
              id: "__streaming__",
              kind: streaming.kind,
              speakerId: streaming.speakerName,
              speakerName: streaming.speakerName,
              round: 0,
              content: streaming.content,
              timestamp: new Date().toISOString(),
            }}
            streaming
          />
        )}

        {running && !streaming && (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("storySimulation.scenarioScheduling")}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            rows={2}
            disabled={running}
            placeholder={
              running
                ? t("storySimulation.scenarioInputPlaceholderRunning")
                : t("storySimulation.scenarioInputPlaceholder")
            }
            className="min-h-0 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) {
                e.preventDefault()
                onSend()
              }
            }}
          />
          <Button onClick={onSend} disabled={!canSend} className="h-9">
            <Send className="mr-1 h-4 w-4" />
            {t("storySimulation.scenarioSend")}
          </Button>
        </div>
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">
          {t("storySimulation.scenarioSendHint")}
        </p>
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  streaming,
}: {
  message: ScenarioMessage
  streaming?: boolean
}) {
  const { t } = useTranslation()
  // 必须放在 system 的提前 return 之前：hooks 不能有条件地调用
  const [showReasoning, setShowReasoning] = useState(false)
  if (message.kind === "system") {
    return (
      <div className="py-1 text-center text-xs text-muted-foreground">
        {message.content}
      </div>
    )
  }

  const isUser = message.kind === "user"
  const isModerator = message.kind === "moderator"

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] min-w-0", isUser && "items-end")}>
        <div
          className={cn(
            "mb-1 flex items-center gap-2 text-xs text-muted-foreground",
            isUser && "justify-end",
          )}
        >
          <span className="font-medium text-foreground/80">
            {message.speakerName}
          </span>
          {isModerator && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.625rem] text-primary">
              {t("storySimulation.scenarioModeratorBadge")}
            </span>
          )}
          {!isUser && message.round > 0 && (
            <span>{t("storySimulation.scenarioRound", { n: message.round })}</span>
          )}
        </div>
        <div
          className={cn(
            "whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground"
              : isModerator
                ? "border border-primary/30 bg-primary/5"
                : "bg-muted",
          )}
        >
          {message.content}
          {streaming && (
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-current align-middle" />
          )}
        </div>
        {/*
          模型的思考过程一直存在消息里却没有出口（多数模型不发 reasoning
          token，所以没有就不渲染任何控件，避免留一个点开是空的按钮）。
        */}
        {message.reasoning && (
          <>
            <button
              type="button"
              onClick={() => setShowReasoning((v) => !v)}
              className="mt-1 flex items-center gap-1 text-[0.6875rem] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Brain className="h-3 w-3" />
              {t("storySimulation.scenarioReasoning")}
            </button>
            {showReasoning && (
              <div className="mt-1 whitespace-pre-wrap rounded-lg border border-dashed px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                {message.reasoning}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
