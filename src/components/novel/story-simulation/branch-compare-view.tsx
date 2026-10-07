import { useState, useMemo, useEffect } from "react"
import { ArrowLeft, BarChart3, Clock, Zap } from "lucide-react"
import type { SimulationBranch, DirectorScore } from "@/lib/novel/story-simulation/types"
import { actionTypeShortLabel } from "@/lib/novel/story-simulation/action-type-utils"
import { Button } from "@/components/ui/button"
import { useSimulationWorker } from "@/hooks/use-simulation-worker"

interface BranchCompareViewProps {
  branches: SimulationBranch[]
  compareBranchIds: string[]
  onBack: () => void
}

const DIMENSION_KEYS: (keyof DirectorScore)[] = [
  "tension",
  "pace",
  "characterUtilization",
  "characterArc",
  "infoDensity",
  "emotionalResonance",
  "logicConsistency",
]

const DIMENSION_LABELS: Record<keyof DirectorScore, string> = {
  tension: "剧情张力",
  pace: "节奏把控",
  characterUtilization: "角色发挥",
  characterArc: "人物弧光",
  infoDensity: "信息密度",
  emotionalResonance: "情感共鸣",
  logicConsistency: "逻辑自洽",
}

const BRANCH_COLORS = [
  "#3b82f6",
  "#f97316",
  "#10b981",
]

function getAvgDirectorScore(branch: SimulationBranch): DirectorScore {
  if (branch.directorEvaluations.length === 0) {
    return {
      tension: 3.0,
      pace: 3.0,
      characterUtilization: 3.0,
      characterArc: 3.0,
      infoDensity: 3.0,
      emotionalResonance: 3.0,
      logicConsistency: 3.0,
    }
  }
  const sum: DirectorScore = {
    tension: 0,
    pace: 0,
    characterUtilization: 0,
    characterArc: 0,
    infoDensity: 0,
    emotionalResonance: 0,
    logicConsistency: 0,
  }
  for (const ev of branch.directorEvaluations) {
    for (const key of DIMENSION_KEYS) {
      sum[key] += ev.scores[key]
    }
  }
  const n = branch.directorEvaluations.length
  const avg: DirectorScore = { ...sum }
  for (const key of DIMENSION_KEYS) {
    avg[key] = Math.round((avg[key] / n) * 10) / 10
  }
  return avg
}

function RadarChart({
  branches,
  size = 320,
}: {
  branches: SimulationBranch[]
  size?: number
}) {
  const center = size / 2
  const radius = size * 0.38
  const levels = 3
  const angleStep = (Math.PI * 2) / DIMENSION_KEYS.length

  const scoresList = branches.map((b) => getAvgDirectorScore(b))

  const getPoint = (angle: number, r: number) => ({
    x: center + r * Math.sin(angle),
    y: center - r * Math.cos(angle),
  })

  const gridPolygons = []
  for (let i = 1; i <= levels; i++) {
    const r = (radius * i) / levels
    const points = DIMENSION_KEYS.map((_, idx) => {
      const { x, y } = getPoint(angleStep * idx, r)
      return `${x},${y}`
    }).join(" ")
    gridPolygons.push(
      <polygon
        key={`grid-${i}`}
        points={points}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={1}
      />,
    )
  }

  const axisLines = DIMENSION_KEYS.map((_, idx) => {
    const { x, y } = getPoint(angleStep * idx, radius)
    return (
      <line
        key={`axis-${idx}`}
        x1={center}
        y1={center}
        x2={x}
        y2={y}
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={1}
      />
    )
  })

  const labelElements = DIMENSION_KEYS.map((key, idx) => {
    const { x, y } = getPoint(angleStep * idx, radius + 24)
    return (
      <text
        key={`label-${idx}`}
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-current text-[0.6875rem] text-foreground"
      >
        {DIMENSION_LABELS[key]}
      </text>
    )
  })

  const dataPolygons = scoresList.map((scores, bIdx) => {
    const points = DIMENSION_KEYS.map((key, idx) => {
      const value = Math.max(0, Math.min(5, scores[key]))
      const r = (radius * value) / 5
      const { x, y } = getPoint(angleStep * idx, r)
      return `${x},${y}`
    }).join(" ")
    return (
      <polygon
        key={`data-${bIdx}`}
        points={points}
        fill={BRANCH_COLORS[bIdx]}
        fillOpacity={0.15}
        stroke={BRANCH_COLORS[bIdx]}
        strokeWidth={2}
      />
    )
  })

  const dataDots = scoresList.map((scores, bIdx) =>
    DIMENSION_KEYS.map((key, idx) => {
      const value = Math.max(0, Math.min(5, scores[key]))
      const r = (radius * value) / 5
      const { x, y } = getPoint(angleStep * idx, r)
      return (
        <circle
          key={`dot-${bIdx}-${idx}`}
          cx={x}
          cy={y}
          r={3}
          fill={BRANCH_COLORS[bIdx]}
        />
      )
    }),
  )

  return (
    <svg width={size} height={size} className="text-foreground">
      {gridPolygons}
      {axisLines}
      {labelElements}
      {dataPolygons}
      {dataDots}
    </svg>
  )
}

function ScoreCompareTab({ branches }: { branches: SimulationBranch[] }) {
  const scoresList = branches.map((b) => getAvgDirectorScore(b))

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <RadarChart branches={branches} size={360} />
      </div>

      <div className="flex justify-center gap-4 flex-wrap">
        {branches.map((b, idx) => (
          <div key={b.id} className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: BRANCH_COLORS[idx] }}
            />
            <span className="text-xs">{b.name}</span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">维度</th>
              {branches.map((b) => (
                <th key={b.id} className="px-3 py-2 text-center font-medium">
                  {b.name}
                </th>
              ))}
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">最大差异</th>
            </tr>
          </thead>
          <tbody>
            {DIMENSION_KEYS.map((key) => {
              const values = scoresList.map((s) => s[key])
              const max = Math.max(...values)
              const min = Math.min(...values)
              const diff = Math.round((max - min) * 10) / 10
              return (
                <tr key={key} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-2">{DIMENSION_LABELS[key]}</td>
                  {values.map((v, idx) => (
                    <td key={idx} className="px-3 py-2 text-center font-medium">
                      <span
                        style={{ color: v === max ? BRANCH_COLORS[idx] : undefined }}
                      >
                        {v.toFixed(1)}
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center text-muted-foreground">
                    {diff > 0 ? `+${diff}` : "-"}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t-2 border-primary/30 bg-primary/5 font-medium">
              <td className="px-3 py-2">综合评分</td>
              {branches.map((b) => (
                <td key={b.id} className="px-3 py-2 text-center text-primary">
                  {b.overallScore.toFixed(1)}
                </td>
              ))}
              <td className="px-3 py-2 text-center text-muted-foreground">
                +{(Math.max(...branches.map((b) => b.overallScore)) - Math.min(...branches.map((b) => b.overallScore))).toFixed(1)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TimelineCompareTab({ branches }: { branches: SimulationBranch[] }) {
  const groupedList = branches.map((b) => {
    const groups = new Map<number, typeof b.timelineEvents>()
    for (const ev of b.timelineEvents) {
      if (!groups.has(ev.round)) groups.set(ev.round, [])
      groups.get(ev.round)!.push(ev)
    }
    return {
      branch: b,
      rounds: Array.from(groups.entries())
        .sort(([a], [b]) => a - b)
        .map(([round, events]) => ({ round, events })),
    }
  })

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${branches.length}, minmax(0, 1fr))` }}>
      {groupedList.map(({ branch, rounds }, bIdx) => (
        <div key={branch.id} className="flex min-h-0 flex-col rounded-lg border bg-muted/20">
          <div className="border-b px-3 py-2 text-center">
            <div className="text-sm font-medium">{branch.name}</div>
            <div className="text-xs text-primary">综合 {branch.overallScore.toFixed(1)} 分</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {rounds.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                暂无事件
              </div>
            ) : (
              <div className="space-y-3">
                {rounds.map(({ round, events }) => (
                  <div key={round} className="space-y-1.5">
                    <div className="text-[0.6875rem] font-medium text-muted-foreground">
                      第 {round + 1} 轮 · {events.length} 条事件
                    </div>
                    {events.map((ev) => (
                      <div
                        key={ev.id}
                        className="rounded-md border bg-background/70 p-2 text-xs leading-relaxed"
                      >
                        <div className="mb-0.5">
                          <span className="font-medium" style={{ color: BRANCH_COLORS[bIdx] }}>
                            {ev.actorName}
                          </span>
                          <span className="text-muted-foreground">
                            {" "}
                            {ev.targetName ? `对 ${ev.targetName}` : ""} · {actionTypeShortLabel(ev.actionType)}
                          </span>
                        </div>
                        <div className="line-clamp-3 text-muted-foreground">
                          {ev.content}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function KeyDifferencesTab({ branches }: { branches: SimulationBranch[] }) {
  const { calcBranchDiff } = useSimulationWorker()
  const [diffResult, setDiffResult] = useState<{
    dimensionDiffs: { key: string; diff: number; maxBranchName: string; maxValue: number; minValue: number }[]
    eventCounts: number[]
    characterCounts: number[]
    topSentimentDiffs: { charId: string; charName: string; maxDiff: number; maxBranch: string; values: number[] }[]
    divergenceRound: number
    bestBranchIdx: number
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (branches.length < 2) {
      setLoading(false)
      return
    }
    setLoading(true)
    calcBranchDiff(branches[0], branches[1]).then((result) => {
      setDiffResult(result)
      setLoading(false)
    })
  }, [branches, calcBranchDiff])

  if (loading || !diffResult) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="text-sm text-muted-foreground">分析中...</div>
      </div>
    )
  }

  const { dimensionDiffs: rawDimensionDiffs, eventCounts, characterCounts, topSentimentDiffs, divergenceRound, bestBranchIdx } = diffResult

  const dimensionDiffs = rawDimensionDiffs.map((d) => ({
    ...d,
    label: DIMENSION_LABELS[d.key as keyof DirectorScore],
  }))

  const bestBranch = branches[bestBranchIdx]
  const secondBestIdx = branches.findIndex((_, i) => i !== bestBranchIdx)
  const secondBest = secondBestIdx >= 0 ? branches[secondBestIdx] : null

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-muted/20 p-4">
          <h3 className="mb-3 text-sm font-medium">评分差异最大的 3 个维度</h3>
          <div className="space-y-2">
            {dimensionDiffs.map((d, idx) => (
              <div key={d.key} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {idx + 1}. {d.label}
                </span>
                <span className="font-medium">
                  {d.maxBranchName} 领先 {d.maxValue.toFixed(1)} vs {d.minValue.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <h3 className="mb-3 text-sm font-medium">基础数据对比</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">事件数量</span>
              <span className="font-medium">
                {eventCounts.join(" / ")} 条
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">角色数量</span>
              <span className="font-medium">
                {characterCounts.join(" / ")} 人
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">分岔轮次</span>
              <span className="font-medium">
                {divergenceRound > 0 ? `第 ${divergenceRound} 轮开始` : "无明显分岔"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 p-4">
        <h3 className="mb-3 text-sm font-medium">角色好感度差异最大的 3 对</h3>
        {topSentimentDiffs.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无数据</div>
        ) : (
          <div className="space-y-2">
            {topSentimentDiffs.map((d, idx) => (
              <div key={d.charId} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {idx + 1}. {d.charName}
                </span>
                <span className="font-medium">
                  {d.maxBranch} 最高 ({d.values.map((v) => v.toFixed(0)).join(" / ")})
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <h3 className="mb-2 text-sm font-medium text-primary">
          推荐结论：综合推荐 {bestBranch.name}
        </h3>
        <div className="text-sm text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">主要优势：</div>
          <div className="space-y-1">
            {dimensionDiffs.slice(0, 3).map((d, idx) => (
              <div key={d.key}>
                {idx + 1}. {d.label}更出色（{d.maxValue.toFixed(1)} vs {d.minValue.toFixed(1)}）
              </div>
            ))}
            {eventCounts[bestBranchIdx] >= (secondBest ? eventCounts[secondBestIdx] : 0) && (
              <div>
                {dimensionDiffs.length + 1}. 事件数量更丰富（{eventCounts[bestBranchIdx]} 条）
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function BranchCompareView({
  branches,
  compareBranchIds,
  onBack,
}: BranchCompareViewProps) {
  const [activeTab, setActiveTab] = useState<"score" | "timeline" | "differences">("score")

  const compareBranches = useMemo(() => {
    return compareBranchIds
      .map((id) => branches.find((b) => b.id === id))
      .filter((b): b is SimulationBranch => !!b)
  }, [branches, compareBranchIds])

  if (compareBranches.length < 2) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-sm text-muted-foreground">
          请选择至少 2 个分支进行对比
        </div>
      </div>
    )
  }

  const tabs = [
    { key: "score" as const, label: "评分对比", icon: BarChart3 },
    { key: "timeline" as const, label: "时间线对比", icon: Clock },
    { key: "differences" as const, label: "关键差异", icon: Zap },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-8"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回分支管理
        </Button>
        <div className="flex items-center gap-2">
          {compareBranches.map((b, idx) => (
            <span
              key={b.id}
              className="rounded-full px-2.5 py-1 text-xs font-medium"
              style={{
                backgroundColor: `${BRANCH_COLORS[idx]}20`,
                color: BRANCH_COLORS[idx],
              }}
            >
              {b.name}
            </span>
          ))}
        </div>
        <div className="ml-auto">
          <div className="inline-flex rounded-md border bg-muted/40 p-0.5 text-xs">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 ${
                  activeTab === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab(key)}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === "score" && <ScoreCompareTab branches={compareBranches} />}
        {activeTab === "timeline" && <TimelineCompareTab branches={compareBranches} />}
        {activeTab === "differences" && <KeyDifferencesTab branches={compareBranches} />}
      </div>
    </div>
  )
}
