import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import {
  analysisProgressKey,
  type AnalysisChunkRecord,
  type AnalysisChunkStatus,
  type AnalysisRuntimeProgress,
  type AnalysisSkill,
  type BookAnalysisPipelineTask,
} from "@/lib/novel/book-analysis/analysis-pipeline-types"
import { BookAnalysisCharacterPanel } from "./book-analysis-character-panel"
import { BookAnalysisStyleCard } from "./book-analysis-style-card"

export type BookAnalysisModuleTab = "characters" | "story" | "style" | "evidence"

interface BookAnalysisModuleViewProps {
  book: BookAnalysisLibraryBook
  task?: BookAnalysisPipelineTask | null
  chunks?: AnalysisChunkRecord[]
  progresses?: Record<string, AnalysisRuntimeProgress>
  selectedCharacterId: string | null
  storyContent?: ReactNode
  extractingStyle: boolean
  addingToSoul: boolean
  activeTab?: BookAnalysisModuleTab
  onActiveTabChange?: (tab: BookAnalysisModuleTab) => void
  onSelectCharacter: (id: string) => void
  onToggleStyle: () => void
  onAddSelectedSkillsToSoul: (skillId: string) => void
  onOpenSkillSelection?: () => void
  onReextract: (skill: AnalysisSkill) => void
  onConfigureTask?: () => void
  onSelectCharacters?: () => void
  onPauseTask?: () => void
  onContinueTask?: () => void
  onRetryTask?: () => void
  onRetryChunk?: (skill: AnalysisSkill, chunkId: string) => void
  onCancelTask?: () => void
}

function RuntimeProgressBar({ progress, label }: { progress: AnalysisRuntimeProgress; label?: string }) {
  const percentage = Math.max(0, Math.min(100, progress.percentage))
  return (
    <div className="mt-2 space-y-1.5" aria-label={label ?? "分析进度"}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-foreground">{progress.stageLabel}</span>
        <span className="shrink-0 text-muted-foreground">{percentage}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        aria-label={progress.stageLabel}
        className="h-2 overflow-hidden rounded-full bg-secondary"
      >
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {progress.currentItem && (
        <div className="truncate text-xs text-muted-foreground">{progress.currentItem}</div>
      )}
    </div>
  )
}

const TABS: Array<{ id: BookAnalysisModuleTab; label: string }> = [
  { id: "characters", label: "角色 Skill" },
  { id: "story", label: "故事 Skill" },
  { id: "style", label: "文风 Skill" },
  { id: "evidence", label: "证据片段" },
]

const STATUS_LABELS = {
  pending: "待分析",
  running: "分析中",
  completed: "已完成",
  failed: "失败",
  skipped: "未选择",
} as const

const CHUNK_STATUS_LABELS: Record<AnalysisChunkStatus, string> = {
  pending: "待处理",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  skipped: "已跳过",
  cancelled: "已取消",
}

const SKILL_LABELS: Record<AnalysisSkill, string> = {
  characters: "角色 Skill",
  story: "故事 Skill",
  style: "文风 Skill",
}

const EVIDENCE_FILTERS: Array<{ id: "all" | AnalysisSkill; label: string }> = [
  { id: "all", label: "全部" },
  { id: "characters", label: "角色" },
  { id: "story", label: "故事" },
  { id: "style", label: "文风" },
]

function taskStatusLabel(status: BookAnalysisPipelineTask["status"]): string {
  switch (status) {
    case "queued":
      return "排队中"
    case "running":
      return "进行中"
    case "paused":
      return "已暂停"
    case "failed":
      return "失败"
    case "cancelled":
      return "已取消"
    case "completed":
      return "已完成"
    case "awaiting-range":
      return "待选择章节"
    case "awaiting-character-selection":
      return "待选择角色"
    default:
      return status
  }
}

export function BookAnalysisModuleView(props: BookAnalysisModuleViewProps) {
  const [internalActive, setInternalActive] = useState<BookAnalysisModuleTab>("characters")
  const [evidenceFilter, setEvidenceFilter] = useState<"all" | AnalysisSkill>("all")
  const controlled = props.activeTab !== undefined
  const active = controlled ? props.activeTab! : internalActive
  const setActive = (tab: BookAnalysisModuleTab) => {
    if (!controlled) setInternalActive(tab)
    props.onActiveTabChange?.(tab)
  }

  const skill = active === "evidence" ? null : active
  const currentTaskModule = skill && props.task?.selectedSkills.includes(skill)
    ? props.task.modules[skill]
    : null
  const moduleState = skill ? currentTaskModule ?? props.book.analysisManifest?.modules[skill] : null
  const skillChunks = skill && props.task
    ? (props.chunks ?? [])
        .filter((chunk) => chunk.taskId === props.task?.id && chunk.skill === skill)
        .sort((left, right) => left.startOrder - right.startOrder)
    : []
  const completed = skillChunks.filter((chunk) => chunk.status === "completed").length
  const total = moduleState?.chunkIds.length ?? skillChunks.length
  const tabActiveChunk = skillChunks.find((chunk) => chunk.status === "running")
    ?? skillChunks.find((chunk) => chunk.status === "failed")
  const tabActiveChunkIndex = tabActiveChunk
    ? skillChunks.findIndex((chunk) => chunk.id === tabActiveChunk.id) + 1
    : 0
  const currentSkill = props.task?.currentSkill
  const taskBusy = props.task && ["queued", "running", "paused", "failed"].includes(props.task.status)
  const progresses = props.progresses ?? {}
  const currentSkillChunks = props.task && currentSkill
    ? (props.chunks ?? [])
        .filter((chunk) => chunk.taskId === props.task?.id && chunk.skill === currentSkill)
        .sort((left, right) => left.startOrder - right.startOrder)
    : []
  const currentSkillCompleted = currentSkillChunks.filter((chunk) => chunk.status === "completed").length
  const currentSkillTotal = props.task && currentSkill
    ? (props.task.modules[currentSkill].chunkIds.length || currentSkillChunks.length)
    : 0
  const phaseRuntimeProgress = (() => {
    if (!props.task || !currentSkill) return null
    for (const phase of ["aggregate", "publish"] as const) {
      const phaseProgress = progresses[analysisProgressKey(props.task.id, currentSkill, phase)]
      if (phaseProgress) return phaseProgress
    }
    return null
  })()
  const runningChunkProgresses = props.task && currentSkill
    ? currentSkillChunks
        .filter((chunk) => chunk.status === "running")
        .map((chunk) => progresses[analysisProgressKey(props.task!.id, currentSkill, chunk.id)])
        .filter((progress): progress is NonNullable<typeof progress> => Boolean(progress))
    : []
  const activeRuntimeProgress = phaseRuntimeProgress
    ?? runningChunkProgresses[0]
    ?? (() => {
      if (!props.task || !currentSkill) return null
      const prefix = `${props.task.id}:${currentSkill}:`
      return Object.entries(progresses).find(([key]) => key.startsWith(prefix))?.[1] ?? null
    })()
  // chunk 阶段占 0–90%；aggregate/publish 直接使用 phase 百分比（适配器报 92–100）
  const overallPercentage = (() => {
    if (phaseRuntimeProgress) {
      return Math.max(90, Math.min(100, Math.round(phaseRuntimeProgress.percentage)))
    }
    if (currentSkillTotal <= 0) return activeRuntimeProgress?.percentage ?? 0
    const runningShare = runningChunkProgresses.reduce(
      (sum, progress) => sum + Math.max(0, Math.min(100, progress.percentage)) / 100,
      0,
    )
    return Math.min(
      90,
      Math.round(((currentSkillCompleted + runningShare) / currentSkillTotal) * 90),
    )
  })()

  const filteredEvidence = evidenceFilter === "all"
    ? props.book.evidence
    : props.book.evidence.filter((item) => item.skill === evidenceFilter)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="拆书分析模块" className="flex shrink-0 border-b bg-background px-5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={`border-b-2 px-3 py-3 text-sm ${active === tab.id ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {taskBusy && props.task && (
          <section className={`mb-4 rounded-md border p-3 ${props.task.status === "failed" ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}`}>
            <div className="space-y-1 text-sm">
              <div className="font-medium">
                分析任务{taskStatusLabel(props.task.status)}
                {currentSkill ? ` · 当前：${SKILL_LABELS[currentSkill]}` : ""}
              </div>
              {props.task.selectedSkills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1" aria-label="各 Skill 状态">
                  {props.task.selectedSkills.map((item) => {
                    const module = props.task!.modules[item]
                    const isCurrent = currentSkill === item
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setActive(item)}
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                          active === item
                            ? "border-primary bg-primary/10 text-foreground"
                            : isCurrent
                              ? "border-primary/50 text-foreground"
                              : "border-border text-muted-foreground hover:bg-muted/60"
                        }`}
                      >
                        {SKILL_LABELS[item]} · {STATUS_LABELS[module.status]}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {props.task.error && (
              <div role="alert" className="mt-2 break-words text-sm text-destructive">
                失败原因：{props.task.error}
              </div>
            )}
            {props.task.status === "running" && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    区块进度 {currentSkillCompleted}/{currentSkillTotal || "?"}
                    {activeRuntimeProgress ? ` · ${activeRuntimeProgress.stageLabel}` : ""}
                  </span>
                  <span>{overallPercentage}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={overallPercentage}
                  aria-label="任务整体进度"
                  className="h-2 overflow-hidden rounded-full bg-secondary"
                >
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${overallPercentage}%` }}
                  />
                </div>
                {activeRuntimeProgress?.currentItem && (
                  <div className="truncate text-xs text-muted-foreground">{activeRuntimeProgress.currentItem}</div>
                )}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {props.task.status === "running" && props.onPauseTask && (
                <Button size="sm" variant="outline" onClick={props.onPauseTask}>暂停</Button>
              )}
              {props.task.status === "paused" && props.onContinueTask && (
                <Button size="sm" onClick={props.onContinueTask}>
                  从断点继续（已完成 {currentSkillCompleted}/{currentSkillTotal || "?"} 区块）
                </Button>
              )}
              {props.task.status === "failed" && props.onRetryTask && (
                <Button size="sm" onClick={props.onRetryTask}>重试当前步骤</Button>
              )}
              {["awaiting-character-selection", "queued", "running", "paused", "failed"].includes(props.task.status) && props.onCancelTask && (
                <Button size="sm" variant="outline" onClick={props.onCancelTask}>取消任务</Button>
              )}
            </div>
          </section>
        )}

        {props.task?.status === "awaiting-range" && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
            <div>
              <div className="text-sm font-medium">待选择章节</div>
              <div className="mt-1 text-xs text-muted-foreground">已选择 {props.task.selectedSkills.length} 个提取项目</div>
            </div>
            <Button size="sm" onClick={props.onConfigureTask}>选择章节</Button>
          </div>
        )}

        {props.task?.status === "awaiting-character-selection" && (() => {
          const recognitionProgress = progresses[analysisProgressKey(props.task.id, "characters", "recognition")]
          const hasRecognized = (props.task.recognizedCharacters?.length ?? 0) > 0
          return (
            <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {hasRecognized ? "待选择角色" : "正在识别角色"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {hasRecognized
                      ? `已识别 ${props.task.recognizedCharacters!.length} 个角色，请勾选后开始深度分析`
                      : recognitionProgress
                        ? (recognitionProgress.currentItem
                          ? `范围：${recognitionProgress.currentItem}`
                          : "识别进行中…")
                        : "准备识别角色…"}
                  </div>
                  {recognitionProgress && !hasRecognized && (
                    <RuntimeProgressBar progress={recognitionProgress} label="角色识别进度" />
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {props.onSelectCharacters && hasRecognized && (
                    <Button size="sm" onClick={props.onSelectCharacters}>选择角色</Button>
                  )}
                  {props.onCancelTask && (
                    <Button size="sm" variant="outline" onClick={props.onCancelTask}>取消任务</Button>
                  )}
                </div>
              </div>
            </div>
          )
        })()}

        {skill && (
          <div className="mb-4 space-y-3 border-b pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                <div>{moduleState ? STATUS_LABELS[moduleState.status] : "尚未分析"}</div>
                {moduleState && (
                  <div className="mt-1">
                    最近范围：第 {moduleState.range.startOrder}～{moduleState.range.endOrder} 章
                    {total > 0 ? ` · 完成区块 ${completed}/${total}` : ""}
                  </div>
                )}
                {moduleState?.summary && <div className="mt-1 break-words">{moduleState.summary}</div>}
                {taskBusy && currentSkill && currentSkill !== skill && (
                  <div className="mt-1 text-xs">
                    当前任务正在跑：{SKILL_LABELS[currentSkill]}（本 Tab 显示本 Skill 状态，不含其他 Skill 区块详情）
                  </div>
                )}
                {skill && currentSkill === skill && tabActiveChunk && (
                  <div className="mt-1">
                    当前区块：第 {tabActiveChunkIndex}/{skillChunks.length} 个（第 {tabActiveChunk.startOrder}～{tabActiveChunk.endOrder} 章）
                  </div>
                )}
                {skill && currentSkill === skill && activeRuntimeProgress && (
                  <RuntimeProgressBar progress={activeRuntimeProgress} label={`${SKILL_LABELS[skill]} 当前阶段`} />
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => props.onReextract(skill)}>重新提取</Button>
            </div>

            {skillChunks.length > 0 && (
              <div className="rounded-md border bg-muted/20 p-3" aria-label={`${SKILL_LABELS[skill]} 断点进度`}>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  {SKILL_LABELS[skill]} 区块进度 · {completed}/{skillChunks.length}
                  {moduleState?.resultPath ? " · 结果已发布" : ""}
                </div>
                <div className="space-y-1.5">
                  {skillChunks.map((chunk) => {
                    const chunkProgress = props.task
                      ? progresses[analysisProgressKey(props.task.id, skill, chunk.id)]
                      : undefined
                    return (
                      <div
                        key={chunk.id}
                        className="rounded border bg-background px-2.5 py-1.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-medium">第 {chunk.startOrder}～{chunk.endOrder} 章</span>
                            <span className="ml-2 text-muted-foreground">
                              {CHUNK_STATUS_LABELS[chunk.status]}
                              {chunk.attempts > 0 ? ` · 尝试 ${chunk.attempts}` : ""}
                            </span>
                            {chunk.error && (
                              <div className="mt-0.5 break-words text-destructive">{chunk.error}</div>
                            )}
                          </div>
                          {chunk.status === "failed" && props.onRetryChunk && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7"
                              onClick={() => props.onRetryChunk?.(skill, chunk.id)}
                            >
                              重试此区块
                            </Button>
                          )}
                        </div>
                        {chunk.status === "running" && chunkProgress && (
                          <RuntimeProgressBar
                            progress={chunkProgress}
                            label={`第 ${chunk.startOrder}～${chunk.endOrder} 章进度`}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {active === "characters" && (
          <BookAnalysisCharacterPanel
            book={props.book}
            selectedCharacterId={props.selectedCharacterId}
            addingToSoul={props.addingToSoul}
            onSelectCharacter={props.onSelectCharacter}
            onAddSelectedSkillsToSoul={props.onAddSelectedSkillsToSoul}
            onOpenSkillSelection={props.onOpenSkillSelection ?? (() => undefined)}
          />
        )}
        {active === "story" && props.storyContent}
        {active === "style" && (
          <BookAnalysisStyleCard
            book={props.book}
            extracting={props.extractingStyle}
            onExtractStyle={() => props.onReextract("style")}
            onToggleStyle={props.onToggleStyle}
          />
        )}
        {active === "evidence" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5" aria-label="证据 Skill 筛选">
              {EVIDENCE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setEvidenceFilter(filter.id)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    evidenceFilter === filter.id
                      ? "border-primary bg-primary/10 font-medium"
                      : "border-border text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            {filteredEvidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无证据片段</p>
            ) : (
              filteredEvidence.map((item) => (
                <article key={item.id} className="rounded-md border p-3 text-sm">
                  <div className="text-xs text-muted-foreground">
                    第 {item.chapterOrder} 章 · {SKILL_LABELS[item.skill] ?? item.skill}
                    {item.tags.length > 0 ? ` · ${item.tags.join("、")}` : ""}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words">{item.text}</p>
                  <p className="mt-2 text-xs text-muted-foreground">用途：{item.purpose}；保存原因：{item.reason}</p>
                </article>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
