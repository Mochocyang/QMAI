import { memo, useState, useEffect, useMemo, useRef } from "react"
import type { TimelineEvent } from "./timeline-types"
import { groupTimelineEvents } from "./timeline-grouping"
import { ThinkingEvent } from "./timeline-thinking-event"
import { ToolCallEvent } from "./timeline-tool-event"
import { getToolCallGroupRenderKey, ToolCallGroup } from "./timeline-tool-group"
import { ArrowDown, Brain, Clock3, Hash } from "lucide-react"

interface EventStreamProps {
  events: TimelineEvent[]
  isStreaming: boolean
  totalDurationMs?: number
  totalTokens?: number
}

function EventStreamImpl({ events, isStreaming, totalDurationMs, totalTokens }: EventStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const userScrolledRef = useRef(false)
  const groupedEvents = useMemo(() => groupTimelineEvents(events), [events])

  const thinkingCount = events.filter((e) => e.kind === "thinking").length
  const toolCount = events.reduce((count, event) => {
    if (event.kind === "tool_call") return count + 1
    if (event.kind === "tool_group") return count + event.data.items.length
    return count
  }, 0)

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    const minutes = Math.floor(ms / 60000)
    const seconds = ((ms % 60000) / 1000).toFixed(0)
    return `${minutes}分${seconds}秒`
  }

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
      userScrolledRef.current = false
      setShowScrollButton(false)
    }
  }

  useEffect(() => {
    if (!isStreaming) return
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const atBottom = scrollHeight - scrollTop - clientHeight < 30
      if (!atBottom) {
        userScrolledRef.current = true
        setShowScrollButton(true)
      } else {
        userScrolledRef.current = false
        setShowScrollButton(false)
      }
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [isStreaming])

  useEffect(() => {
    if (!isStreaming || userScrolledRef.current) return
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [groupedEvents, isStreaming])

  if (events.length === 0) {
    if (isStreaming) {
      return (
        <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-muted-foreground">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500" />
          <span>思考中...</span>
        </div>
      )
    }
    return null
  }

  return (
    <div className="relative w-full min-w-0 max-w-full overflow-x-hidden">
      <div
        ref={containerRef}
        className="event-stream-scroll max-h-[50vh] w-full min-w-0 max-w-full space-y-0 overflow-x-hidden overflow-y-auto py-1"
      >
        {groupedEvents.map((event, idx) => {
          const delay = Math.min(idx * 50, 300)
          const animationStyle = {
            animationDelay: `${delay}ms`,
            animationFillMode: "backwards" as const,
          }
          if (event.kind === "thinking") {
            return (
              <div key={`thinking-${idx}-${event.data.id}`} style={animationStyle}>
                <ThinkingEvent event={event.data} />
              </div>
            )
          }
          if (event.kind === "tool_group") {
            return (
              <ToolCallGroup
                key={getToolCallGroupRenderKey(event.data)}
                group={event.data}
                style={animationStyle}
              />
            )
          }
          return (
            <div key={`tool-${event.data.id}`} style={animationStyle}>
              <ToolCallEvent event={event.data} />
            </div>
          )
        })}

        {!isStreaming && (totalDurationMs !== undefined || totalTokens !== undefined) && (
          <div
            className="mt-2 flex items-center gap-3 px-2 pt-2 border-t border-border/50 text-[11px] text-muted-foreground/70"
            style={{
              animationDelay: `${Math.min(groupedEvents.length * 50 + 100, 400)}ms`,
              animationFillMode: "backwards",
              animation: "slideInUp 300ms ease-out",
            }}
          >
            {totalDurationMs !== undefined && (
              <span className="flex items-center gap-1">
                <Clock3 aria-hidden="true" className="h-3 w-3" />
                <span>耗时 {formatDuration(totalDurationMs)}</span>
              </span>
            )}
            {totalTokens !== undefined && (
              <span className="flex items-center gap-1">
                <Hash aria-hidden="true" className="h-3 w-3" />
                <span>{totalTokens.toLocaleString()} tokens</span>
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <Brain aria-hidden="true" className="h-3 w-3" />
              <span>思考 {thinkingCount} 段 · 工具 {toolCount} 次</span>
            </span>
          </div>
        )}
      </div>

      {showScrollButton && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-background border border-border shadow-md hover:bg-accent transition-colors text-foreground/70 hover:text-foreground"
          title="回到最新"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export const EventStream = memo(EventStreamImpl)
