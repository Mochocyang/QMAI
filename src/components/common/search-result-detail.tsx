import type { SearchDisplayDetail } from "@/lib/search-display"
import { openExternalUrl } from "@/lib/open-external-url"

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
 * 联网搜索的展开内容：实际搜索词、摘要前几行、来源（外部打开）、
 * Google 搜索建议（沙箱 iframe，禁止脚本）。只在有附加信息时渲染（目前只有 Gemini）。
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
      {detail.sources.length > 0 && (
        <ol className="space-y-0.5" aria-label="来源">
          {detail.sources.map((source) => (
            <li key={source.id} className="flex min-w-0 gap-1">
              <span className="shrink-0 text-muted-foreground/60">[{source.id}]</span>
              <a
                href={source.url}
                className="min-w-0 truncate text-primary underline-offset-2 hover:underline"
                title={source.title || source.source}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void openExternalUrl(source.url)
                }}
              >
                {source.source || source.title || source.url}
              </a>
            </li>
          ))}
        </ol>
      )}
      {detail.suggestionsHtml.trim() && (
        <iframe
          title="Google 搜索建议"
          className="h-16 w-full rounded border-0 bg-transparent"
          // 沙箱且不允许脚本：只渲染 Google 要求展示的建议样式，链接在新窗口打开。
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={`<base target="_blank">${detail.suggestionsHtml}`}
        />
      )}
    </div>
  )
}
