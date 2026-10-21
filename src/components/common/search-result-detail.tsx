import type { SearchDisplayDetail } from "@/lib/search-display"

const SUMMARY_PREVIEW_LINES = 3

/** 摘要预览：去掉 Markdown 标记与分隔线，取前几行非空文本。 */
export function summaryPreviewLines(summary: string, max = SUMMARY_PREVIEW_LINES): string[] {
  return summary
    .split("\n")
    .map((line) => line.replace(/\*\*/g, "").replace(/^\s*(#{1,6}|[*\-]|\d+\.)\s+/, "").trim())
    .filter((line) => line && !/^[-|:\s]+$/.test(line))
    .slice(0, max)
}

/**
 * 联网搜索的展开内容：只显示实际搜索词与摘要前几行。
 * 来源列表与 Google 搜索建议仍保存在记录里，但不再显示。只在有附加信息时渲染（目前只有 Gemini）。
 */
export function SearchResultDetail({ detail }: { detail: SearchDisplayDetail }) {
  const preview = summaryPreviewLines(detail.summary)
  return (
    <div className="space-y-1.5" data-search-detail="">
      {detail.queries.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="实际搜索词">
          {detail.queries.map((query) => (
            <span key={query} className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[0.625rem]">{query}</span>
          ))}
        </div>
      )}
      {preview.length > 0 && (
        <div className="space-y-0.5 text-foreground/80" aria-label="搜索摘要">
          {preview.map((line, index) => <p key={index} className="line-clamp-2 break-words">{line}</p>)}
        </div>
      )}
    </div>
  )
}
