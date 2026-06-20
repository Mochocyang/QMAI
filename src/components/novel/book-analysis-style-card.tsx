import { useState } from "react"
import { ChevronDown, ChevronUp, Feather, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import { STYLE_DIMENSIONS } from "@/lib/novel/book-analysis/style-prompts"

interface BookAnalysisStyleCardProps {
  book: BookAnalysisLibraryBook
  extracting: boolean
  onExtractStyle: () => void
  onToggleStyle: () => void
}

export function BookAnalysisStyleCard({ book, extracting, onExtractStyle, onToggleStyle }: BookAnalysisStyleCardProps) {
  const profile = book.styleProfile
  const enabled = book.styleStatus === "enabled"
  const [expanded, setExpanded] = useState(false)

  return (
    <section className="rounded-lg border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Feather className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">作品文风</h3>
            {enabled && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">已启用</span>
            )}
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {profile?.narrativeDensity || "尚未提取叙事文风。作品文风只约束叙事写法，不等同于角色说话方式。"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {profile && (
            <Button size="sm" variant={enabled ? "outline" : "default"} onClick={onToggleStyle}>
              {enabled ? "取消启用" : "启用此文风"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onExtractStyle} disabled={extracting}>
            {extracting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {extracting ? "提取中..." : profile ? "重新提取文风" : "提取文风"}
          </Button>
        </div>
      </div>
      {profile && (
        <>
          {/* 始终显示的维度摘要 */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {STYLE_DIMENSIONS.slice(0, 4).map((d) => (
              <div key={d.key} className="rounded-md bg-muted/40 p-3 text-xs">
                <div className="font-medium">{d.label}</div>
                <div className="mt-1 text-muted-foreground line-clamp-2">{(profile[d.key] as string) || "\u2014"}</div>
              </div>
            ))}
          </div>
          {/* 展开/收起 */}
          <button
            type="button"
            className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "收起详情" : "查看全部维度、风格宪法与代表样本"}
          </button>
          {expanded && (
            <div className="mt-3 space-y-4">
              {/* 剩余维度 */}
              {STYLE_DIMENSIONS.slice(4).map((d) => (
                <div key={d.key} className="rounded-md bg-muted/40 p-3 text-xs">
                  <div className="font-medium">{d.label}</div>
                  <div className="mt-1 text-muted-foreground leading-5">{(profile[d.key] as string) || "\u2014"}</div>
                </div>
              ))}
              {/* 风格宪法 */}
              {profile.constitution && (
                <div className="rounded-md bg-muted/40 p-3 text-xs">
                  <div className="font-medium">风格宪法（注入生成）</div>
                  <div className="mt-1 text-muted-foreground leading-5 whitespace-pre-line">{profile.constitution}</div>
                </div>
              )}
              {/* 代表样本 */}
              {profile.samples && profile.samples.length > 0 && (
                <div className="rounded-md bg-muted/40 p-3 text-xs">
                  <div className="font-medium">代表原文样本</div>
                  <div className="mt-1 space-y-2">
                    {profile.samples.map((sample, i) => (
                      <div key={i} className="text-muted-foreground leading-5 border-l-2 border-primary/30 pl-2">
                        {sample}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
