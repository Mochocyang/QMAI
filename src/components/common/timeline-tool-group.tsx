import { memo, useState, type CSSProperties } from "react"
import { Check, ChevronDown, ChevronRight } from "lucide-react"
import type { ToolCallGroupItem } from "./timeline-types"
import { ToolCallEvent } from "./timeline-tool-event"

interface ToolCallGroupProps {
  group: ToolCallGroupItem
  style?: CSSProperties
}

export function getToolCallGroupRenderKey(group: ToolCallGroupItem): string {
  return `tool-group:${JSON.stringify([group.kind, group.items[0]?.id ?? group.id])}`
}

function ToolCallGroupImpl({ group, style }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <div className="px-2 text-[12px]" style={style}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex min-h-8 w-full items-center gap-1.5 py-1 text-left text-muted-foreground"
        aria-expanded={expanded}
        aria-label={`${group.label}，${group.items.length}项`}
      >
        <Chevron aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-500/45" />
        <span className="min-w-0 flex-1 break-words text-foreground/75">{group.label}</span>
        <span className="shrink-0 text-[10px]">{group.items.length}项</span>
      </button>

      {expanded && (
        <div className="ml-3 border-l border-border/60 pl-1">
          {group.items.map((item) => (
            <ToolCallEvent
              key={`${getToolCallGroupRenderKey(group)}:${item.id}`}
              event={item}
              compact
            />
          ))}
        </div>
      )}
    </div>
  )
}

export const ToolCallGroup = memo(ToolCallGroupImpl)
