import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  CONTEXT_USAGE_FULL_RATIO,
  CONTEXT_USAGE_SEGMENT_ORDER,
  CONTEXT_USAGE_WARN_RATIO,
  contextUsageRatio,
  formatContextTokenCount,
  type ContextUsageKey,
  type ContextUsageSnapshot,
} from "@/lib/context-usage"
import { cn } from "@/lib/utils"

const SEGMENT_COLORS: Record<ContextUsageKey, string> = {
  softwareRules: "#94a3b8",
  toolDefinitions: "#c4b5fd",
  stableCore: "#4ade80",
  sessionSummary: "#facc15",
  dynamicContext: "#c084fc",
  history: "#60a5fa",
  toolResults: "#2dd4bf",
  currentInput: "#fb923c",
}

interface ContextUsageRingProps {
  usage?: ContextUsageSnapshot | null
  onCreateConversation?: () => void
  className?: string
}

function ringStrokeColor(ratio: number): string {
  if (ratio >= CONTEXT_USAGE_FULL_RATIO) return "#ef4444"
  if (ratio >= CONTEXT_USAGE_WARN_RATIO) return "#f59e0b"
  return "#22c55e"
}

function SegmentBar({ segments, windowTokens }: {
  segments: ContextUsageSnapshot["segments"]
  windowTokens: number
}) {
  const ordered = CONTEXT_USAGE_SEGMENT_ORDER
    .map((key) => segments.find((segment) => segment.key === key))
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment && segment.tokens > 0))
  const denominator = Math.max(1, windowTokens)
  return (
    <div
      data-testid="context-usage-bar"
      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      {ordered.map((segment) => (
        <div
          key={segment.key}
          className="h-full shrink-0"
          data-segment={segment.key}
          style={{
            width: `${(segment.tokens / denominator) * 100}%`,
            backgroundColor: SEGMENT_COLORS[segment.key] ?? "#94a3b8",
          }}
        />
      ))}
    </div>
  )
}

export function ContextUsageRing({
  usage,
  onCreateConversation,
  className,
}: ContextUsageRingProps) {
  const { t } = useTranslation()
  const ratio = usage ? contextUsageRatio(usage) : 0
  const percent = Math.round(ratio * 100)
  const stroke = ringStrokeColor(ratio)
  const isFull = ratio >= CONTEXT_USAGE_FULL_RATIO
  const size = 22
  const strokeWidth = 3
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - Math.min(1, ratio))

  const segmentRows = useMemo(() => {
    if (!usage) return []
    const byKey = new Map(usage.segments.map((segment) => [segment.key, segment.tokens]))
    return CONTEXT_USAGE_SEGMENT_ORDER
      .map((key) => ({ key, tokens: byKey.get(key) ?? 0 }))
      .filter((row) => row.tokens > 0)
  }, [usage])

  if (!usage) return null

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
            isFull && "text-destructive",
            className,
          )}
          aria-label={t("chat.contextUsage.title")}
        >
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.2}
              strokeWidth={strokeWidth}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
            <text
              x="50%"
              y="50%"
              dominantBaseline="central"
              textAnchor="middle"
              fontSize="7"
              fill="currentColor"
            >
              {percent}
            </text>
          </svg>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="w-72 max-w-none border border-border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <div className="space-y-2.5 text-left">
            <div className="space-y-1">
              <div className="text-xs font-medium">{t("chat.contextUsage.title")}</div>
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-semibold">
                  {t("chat.contextUsage.percentFull", { percent })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {usage.estimated ? "~" : ""}
                  {formatContextTokenCount(usage.totalTokens)}
                  {" / "}
                  {formatContextTokenCount(usage.windowTokens)}
                  {" "}
                  {t("chat.contextUsage.tokens")}
                </div>
              </div>
            </div>

            <SegmentBar segments={usage.segments} windowTokens={usage.windowTokens} />

            <div className="space-y-1.5">
              {segmentRows.map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ backgroundColor: SEGMENT_COLORS[row.key] }}
                    />
                    <span className="truncate">{t(`chat.contextUsage.segments.${row.key}`)}</span>
                  </div>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatContextTokenCount(row.tokens)}
                  </span>
                </div>
              ))}
            </div>

            {isFull && (
              <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                <p className="text-xs text-destructive">
                  {t("chat.contextUsage.fullHint")}
                </p>
                {onCreateConversation && (
                  <button
                    type="button"
                    className="rounded border border-destructive/40 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onCreateConversation()
                    }}
                  >
                    {t("chat.contextUsage.newConversation")}
                  </button>
                )}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
