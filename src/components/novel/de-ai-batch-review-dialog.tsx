import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { AiChangeComparePanel } from "@/components/common/ai-change-compare-panel"
import { extractDeAiChapterText } from "@/lib/chapter-selection"
import type { DeAiBatchChapter, DeAiBatchTaskRecord } from "@/lib/novel/de-ai-batch/types"

const CHAPTER_STATUS: Record<DeAiBatchChapter["status"], string> = {
  pending: "等待中",
  generating: "生成中",
  ready: "待确认",
  confirmed: "已确认",
  failed: "失败",
  cancelled: "已取消",
}

interface DeAiBatchReviewDialogProps {
  open: boolean
  record: DeAiBatchTaskRecord | null
  currentChapterId: string | null
  pending?: boolean
  onSelectChapter(chapterId: string): void
  onConfirm(taskId: string, chapterId: string, candidateContent: string): void
  onSaveDraft?(taskId: string, chapterId: string, candidateContent: string): void
  onRegenerate(taskId: string, chapterId: string): void
  onCancelChapter(taskId: string, chapterId: string): void
  onClose(): void
}

function ChapterList({
  record,
  currentChapterId,
  onSelectChapter,
}: Pick<DeAiBatchReviewDialogProps, "record" | "currentChapterId" | "onSelectChapter">) {
  if (!record) return null
  return (
    <div data-testid="de-ai-review-scroll" className="h-full min-h-0 overflow-y-auto p-2">
      <div className="space-y-1">
        {record.chapters.map((chapter) => (
          <button
            key={chapter.id}
            type="button"
            aria-current={chapter.id === currentChapterId ? "true" : undefined}
            className={`w-full rounded-md px-3 py-2 text-left text-sm ${
              chapter.id === currentChapterId ? "bg-primary/10 text-primary" : "hover:bg-muted"
            }`}
            onClick={() => onSelectChapter(chapter.id)}
          >
            <span className="block truncate font-medium">{chapter.title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{CHAPTER_STATUS[chapter.status]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function DeAiBatchReviewDialog({
  open,
  record,
  currentChapterId,
  pending = false,
  onSelectChapter,
  onConfirm,
  onSaveDraft,
  onRegenerate,
  onCancelChapter,
  onClose,
}: DeAiBatchReviewDialogProps) {
  const [candidateDrafts, setCandidateDrafts] = useState<
    Record<string, { generation: number; content: string }>
  >({})

  useEffect(() => {
    setCandidateDrafts({})
  }, [open, record?.task.id])

  const chapter = record?.chapters.find((item) => item.id === currentChapterId)
    ?? record?.chapters[0]
    ?? null
  const candidateDraft = chapter ? candidateDrafts[chapter.id] : undefined
  const rawCandidateContent = chapter && candidateDraft?.generation === chapter.generation
    ? candidateDraft.content
    : chapter?.candidateContent ?? ""
  // 旧任务可能把 frontmatter 一并塞进 source/candidate；对比与编辑都只暴露正文。
  const originalContent = extractDeAiChapterText(chapter?.sourceContent ?? "")
  const candidateContent = candidateDraft?.generation === chapter?.generation
    ? rawCandidateContent
    : extractDeAiChapterText(rawCandidateContent)
  const candidateEditable = !pending && chapter?.status === "ready"
  const canConfirm = candidateEditable && !!candidateContent.trim()
  const canSaveDraft = !pending
    && !!onSaveDraft
    && !!candidateContent.trim()
    && chapter?.status !== "generating"
  const canRegenerate = !pending
    && !!chapter
    && chapter.status !== "generating"
    && chapter.status !== "confirmed"
  const canCancel = !pending
    && !!chapter
    && chapter.status !== "confirmed"
    && chapter.status !== "cancelled"

  function handleCandidateContentChange(content: string): void {
    if (!chapter || !candidateEditable) return
    setCandidateDrafts((current) => ({
      ...current,
      [chapter.id]: { generation: chapter.generation, content },
    }))
  }

  function clearCandidateDraft(chapterId: string): void {
    setCandidateDrafts((current) => {
      const next = { ...current }
      delete next[chapterId]
      return next
    })
  }

  const comparisonPanel = (
    <AiChangeComparePanel
      originalContent={originalContent}
      modifiedContent={candidateContent}
      originalLabel={"原文"}
      modifiedLabel={"候选"}
      editable={candidateEditable}
      resetKey={chapter ? `${chapter.id}:${chapter.generation}` : undefined}
      onModifiedContentChange={handleCandidateContentChange}
    />
  )

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        data-testid="de-ai-review-dialog"
        showCloseButton={false}
        className="flex h-[min(52rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-[min(90rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-[calc(100vw-2rem)]"
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>{"批量去 AI 味审核"}</DialogTitle>
          <DialogDescription>
            {record?.task.workTitle ?? "未选择作品"}
            {chapter ? ` · ${chapter.title} · ${CHAPTER_STATUS[chapter.status]}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div data-testid="de-ai-review-body" className="min-h-24 flex-1 overflow-hidden">
          <ResizablePanelGroup data-testid="de-ai-review-desktop" direction="horizontal" className="hidden h-full md:flex">
            <ResizablePanel defaultSize={20} minSize={14}>
              <ChapterList record={record} currentChapterId={chapter?.id ?? null} onSelectChapter={onSelectChapter} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={80} minSize={40}>
              {comparisonPanel}
            </ResizablePanel>
          </ResizablePanelGroup>

          <div data-testid="de-ai-review-mobile" className="flex h-full min-h-0 flex-col md:hidden">
            <div className="shrink-0 space-y-2 border-b p-3">
              <label className="block text-xs font-medium text-muted-foreground" htmlFor="de-ai-review-chapter-select">
                {"审核章节"}
              </label>
              <select
                id="de-ai-review-chapter-select"
                aria-label={"选择审核章节"}
                disabled={pending}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={chapter?.id ?? ""}
                onChange={(event) => onSelectChapter(event.target.value)}
              >
                {record?.chapters.map((item) => (
                  <option key={item.id} value={item.id}>{item.title} {"·"} {CHAPTER_STATUS[item.status]}</option>
                ))}
              </select>
            </div>
            <div
              id="de-ai-review-tabpanel"
              role="tabpanel"
              tabIndex={0}
              data-testid="de-ai-review-scroll"
              className="min-h-0 flex-1 overflow-hidden"
            >
              {comparisonPanel}
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none px-4 py-3">
          <Button type="button" variant="outline" onClick={onClose}>{"关闭"}</Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canCancel}
            onClick={() => {
              if (!record || !chapter) return
              if (window.confirm(`确定取消“${chapter.title}”的本次处理吗？原文不会被修改。`)) {
                clearCandidateDraft(chapter.id)
                onCancelChapter(record.task.id, chapter.id)
              }
            }}
          >
            {"取消当前章"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canRegenerate}
            onClick={() => {
              if (!record || !chapter) return
              clearCandidateDraft(chapter.id)
              onRegenerate(record.task.id, chapter.id)
            }}
          >
            {"重新生成"}
          </Button>
          {onSaveDraft ? (
            <Button
              type="button"
              variant="outline"
              disabled={!canSaveDraft}
              onClick={() => {
                if (record && chapter) onSaveDraft(record.task.id, chapter.id, candidateContent)
              }}
            >
              {"另存草稿"}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              if (record && chapter) onConfirm(record.task.id, chapter.id, candidateContent)
            }}
          >
            {"确认当前章"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
