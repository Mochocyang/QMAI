import { MessageSquare, ChevronDown } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { ChatPanel } from "@/components/chat/chat-panel"
import { getChatBarVisibility } from "./chat-layout"

export function ChatBar() {
  const chatExpanded = useWikiStore((s) => s.chatExpanded)
  const chatDockPosition = useWikiStore((s) => s.chatDockPosition)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)

  if (getChatBarVisibility(chatExpanded, chatDockPosition) === "hidden") {
    return null
  }

  return (
    <div className="flex h-full flex-col">
      <button
        onClick={() => setChatExpanded(false)}
        className="flex w-full items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground hover:bg-accent/50"
      >
        <span className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          AI 对话
        </span>
        <ChevronDown className="h-4 w-4" />
      </button>
      <div className="flex-1 overflow-hidden">
        <ChatPanel />
      </div>
    </div>
  )
}
