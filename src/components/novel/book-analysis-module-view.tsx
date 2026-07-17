import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import type { AnalysisChunkRecord, AnalysisSkill, BookAnalysisPipelineTask } from "@/lib/novel/book-analysis/analysis-pipeline-types"
import { BookAnalysisCharacterPanel } from "./book-analysis-character-panel"
import { BookAnalysisStyleCard } from "./book-analysis-style-card"

export type BookAnalysisModuleTab = "characters" | "story" | "style" | "evidence"

interface BookAnalysisModuleViewProps {
  book: BookAnalysisLibraryBook
  task?: BookAnalysisPipelineTask | null
  chunks?: AnalysisChunkRecord[]
  selectedCharacterId: string | null
  storyContent?: ReactNode
  extractingStyle: boolean
  addingToSoul: boolean
  onSelectCharacter: (id: string) => void
  onToggleStyle: () => void
  onAddSelectedSkillsToSoul: (skillId: string) => void
  onOpenSkillSelection?: () => void
  onReextract: (skill: AnalysisSkill) => void
  onConfigureTask?: () => void
  onPauseTask?: () => void
  onContinueTask?: () => void
  onRetryTask?: () => void
  onCancelTask?: () => void
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

const SKILL_LABELS: Record<AnalysisSkill, string> = {
  characters: "角色 Skill",
  story: "故事 Skill",
  style: "文风 Skill",
}

export function BookAnalysisModuleView(props: BookAnalysisModuleViewProps) {
  const [active, setActive] = useState<BookAnalysisModuleTab>("characters")
  const skill = active === "evidence" ? null : active
  const currentTaskModule = skill && props.task?.selectedSkills.includes(skill)
    ? props.task.modules[skill]
    : null
  const moduleState = skill ? currentTaskModule ?? props.book.analysisManifest?.modules[skill] : null
  const completed = skill && props.task
    ? props.chunks?.filter((chunk) => chunk.taskId === props.task?.id && chunk.skill === skill && chunk.status === "completed").length ?? 0
    : 0
  const total = moduleState?.chunkIds.length ?? 0
  const currentSkill = props.task?.currentSkill
  const currentSkillChunks = currentSkill
    ? (props.chunks ?? [])
        .filter((chunk) => chunk.taskId === props.task?.id && chunk.skill === currentSkill)
        .sort((left, right) => left.startOrder - right.startOrder)
    : []
  const activeChunk = currentSkillChunks.find((chunk) => chunk.status === "running")
    ?? currentSkillChunks.find((chunk) => chunk.status === "failed")
  const activeChunkIndex = activeChunk
    ? currentSkillChunks.findIndex((chunk) => chunk.id === activeChunk.id) + 1
    : 0
  const completedCurrentChunks = currentSkillChunks.filter((chunk) => chunk.status === "completed").length
  const currentSkillIndex = currentSkill ? props.task?.selectedSkills.indexOf(currentSkill) ?? -1 : -1
  const nextSkill = currentSkillIndex >= 0 ? props.task?.selectedSkills[currentSkillIndex + 1] : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="拆书分析模块" className="flex shrink-0 border-b bg-background px-5">
        {TABS.map((tab) => (
          <button key={tab.id} role="tab" aria-selected={active === tab.id} onClick={() => setActive(tab.id)} className={`border-b-2 px-3 py-3 text-sm ${active === tab.id ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {props.task && ["queued", "running", "paused", "failed"].includes(props.task.status) && (
          <section className={`mb-4 rounded-md border p-3 ${props.task.status === "failed" ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}`}>
            {currentSkill ? (
              <div className="space-y-1 text-sm">
                <div className="font-medium">
                  {props.task.status === "failed"
                    ? `${SKILL_LABELS[currentSkill]} 分析失败`
                    : `正在进行：${SKILL_LABELS[currentSkill]}`}
                </div>
                {activeChunk && (
                  <div>当前区块：第 {activeChunkIndex}/{currentSkillChunks.length} 个（第 {activeChunk.startOrder}～{activeChunk.endOrder} 章）</div>
                )}
                <div>已完成区块：{completedCurrentChunks}/{currentSkillChunks.length}</div>
                <div>{props.task.status === "failed"
                  ? "后续步骤已暂停"
                  : `下一步：${nextSkill ? SKILL_LABELS[nextSkill] : "汇总并保存结果"}`}</div>
              </div>
            ) : (
              <div className="text-sm font-medium">分析任务等待开始</div>
            )}
            {props.task.error && <div role="alert" className="mt-2 break-words text-sm text-destructive">失败原因：{props.task.error}</div>}
            <div className="mt-3 flex flex-wrap gap-2">
              {props.task.status === "running" && props.onPauseTask && <Button size="sm" variant="outline" onClick={props.onPauseTask}>暂停</Button>}
              {props.task.status === "paused" && props.onContinueTask && <Button size="sm" onClick={props.onContinueTask}>继续</Button>}
              {props.task.status === "failed" && props.onRetryTask && <Button size="sm" onClick={props.onRetryTask}>重试当前步骤</Button>}
              {["queued", "running", "paused", "failed"].includes(props.task.status) && props.onCancelTask && (
                <Button size="sm" variant="outline" onClick={props.onCancelTask}>取消任务</Button>
              )}
            </div>
          </section>
        )}
        {props.task?.status === "awaiting-range" && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
            <div><div className="text-sm font-medium">待选择章节</div><div className="mt-1 text-xs text-muted-foreground">已选择 {props.task.selectedSkills.length} 个提取项目</div></div>
            <Button size="sm" onClick={props.onConfigureTask}>选择章节</Button>
          </div>
        )}
        {skill && (
          <div className="mb-4 flex items-start justify-between gap-3 border-b pb-3">
            <div className="text-sm text-muted-foreground">
              <div>{moduleState ? STATUS_LABELS[moduleState.status] : "尚未分析"}</div>
              {moduleState && <div className="mt-1">最近范围：第 {moduleState.range.startOrder}～{moduleState.range.endOrder} 章{total > 0 ? ` · 完成区块 ${completed}/${total}` : ""}</div>}
              {moduleState?.summary && <div className="mt-1 break-words">{moduleState.summary}</div>}
            </div>
            <Button variant="outline" size="sm" onClick={() => props.onReextract(skill)}>重新提取</Button>
          </div>
        )}
        {active === "characters" && (
          <BookAnalysisCharacterPanel book={props.book} selectedCharacterId={props.selectedCharacterId} addingToSoul={props.addingToSoul} onSelectCharacter={props.onSelectCharacter} onAddSelectedSkillsToSoul={props.onAddSelectedSkillsToSoul} onOpenSkillSelection={props.onOpenSkillSelection ?? (() => undefined)} />
        )}
        {active === "story" && props.storyContent}
        {active === "style" && (
          <BookAnalysisStyleCard book={props.book} extracting={props.extractingStyle} onExtractStyle={() => props.onReextract("style")} onToggleStyle={props.onToggleStyle} />
        )}
        {active === "evidence" && (
          <div className="space-y-3">
            {props.book.evidence.length === 0 ? <p className="text-sm text-muted-foreground">暂无证据片段</p> : props.book.evidence.map((item) => (
              <article key={item.id} className="rounded-md border p-3 text-sm">
                <div className="text-xs text-muted-foreground">第 {item.chapterOrder} 章 · {item.tags.join("、") || item.skill}</div>
                <p className="mt-2 whitespace-pre-wrap break-words">{item.text}</p>
                <p className="mt-2 text-xs text-muted-foreground">用途：{item.purpose}；保存原因：{item.reason}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
