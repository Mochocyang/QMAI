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
 * 「角色数量」相关的临时提示（选满 / 自定义超界被夹取）。
 *
 * 记下「它是什么时候算出来的」，而不是只存一句本地化好的话：
 * - 存成字符串就永远在场。选满 3 人时点第 4 张卡说「已选满 3 个角色」，再把
 *   人数改成 4，这句已经不成立的话还挂在屏幕上；夹取提示在用户重新点了
 *   「3 个角色」之后也一样。
 * - 跨提取周期同样要失效：重新分析角色往返一趟（组件不卸载、state 原样保留）
 *   后人还是那几个人、人数一个字没变，上一轮的解释却已经不作数了。
 */
interface CharacterCountNotice {
  kind: "full" | "clamped"
  /** 已经本地化好的提示正文。 */
  text: string
  /** 生成它时的「所选人数」；与当前人数不一致即失效。 */
  count: number
  /** 生成它时的提取周期；重新提取过即失效。 */
  epoch: number
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
  /** 正在绑定灵魂的角色；null 表示弹窗关闭。 */
  const [soulTarget, setSoulTarget] = useState<ScenarioCandidate | null>(null)
  /**
   * 「已选满」与「自定义人数超界被夹取」两类提示共用一个槽位。
   *
   * 为什么不合起来不行：
   * - 两类提示在真实操作里可以同时成立（先填 99 被夹到 10，再点一张满员之外
   *   的卡片），同屏出现两句自相矛盾的话。共用一个槽位后「不可能同时在场」
   *   是结构上的保证，而不是靠两处互相记得清。
   * - 提示的有效性由 `count === characterCount && epoch === extractEpoch` 现算，
   *   不依赖在每一个改人数 / 重新提取的地方记得手动清空。
   *
   * 唯一需要主动搬一次基准的地方是下面那个「不超过候选人数」的 effect：那是
   * 系统替用户改的人数（填 99、候选只有 7 人时会落成 7），若不动基准，刚说
   * 出口的解释就会被这句夹取自己判成失效，用户会以为填的数字被吃掉了却一声
   * 不吭 —— 这正是上面 count 字段存在的意义。
   */
  const [notice, setNotice] = useState<CharacterCountNotice | null>(null)
  /** 提取周期：每进入一次「提取中」加一，让上一轮算出的提示自动失效。 */
  const [extractEpoch, setExtractEpoch] = useState(0)

  useEffect(() => {
    if (!extracting) return
    setExtractEpoch((n) => n + 1)
  }, [extracting])

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
    // 超出配置上限的输入留给失焦时统一夹取（并给出「已夹到 3-10」提示），
    // 这里只处理「比现有候选人数还多」这一种情况
    if (characterCount > SCENARIO_CHARACTER_MAX) return
    if (characterCount <= candidates.length) return
    setCharacterCount(candidates.length)
    // 这一步是系统替用户改的人数：夹取提示的基准跟着挪，否则刚说出口的解释
    // 会被这句夹取自己判成失效（填 99、候选 7 人时落成 7 却一声不吭）。
    setNotice((cur) =>
      cur && cur.kind === "clamped" ? { ...cur, count: candidates.length } : cur,
    )
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
   * 把上台人数收敛到 nextCount：多出来的人下台。
   *
   * 为什么保留「前 N 个」而不是「后 N 个」：selectedIds 的顺序就是上台顺序，
   * 卡片上的序号 1..N 直接取自它。保留前 N 个时已上台角色的序号一格都不动，
   * 用户看到的只是排在末尾的人下台；保留后 N 个会把所有人往前挪，等于把已经
   * 排好的台位重排一遍 —— 而用户只是想把人数改少。
   *
   * 只在「提交点」（预设按钮、自定义输入失焦）调用，绝不放进入按键的 onChange：
   * 想把 5 改成 10，输入过程必然先经过 "1"，按键即裁会把 4 个人当场踢下台，
   * 那是真实的数据丢失。
   *
   * 主持人若正好被裁掉，退回「由你主持」—— 判据与下面「候选消失」那个 effect
   * 同一套：只有真的指定了角色主持人时才需要退回。
   */
  const pruneSelectedTo = (nextCount: number) => {
    const kept = selectedIds.slice(0, Math.max(0, nextCount))
    setSelectedIds(kept)
    if (
      moderatorId !== SCENARIO_MODERATOR_USER_ID &&
      !kept.includes(moderatorId)
    ) {
      setModeratorId(SCENARIO_MODERATOR_USER_ID)
    }
  }

  /**
   * 点一张候选卡：已上台就下台，未上台就上台；选满时给提示而不是静默忽略。
   *
   * 满员判断放在这里（而不是网格里）是为了只有一处真相：网格是哑组件，
   * 它只管把点击报上来。
   */
  const toggleCharacter = (id: string) => {
    // 任何时候点卡片，上一条关于人数的提示都不再作数：下台会让「已选满」立刻
    // 变成假话，上台则可能换成新的满员提示。
    setNotice(null)
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id))
      if (moderatorId === id) setModeratorId(SCENARIO_MODERATOR_USER_ID)
      return
    }
    if (selectedIds.length >= characterCount) {
      setNotice({
        kind: "full",
        text: t("storySimulation.scenarioFull", { n: characterCount }),
        count: characterCount,
        epoch: extractEpoch,
      })
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

  /**
   * 只有「为当前人数算的、且属于本次提取周期」的提示才作数。
   * 人数一变、或重新提取过，旧提示自动失效（不需要在别处手动清）。
   */
  const visibleNotice =
    notice && notice.count === characterCount && notice.epoch === extractEpoch
      ? notice
      : null

  const canStart =
    !extracting &&
    !insufficientCandidates &&
    // 下限守卫：输入框在按键期间允许暂时越界（下限夹取要到失焦才做，见 onBlur），
    // 此时填 2 再选 2 个人也会满足下面那个「两边长度相等」，人数填 0 且一个都
    // 没选时 0 === 0 同样成立 —— 会带着低于下限、甚至空 participants 的配置进
    // 引擎。这里挡的就是「低于下限也能开演」。
    characterCount >= SCENARIO_CHARACTER_MIN &&
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
              onClick={() => {
                setCharacterCount(n)
                // 提交点：改了人数就把多出来的人请下台（按键期间不裁，见 onBlur 注释）
                pruneSelectedTo(n)
              }}
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
              // 按键期间只写人数、不夹取也不裁人：用户想把 5 改成 10，路上必然
              // 先经过 "1"，当场夹成 3 或裁掉 4 个人都是真实的数据丢失。
              // 下限由 canStart 挡着，越界值不会真的开演。
              if (!isNaN(val)) setCharacterCount(val)
            }}
            onBlur={() => {
              const clamped = clampScenarioCharacterCount(characterCount)
              // 裁切无条件执行：输入的人数正好等于当前 characterCount 时（例如把
              // 5 改成 3）提前 return，会让已经多出来的那两个人永远下不了台。
              // 只有「要不要提示被夹取」才取决于 clamped 是否真的改动了人数。
              setCharacterCount(clamped)
              pruneSelectedTo(clamped)
              setNotice(
                clamped === characterCount
                  ? null
                  : {
                      kind: "clamped",
                      text: t("storySimulation.scenarioCharacterCountClamped", {
                        min: SCENARIO_CHARACTER_MIN,
                        max: SCENARIO_CHARACTER_MAX,
                      }),
                      count: clamped,
                      epoch: extractEpoch,
                    },
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

        {/* 提示是异步冒出来的，屏幕阅读器不会主动播报：挂 role="alert"
            （与 scenario-soul-bind-dialog.tsx 的错误段同一做法） */}
        {visibleNotice?.kind === "clamped" && (
          <p
            role="alert"
            className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
          >
            {visibleNotice.text}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {t("storySimulation.scenarioCharacterCountHint", {
            min: SCENARIO_CHARACTER_MIN,
            max: SCENARIO_CHARACTER_MAX,
          })}
        </p>

        {insufficientCandidates && (
          <p
            role="alert"
            className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
          >
            {t("storySimulation.scenarioCandidatesInsufficient", {
              count: candidates.length,
              min: SCENARIO_CHARACTER_MIN,
            })}
          </p>
        )}

        {visibleNotice?.kind === "full" && (
          <p
            role="alert"
            className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground"
          >
            {visibleNotice.text}
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
