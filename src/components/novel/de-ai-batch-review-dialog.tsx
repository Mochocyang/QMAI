import { useState } from "react"
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
import type { DeAiBatchChapter, DeAiBatchTaskRecord } from "@/lib/novel/de-ai-batch/types"

const CHAPTER_STATUS: Record<DeAiBatchChapter["status"], string> = {
  pending: "等待中",
  generating: "生成中",
  ready: "待确认",
  confirmed: "已确认",
  failed: "失败",
  cancelled: "已取消",
}

export interface DeAiBatchReviewDialogProps {
  open: boolean
  record: DeAiBatchTaskRecord | null
  currentChapterId: string | null
  pending?: boolean
  onSelectChapter(chapterId: string): void
  onConfirm(taskId: string, chapterId: string): void
  onSaveDraft?(taskId: string, chapterId: string): void
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

function TextPane({ title, content, emptyText }: { title: string; content: string | null; emptyText: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-3 py-2 text-xs font-medium text-muted-foreground">{title}</div>
      <div data-testid="de-ai-review-scroll" className="min-h-0 flex-1 overflow-y-auto p-4 text-sm leading-7 whitespace-pre-wrap">
        {content || <span className="text-muted-foreground">{emptyText}</span>}
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
  const [mobileTab, setMobileTab] = useState<"source" | "candidate">("source")
  const chapter = record?.chapters.find((item) => item.id === currentChapterId) ?? record?.chapters[0] ?? null
  const canConfirm = !pending && chapter?.status === "ready" && !!chapter.candidateContent
  const canSaveDraft = !pending && !!onSaveDraft && !!chapter?.candidateContent && chapter.status !== "generating"
  const canRegenerate = !pending && !!chapter && chapter.status !== "generating" && chapter.status !== "confirmed"
  const canCancel = !pending && !!chapter && chapter.status !== "confirmed" && chapter.status !== "cancelled"

  function handleMobileTabKey(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const nextTab = mobileTab === "source" ? "candidate" : "source"
    setMobileTab(nextTab)
    document.getElementById(`de-ai-review-tab-${nextTab}`)?.focus()
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        data-testid="de-ai-review-dialog"
        showCloseButton={false}
        className="flex h-[min(52rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-[min(90rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-[calc(100vw-2rem)]"
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>批量去 AI 味审核</DialogTitle>
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
            <ResizablePanel defaultSize={40} minSize={24}>
              <TextPane title="原文" content={chapter?.sourceContent ?? null} emptyText="暂无原文副本" />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={40} minSize={24}>
              <TextPane title="候选" content={chapter?.candidateContent ?? null} emptyText="候选尚未生成" />
            </ResizablePanel>
          </ResizablePanelGroup>

          <div data-testid="de-ai-review-mobile" className="flex h-full min-h-0 flex-col md:hidden">
            <div className="shrink-0 space-y-2 border-b p-3">
              <label className="block text-xs font-medium text-muted-foreground" htmlFor="de-ai-review-chapter-select">
                审核章节
              </label>
              <select
                id="de-ai-review-chapter-select"
                aria-label="选择审核章节"
                disabled={pending}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={chapter?.id ?? ""}
                onChange={(event) => onSelectChapter(event.target.value)}
              >
                {record?.chapters.map((item) => (
                  <option key={item.id} value={item.id}>{item.title} · {CHAPTER_STATUS[item.status]}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 rounded-md bg-muted p-1" role="tablist" aria-label="审核内容">
                <button
                  id="de-ai-review-tab-source"
                  type="button"
                  role="tab"
                  aria-controls="de-ai-review-tabpanel"
                  aria-selected={mobileTab === "source"}
                  tabIndex={mobileTab === "source" ? 0 : -1}
                  onKeyDown={handleMobileTabKey}
                  className={`rounded px-2 py-1.5 text-sm ${mobileTab === "source" ? "bg-background shadow-sm" : ""}`}
                  onClick={() => setMobileTab("source")}
                >
                  原文
                </button>
                <button
                  id="de-ai-review-tab-candidate"
                  type="button"
                  role="tab"
                  aria-controls="de-ai-review-tabpanel"
                  aria-selected={mobileTab === "candidate"}
                  tabIndex={mobileTab === "candidate" ? 0 : -1}
                  onKeyDown={handleMobileTabKey}
                  className={`rounded px-2 py-1.5 text-sm ${mobileTab === "candidate" ? "bg-background shadow-sm" : ""}`}
                  onClick={() => setMobileTab("candidate")}
                >
                  候选
                </button>
              </div>
            </div>
            <div
              id="de-ai-review-tabpanel"
              role="tabpanel"
              aria-labelledby={`de-ai-review-tab-${mobileTab}`}
              tabIndex={0}
              data-testid="de-ai-review-scroll"
              className="min-h-0 flex-1 overflow-y-auto p-4 text-sm leading-7 whitespace-pre-wrap"
            >
              {mobileTab === "source"
                ? chapter?.sourceContent || "暂无原文副本"
                : chapter?.candidateContent || "候选尚未生成"}
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none px-4 py-3">
          <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canCancel}
            onClick={() => {
              if (!record || !chapter) return
              if (window.confirm(`确定取消“${chapter.title}”的本次处理吗？原文不会被修改。`)) {
                onCancelChapter(record.task.id, chapter.id)
              }
            }}
          >
            取消当前章
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canRegenerate}
            onClick={() => { if (record && chapter) onRegenerate(record.task.id, chapter.id) }}
          >
            重新生成
          </Button>
          {onSaveDraft ? (
            <Button
              type="button"
              variant="outline"
              disabled={!canSaveDraft}
              onClick={() => { if (record && chapter) onSaveDraft(record.task.id, chapter.id) }}
            >
              另存草稿
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() => { if (record && chapter) onConfirm(record.task.id, chapter.id) }}
          >
            确认当前章
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
