import { useState, useMemo } from "react"
import { Eye, EyeOff, Filter, MessageSquare, Zap, Clock } from "lucide-react"
import type { RumorEvent, NovelAgent, TimelineEvent } from "@/lib/novel/story-simulation/types"
import { actionTypeShortLabel } from "@/lib/novel/story-simulation/action-type-utils"

interface ClueTimelinePanelProps {
  agents: Map<string, NovelAgent>
  rumors: RumorEvent[]
  events: TimelineEvent[]
}

type ClueType = "event" | "rumor"
type FilterAgent = "all" | string

interface ClueItem {
  id: string
  type: ClueType
  nodeIndex: number
  round: number
  timestamp: number
  title: string
  content: string
  actorName?: string
  targetName?: string
  knowAgents: string[]
  unknowAgents: string[]
  isSecret: boolean
}

export function ClueTimelinePanel({ agents, rumors, events }: ClueTimelinePanelProps) {
  const [filterType, setFilterType] = useState<"all" | ClueType>("all")
  const [filterAgent, setFilterAgent] = useState<FilterAgent>("all")
  const [filterNode, setFilterNode] = useState<"all" | number>("all")
  const [showOnlyUnknown, setShowOnlyUnknown] = useState(false)

  const agentList = useMemo(() => Array.from(agents.values()), [agents])

  const nodeList = useMemo(() => {
    const nodes = new Set<number>()
    events.forEach((e) => nodes.add(e.nodeIndex))
    rumors.forEach((r) => nodes.add(r.nodeIndex))
    return Array.from(nodes).sort((a, b) => a - b)
  }, [events, rumors])

  const clues = useMemo<ClueItem[]>(() => {
    const allAgentIds = agentList.map((a) => a.characterId)

    const eventClues: ClueItem[] = events
      .filter((e) => e.content && e.content.trim())
      .map((e) => {
        const knowAgents = e.observableBy || []
        const isPublic = knowAgents.length === allAgentIds.length
        const unknowAgents = allAgentIds.filter((id) => !knowAgents.includes(id))

        return {
          id: `ev_${e.id}`,
          type: "event" as ClueType,
          nodeIndex: e.nodeIndex,
          round: e.round,
          timestamp: new Date(e.timestamp).getTime(),
          title: actionTypeShortLabel(e.actionType),
          content: e.content,
          actorName: e.actorName,
          targetName: e.targetName,
          knowAgents,
          unknowAgents,
          isSecret: !isPublic && knowAgents.length <= 2,
        }
      })

    const rumorClues: ClueItem[] = rumors.map((r) => {
      const knowAgents = r.observableBy || []
      const unknowAgents = allAgentIds.filter((id) => !knowAgents.includes(id))
      const spreaderName = r.spreadBy ? agents.get(r.spreadBy)?.name : null
      const sourceName = r.sourceId ? agents.get(r.sourceId)?.name : null

      return {
        id: `rumor_${r.id}`,
        type: "rumor" as ClueType,
        nodeIndex: r.nodeIndex,
        round: r.round,
        timestamp: new Date(r.timestamp).getTime(),
        title: sourceName ? `传闻（源自${sourceName}）` : "传闻",
        content: r.content,
        actorName: spreaderName || sourceName || undefined,
        knowAgents,
        unknowAgents,
        isSecret: knowAgents.length <= 2,
      }
    })

    return [...eventClues, ...rumorClues].sort((a, b) => {
      if (a.nodeIndex !== b.nodeIndex) return a.nodeIndex - b.nodeIndex
      if (a.round !== b.round) return a.round - b.round
      return a.timestamp - b.timestamp
    })
  }, [events, rumors, agentList])

  const filteredClues = useMemo(() => {
    return clues.filter((clue) => {
      if (filterType !== "all" && clue.type !== filterType) return false
      if (filterNode !== "all" && clue.nodeIndex !== filterNode) return false
      if (filterAgent !== "all") {
        const knows = clue.knowAgents.includes(filterAgent)
        if (showOnlyUnknown) {
          if (knows) return false
        } else {
          if (!knows && !clue.knowAgents.includes(filterAgent)) return false
        }
      }
      return true
    })
  }, [clues, filterType, filterAgent, filterNode, showOnlyUnknown])

  const groupedByNode = useMemo(() => {
    const groups = new Map<number, ClueItem[]>()
    for (const clue of filteredClues) {
      if (!groups.has(clue.nodeIndex)) groups.set(clue.nodeIndex, [])
      groups.get(clue.nodeIndex)!.push(clue)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b)
  }, [filteredClues])

  const getAgentName = (id: string) => {
    return agents.get(id)?.name || id
  }

  const typeInfo = (type: ClueType) => {
    if (type === "event") {
      return { label: "事件", icon: Zap, color: "text-blue-600 bg-blue-100 dark:bg-blue-900/40 dark:text-blue-400" }
    }
    return { label: "传闻", icon: MessageSquare, color: "text-amber-600 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-400" }
  }

  if (clues.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        暂无线索数据，开始推演后会自动生成
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 筛选栏 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          <span>筛选</span>
        </div>

        {/* 类型筛选 */}
        <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
          <button
            type="button"
            className={`rounded px-2 py-1 ${filterType === "all" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setFilterType("all")}
          >
            全部
          </button>
          <button
            type="button"
            className={`flex items-center gap-1 rounded px-2 py-1 ${filterType === "event" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setFilterType("event")}
          >
            <Zap className="h-3 w-3" />
            事件
          </button>
          <button
            type="button"
            className={`flex items-center gap-1 rounded px-2 py-1 ${filterType === "rumor" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setFilterType("rumor")}
          >
            <MessageSquare className="h-3 w-3" />
            传闻
          </button>
        </div>

        {/* 角色筛选 */}
        <select
          className="rounded border bg-background px-2 py-1 text-xs"
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
        >
          <option value="all">全部角色</option>
          {agentList.map((a) => (
            <option key={a.characterId} value={a.characterId}>{a.name}</option>
          ))}
        </select>

        {/* 节点筛选 */}
        <select
          className="rounded border bg-background px-2 py-1 text-xs"
          value={filterNode === "all" ? "all" : String(filterNode)}
          onChange={(e) => setFilterNode(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">全部节点</option>
          {nodeList.map((n) => (
            <option key={n} value={n}>节点 {n + 1}</option>
          ))}
        </select>

        {filterAgent !== "all" && (
          <label className="flex items-center gap-1 text-muted-foreground">
            <input
              type="checkbox"
              checked={showOnlyUnknown}
              onChange={(e) => setShowOnlyUnknown(e.target.checked)}
              className="h-3 w-3"
            />
            只看不知道的
          </label>
        )}

        <div className="ml-auto text-[0.6875rem] text-muted-foreground">
          共 {filteredClues.length} 条线索
        </div>
      </div>

      {/* 时间线列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {groupedByNode.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            没有符合筛选条件的线索
          </div>
        ) : (
          <div className="space-y-4">
            {groupedByNode.map(([nodeIndex, nodeClues]) => (
              <div key={nodeIndex}>
                <div className="mb-2 flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium text-primary">
                    节点 {nodeIndex + 1}
                  </span>
                  <span className="text-[0.6875rem] text-muted-foreground">
                    {nodeClues.length} 条线索
                  </span>
                </div>
                <div className="space-y-2 pl-5 border-l-2 border-muted">
                  {nodeClues.map((clue) => {
                    const info = typeInfo(clue.type)
                    const Icon = info.icon
                    return (
                      <div
                        key={clue.id}
                        className="relative rounded-md border bg-background/70 p-2.5 text-xs"
                      >
                        <div
                          className="absolute -left-[7px] top-3 h-3 w-3 rounded-full border-2 border-background"
                          style={{ background: clue.isSecret ? "#f59e0b" : "hsl(var(--primary))" }}
                        />

                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.625rem] font-medium ${info.color}`}>
                            <Icon className="h-2.5 w-2.5" />
                            {info.label}
                          </span>
                          <span className="text-[0.6875rem] text-muted-foreground">
                            第 {clue.round + 1} 轮
                          </span>
                          {clue.isSecret && (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-600 dark:text-amber-400">
                              <EyeOff className="h-2.5 w-2.5" />
                              秘密
                            </span>
                          )}
                        </div>

                        {clue.actorName && (
                          <div className="mb-1 text-[0.6875rem] font-medium text-foreground">
                            {clue.actorName}
                            {clue.targetName && <> → {clue.targetName}</>}
                          </div>
                        )}

                        <div className="mb-2 leading-relaxed text-foreground/90">
                          {clue.content}
                        </div>

                        <div className="flex flex-wrap items-start gap-1.5 border-t pt-1.5">
                          <Eye className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                          <div className="flex flex-wrap gap-1">
                            {clue.knowAgents.length === 0 ? (
                              <span className="text-[0.625rem] text-muted-foreground">无人知晓</span>
                            ) : clue.knowAgents.length === agentList.length ? (
                              <span className="text-[0.625rem] text-emerald-600 dark:text-emerald-400">所有人都知道</span>
                            ) : (
                              clue.knowAgents.map((id) => (
                                <span
                                  key={id}
                                  className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[0.625rem] text-emerald-700 dark:text-emerald-400"
                                >
                                  {getAgentName(id)}
                                </span>
                              ))
                            )}
                          </div>
                        </div>

                        {clue.unknowAgents.length > 0 && clue.unknowAgents.length < agentList.length && (
                          <div className="flex flex-wrap items-start gap-1.5 mt-1">
                            <EyeOff className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                            <div className="flex flex-wrap gap-1">
                              {clue.unknowAgents.slice(0, 5).map((id) => (
                                <span
                                  key={id}
                                  className="rounded bg-muted/50 px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
                                >
                                  {getAgentName(id)}
                                </span>
                              ))}
                              {clue.unknowAgents.length > 5 && (
                                <span className="text-[0.625rem] text-muted-foreground">
                                  +{clue.unknowAgents.length - 5}人
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
