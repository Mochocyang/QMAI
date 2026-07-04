import { useState, useMemo } from "react"
import { Search, Link2 } from "lucide-react"
import type { RumorEvent, NovelAgent } from "@/lib/novel/story-simulation/types"

interface ClueItem {
  id: string
  content: string
  type: "confirmed" | "rumor" | "observed" | "told"
  source: string
  round: number
  agentId: string
  agentName: string
}

interface ClueBoardPanelProps {
  agents: Map<string, NovelAgent>
  rumors: RumorEvent[]
}

const STOP_WORDS = new Set(["的", "了", "是", "在", "有", "和", "与", "等", "也", "都", "就", "不", "我", "你", "他", "她", "它", "们", "这", "那", "个", "一", "之", "而", "于", "上", "下", "中", "里", "外", "前", "后", "左", "右", "大", "小", "多", "少", "很", "太", "最", "更", "还", "又", "再", "已", "曾", "将", "要", "会", "能", "可", "以", "为", "因", "由", "从", "到", "向", "对", "于", "把", "被", "让", "使", "给", "替", "比", "跟", "同", "和", "及", "或", "但", "而", "且", "并", "然", "则", "虽", "若", "如", "假", "使", "令", "叫", "让", "请", "求", "找", "寻", "查", "看", "听", "说", "讲", "谈", "论", "想", "思", "念", "忘", "记", "知", "道", "明", "白", "清", "楚", "懂", "会", "能", "可", "行", "成", "败", "好", "坏", "对", "错", "真", "假", "新", "旧", "老", "少", "男", "女", "人", "事", "物", "地", "方", "时", "间", "年", "月", "日", "天", "夜", "早", "晚", "今", "明", "昨", "前", "后"])

function extractKeywords(text: string): Set<string> {
  const keywords = new Set<string>()
  const chars = text.split("")
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]
    if (STOP_WORDS.has(char)) continue
    if (/[\u4e00-\u9fa5]/.test(char)) {
      keywords.add(char)
      if (i + 1 < chars.length && /[\u4e00-\u9fa5]/.test(chars[i + 1]) && !STOP_WORDS.has(chars[i] + chars[i + 1])) {
        const bigram = chars[i] + chars[i + 1]
        if (!STOP_WORDS.has(bigram)) {
          keywords.add(bigram)
        }
      }
    }
  }
  return keywords
}

function calcSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const kw of a) {
    if (b.has(kw)) intersection++
  }
  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

function getTypeLabel(type: ClueItem["type"]): string {
  switch (type) {
    case "confirmed":
      return "调查证实"
    case "rumor":
      return "传闻得知"
    case "observed":
      return "亲眼所见"
    case "told":
      return "他人告知"
  }
}

function getTypeColor(type: ClueItem["type"]): string {
  switch (type) {
    case "confirmed":
      return "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/30"
    case "rumor":
      return "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30"
    case "observed":
      return "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/30"
    case "told":
      return "border-purple-400 bg-purple-50 dark:border-purple-600 dark:bg-purple-950/30"
  }
}

function getTypeIcon(type: ClueItem["type"]): string {
  switch (type) {
    case "confirmed":
      return "🔵"
    case "rumor":
      return "🟡"
    case "observed":
      return "🟢"
    case "told":
      return "🟣"
  }
}

export function ClueBoardPanel({ agents, rumors }: ClueBoardPanelProps) {
  const agentList = useMemo(() => Array.from(agents.values()), [agents])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    agentList.length > 0 ? agentList[0].characterId : null,
  )
  const [selectedClueId, setSelectedClueId] = useState<string | null>(null)

  const visibleRumorsByAgent = useMemo(() => {
    const map = new Map<string, RumorEvent[]>()
    for (const agent of agentList) {
      map.set(agent.characterId, [])
    }
    for (const rumor of rumors) {
      for (const agentId of rumor.observableBy) {
        if (!map.has(agentId)) map.set(agentId, [])
        map.get(agentId)!.push(rumor)
      }
    }
    return map
  }, [rumors, agentList])

  const cluesByAgent = useMemo(() => {
    const map = new Map<string, ClueItem[]>()
    for (const agent of agentList) {
      const clueList: ClueItem[] = []
      const knownSecrets = agent.memory?.knownSecrets ?? new Set<string>()
      let idx = 0
      for (const secret of knownSecrets) {
        clueList.push({
          id: `${agent.characterId}-confirmed-${idx++}`,
          content: secret,
          type: "confirmed",
          source: "调查证实",
          round: 0,
          agentId: agent.characterId,
          agentName: agent.name,
        })
      }
      const visibleRumors = visibleRumorsByAgent.get(agent.characterId) ?? []
      for (const rumor of visibleRumors) {
        if (rumor.verifiedBy.includes(agent.characterId)) continue
        clueList.push({
          id: `${agent.characterId}-rumor-${rumor.id}`,
          content: rumor.content,
          type: "rumor",
          source: `传闻（第${rumor.round + 1}轮）`,
          round: rumor.round,
          agentId: agent.characterId,
          agentName: agent.name,
        })
      }
      map.set(agent.characterId, clueList)
    }
    return map
  }, [agentList, visibleRumorsByAgent])

  const currentClues = useMemo(() => {
    if (!selectedAgentId) return []
    return cluesByAgent.get(selectedAgentId) ?? []
  }, [selectedAgentId, cluesByAgent])

  const selectedClue = useMemo(() => {
    if (!selectedClueId) return null
    return currentClues.find((c) => c.id === selectedClueId) ?? null
  }, [selectedClueId, currentClues])

  const relatedClues = useMemo(() => {
    if (!selectedClue || currentClues.length <= 1) return []
    const selectedKeywords = extractKeywords(selectedClue.content)
    const others = currentClues.filter((c) => c.id !== selectedClue.id)
    const withScore = others.map((clue) => {
      const kw = extractKeywords(clue.content)
      const sharedCount = Array.from(selectedKeywords).filter((k) => kw.has(k)).length
      const similarity = calcSimilarity(selectedKeywords, kw)
      return { clue, sharedCount, similarity }
    })
    return withScore
      .filter((item) => item.sharedCount >= 2)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)
  }, [selectedClue, currentClues])

  if (agentList.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border bg-muted/30 p-6 text-center text-xs text-muted-foreground">
        暂无角色数据
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
          {agentList.map((agent) => {
            const clueCount = cluesByAgent.get(agent.characterId)?.length ?? 0
            const isActive = selectedAgentId === agent.characterId
            return (
              <button
                key={agent.characterId}
                type="button"
                onClick={() => {
                  setSelectedAgentId(agent.characterId)
                  setSelectedClueId(null)
                }}
                className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background/70 hover:bg-muted/50"
                }`}
              >
                <span>{agent.name}</span>
                <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] ${
                  isActive
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {clueCount}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="text-sm">🟢</span>
            <span>亲眼所见</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-sm">🔵</span>
            <span>调查证实</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-sm">🟡</span>
            <span>传闻得知</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-sm">🟣</span>
            <span>他人告知</span>
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {currentClues.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-md border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
            <div>
              <Search className="mx-auto mb-2 h-6 w-6 opacity-50" />
              <div>该角色暂无线索</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {currentClues.map((clue) => (
              <button
                key={clue.id}
                type="button"
                onClick={() => setSelectedClueId(clue.id)}
                className={`rounded-md border-2 p-2.5 text-left transition-all ${
                  selectedClueId === clue.id
                    ? "ring-2 ring-primary ring-offset-1"
                    : "hover:shadow-sm"
                } ${getTypeColor(clue.type)}`}
              >
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span className="text-[10px] font-medium">
                    {getTypeIcon(clue.type)} {getTypeLabel(clue.type)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    R{clue.round + 1}
                  </span>
                </div>
                <div className="line-clamp-3 text-xs leading-relaxed">
                  {clue.content}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedClue && (
        <div className="shrink-0 rounded-md border bg-background/80 p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-base">{getTypeIcon(selectedClue.type)}</span>
              <span className="text-sm font-medium">
                {getTypeLabel(selectedClue.type)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                · {selectedClue.source}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedClueId(null)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              收起
            </button>
          </div>
          <div className="mb-3 rounded-md border bg-muted/20 p-2.5 text-xs leading-relaxed">
            {selectedClue.content}
          </div>

          {relatedClues.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium">
                <Link2 className="h-3 w-3" />
                <span>关联线索</span>
              </div>
              <div className="space-y-1.5">
                {relatedClues.map(({ clue, similarity }) => (
                  <button
                    key={clue.id}
                    type="button"
                    onClick={() => setSelectedClueId(clue.id)}
                    className={`flex w-full items-center gap-2 rounded-md border p-2 text-left text-xs transition-colors hover:bg-muted/30 ${getTypeColor(
                      clue.type,
                    )}`}
                  >
                    <span className="text-sm">{getTypeIcon(clue.type)}</span>
                    <span className="line-clamp-2 flex-1">{clue.content}</span>
                    <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                      {(similarity * 100).toFixed(0)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
