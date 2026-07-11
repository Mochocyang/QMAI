import { useState, useEffect, useRef, memo } from "react"
import { Brain } from "lucide-react"
import type { ThinkingEventItem } from "./timeline-types"
import { StreamingSpinner } from "./streaming-spinner"

interface ThinkingEventProps {
  event: ThinkingEventItem
}

function ThinkingEventImpl({ event }: ThinkingEventProps) {
  const [collapsed, setCollapsed] = useState(false)
  const wasStreamingRef = useRef(false)
  const manuallyChangedRef = useRef(false)

  useEffect(() => {
    if (!wasStreamingRef.current && event.streaming) {
      manuallyChangedRef.current = false
      setCollapsed(false)
    } else if (
      wasStreamingRef.current
      && !event.streaming
      && event.content
      && !manuallyChangedRef.current
    ) {
      setCollapsed(true)
    }
    wasStreamingRef.current = event.streaming
  }, [event.streaming, event.content])

  if (!event.content) return null

  const charCount = event.content.length

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => {
          manuallyChangedRef.current = true
          setCollapsed(false)
        }}
        className="flex items-center gap-1.5 px-2 py-1 text-left text-[12px] text-muted-foreground hover:text-foreground w-full"
        aria-label={`思考完成，${charCount}字，点击展开`}
        aria-expanded={false}
      >
        <Brain aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span>思考完成 · {charCount}字</span>
      </button>
    )
  }

  return (
    <div className="px-2 py-1 animate-[slideInUp_300ms_ease-out] group">
      <div className="flex items-start gap-2">
        <Brain aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {event.streaming ? "思考中" : `思考完成 · ${charCount}字`}
            </span>
            {!event.streaming && (
              <button
                type="button"
                onClick={() => {
                  manuallyChangedRef.current = true
                  setCollapsed(true)
                }}
                className="text-[10px] text-muted-foreground/70 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              >
                收起
              </button>
            )}
          </div>
          <div className="border-l-2 border-amber-400/30 pl-2.5 text-[12px] leading-5 text-foreground/75 whitespace-pre-wrap">
            {event.content}
            {event.streaming && (
              <span className="inline-block ml-0.5 text-amber-500 dark:text-amber-400 align-text-bottom">
                <StreamingSpinner />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export const ThinkingEvent = memo(ThinkingEventImpl)
