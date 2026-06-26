import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { MessageCircle, RefreshCw, Sparkles, TrendingUp, Network } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import type { StoryBranch } from "@/lib/novel/story-simulation/types"

const PROBABILITY_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  low: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
}

interface SimulationReportViewProps {
  onResimulate: () => void
  onGenerateDraft: (branch: StoryBranch) => void
  onInterviewAgent: (agentId: string, agentName: string) => void
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

export function SimulationReportView({
  onResimulate,
  onGenerateDraft,
  onInterviewAgent,
}: SimulationReportViewProps) {
  const { t } = useTranslation()
  const report = useStorySimulationStore((s) => s.currentReport)
  const timelineEvents = useStorySimulationStore((s) => s.timelineEvents)

  if (!report) return null

  // 构建角色关系网络数据
  const relationshipData = useMemo(() => {
    if (timelineEvents.length === 0) return null

    // 统计角色活跃度
    const activityCount = new Map<string, number>()
    // 统计角色间互动：key = "A|B"（字母序），value = { count, sentiment }
    const interactions = new Map<string, { count: number; sentiment: number; lastAction: string }>()

    for (const ev of timelineEvents) {
      activityCount.set(ev.actorName, (activityCount.get(ev.actorName) || 0) + 1)
      if (ev.targetName) {
        activityCount.set(ev.targetName, (activityCount.get(ev.targetName) || 0) + 1)
        const pair = [ev.actorName, ev.targetName].sort().join("|")
        const existing = interactions.get(pair) || { count: 0, sentiment: 0, lastAction: "" }
        let sentimentDelta = 0
        switch (ev.actionType) {
          case "ally":
            sentimentDelta = 2
            break
          case "speak":
            sentimentDelta = 0.5
            break
          case "confront":
            sentimentDelta = -2
            break
          case "react":
            sentimentDelta = ev.content.includes("好感") || ev.content.includes("赞同") ? 1 : -1
            break
          default:
            sentimentDelta = 0
        }
        interactions.set(pair, {
          count: existing.count + 1,
          sentiment: Math.max(-5, Math.min(5, existing.sentiment + sentimentDelta)),
          lastAction: ev.content.slice(0, 30),
        })
      }
    }

    const characters = Array.from(activityCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    const edges = Array.from(interactions.entries()).map(([key, data]) => {
      const [from, to] = key.split("|")
      return { from, to, ...data }
    })

    return { characters, edges }
  }, [timelineEvents])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{t("storySimulation.reportTitle")}</h2>
        </div>
        <Button variant="outline" size="sm" onClick={onResimulate}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t("storySimulation.resimulate")}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* 角色关系网络 */}
          {relationshipData && relationshipData.characters.length > 1 && (
            <section>
              <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Network className="h-3.5 w-3.5" />
                角色关系网络
              </h3>
              <RelationshipGraph data={relationshipData} />
            </section>
          )}

          {/* 关键剧情事件时间线 */}
          {timelineEvents.length > 0 && (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                关键剧情事件
              </h3>
              <div className="space-y-2">
                {timelineEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        节点{ev.nodeIndex + 1}·R{ev.round + 1}
                      </span>
                      <span className="font-medium">{ev.actorName}</span>
                      <span className="text-xs text-muted-foreground">
                        {actionLabel(ev.actionType)}
                      </span>
                      {ev.targetName && (
                        <span className="text-xs text-muted-foreground">
                          → {ev.targetName}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-foreground/90">
                      {ev.content}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 角色采访区 */}
          {report.characterAnalyses.length > 0 && (
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
                    onClick={() =>
                      onInterviewAgent(char.characterId, char.name)
                    }
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
                {t("storySimulation.characterAnalysis")}
              </h3>
              <div className="space-y-3">
                {report.characterAnalyses.map((char) => (
                  <div key={char.characterId} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{char.name}</span>
                      <span className="rounded px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        {t("storySimulation.consistencyScore")}: {char.consistencyScore}
                      </span>
                    </div>

                    {char.behaviors.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          {t("storySimulation.behaviors")}
                        </p>
                        <ul className="space-y-1">
                          {char.behaviors.map((b, i) => (
                            <li key={i} className="text-sm">
                              <span className="text-muted-foreground">[{b.node}]</span>{" "}
                              {b.action}
                              <span className="text-muted-foreground">
                                {" "}
                                — {t("storySimulation.motivation")}: {b.motivation}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {char.stateChanges.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          {t("storySimulation.stateChanges")}
                        </p>
                        <ul className="list-disc space-y-0.5 pl-4 text-sm">
                          {char.stateChanges.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
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
                {t("storySimulation.storyBranches")}
              </h3>
              <div className="space-y-3">
                {report.branches.map((branch, idx) => (
                  <div key={idx} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{branch.title}</span>
                      {branch.recommendation && (
                        <span className="rounded px-1.5 py-0.5 text-xs bg-primary/10 text-primary">
                          {t("storySimulation.recommended")}
                        </span>
                      )}
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${PROBABILITY_COLORS[branch.probability]}`}
                      >
                        {t("storySimulation.probability")}:{" "}
                        {t(`storySimulation.probability${branch.probability.charAt(0).toUpperCase()}${branch.probability.slice(1)}`)}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-muted-foreground">{branch.summary}</p>

                    {branch.keyEvents.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          {t("storySimulation.keyEvents")}
                        </p>
                        <ul className="list-disc space-y-0.5 pl-4 text-sm">
                          {branch.keyEvents.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {branch.pros && (
                        <div className="rounded-md bg-green-50 p-2 text-sm dark:bg-green-950/30">
                          <span className="font-medium text-green-700 dark:text-green-400">
                            {t("storySimulation.pros")}:{" "}
                          </span>
                          {branch.pros}
                        </div>
                      )}
                      {branch.cons && (
                        <div className="rounded-md bg-red-50 p-2 text-sm dark:bg-red-950/30">
                          <span className="font-medium text-red-700 dark:text-red-400">
                            {t("storySimulation.cons")}:{" "}
                          </span>
                          {branch.cons}
                        </div>
                      )}
                    </div>

                    <Button
                      variant="default"
                      size="sm"
                      className="mt-3"
                      onClick={() => onGenerateDraft(branch)}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {t("storySimulation.generateDraft")}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 综合推荐 */}
          {report.recommendation && (
            <section>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("storySimulation.recommendation")}
                </h3>
                <p className="text-sm leading-relaxed">{report.recommendation}</p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 角色关系图谱组件（SVG 实现，轻量无依赖） ──

interface RelationNode {
  name: string
  count: number
}

interface RelationEdge {
  from: string
  to: string
  count: number
  sentiment: number
  lastAction: string
}

interface RelationshipGraphData {
  characters: RelationNode[]
  edges: RelationEdge[]
}

function RelationshipGraph({ data }: { data: RelationshipGraphData }) {
  const { characters, edges } = data
  const width = 520
  const height = 380
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(cx, cy) - 50

  // 圆形布局：按活跃度排序，主角居中
  const positions = useMemo(() => {
    const posMap = new Map<string, { x: number; y: number }>()
    const maxNodes = Math.min(characters.length, 10) // 最多显示10个角色

    if (characters.length === 0) return posMap

    // 最活跃角色放中心
    const main = characters[0]
    posMap.set(main.name, { x: cx, y: cy })

    // 其他角色围一圈
    const others = characters.slice(1, maxNodes)
    others.forEach((char, i) => {
      const angle = (i / others.length) * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(angle) * radius
      const y = cy + Math.sin(angle) * radius
      posMap.set(char.name, { x, y })
    })

    return posMap
  }, [characters, cx, cy, radius])

  const maxActivity = characters[0]?.count || 1

  const nodeRadius = (count: number, isMain: boolean) => {
    if (isMain) return 28
    return 14 + (count / maxActivity) * 14
  }

  const edgeColor = (sentiment: number) => {
    if (sentiment > 1) return "#22c55e" // 绿色-友好
    if (sentiment < -1) return "#ef4444" // 红色-敌对
    return "#94a3b8" // 灰色-中立
  }

  const edgeWidth = (count: number) => Math.max(1, Math.min(4, count / 2))

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 380 }}>
        {/* 绘制边 */}
        {edges.map((edge, i) => {
          const from = positions.get(edge.from)
          const to = positions.get(edge.to)
          if (!from || !to) return null
          return (
            <line
              key={i}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={edgeColor(edge.sentiment)}
              strokeWidth={edgeWidth(edge.count)}
              strokeOpacity={0.6}
            >
              <title>{`${edge.from} ↔ ${edge.to}\n互动${edge.count}次\n情感倾向：${edge.sentiment > 1 ? "友好" : edge.sentiment < -1 ? "敌对" : "中立"}`}</title>
            </line>
          )
        })}

        {/* 绘制节点 */}
        {characters.slice(0, 10).map((char, i) => {
          const pos = positions.get(char.name)
          if (!pos) return null
          const isMain = i === 0
          const r = nodeRadius(char.count, isMain)
          return (
            <g key={char.name}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={r}
                fill={isMain ? "hsl(var(--primary))" : "hsl(var(--muted))"}
                stroke={isMain ? "hsl(var(--primary))" : "hsl(var(--border))"}
                strokeWidth={2}
              >
                <title>{`${char.name}\n参与事件：${char.count}次${isMain ? "\n（核心角色）" : ""}`}</title>
              </circle>
              <text
                x={pos.x}
                y={pos.y + r + 14}
                textAnchor="middle"
                fontSize={11}
                fill="currentColor"
                className="fill-muted-foreground"
              >
                {char.name.length > 4 ? char.name.slice(0, 4) : char.name}
              </text>
            </g>
          )
        })}
      </svg>

      {/* 图例 */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-[#22c55e]" /> 友好
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-[#94a3b8]" /> 中立
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-[#ef4444]" /> 敌对
        </span>
        <span>· 节点大小=活跃度 · 线粗细=互动次数</span>
      </div>
    </div>
  )
}
