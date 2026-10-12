import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Info, Plus, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  SCENARIO_CHARACTER_DEFAULT,
  SCENARIO_CHARACTER_MAX,
  SCENARIO_CHARACTER_MIN,
  SCENARIO_CHARACTER_PRESETS,
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
  clampScenarioCharacterCount,
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
import { ScenarioCharacterGrid } from "./scenario-character-grid"
import { ScenarioSoulBindDialog } from "./scenario-soul-bind-dialog"

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
  /** 项目路径；绑定灵魂要写盘，缺它时绑定入口不可用。 */
  projectPath?: string | null
  /** 绑定/解绑灵魂成功后：由视图重载 bindings + auras 并刷新候选。 */
  onSoulChanged?: () => void
  /** 已保存的历史情景会话 */
  savedScenarios?: ScenarioSession[]
  onStart: (setup: ScenarioSetup) => void
  onOpenSaved?: (session: ScenarioSession) => void
  onDeleteSaved?: (id: string) => void
  onCancel: () => void
}

/**
 * 「舞台情景」设置面板（第 1、2 步）
 * 1) 角色选择与配置：数量 3/4/5 或自定义、候选卡片网格选人、绑定灵魂
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
  projectPath = null,
  onSoulChanged,
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
  /** 已选满时点候选卡给的临时提示（不静默失败）。 */
  const [hint, setHint] = useState<string | null>(null)
  /** 正在绑定灵魂的角色；null 表示弹窗关闭。 */
  const [soulTarget, setSoulTarget] = useState<ScenarioCandidate | null>(null)
  /**
   * 自定义人数超界时的提示。
   *
   * 为什么要单独存一份，而不是渲染时比较「characterCount 是否等于夹取后的值」：
   * 失焦夹取只发生在一瞬间，随后下面那个「不超过候选人数」的 effect 会立刻把它
   * 再改小（例如填 99、候选只有 7 人，最终落成 7），比较式就再也看不出来了，
   * 用户会以为填的数字被吃掉了却没有任何解释。
   */
  const [countClampNotice, setCountClampNotice] = useState<string | null>(null)

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

  /**
   * 候选角色是否少到根本凑不齐一场舞台情景。
   *
   * 「角色数量」按钮写死为 [3,5]，与真正提取到几个角色无关；而开始条件要求
   * 「已选人数 === 所选人数」。提取只找到 1~2 个角色时用户永远凑不满，开始
   * 按钮会一直灰着 —— 而且界面上唯一的提示（没有候选角色）只在 0 个时出现，
   * 1~2 个时一片沉默。这里把它变成一个说得清的状态。
   */
  const insufficientCandidates = candidates.length < SCENARIO_CHARACTER_MIN

  /**
   * 候选角色变少时（如重新分析后结果不同），把所选人数夹到候选数。
   *
   * 不足 3 人时不夹：那是「素材不够」，应当明确报错让用户去加提取章节数，
   * 而不是把下限偷偷降到 2 让功能看起来可用。
   */
  useEffect(() => {
    if (candidates.length < SCENARIO_CHARACTER_MIN) return
    // 超出配置上限的输入留给失焦时统一夹取（并给出 setCountClampNotice 提示），
    // 这里只处理「比现有候选人数还多」这一种情况
    if (characterCount > SCENARIO_CHARACTER_MAX) return
    if (characterCount <= candidates.length) return
    setCharacterCount(candidates.length)
  }, [candidates.length, characterCount])

  /**
   * 候选变少或换人后，把已经不存在的 id 从 selectedIds 里裁掉。
   *
   * selectedIds 只增不减：不裁的话「已选 N / 共 M」会出现 N > M（如「已选 5 / 共 3」），
   * reachedLimit 恒真；换成网格后表现为「明明看着有空位却点不进去」。
   * 更糟的是：把可见卡片全部移除后，selectedIds 可能全是已消失的人，此时
   * canStart 里「两边长度相等」反而成立 —— 会带着不存在的角色开演。
   * 主持人若正好是其中一员，一并退回「由你主持」。
   */
  useEffect(() => {
    const alive = new Set(candidates.map((c) => c.id))
    if (selectedIds.every((id) => alive.has(id))) return
    setSelectedIds(selectedIds.filter((id) => alive.has(id)))
    if (moderatorId !== SCENARIO_MODERATOR_USER_ID && !alive.has(moderatorId)) {
      setModeratorId(SCENARIO_MODERATOR_USER_ID)
    }
  }, [candidates, selectedIds, moderatorId])

  /**
   * 点一张候选卡：已上台就下台，未上台就上台；选满时给提示而不是静默忽略。
   *
   * 满员判断放在这里（而不是网格里）是为了只有一处真相：网格是哑组件，
   * 它只管把点击报上来。
   */
  const toggleCharacter = (id: string) => {
    setHint(null)
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id))
      if (moderatorId === id) setModeratorId(SCENARIO_MODERATOR_USER_ID)
      return
    }
    if (selectedIds.length >= characterCount) {
      setHint(t("storySimulation.scenarioFull", { n: characterCount }))
      return
    }
    setSelectedIds([...selectedIds, id])
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
    !insufficientCandidates &&
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      {/* 1. 上台角色：提取范围、人数、候选网格 */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            {t("storySimulation.scenarioOnStage")}
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={sourceChapters}
              disabled={extracting}
              aria-label={t("storySimulation.scenarioSourceChapters")}
              onChange={(e) => onSourceChaptersChange(Number(e.target.value))}
              className="h-8 w-40 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {SCENARIO_SOURCE_CHAPTER_PRESETS.map((n) => (
                <option key={n} value={n}>
                  {t("storySimulation.scenarioSourceChapters")} {n}{" "}
                  {t("storySimulation.scenarioSourceChaptersUnit")}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={onReExtract} disabled={extracting}>
              {extracting
                ? t("storySimulation.scenarioReExtracting")
                : t("storySimulation.scenarioReExtract")}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t("storySimulation.scenarioCharacterCount")}
          </span>
          {SCENARIO_CHARACTER_PRESETS.map((n) => (
            <Button
              key={n}
              variant={characterCount === n ? "default" : "outline"}
              size="sm"
              disabled={n > candidates.length}
              onClick={() => setCharacterCount(n)}
            >
              {n} {t("storySimulation.scenarioCharacterCountUnit")}
            </Button>
          ))}
          <span className="text-sm text-muted-foreground">
            {t("storySimulation.scenarioCharacterCountCustom")}
          </span>
          <Input
            type="number"
            className="w-24"
            min={SCENARIO_CHARACTER_MIN}
            max={SCENARIO_CHARACTER_MAX}
            value={characterCount}
            aria-label={t("storySimulation.scenarioCharacterCount")}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!isNaN(val)) {
                setCharacterCount(val)
                setCountClampNotice(null)
              }
            }}
            onBlur={() => {
              const clamped = clampScenarioCharacterCount(characterCount)
              if (clamped === characterCount) return
              setCharacterCount(clamped)
              setCountClampNotice(
                t("storySimulation.scenarioCharacterCountClamped", {
                  min: SCENARIO_CHARACTER_MIN,
                  max: SCENARIO_CHARACTER_MAX,
                }),
              )
            }}
          />
          <span className="text-xs text-muted-foreground">
            {t("storySimulation.scenarioSelectedCount", {
              n: selectedIds.length,
              total: characterCount,
            })}
          </span>
        </div>

        {countClampNotice && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            {countClampNotice}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {t("storySimulation.scenarioCharacterCountHint", {
            min: SCENARIO_CHARACTER_MIN,
            max: SCENARIO_CHARACTER_MAX,
          })}
        </p>

        {insufficientCandidates && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            {t("storySimulation.scenarioCandidatesInsufficient", {
              count: candidates.length,
              min: SCENARIO_CHARACTER_MIN,
            })}
          </p>
        )}

        {hint && (
          <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {hint}
          </p>
        )}

        {candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t("storySimulation.scenarioNoCandidates")}
          </p>
        ) : (
          <>
            <ScenarioCharacterGrid
              candidates={candidates}
              selectedIds={selectedIds}
              characterCount={characterCount}
              moderatorId={moderatorId}
              onToggle={toggleCharacter}
              onSetModerator={setModeratorId}
              onBindSoul={setSoulTarget}
            />
            <p className="text-xs text-muted-foreground">
              {t("storySimulation.scenarioSoulHint")}
            </p>
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

      {/* 2. 情景设定 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          {t("storySimulation.scenarioRules")}
        </h3>
        <Textarea
          value={directive}
          onChange={(e) => setDirective(e.target.value)}
          rows={3}
          aria-label={t("storySimulation.scenarioRules")}
          placeholder={t("storySimulation.scenarioRulesPlaceholder")}
        />

        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="scenario-scene">
            {t("storySimulation.scenarioSceneLabel")}
          </label>
          <Textarea
            id="scenario-scene"
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            rows={2}
            placeholder={t("storySimulation.scenarioScenePlaceholder")}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="scenario-location">
              {t("storySimulation.scenarioLocationLabel")}
            </label>
            <Input
              id="scenario-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t("storySimulation.scenarioLocationPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="scenario-time">
              {t("storySimulation.scenarioTimeLabel")}
            </label>
            <Input
              id="scenario-time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder={t("storySimulation.scenarioTimePlaceholder")}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="scenario-reference">
            {t("storySimulation.scenarioReferenceLabel")}
          </label>
          <Input
            id="scenario-reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t("storySimulation.scenarioReferencePlaceholder")}
          />
          {/* 参考点不是一句空话：写着「必须以此为依据」，就得让人知道依据从哪来。
              同时先把「检索不到也照常开演」说在前面，免得事后以为是 bug */}
          <p className="text-xs text-muted-foreground">
            {t("storySimulation.scenarioReferenceHint")}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="scenario-title">
            {t("storySimulation.scenarioTitleLabel")}
          </label>
          <Input
            id="scenario-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("storySimulation.scenarioTitlePlaceholder")}
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
            aria-label={t("storySimulation.scenarioRounds")}
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
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {s.title}
                      </span>
                      {s.status === "cancelled" && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-700 dark:text-amber-300">
                          {t("storySimulation.scenarioStatusCancelled")}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {SCENARIO_FORMAT_INFO[s.setup.format]?.icon}{" "}
                      {SCENARIO_FORMAT_INFO[s.setup.format]?.name ?? s.setup.format}
                      {" · "}
                      {t("storySimulation.scenarioHistoryRounds", {
                        n: s.setup.rounds,
                      })}
                      {" · "}
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

      {/* 绑定灵魂：写盘、补小传都收在这个弹窗里 */}
      {projectPath && (
        <ScenarioSoulBindDialog
          open={soulTarget !== null}
          projectPath={projectPath}
          candidate={soulTarget}
          onOpenChange={(open) => {
            if (!open) setSoulTarget(null)
          }}
          onBound={() => onSoulChanged?.()}
        />
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
