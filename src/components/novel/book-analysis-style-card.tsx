import { useState } from "react"
import { ChevronDown, ChevronUp, Feather, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import {
  INTEGRATED_DNA_CHAR_LIMIT,
  WRITING_DNA_LAYERS,
  needsReextraction,
} from "@/lib/novel/book-analysis/style-profile-schema"
import type { StyleMetrics } from "@/lib/novel/book-analysis/style-metrics"

interface BookAnalysisStyleCardProps {
  book: BookAnalysisLibraryBook
  extracting: boolean
  onExtractStyle: () => void
  onToggleStyle: () => void
  onDeleteStyle: () => void
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`

/** 统计数字面板：这些是脚本算出来的确定值，不是模型的主观判断，值得单独摆出来。 */
function MetricsPanel({ metrics }: { metrics: StyleMetrics }) {
  const { counts, derived } = metrics
  const items: Array<[string, string]> = [
    ["样本", `${counts.chapters} 章 / ${counts.chars} 字`],
    ["平均句长", `${derived.avgSentenceChars} 字`],
    ["短句占比", percent(derived.shortSentenceRatio)],
    ["长句占比", percent(derived.longSentenceRatio)],
    ["平均段落", `${derived.avgParagraphChars} 字 / ${derived.avgParagraphSentences} 句`],
    ["一句一段", percent(derived.oneSentenceParagraphRatio)],
    ["含对白段落", percent(derived.dialogueParagraphRatio)],
    ["破折号 / 千字", String(derived.punctuationPerThousand.dash)],
    ["省略号 / 千字", String(derived.punctuationPerThousand.ellipsis)],
  ]
  return (
    <div className="rounded-md bg-muted/40 p-3 text-xs">
      <div className="font-medium">脚本统计（L1 / L6 确定性指标）</div>
      <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono text-foreground">{value}</span>
          </div>
        ))}
      </div>
      {metrics.topWords.length > 0 && (
        <div className="mt-2 text-muted-foreground leading-5">
          <span className="text-foreground">高频实词：</span>
          {metrics.topWords.slice(0, 12).map((item) => `${item.word}(${item.count})`).join("、")}
        </div>
      )}
      {!metrics.segmenterAvailable && (
        <div className="mt-2 text-amber-600 dark:text-amber-500">
          当前环境缺少中文分词能力，词频表为相邻汉字二元窗口的近似结果。
        </div>
      )}
    </div>
  )
}

export function BookAnalysisStyleCard({ book, extracting, onExtractStyle, onToggleStyle, onDeleteStyle }: BookAnalysisStyleCardProps) {
  const profile = book.styleProfile
  const enabled = book.styleStatus === "enabled"
  const [expanded, setExpanded] = useState(false)
  const stale = profile ? needsReextraction(profile) : false
  const integratedLength = profile?.integratedDna?.trim().length ?? 0

  return (
    <section className="rounded-lg border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Feather className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">作品文风 · Writing DNA</h3>
            {enabled && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">已启用</span>
            )}
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {!profile
              ? "尚未蒸馏 Writing DNA。作品文风只约束叙事写法，不等同于角色说话方式。"
              : stale
                ? "这份画像来自旧版单轮提取，没有分层产物与统计指标，建议重新提取。"
                : `已蒸馏 ${profile.sampledChapterIds.length} 章样本，整合文档 ${integratedLength} 字。`}
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
          {profile && (
            <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={onDeleteStyle}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              删除文风
            </Button>
          )}
        </div>
      </div>
      {profile && (
        <>
          {/* 六层蒸馏状态一览 */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {WRITING_DNA_LAYERS.map((layer) => {
              const text = profile.layers?.[layer.key]?.trim() ?? ""
              return (
                <div key={layer.key} className="rounded-md bg-muted/40 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{layer.level} {layer.label}</span>
                    <span className={text ? "text-primary" : "text-muted-foreground"}>
                      {text ? `${text.length} 字` : "未提取"}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground line-clamp-2">{text || layer.summary}</div>
                </div>
              )
            })}
          </div>
          {profile.metrics && profile.metrics.counts.chapters > 0 && (
            <div className="mt-2">
              <MetricsPanel metrics={profile.metrics} />
            </div>
          )}
          <button
            type="button"
            className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "收起详情" : "查看分层产物、整合文档与代表样本"}
          </button>
          {expanded && (
            <div className="mt-3 space-y-4">
              {WRITING_DNA_LAYERS.map((layer) => {
                const text = profile.layers?.[layer.key]?.trim()
                if (!text) return null
                return (
                  <div key={layer.key} className="rounded-md bg-muted/40 p-3 text-xs">
                    <div className="font-medium">{layer.level} {layer.label}</div>
                    <div className="mt-1 text-muted-foreground leading-5 whitespace-pre-line">{text}</div>
                  </div>
                )
              })}
              {integratedLength > 0 && (
                <div className="rounded-md bg-muted/40 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">整合文档 Writing-DNA.md（注入生成）</span>
                    {integratedLength > INTEGRATED_DNA_CHAR_LIMIT && (
                      <span className="text-amber-600 dark:text-amber-500">
                        超过 {INTEGRATED_DNA_CHAR_LIMIT} 字上限，建议重新提取
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-muted-foreground leading-5 whitespace-pre-line">
                    {profile.integratedDna}
                  </div>
                </div>
              )}
              {profile.constitution && (
                <div className="rounded-md bg-muted/40 p-3 text-xs">
                  <div className="font-medium">风格硬约束</div>
                  <div className="mt-1 text-muted-foreground leading-5 whitespace-pre-line">{profile.constitution}</div>
                </div>
              )}
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
