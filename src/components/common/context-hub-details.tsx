import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp, Database, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { getContextHub } from "@/lib/context-hub/context-hub"
import type {
  ContextCacheItemStatus,
  ContextCacheItemTrace,
  ContextHubSnapshot,
  ContextHubSnapshotRef,
  ContextHubStats,
} from "@/lib/context-hub/types"

type ContextSection = "stableCore" | "sessionSummary" | "dynamicContext"

interface ContextHubDetailsProps {
  reference: ContextHubSnapshotRef
  projectPath?: string | null
  loadSnapshot?: (reference: ContextHubSnapshotRef) => Promise<ContextHubSnapshot | null>
  className?: string
}

const SOURCE_LABELS: Record<string, string> = {
  outline: "大纲资料",
  chapterOutline: "章节大纲",
  volumeContext: "分卷上下文",
  snapshots: "章节快照",
  recentChapterContents: "最近章节正文",
  fallbackRecentSummaries: "最近章节摘要",
  fallbackPreviousEnding: "上一章结尾",
  fallbackCharacterStates: "人物当前状态",
  fallbackForeshadowingStates: "伏笔状态",
  fallbackTimeline: "故事时间线",
  relatedSettings: "相关设定",
  canonRules: "硬性世界规则",
  writingStyle: "写作风格",
  bookAnalysisReferences: "拆书库分析",
  searchResults: "任务检索结果",
  graphSearchResults: "关系图检索结果",
  revisionFeedback: "修订反馈",
  cognitionText: "人物认知",
  soulDoc: "作品灵魂",
  characterAuras: "人物气质",
  sectionBriefing: "小节简报",
  stableCore: "稳定核心缓存",
}

const STATUS_LABELS: Record<ContextCacheItemStatus, string> = {
  hit: "命中",
  refreshed: "已刷新",
  failed: "失败",
}

const STATUS_ORDER: ContextCacheItemStatus[] = ["hit", "refreshed", "failed"]

const SECTION_LABELS: Record<ContextSection, string> = {
  stableCore: "稳定核心",
  sessionSummary: "会话摘要",
  dynamicContext: "动态片段",
}

function getSourceLabel(sourceName: string): string {
  return SOURCE_LABELS[sourceName] ?? "其他上下文"
}

function CacheItemGroup({ status, items }: { status: ContextCacheItemStatus; items: ContextCacheItemTrace[] }) {
  if (items.length === 0) return null
  return (
    <section className="border-t border-border/60 py-2 first:border-t-0">
      <div className="mb-1 text-[11px] font-medium text-foreground">
        {STATUS_LABELS[status]}（{items.length}）
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${item.key}:${item.status}:${index}`} className="min-w-0 text-[11px] text-muted-foreground">
            <div className="flex min-w-0 items-center gap-1.5">
              <FileText aria-hidden="true" className="h-3 w-3 shrink-0" />
              <span className="min-w-0 break-words text-foreground/80">{getSourceLabel(item.sourceName)}</span>
            </div>
            {item.dependencyPaths.length > 0 && (
              <ul className="ml-4 mt-1 space-y-0.5 border-l border-border/70 pl-2">
                {item.dependencyPaths.map((path) => (
                  <li key={path} className="break-all">{path}</li>
                ))}
                {item.dependencyPathsTruncated ? (
                  <li className="text-foreground/60">
                    另有 {Math.max(0, item.dependencyStamp.sourceCount - item.dependencyPaths.length).toLocaleString()} 个文件，按集合指纹校验
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

export function ProviderCacheUsage({ stats }: { stats: ContextHubStats }) {
  const cachedTokens = stats.providerCachedTokens
  const inputTokens = stats.providerInputTokens
  const hitPercent = cachedTokens !== undefined && inputTokens !== undefined && inputTokens > 0
    ? Math.min(100, Math.round((cachedTokens / inputTokens) * 100))
    : null

  return (
    <>
      {cachedTokens !== undefined ? (
        cachedTokens > 0 ? (
          <div className="font-medium text-green-600 dark:text-green-400">
            供应商已确认命中 {cachedTokens.toLocaleString()} Token
            {hitPercent !== null ? `（输入占比 ${hitPercent}%）` : ""}
          </div>
        ) : (
          <div>供应商已确认本次未命中缓存（0 Token）</div>
        )
      ) : stats.providerUsageReported ? (
        <div>供应商已返回 Token 用量，但未提供缓存命中明细</div>
      ) : stats.providerCacheEnabled ? (
        <div>已发送稳定前缀，是否命中以供应商返回为准</div>
      ) : null}
      {(stats.providerCacheWriteTokens ?? 0) > 0 && (
        <div>供应商新写入缓存 {stats.providerCacheWriteTokens?.toLocaleString()} Token</div>
      )}
    </>
  )
}

export function ContextHubDetails({
  reference,
  projectPath,
  loadSnapshot,
  className,
}: ContextHubDetailsProps) {
  const [expanded, setExpanded] = useState(false)
  const [snapshot, setSnapshot] = useState<ContextHubSnapshot | null | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [activeSection, setActiveSection] = useState<ContextSection>("stableCore")
  const stats = reference.stats

  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    setSnapshot(undefined)
    setLoading(true)
    const read = async () => {
      const loader = loadSnapshot
        ?? (projectPath ? (value: ContextHubSnapshotRef) => getContextHub(projectPath).readSnapshot(value) : undefined)
      try {
        const value = loader ? await loader(reference) : null
        if (!cancelled) setSnapshot(value)
      } catch {
        if (!cancelled) setSnapshot(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void read()
    return () => { cancelled = true }
  }, [expanded, loadSnapshot, projectPath, reference.createdAt, reference.id])

  return (
    <div className={cn("mt-2 min-w-0 border-t border-border/60 pt-2", className)}>
      <button
        type="button"
        aria-label={expanded ? "收起上下文中控" : "展开上下文中控"}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full min-w-0 items-start gap-2 text-left"
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-100 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400">
          <Database aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-foreground">上下文中控</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            本轮缓存事件：命中 {stats.hits.toLocaleString()}，刷新 {stats.refreshed.toLocaleString()}，失败 {stats.failures.toLocaleString()}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            稳定核心 {stats.stableTokens.toLocaleString()} Token　会话摘要 {stats.summaryTokens.toLocaleString()} Token　动态片段 {stats.dynamicTokens.toLocaleString()} Token
          </span>
          {stats.composedTokens !== undefined && stats.budgetTokens !== undefined ? (
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              最终上下文占用 {stats.composedTokens.toLocaleString()} / {stats.budgetTokens.toLocaleString()} Token（{stats.utilizationPercent ?? 0}%）
            </span>
          ) : null}
          {stats.memoryCandidateCount !== undefined ? (
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              用户记忆：候选 {stats.memoryCandidateCount}，命中 {stats.memorySelectedCount ?? 0}，过滤 {stats.memoryFilteredCount ?? 0}，注入约 {stats.memoryEstimatedTokens ?? 0} Token
            </span>
          ) : null}
        </span>
        {expanded
          ? <ChevronUp aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronDown aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="ml-8 mt-2 min-w-0">
          <div className="mb-2 space-y-0.5 text-[11px] text-muted-foreground">
            <div>上下文压缩预计减少 {stats.estimatedSavedTokens.toLocaleString()} Token（{stats.estimatedSavedPercent}%）</div>
            <div>低置信度扩展：{stats.expanded ? "已启用" : "未启用"}</div>
            <ProviderCacheUsage stats={stats} />
          </div>

          {loading ? (
            <div className="py-3 text-[11px] text-muted-foreground">正在读取上下文快照...</div>
          ) : snapshot === null ? (
            <div className="py-3 text-[11px] text-amber-700 dark:text-amber-300">上下文快照不可用</div>
          ) : snapshot ? (
            <div className="mt-2 min-w-0">
              <div className="max-h-48 overflow-y-auto border-y border-border/60 pr-1">
                {STATUS_ORDER.map((status) => (
                  <CacheItemGroup
                    key={status}
                    status={status}
                    items={snapshot.items.filter((item) => item.status === status)}
                  />
                ))}
              </div>
              <div className="flex border-b border-border/60" role="tablist" aria-label="上下文内容">
                {(Object.keys(SECTION_LABELS) as ContextSection[]).map((section) => (
                  <button
                    key={section}
                    type="button"
                    role="tab"
                    aria-selected={activeSection === section}
                    onClick={() => setActiveSection(section)}
                    className={cn(
                      "border-b-2 px-2 py-1.5 text-[11px] font-medium",
                      activeSection === section
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {SECTION_LABELS[section]}
                  </button>
                ))}
              </div>
              <pre className="max-h-96 min-w-0 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words bg-muted/30 p-2 text-[11px] leading-relaxed text-foreground/80">
                {snapshot[activeSection] || `本轮无${SECTION_LABELS[activeSection]}内容`}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
