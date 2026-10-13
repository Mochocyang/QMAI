import { useEffect, useState, type FormEvent } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  EVENT_OUTLINE_DEFAULT_EVENTS,
  EVENT_OUTLINE_MAX_EVENTS,
  EVENT_OUTLINE_MIN_EVENTS,
  type EventOutlineRequest,
} from "@/lib/novel/event-outline"

/** 事件数选项：4~8，默认 6。 */
const EVENT_COUNT_OPTIONS = Array.from(
  { length: EVENT_OUTLINE_MAX_EVENTS - EVENT_OUTLINE_MIN_EVENTS + 1 },
  (_, index) => EVENT_OUTLINE_MIN_EVENTS + index,
)

interface EventOutlineWizardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (request: EventOutlineRequest) => void
  /** 「下一章」的默认章号，由面板探测后传入。 */
  defaultChapterNumber: number
  /** 项目单章目标字数设置。 */
  defaultTargetWords: number
}

export function EventOutlineWizardDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultChapterNumber,
  defaultTargetWords,
}: EventOutlineWizardDialogProps) {
  const [chapterNumber, setChapterNumber] = useState(String(defaultChapterNumber))
  const [eventCount, setEventCount] = useState(String(EVENT_OUTLINE_DEFAULT_EVENTS))
  const [targetWords, setTargetWords] = useState(String(defaultTargetWords))
  const [requirement, setRequirement] = useState("")
  const [error, setError] = useState("")

  // 每次打开都重置成最新探测结果：上一轮的输入不该粘到下一章。
  useEffect(() => {
    if (!open) return
    setChapterNumber(String(defaultChapterNumber))
    setEventCount(String(EVENT_OUTLINE_DEFAULT_EVENTS))
    setTargetWords(String(defaultTargetWords))
    setRequirement("")
    setError("")
  }, [open, defaultChapterNumber, defaultTargetWords])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const chapter = Number.parseInt(chapterNumber, 10)
    if (!Number.isFinite(chapter) || chapter <= 0) {
      setError("请填写有效的目标章号（大于 0 的整数）。")
      return
    }
    const words = Number.parseInt(targetWords, 10)
    if (!Number.isFinite(words) || words <= 0) {
      setError("请填写有效的本章目标字数。")
      return
    }
    onSubmit({
      chapterNumber: chapter,
      eventCount: Number.parseInt(eventCount, 10),
      targetWords: words,
      requirement: requirement.trim(),
    })
    onOpenChange(false)
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ui-test-outline-wizard">
        <DialogHeader>
          <DialogTitle>生成章节细纲</DialogTitle>
          <DialogDescription>
            把这一章拆成 4~8 个连续事件，每个事件给一句话与可直接落笔的细节抓手；提交后会在
            AI 对话里生成，结果显示在对话框中。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="ui-test-wizard-scroll">
            <div className="ui-test-wizard-grid">
              <label className="ui-test-wizard-field">
                <span>目标章节</span>
                <Input
                  aria-label="目标章节"
                  value={chapterNumber}
                  onChange={(event) => {
                    setChapterNumber(event.target.value)
                    setError("")
                  }}
                />
              </label>
              <label className="ui-test-wizard-field">
                <span>事件数量</span>
                <select
                  aria-label="事件数量"
                  value={eventCount}
                  onChange={(event) => setEventCount(event.target.value)}
                >
                  {EVENT_COUNT_OPTIONS.map((count) => (
                    <option key={count} value={String(count)}>{`${count} 个事件`}</option>
                  ))}
                </select>
              </label>
              <label className="ui-test-wizard-field">
                <span>本章目标字数</span>
                <Input
                  aria-label="本章目标字数"
                  value={targetWords}
                  onChange={(event) => {
                    setTargetWords(event.target.value)
                    setError("")
                  }}
                />
              </label>
            </div>
            <label className="ui-test-wizard-field">
              <span>本章想法 / 硬要求（可选）</span>
              <Textarea
                aria-label="本章想法/硬要求"
                value={requirement}
                placeholder="例如：这一章要让主角第一次动用令牌；必须交代骆轻竹为什么失望。"
                onChange={(event) => setRequirement(event.target.value)}
              />
            </label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit">生成细纲</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
