import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { MessageCircle, RefreshCw, Sparkles, TrendingUp, Download, ChevronDown, ChevronRight, GitCompare, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useStorySimulationStore, type SavedSimulationResult } from "@/stores/story-simulation-store"
import { useWikiStore } from "@/stores/wiki-store"
import { exportReport } from "@/lib/novel/story-simulation/report-export"
import { cn } from "@/lib/utils"
import type { StoryBranch, TimelineEvent, StoryFramework, SimulationReport } from "@/lib/novel/story-simulation/types"

const PROBABILITY_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  low: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
}

interface SimulationReportViewProps {
  onResimulate: () => void
  onGenerateDraft: (branch: StoryBranch) => void
  onInterviewAgent: (agentId: string, agentName: string) => void
  onViewDraft?: () => void
  hasDraft?: boolean
  onViewInterviewHistory?: () => void
}

/** 将 actionType 映射为中文动词短语 */
function actionLabel(type: string): string {
  switch (type) {
    case "evaluate":
      return "评价"
    case "pushPlot":
      return "推动事态"
    case "observe":
      return "观察"
    case "react":
      return "反应"
    case "speak":
      return "说"
    case "ally":
      return "结盟"
    case "confront":
      return "对抗"
    case "conceal":
      return "隐瞒"
    case "investigate":
      return "调查"
    default:
      return "行动"
  }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  } catch {
    return dateStr
  }
}

// ── 单个报告内容面板（可复用，用于对比模式） ──

interface ReportContentProps {
  report: SimulationReport
  timelineEvents: TimelineEvent[]
  framework?: StoryFramework | null
  onInterviewAgent?: (agentId: string, agentName: string) => void
  onGenerateDraft?: (branch: StoryBranch) => void
  title?: string
  compact?: boolean
  /** 对比模式下的另一个报告，用于高亮差异 */
  compareReport?: SimulationReport | null
  /** 对比模式下的另一组时间线事件，用于差异统计 */
  compareTimelineEvents?: TimelineEvent[]
}

function ReportContent({ report, timelineEvents, framework, onInterviewAgent, onGenerateDraft, title, compact, compareReport, compareTimelineEvents }: ReportContentProps) {
  // 安全清洗 recommendation：防止模型返回 JSON 对象导致显示乱码
  const safeRecommendation = useMemo(() => {
    const raw = report.recommendation
    if (!raw) return ""
    const trimmed = raw.trim()
    if (!trimmed) return ""
    // 如果是 JSON 格式的字符串，尝试提取文本
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed)
        if (typeof parsed === "string") return parsed.trim()
        if (typeof parsed === "object" && parsed !== null) {
          const obj = parsed as Record<string, unknown>
          const textFields = ["recommendation", "text", "content", "summary", "建议"]
          for (const field of textFields) {
            if (typeof obj[field] === "string" && (obj[field] as string).trim()) {
              return (obj[field] as string).trim()
            }
          }
          if (Array.isArray(parsed)) {
            return parsed.map((item) => {
              if (typeof item === "string") return item
              if (typeof item === "object" && item !== null) {
                const o = item as Record<string, unknown>
                return String(o.text || o.content || o.recommendation || "")
              }
              return String(item)
            }).filter(Boolean).join("；")
          }
          return "模型未提供规范格式的综合推荐建议"
        }
      } catch {
        // 解析失败，继续用原文本
      }
    }
    return trimmed
  }, [report.recommendation])
  // 构建名字到ID的映射
  const nameToId = useMemo(() => {
    const map = new Map<string, string>()
    for (const ca of report.characterAnalyses) {
      map.set(ca.name, ca.characterId)
    }
    return map
  }, [report.characterAnalyses])

  // 对比模式：计算角色分析差异
  const characterDiff = useMemo(() => {
    if (!compareReport) return null
    const aNames = new Set(report.characterAnalyses.map((c) => c.name))
    const bNames = new Set(compareReport.characterAnalyses.map((c) => c.name))
    const onlyInA = new Set([...aNames].filter((n) => !bNames.has(n)))
    const onlyInB = new Set([...bNames].filter((n) => !aNames.has(n)))
    const scoreDiff = new Map<string, { a: number; b: number }>()
    for (const ca of report.characterAnalyses) {
      const cb = compareReport.characterAnalyses.find((c) => c.name === ca.name)
      if (cb && ca.consistencyScore !== cb.consistencyScore) {
        scoreDiff.set(ca.name, { a: ca.consistencyScore, b: cb.consistencyScore })
      }
    }
    return { onlyInA, onlyInB, scoreDiff }
  }, [report.characterAnalyses, compareReport])

  const getCharHighlightClass = (name: string): string => {
    if (!characterDiff) return ""
    if (characterDiff.onlyInA.has(name)) return "bg-green-100 dark:bg-green-950/40"
    if (characterDiff.onlyInB.has(name)) return "bg-red-100 dark:bg-red-950/40"
    if (characterDiff.scoreDiff.has(name)) return "bg-amber-100 dark:bg-amber-950/40"
    return ""
  }

  // 对比模式：计算走向分支差异
  const branchDiff = useMemo(() => {
    if (!compareReport) return null
    const aTitles = new Set(report.branches.map((b) => b.title))
    const bTitles = new Set(compareReport.branches.map((b) => b.title))
    const onlyInA = new Set([...aTitles].filter((t) => !bTitles.has(t)))
    const onlyInB = new Set([...bTitles].filter((t) => !aTitles.has(t)))
    const probDiff = new Map<string, { a: string; b: string }>()
    for (const ba of report.branches) {
      const bb = compareReport.branches.find((b) => b.title === ba.title)
      if (bb && ba.probability !== bb.probability) {
        probDiff.set(ba.title, { a: ba.probability, b: bb.probability })
      }
    }
    return { onlyInA, onlyInB, probDiff }
  }, [report.branches, compareReport])

  const getBranchHighlightClass = (title: string): string => {
    if (!branchDiff) return ""
    if (branchDiff.onlyInA.has(title)) return "bg-green-100 dark:bg-green-950/40"
    if (branchDiff.onlyInB.has(title)) return "bg-red-100 dark:bg-red-950/40"
    if (branchDiff.probDiff.has(title)) return "bg-amber-100 dark:bg-amber-950/40"
    return ""
  }

  // 对比模式：计算综合推荐差异（按句号分段）
  const recommendationDiff = useMemo(() => {
    if (!compareReport || !safeRecommendation) return null
    const compareRec = compareReport.recommendation?.trim() || ""

    // 对比方也做同样清洗
    const safeCompare = (() => {
      if (!compareRec) return ""
      if ((compareRec.startsWith("{") && compareRec.endsWith("}")) ||
          (compareRec.startsWith("[") && compareRec.endsWith("]"))) {
        try {
          const parsed = JSON.parse(compareRec)
          if (typeof parsed === "string") return parsed.trim()
          if (typeof parsed === "object" && parsed !== null) {
            const obj = parsed as Record<string, unknown>
            const textFields = ["recommendation", "text", "content", "summary", "建议"]
            for (const field of textFields) {
              if (typeof obj[field] === "string" && (obj[field] as string).trim()) {
                return (obj[field] as string).trim()
              }
            }
            return ""
          }
        } catch {
          // 解析失败，用原文本
        }
      }
      return compareRec
    })()

    if (!safeCompare) return { segments: [{ text: safeRecommendation, isDifferent: true }] }

    const aSegments = safeRecommendation.split(/[。！？]/).filter((s) => s.trim())
    const bSegments = new Set(safeCompare.split(/[。！？]/).filter((s) => s.trim()))

    return {
      segments: aSegments.map((seg) => ({
        text: seg,
        isDifferent: !bSegments.has(seg),
      })),
    }
  }, [safeRecommendation, compareReport])

  // 对比模式：计算时间线事件差异
  const timelineDiff = useMemo(() => {
    if (!compareReport || !compareTimelineEvents) return null
    const aCount = timelineEvents.length
    const bCount = compareTimelineEvents.length

    const aActivity = new Map<string, number>()
    for (const ev of timelineEvents) {
      aActivity.set(ev.actorName, (aActivity.get(ev.actorName) || 0) + 1)
    }
    const aRanking = Array.from(aActivity.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)

    return { aCount, bCount, aRanking }
  }, [timelineEvents, compareReport, compareTimelineEvents])

  return (
    <div className="flex h-full flex-col">
      {title && (
        <div className="border-b bg-muted/30 px-4 py-2 text-sm font-medium text-center">
          {title}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className={`mx-auto ${compact ? "max-w-none" : "max-w-3xl"} space-y-6`}>
          {/* 关键剧情事件时间线 */}
          {timelineDiff && (
            <div className="flex items-center gap-4 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium">事件数量对比：</span>
              <span className="text-primary">A: {timelineDiff.aCount}</span>
              <span className="text-muted-foreground">vs</span>
              <span className="text-red-500">B: {timelineDiff.bCount}</span>
              <span className="ml-auto text-muted-foreground">
                差异: {Math.abs(timelineDiff.aCount - timelineDiff.bCount)} 条
              </span>
            </div>
          )}
          {timelineEvents.length > 0 && (
            <TimelineGroupedEvents
              events={timelineEvents}
              framework={framework}
              nameToId={nameToId}
              onInterviewAgent={onInterviewAgent}
              compact={compact}
            />
          )}

          {/* 角色采访区 */}
          {!compact && report.characterAnalyses.length > 0 && onInterviewAgent && (
            <section>
              <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MessageCircle className="h-3.5 w-3.5" />
                采访角色
              </h3>
              <div className="flex flex-wrap gap-2">
                {report.characterAnalyses.map((char) => (
                  <Button
                    key={char.characterId}
                    variant="outline"
                    size="sm"
                    onClick={() => onInterviewAgent(char.characterId, char.name)}
                  >
                    <MessageCircle className="mr-1 h-3.5 w-3.5" />
                    与 {char.name} 对话
                  </Button>
                ))}
              </div>
            </section>
          )}

          {/* 角色行为分析 */}
          {report.characterAnalyses.length > 0 && (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                角色行为分析
              </h3>
              <div className="space-y-3">
                {report.characterAnalyses.map((char) => (
                  <div key={char.characterId} className={cn("rounded-lg border p-3", getCharHighlightClass(char.name))}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{char.name}</span>
                      <span className="rounded px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        一致性: {char.consistencyScore}
                        {characterDiff?.scoreDiff.has(char.name) && (
                          <span className="ml-1 text-amber-600">
                            (B: {characterDiff.scoreDiff.get(char.name)!.b})
                          </span>
                        )}
                      </span>
                    </div>

                    {char.behaviors.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">行为：</p>
                        <ul className="space-y-1">
                          {char.behaviors.map((b, i) => (
                            <li key={i} className="text-sm">
                              <span className="text-muted-foreground">[{b.node}]</span> {b.action}
                              <span className="text-muted-foreground"> — 动机: {b.motivation}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {char.stateChanges.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">状态变化：</p>
                        <ul className="list-disc space-y-0.5 pl-4 text-sm">
                          {char.stateChanges.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 走向分支 */}
          {report.branches.length > 0 && (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                走向分支
              </h3>
              <div className="space-y-3">
                {report.branches.map((branch, idx) => (
                  <div key={idx} className={cn("rounded-lg border p-3", getBranchHighlightClass(branch.title))}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{branch.title}</span>
                      {branch.recommendation && (
                        <span className="rounded px-1.5 py-0.5 text-xs bg-primary/10 text-primary">推荐</span>
                      )}
                      <span className={`rounded px-1.5 py-0.5 text-xs ${PROBABILITY_COLORS[branch.probability]}`}>
                        概率: {branch.probability === "high" ? "高" : branch.probability === "medium" ? "中" : "低"}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-muted-foreground">{branch.summary}</p>

                    {branch.keyEvents.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">关键事件：</p>
                        <ul className="list-disc space-y-0.5 pl-4 text-sm">
                          {branch.keyEvents.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      </div>
                    )}

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {branch.pros && (
                        <div className="rounded-md bg-green-50 p-2 text-sm dark:bg-green-950/30">
                          <span className="font-medium text-green-700 dark:text-green-400">利：</span>
                          {branch.pros}
                        </div>
                      )}
                      {branch.cons && (
                        <div className="rounded-md bg-red-50 p-2 text-sm dark:bg-red-950/30">
                          <span className="font-medium text-red-700 dark:text-red-400">弊：</span>
                          {branch.cons}
                        </div>
                      )}
                    </div>

                    {!compact && onGenerateDraft && (
                      <Button
                        variant="default"
                        size="sm"
                        className="mt-3"
                        onClick={() => onGenerateDraft(branch)}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        生成草稿
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 综合推荐 */}
          {safeRecommendation && (
            <section>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  综合推荐
                  {recommendationDiff && (
                    <span className="ml-auto text-xs font-normal text-amber-600">有差异</span>
                  )}
                </h3>
                {recommendationDiff ? (
                  <div className="space-y-1 text-sm leading-relaxed">
                    {recommendationDiff.segments.map((seg, i) => (
                      <span
                        key={i}
                        className={seg.isDifferent ? "rounded bg-amber-100 px-1 dark:bg-amber-950/40" : ""}
                      >
                        {seg.text}。
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed">{safeRecommendation}</p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

export function SimulationReportView({
  onResimulate,
  onGenerateDraft,
  onInterviewAgent,
  onViewDraft,
  hasDraft,
  onViewInterviewHistory,
}: SimulationReportViewProps) {
  const { t } = useTranslation()
  const projectPath = useWikiStore((s) => s.project?.path)
  const report = useStorySimulationStore((s) => s.currentReport)
  const currentFramework = useStorySimulationStore((s) => s.currentFramework)
  const timelineEvents = useStorySimulationStore((s) => s.timelineEvents)
  const savedResults = useStorySimulationStore((s) => s.savedResults)
  const setError = useStorySimulationStore((s) => s.setError)
  const setInfoMessage = useStorySimulationStore((s) => s.setInfoMessage)
  const [exporting, setExporting] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [selectedCompareId, setSelectedCompareId] = useState<string | null>(null)
  const [viewingResultId, setViewingResultId] = useState<string | null>(null)

  // 当前查看的结果（可能是历史结果）
  const currentResult: SavedSimulationResult | null = useMemo(() => {
    if (!viewingResultId) return null
    return savedResults.find(r => r.id === viewingResultId) || null
  }, [viewingResultId, savedResults])

  const activeReport = currentResult?.report || report
  const activeTimeline = currentResult?.timelineEvents || timelineEvents
  const compareResult = selectedCompareId ? savedResults.find(r => r.id === selectedCompareId) : null

  // 可选择对比的结果（排除当前查看的）
  const comparableResults = useMemo(() => {
    return savedResults.filter(r => r.id !== viewingResultId && r.report)
  }, [savedResults, viewingResultId])

  const handleExport = async () => {
    if (!projectPath || !activeReport || !currentFramework) return
    setExporting(true)
    try {
      const filePath = await exportReport(projectPath, currentFramework, activeReport, activeTimeline)
      setInfoMessage(`报告已导出到：${filePath}`)
      setTimeout(() => setInfoMessage(null), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败")
      setTimeout(() => setError(null), 5000)
    } finally {
      setExporting(false)
    }
  }

  const handleExitCompare = () => {
    setCompareMode(false)
    setSelectedCompareId(null)
  }

  if (!activeReport) return null

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{t("storySimulation.reportTitle")}</h2>
          {currentResult && (
            <span className="rounded bg-muted px-2 py-0.5 text-[0.625rem] text-muted-foreground">
              {formatDate(currentResult.createdAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 历史结果选择 */}
          {savedResults.length > 0 && (
            <select
              value={viewingResultId || ""}
              onChange={(e) => {
                setViewingResultId(e.target.value || null)
                setCompareMode(false)
                setSelectedCompareId(null)
              }}
              className="h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">最新推演</option>
              {savedResults.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatDate(r.createdAt)} ({r.report.mode})
                </option>
              ))}
            </select>
          )}
          {/* 对比按钮 */}
          {comparableResults.length > 0 && !compareMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCompareMode(true)
                if (comparableResults.length > 0) {
                  setSelectedCompareId(comparableResults[0].id)
                }
              }}
            >
              <GitCompare className="mr-1 h-3.5 w-3.5" />
              对比结果
            </Button>
          )}
          {compareMode && (
            <>
              <select
                value={selectedCompareId || ""}
                onChange={(e) => setSelectedCompareId(e.target.value || null)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                {comparableResults.map((r) => (
                  <option key={r.id} value={r.id}>
                    对比: {formatDate(r.createdAt)}
                  </option>
                ))}
              </select>
              <Button variant="ghost" size="sm" onClick={handleExitCompare}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {onViewInterviewHistory && (
            <Button
              variant="outline"
              size="sm"
              onClick={onViewInterviewHistory}
            >
              <MessageCircle className="mr-1 h-3.5 w-3.5" />
              采访历史
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            {exporting ? "导出中..." : "导出报告"}
          </Button>
          {!currentResult && hasDraft && onViewDraft && (
            <Button variant="default" size="sm" onClick={onViewDraft}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              查看草稿
            </Button>
          )}
          {!currentResult && (
            <Button variant="outline" size="sm" onClick={onResimulate}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              {t("storySimulation.resimulate")}
            </Button>
          )}
        </div>
      </div>

      {/* 内容区域：单栏或双栏对比 */}
      {compareMode && compareResult ? (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 border-r">
            <ReportContent
              report={activeReport}
              timelineEvents={activeTimeline}
              framework={currentFramework}
              onInterviewAgent={!currentResult ? onInterviewAgent : undefined}
              onGenerateDraft={!currentResult ? onGenerateDraft : undefined}
              title={currentResult ? `结果 A (${formatDate(currentResult.createdAt)})` : "结果 A (最新)"}
              compact={true}
              compareReport={compareResult?.report}
              compareTimelineEvents={compareResult?.timelineEvents || []}
            />
          </div>
          <div className="min-w-0 flex-1">
            <ReportContent
              report={compareResult.report}
              timelineEvents={compareResult.timelineEvents || []}
              framework={currentFramework}
              title={`结果 B (${formatDate(compareResult.createdAt)})`}
              compact={true}
            />
          </div>
        </div>
      ) : (
        <ReportContent
          report={activeReport}
          timelineEvents={activeTimeline}
          framework={currentFramework}
          onInterviewAgent={!currentResult ? onInterviewAgent : undefined}
          onGenerateDraft={!currentResult ? onGenerateDraft : undefined}
        />
      )}
    </div>
  )
}

// ── 按节点分组折叠的时间线组件 ──

function TimelineGroupedEvents({
  events,
  framework,
  nameToId,
  onInterviewAgent,
  compact,
}: {
  events: TimelineEvent[]
  framework?: StoryFramework | null
  nameToId: Map<string, string>
  onInterviewAgent?: (agentId: string, agentName: string) => void
  compact?: boolean
}) {
  // 折叠状态：key = nodeIndex，value = 是否折叠
  const [collapsedNodes, setCollapsedNodes] = useState<Set<number>>(new Set())

  // 构建节点索引映射
  const nodeMap = useMemo(() => {
    const map = new Map<number, { title: string; phase: string }>()
    if (framework) {
      for (const node of framework.nodes) {
        map.set(node.index, { title: node.title, phase: node.phase })
      }
    }
    return map
  }, [framework])

  // 阶段中文标签
  const phaseLabel = (phase: string): string => {
    const map: Record<string, string> = { 起: "起", 承: "承", 转: "转", 合: "合" }
    return map[phase] || phase
  }

  // 按节点分组事件
  const groupedEvents = useMemo(() => {
    const groups = new Map<number, TimelineEvent[]>()
    for (const ev of events) {
      const idx = ev.nodeIndex
      if (!groups.has(idx)) groups.set(idx, [])
      groups.get(idx)!.push(ev)
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a - b)
      .map(([nodeIndex, evs]) => ({
        nodeIndex,
        nodeInfo: nodeMap.get(nodeIndex),
        events: evs,
      }))
  }, [events, nodeMap])

  const toggleNode = (idx: number) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  const expandAll = () => setCollapsedNodes(new Set())
  const collapseAll = () => {
    const allNodes = new Set(groupedEvents.map((g) => g.nodeIndex))
    setCollapsedNodes(allNodes)
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          关键剧情事件
        </h3>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={expandAll}
          >
            全部展开
          </button>
          <span className="text-muted-foreground">|</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={collapseAll}
          >
            全部折叠
          </button>
        </div>
      </div>
      <div className={compact ? "space-y-2" : "space-y-3"}>
        {groupedEvents.map(({ nodeIndex, nodeInfo, events: nodeEvents }) => {
          const isCollapsed = collapsedNodes.has(nodeIndex)
          const phase = nodeInfo?.phase || "起"
          const nodeTitle = nodeInfo?.title || `节点 ${nodeIndex + 1}`
          return (
            <div key={nodeIndex} className="rounded-md border bg-background/50">
              {/* 节点标题栏 - 可点击折叠 */}
              <button
                type="button"
                className={`flex w-full items-center gap-2 text-left hover:bg-accent/50 ${compact ? "px-2 py-1.5" : "px-3 py-2"}`}
                onClick={() => toggleNode(nodeIndex)}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.6875rem] font-medium text-primary">
                  {phaseLabel(phase)}
                </span>
                <span className={`font-medium ${compact ? "text-xs" : "text-sm"}`}>
                  节点 {nodeIndex + 1}：{nodeTitle}
                </span>
                <span className="ml-auto text-[0.6875rem] text-muted-foreground">
                  {nodeEvents.length} 条
                </span>
              </button>
              {/* 节点事件列表 */}
              {!isCollapsed && (
                <div className={`border-t ${compact ? "space-y-1 p-2" : "space-y-2 p-3"}`}>
                  {nodeEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className={`rounded-md border bg-muted/20 ${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
                          R{ev.round + 1}
                        </span>
                        {onInterviewAgent ? (
                          <button
                            type="button"
                            className="font-medium text-primary hover:underline"
                            onClick={() => onInterviewAgent(ev.actorId, ev.actorName)}
                          >
                            {ev.actorName}
                          </button>
                        ) : (
                          <span className="font-medium">{ev.actorName}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {actionLabel(ev.actionType)}
                        </span>
                        {ev.targetName && (
                          <>
                            <span className="text-xs text-muted-foreground">→</span>
                            {onInterviewAgent ? (
                              <button
                                type="button"
                                className="text-xs text-primary hover:underline"
                                onClick={() => {
                                  const targetId = ev.targetId || nameToId.get(ev.targetName || "")
                                  if (targetId && ev.targetName) {
                                    onInterviewAgent(targetId, ev.targetName)
                                  }
                                }}
                              >
                                {ev.targetName}
                              </button>
                            ) : (
                              <span className="text-xs">{ev.targetName}</span>
                            )}
                          </>
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-foreground/90">
                        {ev.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
