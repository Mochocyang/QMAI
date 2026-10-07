import { useState, useMemo } from "react"
import { MessageCircle, Users, Eye, CheckCircle, GitBranch, Filter } from "lucide-react"
import type { RumorEvent, NovelAgent, TimelineEvent } from "@/lib/novel/story-simulation/types"

type RumorFilter = "all" | "unverified" | "verified" | "falsified"

interface RumorPropagationPanelProps {
  rumors: RumorEvent[]
  agents: Map<string, NovelAgent>
  events: TimelineEvent[]
}

interface RumorTreeNode {
  rumor: RumorEvent
  children: RumorTreeNode[]
  spreaderName?: string
}

function buildRumorFamilyTree(rumors: RumorEvent[], targetRumorId: string): RumorTreeNode | null {
  const rumorMap = new Map<string, RumorEvent>()
  for (const r of rumors) {
    rumorMap.set(r.id, r)
  }

  const target = rumorMap.get(targetRumorId)
  if (!target) return null

  const ancestors: RumorEvent[] = []
  let current: RumorEvent | undefined = target
  while (current) {
    ancestors.unshift(current)
    current = current.parentId ? rumorMap.get(current.parentId) : undefined
  }

  const rootRumor = ancestors[0]

  function buildNode(rumor: RumorEvent): RumorTreeNode {
    const children = rumors
      .filter((r) => r.parentId === rumor.id)
      .map((r) => buildNode(r))
    return {
      rumor,
      children,
    }
  }

  return buildNode(rootRumor)
}

function getAgentName(agents: Map<string, NovelAgent>, agentId: string): string {
  return agents.get(agentId)?.name ?? agentId
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

  const familyTree = useMemo(() => {
    if (!selectedRumorId) return null
    return buildRumorFamilyTree(rumors, selectedRumorId)
  }, [rumors, selectedRumorId])

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
                    className={`rounded px-1.5 py-0.5 text-[0.625rem] font-medium ${
                      rumor.distortion < 0.3
                        ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                        : rumor.distortion < 0.6
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                          : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                    }`}
                  >
                    失真 {(rumor.distortion * 100).toFixed(0)}%
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground">
                    第 {rumor.round + 1} 轮
                  </span>
                </div>
                <div className="mb-1.5 line-clamp-2 text-xs">
                  {rumor.content}
                </div>
                <div className="flex items-center gap-3 text-[0.625rem] text-muted-foreground">
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
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">传播家谱</span>
              </div>

              <div className="space-y-2">
                {familyTree ? (
                  <RumorTreeNodeView
                    node={familyTree}
                    agents={agents}
                    selectedRumorId={selectedRumorId}
                    depth={0}
                    isRoot={true}
                    sourceEvent={sourceEvent}
                  />
                ) : (
                  <div className="text-xs text-muted-foreground">暂无传播链数据</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border bg-muted/20 p-2 text-center">
                <div className="text-[0.625rem] text-muted-foreground">失真度</div>
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
                <div className="text-[0.625rem] text-muted-foreground">可见人数</div>
                <div className="text-lg font-semibold">
                  {selectedRumor.observableBy.length}
                </div>
              </div>
              <div className="rounded-md border bg-muted/20 p-2 text-center">
                <div className="text-[0.625rem] text-muted-foreground">验证人数</div>
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

interface RumorTreeNodeViewProps {
  node: RumorTreeNode
  agents: Map<string, NovelAgent>
  selectedRumorId: string | null
  depth: number
  isRoot: boolean
  sourceEvent: TimelineEvent | null
}

function RumorTreeNodeView({
  node,
  agents,
  selectedRumorId,
  depth,
  isRoot,
  sourceEvent,
}: RumorTreeNodeViewProps) {
  const { rumor } = node
  const isSelected = rumor.id === selectedRumorId
  const spreaderName = rumor.spreadBy ? getAgentName(agents, rumor.spreadBy) : undefined

  return (
    <div className="relative">
      <div className="flex gap-2">
        {depth > 0 && (
          <div className="relative w-5 shrink-0">
            <div className="absolute left-2 top-0 h-full w-px bg-muted" />
            <div className="absolute left-2 top-3 h-px w-3 bg-muted" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div
            className={`rounded-md border p-2.5 transition-colors ${
              isSelected
                ? "border-primary bg-primary/5"
                : "bg-background/70 hover:bg-muted/20"
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {isRoot ? (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-primary">
                    原始传闻
                  </span>
                ) : (
                  <span className="text-[0.625rem] text-muted-foreground">
                    第 {rumor.generation} 代
                  </span>
                )}
                <span
                  className={`rounded px-1.5 py-0.5 text-[0.625rem] font-medium ${
                    rumor.distortion < 0.3
                      ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                      : rumor.distortion < 0.6
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                        : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                  }`}
                >
                  失真 {(rumor.distortion * 100).toFixed(0)}%
                </span>
              </div>
              <span className="text-[0.625rem] text-muted-foreground">
                第 {rumor.round + 1} 轮
              </span>
            </div>
            <div className="mb-1.5 line-clamp-2 text-xs">{rumor.content}</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem] text-muted-foreground">
              {spreaderName && (
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  传播者：{spreaderName}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {rumor.observableBy.length} 人可见
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                {rumor.believedBy.length} 人相信
              </span>
            </div>
            {isRoot && sourceEvent && (
              <div className="mt-2 rounded-md border bg-muted/20 p-2 text-[0.625rem] text-muted-foreground">
                <div className="mb-0.5 font-medium text-foreground">
                  源事件：{sourceEvent.actorName} 的{actionTypeLabel(sourceEvent.actionType)}
                </div>
                <div className="line-clamp-2">{sourceEvent.content}</div>
              </div>
            )}
          </div>
        </div>
      </div>
      {node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((child) => (
            <RumorTreeNodeView
              key={child.rumor.id}
              node={child}
              agents={agents}
              selectedRumorId={selectedRumorId}
              depth={depth + 1}
              isRoot={false}
              sourceEvent={null}
            />
          ))}
        </div>
      )}
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
