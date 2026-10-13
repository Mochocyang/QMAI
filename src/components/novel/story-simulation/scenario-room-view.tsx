import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Brain, Copy, Download, FilePlus2, Loader2, Play, Send, Square, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { scenarioToMarkdown } from "@/lib/novel/story-simulation/scenario-export"
import {
  scenarioAvatarInitial,
  scenarioSpeakerTone,
} from "@/lib/novel/story-simulation/scenario-avatar"
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
  /**
   * 接着跑完剩余轮数（可选）。中止过、或计划轮数还没跑满时才有意义；
   * 与「插话后继续」不同 —— 插话固定只走 1 轮，这个按钮把剩下的跑完。
   */
  onContinue?: () => void
  /** 还剩多少轮没跑；0 表示跑完了，不显示「继续生成」。 */
  remainingRounds?: number
  /**
   * 本场实际注入的参考资料篇数（null=没填参考点或一篇都没检索到）。
   *
   * 传 null 与「没填参考点」在渲染上按 setup.rules.reference 区分：填了却
   * 检索不到要说出来，没填就什么都不显示。
   */
  referenceInfo?: { count: number; truncated: boolean } | null
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
  onContinue,
  remainingRounds = 0,
  referenceInfo = null,
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
            {/* 参考点检索到了几篇。一篇都没检索到时也必须说，否则用户只会
                以为模型不听话 —— 提示词里写着「必须以此为依据」，但手里是空的 */}
            {session.setup.rules.reference && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[0.625rem]",
                  referenceInfo
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                )}
              >
                {referenceInfo
                  ? t("storySimulation.scenarioReferenceInjected", {
                      count: referenceInfo.count,
                    })
                  : t("storySimulation.scenarioReferenceMissing")}
                {referenceInfo?.truncated &&
                  ` · ${t("storySimulation.scenarioReferenceTruncated")}`}
              </span>
            )}
          </div>
          {/*
            成员条：把「这场有谁」从一行逗号文字变成一排带头像的小标签，
            并标出当前正在发言的那位。生成中如果只有一个转圈，用户看不出
            在等谁 —— 而「在等谁」正是群聊里最要紧的信息。

            role="group" 不能省：裸 div 上的 aria-label 多数读屏不会念。
            不用 role="list" 是因为条里还有个装饰性的 Users 图标，
            它不构成合法的 listitem 子项。
          */}
          <div
            className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"
            data-testid="scenario-member-bar"
            role="group"
            aria-label={t("storySimulation.scenarioMembers")}
          >
            {/* 图标只是装饰，旁白里已有人名，别让读屏念出一个无意义的图形名 */}
            <Users
              className="h-3 w-3 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            {session.setup.participants.map((p) => {
              const tone = scenarioSpeakerTone(p.id, Boolean(p.isModerator))
              const active = running && streaming?.speakerId === p.id
              /*
                灵魂小字：规格要求成员徽章是「头像 + 名字 + 灵魂小字」。
                灵魂名本身就是数据（participants[].auraName 由
                candidateToParticipant 从候选带进来），直接显示即可，
                不新增文案 key、不加前缀。

                未绑定（null / undefined / 空串 / 只有空白）时整块不渲染 ——
                留一个空 span 会在名字后面拖出一段空白。也刻意不做成可点的样子：
                绑定入口在设置面板，这里只是展示。
              */
              const soulName = String(p.auraName ?? "").trim()
              return (
                <span
                  key={p.id}
                  data-testid="scenario-member"
                  data-speaker-id={p.id}
                  data-active={active ? "true" : "false"}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-1.5 py-0.5",
                    active ? "border-primary/40 bg-primary/5" : "border-transparent",
                  )}
                >
                  <span
                    data-testid="scenario-avatar"
                    data-speaker-id={p.id}
                    className={cn(
                      "grid h-4 w-4 shrink-0 place-items-center rounded-full text-[0.5rem] font-medium",
                      tone.avatarClass,
                    )}
                  >
                    {scenarioAvatarInitial(p.name)}
                  </span>
                  <span className={cn("font-medium", tone.nameClass)}>{p.name}</span>
                  {soulName && (
                    <span
                      data-testid="scenario-member-soul"
                      className="text-[0.625rem] text-muted-foreground"
                    >
                      {soulName}
                    </span>
                  )}
                  {p.isModerator && (
                    <span className="text-muted-foreground">
                      ({t("storySimulation.scenarioModeratorBadge")})
                    </span>
                  )}
                  {active && (
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
                  )}
                </span>
              )
            })}
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
            <>
              {/* 「停止」不该等于毁掉剩余计划 —— 有欠账就让人一次跑完 */}
              {onContinue && remainingRounds > 0 && (
                <Button size="sm" onClick={onContinue}>
                  <Play className="mr-1 h-3.5 w-3.5" />
                  {t("storySimulation.scenarioContinue", {
                    n: remainingRounds,
                  })}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onBack}>
                {t("storySimulation.scenarioReset")}
              </Button>
            </>
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
          <>
            {/*
              还没吐字时明说「×× 正在输入…」：这段时间用户看到的如果只是一个
              空气泡，会以为卡住了。已有正文之后就不必再占一行。
            */}
            {running && !streaming.content && (
              <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("storySimulation.scenarioTyping", {
                  name: streaming.speakerName,
                })}
              </div>
            )}
            <MessageBubble
              message={{
                id: "__streaming__",
                kind: streaming.kind,
                // 引擎本来就给了 speakerId，只是以前拿名字顶替；现在优先用真 id
                speakerId: streaming.speakerId ?? streaming.speakerName,
                speakerName: streaming.speakerName,
                round: 0,
                content: streaming.content,
                timestamp: new Date().toISOString(),
              }}
              streaming
              active
            />
          </>
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
  active,
}: {
  message: ScenarioMessage
  streaming?: boolean
  /** 是否正在发言（用于高亮）。历史消息一律为 false。 */
  active?: boolean
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
  /*
    主持人拿固定主色，角色按 speakerId 稳定散列到一个专属色。

    缺 speakerId 时按 speakerName 兜底（规格「边界与错误处理」第 531 行：
    历史情景旧数据没有 speakerId，可选字段缺省时按 speakerName 兜底取配色、
    不报错）。不兜底的话散列拿到空串会恒落色板第 0 位：所有老气泡撞成同一个
    颜色，且与成员条上按 p.id 配色的同一个人不同色，违反「同一角色颜色保持不变」。

    这样与上面流式气泡那一处（`streaming.speakerId ?? streaming.speakerName`）
    口径一致：历史消息与流式气泡走同一条取色路径。

    今天 id 与名字恰好相等（story-extractor 的 character.id 直接来自 name），
    所以兜底值与成员条的 p.id 配色对得上。将来两者分家时：带真 speakerId 的
    消息不受影响，只有「连 speakerId 都没有」的老数据会退化成按名字取色 ——
    那种老数据本来也无从得知 id，能保住「同名的老气泡彼此同色、且与成员条
    同名的那位同色」就是能给的最好结果；但若届时名字与 id 不一致，这类老气泡
    的颜色会与成员条不一致，需要在那时重新审视（例如迁移旧数据补 speakerId）。
  */
  const tone = scenarioSpeakerTone(
    message.speakerId ?? message.speakerName,
    isModerator,
  )

  return (
    <div
      data-testid="scenario-bubble"
      data-speaker-id={message.speakerId}
      className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && (
        <span
          data-testid="scenario-avatar"
          data-speaker-id={message.speakerId}
          className={cn(
            "mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-medium",
            tone.avatarClass,
          )}
        >
          {scenarioAvatarInitial(message.speakerName)}
        </span>
      )}
      <div className={cn("max-w-[85%] min-w-0", isUser && "items-end")}>
        <div
          className={cn(
            "mb-1 flex items-center gap-2 text-xs text-muted-foreground",
            isUser && "justify-end",
          )}
        >
          <span className={cn("font-medium", isUser ? "text-foreground/80" : tone.nameClass)}>
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
            active && "ring-1 ring-primary/40",
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
