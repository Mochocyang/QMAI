import { PanelBottom, PanelRight } from "lucide-react"
import { useWikiStore, type ChatDockPosition } from "@/stores/wiki-store"

const DOCK_TARGETS: Record<ChatDockPosition, {
  value: ChatDockPosition
  label: string
  icon: typeof PanelBottom
}> = {
  bottom: { value: "right", label: "停靠在侧栏", icon: PanelRight },
  right: { value: "bottom", label: "停靠在底栏", icon: PanelBottom },
}

export function ChatDockControls() {
  const chatDockPosition = useWikiStore((s) => s.chatDockPosition)
  const setChatDockPosition = useWikiStore((s) => s.setChatDockPosition)
  const target = DOCK_TARGETS[chatDockPosition]
  const Icon = target.icon

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-muted/30 p-0.5">
      <button
        type="button"
        onClick={() => setChatDockPosition(target.value)}
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title={target.label}
        aria-label={target.label}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
