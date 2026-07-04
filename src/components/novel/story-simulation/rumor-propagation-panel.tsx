import { useState, useMemo } from "react"
import { MessageCircle, Users, Eye, CheckCircle, XCircle, Clock, Filter } from "lucide-react"
import type { RumorEvent, NovelAgent, TimelineEvent } from "@/lib/novel/story-simulation/types"

type RumorFilter = "all" | "unverified" | "verified" | "falsified"

interface RumorPropagationPanelProps {
  rumors: RumorEvent[]
  agents: Map<string, NovelAgent>
  events: TimelineEvent[]
}

export function RumorPropagationPanel({ rumors, agents, events }: RumorPropagationPanelProps) {
  const [selectedRumorId, setSelectedRumorId] = useState<string | null>(null)
  const [filter, setFilter] = useState<RumorFilter>("all")

  const filteredRumors = useMemo(() => {
    switch (filter) {
      case "unverified":
        return rumors.filter((r) => r.verifiedBy.length === 0)
      case "verified":
        return rumors.filter((r) => r.verifiedBy.length > 0 && r.distortion < 0.5)
      case "falsified":
        return rumors.filter((r) => r.verifiedBy.length > 0 && r.distortion >= 0.5)
      default:
        return rumors
    }
  }, [rumors, filter])

  const selectedRumor = useMemo(
    () => rumors.find((r) => r.id === selectedRumorId) ?? null,
    [rumors, selectedRumorId],
  )

  const sourceEvent = useMemo(() => {
    if (!selectedRumor?.sourceId) return null
    return events.find((e) => e.id === selectedRumor.sourceId) ?? null
  }, [selectedRumor, events])

  if (rumors.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border bg-muted/30 p-6 text-center text-xs text-muted-foreground">
        暂无传闻数据
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="flex w-72 shrink-0 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as RumorFilter)}
            className="h-7 flex-1 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">全部传闻</option>
            <option value="unverified">未验证</option>
            <option value="verified">已验证</option>
            <option value="falsified">已证伪</option>
          </select>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {filteredRumors.length === 0 ? (
            <div className="rounded-md border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
              暂无符合条件的传闻
            </div>
          ) : (
            filteredRumors.map((rumor) => (
              <button
                key={rumor.id}
                type="button"
                onClick={() => setSelectedRumorId(rumor.id)}
                className={`w-full rounded-md border p-2.5 text-left transition-colors ${
                  selectedRumorId === rumor.id
                    ? "border-primary bg-primary/5"
                    : "bg-background/70 hover:bg-muted/30"
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      rumor.distortion < 0.3
                        ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                        : rumor.distortion < 0.6
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                          : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                    }`}
                  >
                    失真 {(rumor.distortion * 100).toFixed(0)}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    第 {rumor.round + 1} 轮
                  </span>
                </div>
                <div className="mb-1.5 line-clamp-2 text-xs">
                  {rumor.content}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {rumor.believedBy.length}
                  </span>
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    {rumor.verifiedBy.length}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-background/70 p-3">
        {selectedRumor ? (
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">传闻详情</span>
              </div>
              <div className="rounded-md border bg-muted/20 p-3 text-xs">
                {selectedRumor.content}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">传播时间线</span>
              </div>

              <div className="relative ml-3 space-y-4 border-l-2 border-muted pl-4">
                <div className="relative">
                  <div className="absolute -left-[21px] top-0.5 h-3 w-3 rounded-full bg-primary" />
                  <div className="text-xs font-medium">
                    第 {selectedRumor.round + 1} 轮 · 传闻生成
                  </div>
                  {sourceEvent ? (
                    <div className="mt-1.5 rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
                      <div className="mb-1 font-medium text-foreground">
                        源事件：{sourceEvent.actorName} 的
                        {actionTypeLabel(sourceEvent.actionType)}
                      </div>
                      <div className="line-clamp-3">{sourceEvent.content}</div>
                    </div>
                  ) : (
                    <div className="mt-1.5 text-xs text-muted-foreground">
                      （无源事件记录）
                    </div>
                  )}
                </div>

                <div className="relative">
                  <div className="absolute -left-[21px] top-0.5 h-3 w-3 rounded-full bg-blue-500" />
                  <div className="text-xs font-medium">角色可见</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {selectedRumor.observableBy.length === 0 ? (
                      <span className="text-xs text-muted-foreground">无</span>
                    ) : (
                      selectedRumor.observableBy.map((agentId) => {
                        const agent = agents.get(agentId)
                        return (
                          <span
                            key={agentId}
                            className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                          >
                            {agent?.name ?? agentId}
                          </span>
                        )
                      })
                    )}
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute -left-[21px] top-0.5 h-3 w-3 rounded-full bg-emerald-500" />
                  <div className="text-xs font-medium">相信传闻</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {selectedRumor.believedBy.length === 0 ? (
                      <span className="text-xs text-muted-foreground">暂无角色相信</span>
                    ) : (
                      selectedRumor.believedBy.map((agentId) => {
                        const agent = agents.get(agentId)
                        return (
                          <span
                            key={agentId}
                            className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          >
                            {agent?.name ?? agentId}
                          </span>
                        )
                      })
                    )}
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute -left-[21px] top-0.5 h-3 w-3 rounded-full bg-purple-500" />
                  <div className="text-xs font-medium">调查验证</div>
                  <div className="mt-1.5">
                    {selectedRumor.verifiedBy.length === 0 ? (
                      <span className="text-xs text-muted-foreground">暂无角色验证</span>
                    ) : (
                      <div className="space-y-1">
                        {selectedRumor.verifiedBy.map((agentId) => {
                          const agent = agents.get(agentId)
                          const isTrue = selectedRumor.distortion < 0.5
                          return (
                            <div
                              key={agentId}
                              className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1 text-xs"
                            >
                              {isTrue ? (
                                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5 text-red-500" />
                              )}
                              <span className="font-medium">
                                {agent?.name ?? agentId}
                              </span>
                              <span className="text-muted-foreground">
                                {isTrue ? "证实为真" : "证实为假"}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border bg-muted/20 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">失真度</div>
                <div
                  className={`text-lg font-semibold ${
                    selectedRumor.distortion < 0.3
                      ? "text-green-600 dark:text-green-400"
                      : selectedRumor.distortion < 0.6
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {(selectedRumor.distortion * 100).toFixed(0)}%
                </div>
              </div>
              <div className="rounded-md border bg-muted/20 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">可见人数</div>
                <div className="text-lg font-semibold">
                  {selectedRumor.observableBy.length}
                </div>
              </div>
              <div className="rounded-md border bg-muted/20 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">验证人数</div>
                <div className="text-lg font-semibold">
                  {selectedRumor.verifiedBy.length}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            <div className="text-center">
              <Eye className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <div>选择左侧传闻查看传播链</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function actionTypeLabel(type: string): string {
  switch (type) {
    case "evaluate":
      return "评价"
    case "pushPlot":
      return "行动"
    case "observe":
      return "观察"
    case "react":
      return "反应"
    case "speak":
      return "对话"
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
