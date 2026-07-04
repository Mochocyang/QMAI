import { useMemo } from "react"
import {
  buildFindHighlightParts,
  type FindHighlightPart,
} from "@/lib/textarea-find"

export interface TextareaFindHighlightsProps {
  text: string
  query: string
  matches: number[]
  activeMatchIndex: number
}

function renderPart(part: FindHighlightPart, index: number) {
  if (part.kind === "plain") {
    return <span key={index}>{part.text}</span>
  }
  if (part.kind === "active") {
    return (
      <mark
        key={index}
        data-find-highlight-active="true"
        className="rounded-[2px] bg-amber-400/55 text-transparent ring-1 ring-amber-500/80 dark:bg-amber-300/45 dark:ring-amber-300/70"
      >
        {part.text}
      </mark>
    )
  }
  return (
    <mark
      key={index}
      data-find-highlight-match="true"
      className="rounded-[2px] bg-amber-300/30 text-transparent dark:bg-amber-200/20"
    >
      {part.text}
    </mark>
  )
}

export function TextareaFindHighlights({
  text,
  query,
  matches,
  activeMatchIndex,
}: TextareaFindHighlightsProps) {
  const parts = useMemo(
    () => buildFindHighlightParts(text, matches, query.length, activeMatchIndex),
    [text, matches, query.length, activeMatchIndex],
  )

  return (
    <div
      aria-hidden="true"
      data-find-highlights="true"
      className="pointer-events-none absolute inset-x-0 top-0 z-0 w-full whitespace-pre-wrap break-words border-0 p-0 text-lg leading-8 text-transparent"
      style={{ fontFamily: "inherit" }}
    >
      {parts.map(renderPart)}
    </div>
  )
}
