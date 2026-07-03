import { X } from "lucide-react"
import type { ReferenceToken } from "@/lib/reference/types"

const categoryColors: Record<ReferenceToken["category"], string> = {
  chapter: "bg-purple-100 text-purple-700 border-purple-300",
  memory: "bg-green-100 text-green-700 border-green-300",
  outline: "bg-blue-100 text-blue-700 border-blue-300",
  deduction: "bg-orange-100 text-orange-700 border-orange-300",
  skill: "bg-yellow-100 text-yellow-700 border-yellow-300",
  chat_history: "bg-cyan-100 text-cyan-700 border-cyan-300",
  outline_history: "bg-indigo-100 text-indigo-700 border-indigo-300",
}

interface ReferenceChipProps {
  token: ReferenceToken
  readonly?: boolean
  onRemove?: (id: string) => void
}

export function ReferenceChip({
  token,
  readonly = false,
  onRemove,
}: ReferenceChipProps) {
  const colorClass = categoryColors[token.category]

  return (
    <span
      className={`mx-0.5 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${colorClass}`}
      contentEditable={readonly ? undefined : false}
      data-reference-id={token.id}
      data-reference-category={token.category}
    >
      @{token.displayTitle}
      {!readonly && (
        <button
          type="button"
          className="ml-0.5 cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={(event) => {
            event.preventDefault()
            onRemove?.(token.id)
          }}
          tabIndex={-1}
          aria-label={`移除引用 ${token.displayTitle}`}
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </span>
  )
}
