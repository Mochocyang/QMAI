import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Search, UserCog } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ScenarioCandidate } from "@/lib/novel/story-simulation/scenario-types"

export interface ScenarioCharacterGridProps {
  candidates: ScenarioCandidate[]
  /** 已上台的角色 id；数组顺序即上台顺序，卡片上的序号取自这里。 */
  selectedIds: string[]
  /** 本次要选几个；选满后未上台的卡片会被淡化。 */
  characterCount: number
  /** 主持人 id；SCENARIO_MODERATOR_USER_ID 表示由用户本人担任。 */
  moderatorId: string
  /** 候选超过这个数量才显示搜索框，避免多一个空控件。 */
  searchThreshold?: number
  /** 点卡片：未上台则上台，已上台则下台。满员与否由调用方决定并给出提示。 */
  onToggle: (id: string) => void
  onSetModerator: (id: string) => void
  onBindSoul: (candidate: ScenarioCandidate) => void
}

const DEFAULT_SEARCH_THRESHOLD = 12

/**
 * 「舞台情景」候选角色网格（哑组件）
 *
 * 只负责呈现与上报：人数上限、上台顺序、主持人归属全部由父组件持有。
 * 拆出来是因为设置面板加上网格与弹窗入口后会超过 1100 行，一次读不完。
 *
 * candidates 为空时整体返回 null，一个占位都不渲染；「一个候选都没有」的空态由调用方负责。
 */
export function ScenarioCharacterGrid({
  candidates,
  selectedIds,
  characterCount,
  moderatorId,
  searchThreshold = DEFAULT_SEARCH_THRESHOLD,
  onToggle,
  onSetModerator,
  onBindSoul,
}: ScenarioCharacterGridProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")

  const keyword = query.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!keyword) return candidates
    return candidates.filter((c) =>
      `${c.name} ${c.auraName ?? ""}`.toLowerCase().includes(keyword),
    )
  }, [candidates, keyword])

  const searchVisible = candidates.length > searchThreshold

  // 搜索框一旦不显示，就必须把关键词清掉：否则 visible 会一直为空，
  // 界面只剩「没有匹配…」，而用户已经没有任何控件能把它清掉。
  useEffect(() => {
    if (!searchVisible) setQuery("")
  }, [searchVisible])

  if (candidates.length === 0) return null
  const full = selectedIds.length >= characterCount

  return (
    <div className="flex flex-col gap-3">
      {searchVisible && (
        <label className="flex items-center gap-2 rounded-lg border border-input px-2.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <Search className="h-4 w-4 shrink-0 opacity-60" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("storySimulation.scenarioCharacterSearch")}
            aria-label={t("storySimulation.scenarioCharacterSearch")}
            className="h-8 w-full bg-transparent text-sm outline-none"
          />
        </label>
      )}

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          {t("storySimulation.scenarioCharacterNoMatch", { query: query.trim() })}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visible.map((c, index) => {
            const order = selectedIds.indexOf(c.id)
            const onStage = order >= 0
            const isMod = onStage && moderatorId === c.id
            // 上台序号与「主持人」徽标都渲染在 toggle 按钮内部，而该按钮带 aria-label；
            // 按可访问名算法，aria-label 会覆盖整棵子树的文本，序号与身份都会被吞掉。
            // 所以这里把徽标挂成按钮的 aria-describedby：name 仍是 aria-label（形状不动，
            // 下游按精确匹配定位卡片），额外多一段 description 让屏幕阅读器朗读。
            // id 用列表下标而不是 c.id —— 角色名可能带空格等字符，拼进 id 会不合法。
            const describedBy = onStage
              ? `scenario-stage-${index}${isMod ? ` scenario-moderator-${index}` : ""}`
              : undefined
            return (
              <div
                key={c.id}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-3 transition-colors",
                  onStage
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border",
                  // 已满且没上台：淡一点，让人一眼看出「再点也不会加进去」
                  !onStage && full && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onToggle(c.id)}
                    aria-pressed={onStage}
                    aria-describedby={describedBy}
                    // 满员且没上台：动作会被父组件拒绝，用 aria-disabled 让「不可选」
                    // 不只停留在视觉淡化上；点击仍然上报，由父组件给出提示。
                    aria-disabled={(!onStage && full) || undefined}
                    aria-label={t("storySimulation.scenarioToggleCharacter", {
                      name: c.name,
                    })}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left hover:bg-accent/40"
                  >
                    {onStage ? (
                      <span
                        id={`scenario-stage-${index}`}
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-[0.625rem] font-semibold text-primary-foreground"
                      >
                        {order + 1}
                      </span>
                    ) : (
                      <span className="h-5 w-5 shrink-0 rounded-full border border-input" />
                    )}
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    {isMod && (
                      <span
                        id={`scenario-moderator-${index}`}
                        className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[0.625rem] font-medium text-primary"
                      >
                        {t("storySimulation.scenarioModerator")}
                      </span>
                    )}
                  </button>

                  {onStage && !isMod && (
                    <button
                      type="button"
                      onClick={() => onSetModerator(c.id)}
                      aria-label={t("storySimulation.scenarioSetModerator", {
                        name: c.name,
                      })}
                      title={t("storySimulation.scenarioSetModerator", {
                        name: c.name,
                      })}
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <UserCog className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => onBindSoul(c)}
                    title={
                      c.auraName
                        ? t("storySimulation.scenarioChangeSoul", { name: c.name })
                        : t("storySimulation.scenarioBindSoul", { name: c.name })
                    }
                    className={cn(
                      "rounded-full px-2 py-0.5",
                      c.auraName
                        ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300"
                        : "bg-muted text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {c.auraName
                      ? `${t("storySimulation.scenarioSoul")}：${c.auraName}`
                      : t("storySimulation.scenarioBindSoul", { name: c.name })}
                  </button>
                  {c.personality.slice(0, 3).map((p, index) => (
                    <span
                      key={`${p}-${index}`}
                      className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                    >
                      {p}
                    </span>
                  ))}
                </div>
                {c.speakingStyle && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {t("storySimulation.scenarioSpeakingStyle")}：{c.speakingStyle}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
