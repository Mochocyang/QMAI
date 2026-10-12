import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Info, Plus, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  SCENARIO_CHARACTER_DEFAULT,
  SCENARIO_CHARACTER_MAX,
  SCENARIO_CHARACTER_MIN,
  SCENARIO_COST_WARN_THRESHOLD,
  SCENARIO_FORMAT_INFO,
  SCENARIO_MODERATOR_INTERVAL_DEFAULT,
  SCENARIO_MODERATOR_INTERVAL_OPTIONS,
  SCENARIO_MODERATOR_USER_ID,
  SCENARIO_MODERATOR_USER_NAME,
  SCENARIO_ROUND_DEFAULT,
  SCENARIO_ROUND_MAX,
  SCENARIO_ROUND_MIN,
  SCENARIO_ROUND_PRESETS,
  SCENARIO_SOURCE_CHAPTER_PRESETS,
  clampScenarioRounds,
  estimateScenarioMessages,
  hasRoleModerator,
  type ScenarioCandidate,
  type ScenarioFormat,
  type ScenarioRules,
  type ScenarioSession,
  type ScenarioSetup,
} from "@/lib/novel/story-simulation/scenario-types"
import { assembleParticipants, candidateToParticipant } from "@/lib/novel/story-simulation/scenario-participant-selector"
import { createScenarioSetup } from "@/lib/novel/story-simulation/scenario-engine"

const FORMATS: ScenarioFormat[] = ["debate", "dialogue", "free"]

export interface ScenarioSetupPanelProps {
  candidates: ScenarioCandidate[]
  /** 正在提取角色时的进度 */
  extracting: boolean
  progress: { progress: number; label: string } | null
  /** 提取来源章节数 */
  sourceChapters: number
  onSourceChaptersChange: (count: number) => void
  /** 重新分析角色（按当前章节数重新提取） */
  onReExtract: () => void
  /** 已保存的历史情景会话 */
  savedScenarios?: ScenarioSession[]
  onStart: (setup: ScenarioSetup) => void
  onOpenSaved?: (session: ScenarioSession) => void
  onDeleteSaved?: (id: string) => void
  onCancel: () => void
}

/**
 * 「舞台情景」设置面板（第 1、2 步）
 * 1) 角色选择与配置：数量 3/4/5、下拉框选择角色、读取并复用灵魂
 * 2) 情景设置：主持人、情景规则、参考点、对话形式、轮数
 */
export function ScenarioSetupPanel({
  candidates,
  extracting,
  progress,
  sourceChapters,
  onSourceChaptersChange,
  onReExtract,
  savedScenarios = [],
  onStart,
  onOpenSaved,
  onDeleteSaved,
  onCancel,
}: ScenarioSetupPanelProps) {
  const { t } = useTranslation()
  const [characterCount, setCharacterCount] = useState<number>(
    SCENARIO_CHARACTER_DEFAULT,
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [moderatorId, setModeratorId] = useState<string>(
    SCENARIO_MODERATOR_USER_ID,
  )
  const [title, setTitle] = useState("")
  const [directive, setDirective] = useState("")
  const [scene, setScene] = useState("")
  const [location, setLocation] = useState("")
  const [time, setTime] = useState("")
  const [reference, setReference] = useState("")
  const [format, setFormat] = useState<ScenarioFormat>("debate")
  const [rounds, setRounds] = useState<number>(SCENARIO_ROUND_DEFAULT)
  const [moderatorEveryRounds, setModeratorEveryRounds] = useState<number>(
    SCENARIO_MODERATOR_INTERVAL_DEFAULT,
  )
  const [costAck, setCostAck] = useState(false)

  const candidateMap = useMemo(
    () => new Map(candidates.map((c) => [c.id, c])),
    [candidates],
  )

  const selectedCandidates = useMemo(
    () =>
      selectedIds
        .map((id) => candidateMap.get(id))
        .filter((c): c is ScenarioCandidate => Boolean(c)),
    [selectedIds, candidateMap],
  )

  const availableCandidates = candidates.filter(
    (c) => !selectedIds.includes(c.id),
  )

  const reachedLimit = selectedIds.length >= characterCount

  const addCharacter = (id: string) => {
    if (!id) return
    if (selectedIds.includes(id)) return
    if (selectedIds.length >= characterCount) return
    setSelectedIds([...selectedIds, id])
  }

  const removeCharacter = (id: string) => {
    setSelectedIds(selectedIds.filter((x) => x !== id))
    if (moderatorId === id) setModeratorId(SCENARIO_MODERATOR_USER_ID)
  }

  const characterSpeakers = selectedIds.filter((id) => id !== moderatorId)

  // 预览参与者（用于成本预估与主持人规则说明）
  const previewParticipants = selectedCandidates.map((c) =>
    candidateToParticipant(
      c,
      moderatorId !== SCENARIO_MODERATOR_USER_ID && c.id === moderatorId,
    ),
  )
  const roleModerated = hasRoleModerator(previewParticipants)

  /**
   * 轮数的一切对外展示都必须经过与引擎同一套夹取。
   *
   * 输入框允许任意正整数，但 `createScenarioSetup` 会把轮数夹到
   * [1, SCENARIO_ROUND_MAX] —— 直接用原始 `rounds` 去估算，用户输入 9999
   * 时界面会报出 29998 条，而引擎只会跑 100 轮（301 条）。那个数字不仅夸大
   * 成本护栏，还让「轮数」这个输入看起来能填 9999，实际上填了也不生效。
   */
  const effectiveRounds = clampScenarioRounds(rounds)
  const roundsClamped = effectiveRounds !== rounds

  const estimatedMessages = estimateScenarioMessages(
    previewParticipants,
    effectiveRounds,
    moderatorEveryRounds,
  )
  const needsCostAck = estimatedMessages > SCENARIO_COST_WARN_THRESHOLD

  // 预估规模一变就让上一次的确认作废：把配置改小再改大，不能靠旧勾选蒙过去。
  // 与剧情推演室的护栏保持同一行为（simulation-config-panel.tsx 同款）。
  useEffect(() => {
    setCostAck(false)
  }, [estimatedMessages])

  const canStart =
    !extracting &&
    selectedIds.length === characterCount &&
    directive.trim().length > 0 &&
    (!needsCostAck || costAck)

  const handleStart = () => {
    const { participants } = assembleParticipants(
      selectedCandidates,
      selectedIds,
      moderatorId === SCENARIO_MODERATOR_USER_ID ? null : moderatorId,
    )
    // 主持人由用户担任时，补一条主持人占位参与者
    const withModerator =
      moderatorId === SCENARIO_MODERATOR_USER_ID
        ? [
            {
              id: SCENARIO_MODERATOR_USER_ID,
              name: SCENARIO_MODERATOR_USER_NAME,
              isModerator: true,
            },
            ...participants,
          ]
        : participants.map((p) => ({ ...p }))

    const rules: ScenarioRules = {
      directive: directive.trim(),
      scene: scene.trim() || undefined,
      location: location.trim() || undefined,
      time: time.trim() || undefined,
      reference: reference.trim() || undefined,
    }

    const setup = createScenarioSetup({
      title:
        title.trim() ||
        directive.trim().slice(0, 20) ||
        t("storySimulation.scenarioDefaultTitle"),
      rules,
      format,
      rounds: effectiveRounds,
      moderatorEveryRounds,
      participants: withModerator,
      sourceChapters,
    })
    onStart(setup)
  }

  if (extracting) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 p-12">
        <Sparkles className="h-6 w-6 animate-pulse text-primary" />
        <div className="text-sm font-medium">
          {progress?.label || t("storySimulation.scenarioExtracting")}
        </div>
        <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress?.progress ?? 0}%` }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      {/* 1. 角色数量 */}
      <section className="flex flex-col gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          {t("storySimulation.scenarioCharacterCount")}
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
        </h3>
        <div className="flex items-center gap-2">
          {[3, 4, 5].map((n) => (
            <Button
              key={n}
              variant={characterCount === n ? "default" : "outline"}
              size="sm"
              onClick={() => setCharacterCount(n)}
            >
              {n} {t("storySimulation.scenarioCharacterCountUnit")}
            </Button>
          ))}
          <span className="text-xs text-muted-foreground">
            {t("storySimulation.scenarioCharacterCountHint", {
              min: SCENARIO_CHARACTER_MIN,
              max: SCENARIO_CHARACTER_MAX,
            })}
          </span>
        </div>
      </section>

      {/* 2. 提取章节数 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          {t("storySimulation.scenarioSourceChapters")}
        </h3>
        <div className="flex items-center gap-2">
          <select
            value={sourceChapters}
            disabled={extracting}
            onChange={(e) => onSourceChaptersChange(Number(e.target.value))}
            className="h-8 w-40 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {SCENARIO_SOURCE_CHAPTER_PRESETS.map((n) => (
              <option key={n} value={n}>
                {t("storySimulation.recentChapters")} {n}{" "}
                {t("storySimulation.scenarioSourceChaptersUnit")}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={onReExtract}
            disabled={extracting}
          >
            {extracting
              ? t("storySimulation.scenarioReExtracting")
              : t("storySimulation.scenarioReExtract")}
          </Button>
        </div>
      </section>

      {/* 3. 角色选择 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          {t("storySimulation.scenarioSelectCharacters")}
        </h3>
        {candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t("storySimulation.scenarioNoCandidates")}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <select
                value=""
                disabled={reachedLimit}
                onChange={(e) => addCharacter(e.target.value)}
                className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <option value="">
                  {reachedLimit
                    ? t("storySimulation.scenarioFull", { n: characterCount })
                    : t("storySimulation.scenarioAddPlaceholder")}
                </option>
                {availableCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.auraName
                      ? `（${t("storySimulation.scenarioSoul")}：${c.auraName}）`
                      : ""}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {t("storySimulation.scenarioSelectedCount", {
                  n: selectedIds.length,
                  total: characterCount,
                })}
              </span>
            </div>

            {/* 已选角色（含灵魂展示） */}
            <div className="flex flex-col gap-2">
              {selectedCandidates.map((c) => {
                const isMod = moderatorId === c.id
                return (
                  <div
                    key={c.id}
                    className="flex items-start justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{c.name}</span>
                        {isMod && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.625rem] font-medium text-primary">
                            {t("storySimulation.scenarioModerator")}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5",
                            c.auraName
                              ? "bg-amber-100 text-amber-700"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {c.auraName
                            ? `${t("storySimulation.scenarioSoul")}：${c.auraName}`
                            : t("storySimulation.scenarioNoSoul")}
                        </span>
                        {c.personality.slice(0, 3).map((p) => (
                          <span
                            key={p}
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
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => removeCharacter(c.id)}
                      aria-label={t("storySimulation.scenarioRemove", {
                        name: c.name,
                      })}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>

      {/* 3. 主持人 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          {t("storySimulation.scenarioModerator")}
        </h3>
        <select
          value={moderatorId}
          onChange={(e) => setModeratorId(e.target.value)}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value={SCENARIO_MODERATOR_USER_ID}>
            {t("storySimulation.scenarioModeratorUser")}（
            {t("storySimulation.scenarioModeratorUserOption")}）
          </option>
          {selectedCandidates.map((c) => (
            <option key={c.id} value={c.id}>
              {t("storySimulation.scenarioModeratorCharacterOption", {
                name: c.name,
              })}
            </option>
          ))}
        </select>

        {roleModerated && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("storySimulation.scenarioModeratorInterval")}
            </span>
            <select
              value={moderatorEveryRounds}
              onChange={(e) => setModeratorEveryRounds(Number(e.target.value))}
              className="h-8 w-32 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {SCENARIO_MODERATOR_INTERVAL_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0
                    ? t("storySimulation.scenarioModeratorIntervalNever")
                    : t("storySimulation.scenarioModeratorIntervalEvery", {
                        n,
                      })}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {roleModerated
            ? t("storySimulation.scenarioModeratorRoleBehavior", {
                n: moderatorEveryRounds,
              })
            : t("storySimulation.scenarioModeratorUserBehavior")}
        </p>
      </section>

      {/* 4. 情景规则 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          {t("storySimulation.scenarioRules")}
        </h3>
        <Textarea
          value={directive}
          onChange={(e) => setDirective(e.target.value)}
          rows={3}
          placeholder={t("storySimulation.scenarioRulesPlaceholder")}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            placeholder={t("storySimulation.scenarioScenePlaceholder")}
          />
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t("storySimulation.scenarioReferencePlaceholder")}
          />
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t("storySimulation.scenarioLocationPlaceholder")}
          />
          <Input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder={t("storySimulation.scenarioTimePlaceholder")}
          />
        </div>
      </section>

      {/* 5. 对话形式 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          {t("storySimulation.scenarioFormat")}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {FORMATS.map((f) => {
            const info = SCENARIO_FORMAT_INFO[f]
            const isSelected = format === f
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all",
                  isSelected
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border hover:border-primary/50 hover:bg-accent/30",
                )}
              >
                <span className="text-sm font-medium">
                  {info.icon} {info.name}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {info.shortDesc}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {/* 6. 轮数 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          {t("storySimulation.scenarioRounds")}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {SCENARIO_ROUND_PRESETS.map((n) => (
            <Button
              key={n}
              variant={rounds === n ? "default" : "outline"}
              size="sm"
              onClick={() => setRounds(n)}
            >
              {n} {t("storySimulation.scenarioRoundsUnit")}
            </Button>
          ))}
          <span className="text-sm text-muted-foreground">
            {t("storySimulation.scenarioRoundsCustom")}
          </span>
          <Input
            type="number"
            className="w-24"
            value={rounds}
            min={SCENARIO_ROUND_MIN}
            max={SCENARIO_ROUND_MAX}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!isNaN(val) && val > 0) setRounds(val)
            }}
          />
        </div>
        {roundsClamped && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            {t("storySimulation.scenarioRoundsClamped", {
              max: SCENARIO_ROUND_MAX,
            })}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("storySimulation.scenarioRoundsHint", {
            count: effectiveRounds * Math.max(1, characterSpeakers.length),
          })}
        </p>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("storySimulation.scenarioTitlePlaceholder")}
        />
      </section>

      {/* 7. 历史情景 */}
      {(onOpenSaved || onDeleteSaved) && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">
            {t("storySimulation.scenarioHistory")}
          </h3>
          {savedScenarios.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              {t("storySimulation.scenarioHistoryEmpty")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {savedScenarios.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{s.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t("storySimulation.scenarioHistoryMessages", {
                        count: s.messages.length,
                      })}
                      {" · "}
                      {t("storySimulation.scenarioHistoryUpdatedAt", {
                        time: new Date(s.updatedAt).toLocaleString("zh-CN"),
                      })}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {onOpenSaved && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenSaved(s)}
                      >
                        {t("storySimulation.scenarioHistoryView")}
                      </Button>
                    )}
                    {onDeleteSaved && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeleteSaved(s.id)}
                      >
                        {t("storySimulation.scenarioHistoryDelete")}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 8. 成本护栏 */}
      {needsCostAck && (
        <section className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            {t("storySimulation.scenarioCostWarn", {
              count: estimatedMessages,
            })}
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={costAck}
              onChange={(e) => setCostAck(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-input"
            />
            {t("storySimulation.scenarioCostAck")}
          </label>
        </section>
      )}

      {/* 9. 开始 */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("storySimulation.scenarioBack")}
        </Button>
        <div className="flex items-center gap-3">
          {moderatorId !== SCENARIO_MODERATOR_USER_ID && (
            <span className="text-xs text-muted-foreground">
              {t("storySimulation.scenarioModeratorRoleHint", {
                count: characterSpeakers.length,
              })}
            </span>
          )}
          <Button onClick={handleStart} size="lg" disabled={!canStart}>
            <Plus className="mr-1 h-4 w-4" />
            {t("storySimulation.scenarioStart")}
          </Button>
        </div>
      </div>
    </div>
  )
}
