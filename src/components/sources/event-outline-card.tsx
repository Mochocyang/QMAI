import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  eventOutlineToProsePrompt,
  validateEventOutlineData,
  type EventOutlineData,
} from "@/lib/novel/event-outline"

interface EventOutlineCardProps {
  data: EventOutlineData
  /** 点「用这份细纲写这一章」时把扩写提示词交给上层。校验不通过时不显示该按钮。 */
  onWriteChapter?: (prompt: string) => void
}

/**
 * 只读事件卡片。
 *
 * 刻意不做卡片内编辑：修改事件靠在大纲对话里说「第 3 个事件改成……」重出一轮，
 * 这样生成与修改走同一条链路，不会出现「界面里改过、模型不知道」的双份真相。
 */
export function EventOutlineCard({ data, onWriteChapter }: EventOutlineCardProps) {
  const validation = useMemo(() => validateEventOutlineData(data), [data])
  const perEventWords = data.events.length > 0 ? Math.round(data.targetWords / data.events.length) : 0

  return (
    <div className="mt-2 rounded-lg border bg-background/60 p-3 text-sm" data-event-outline-card>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-sm">{data.title || `第${data.chapterNumber}章 · 事件细纲`}</strong>
        <span className="text-xs text-muted-foreground">
          {data.events.length} 个事件 · 目标 {data.targetWords} 字 · 每事件约 {perEventWords} 字
        </span>
      </div>

      <ol className="space-y-2">
        {data.events.map((event) => (
          <li key={event.id} className="rounded border-l-2 border-primary/40 pl-2">
            <div className="font-medium">{event.id}. {event.title}</div>
            <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
              {event.points.map((point, index) => (
                <li key={`${event.id}-${index}`}>· {point}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {data.endingHook ? (
        <p className="mt-2 text-xs">
          <span className="text-muted-foreground">章尾钩子：</span>{data.endingHook}
        </p>
      ) : null}

      {validation.problems.length > 0 ? (
        <div className="mt-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <div className="font-medium">细纲体检：{validation.problems.length} 项待修（仍可保存）</div>
          <ul className="mt-1 space-y-0.5">
            {validation.problems.map((problem, index) => (
              <li key={index}>· {problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 软性提示（字数分配一类）只提示、不阻断扩写：项目单章目标字数可到 10000，
          固定的事件字数区间不可能是硬的。 */}
      {validation.advisories.length > 0 ? (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground">
          <div className="font-medium">节奏提示：{validation.advisories.length} 条</div>
          <ul className="mt-1 space-y-0.5">
            {validation.advisories.map((advisory, index) => (
              <li key={index}>· {advisory}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {onWriteChapter && validation.ok ? (
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => onWriteChapter(eventOutlineToProsePrompt(data))}
          >
            用这份细纲写这一章
          </Button>
        </div>
      ) : null}
    </div>
  )
}
