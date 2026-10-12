/**
 * 「舞台情景」绑定灵魂弹窗
 *
 * ── 一个弹窗、两个步骤 ──
 * 步骤 1 选灵魂；步骤 2 只在 `bindCharacterAura` 明确报「缺人物小传」时出现。
 * 为什么不预先判断缺不缺小传：`hasCharacterProfile` 还会兜底走一次
 * searchWiki（character-aura.ts:737-745），预判会漏掉那条命中路径，
 * 对本来能绑成功的角色弹出多余的补小传步骤。
 *
 * ── 为什么复用 soul-binding-target-dialog 的名单链而不是它的组件 ──
 * 那个弹窗是「本条消息的临时绑定」语义，文案写着「只对这一条消息生效」，
 * 而且是多选；本处要做的是**项目级持久绑定**，两者同形不同义。
 *
 * ── 异步结果的归属 ──
 * 绑定请求可能在飞的时候被用户换人。`await` 之后必须重新确认「人还是不是发请求
 * 那一个」：否则会拿 A 的结果去改 B 的界面，最坏在磁盘上留下一份内容属于 A 的
 * B.md。为此用 `candidateRef` 跟随最新角色，并在每个 `await` 之后比对。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  listCharacterAuras,
  unbindCharacterAura,
  type CharacterAura,
} from "@/lib/novel/character-aura"
import {
  bindScenarioSoul,
  buildProfileDraftFromCandidate,
  createProfilePageThenBind,
} from "@/lib/novel/story-simulation/scenario-soul-binding"
import type { ScenarioCandidate } from "@/lib/novel/story-simulation/scenario-types"

export interface ScenarioSoulBindDialogProps {
  open: boolean
  projectPath: string
  /** 要绑定的角色；为 null 时弹窗内容为空。 */
  candidate: ScenarioCandidate | null
  onOpenChange: (open: boolean) => void
  /** 绑定或解绑成功后通知调用方刷新候选。 */
  onBound: () => void
}

export function ScenarioSoulBindDialog({
  open,
  projectPath,
  candidate,
  onOpenChange,
  onBound,
}: ScenarioSoulBindDialogProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<"pick" | "profile">("pick")
  const [auras, setAuras] = useState<CharacterAura[] | null>(null)
  const [query, setQuery] = useState("")
  const [pickedId, setPickedId] = useState("")
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 上次「创建小传并绑定」失败时，同名人物页是否本来就已经存在（我们一个字节都没写）。 */
  const [pageExists, setPageExists] = useState(false)

  /**
   * effect 只依赖这两个基本类型。
   *
   * 调用方很容易写成 `candidate={{ ... }}` 或每次 `map`/`find` 出新对象，此时把
   * `candidate` 本身写进依赖，父组件**任何一次无关重渲染**都会让 effect 重跑：
   * 名单被重读、`step` 弹回第一步、用户正在改的小传草稿被清空。
   */
  const candidateId = candidate?.id ?? null
  const candidateAuraId = candidate?.auraId ?? null

  /** 最新角色。异步处理器取它，就不会拿到闭包里的旧值。 */
  const candidateRef = useRef(candidate)
  candidateRef.current = candidate
  /** 上一次自动生成的小传草稿，用来判断用户有没有改过它。 */
  const autoDraftRef = useRef("")
  /** 当前草稿属于哪个角色。写盘前比对，防止把 A 的草稿写进 B 的人物页。 */
  const draftOwnerRef = useRef<string | null>(null)

  // 每次打开、或换了角色都重读名单：用户可能刚在灵魂页建了一个灵魂
  useEffect(() => {
    // 没有角色就没有内容可渲染，不必白跑一次读名单的 IPC
    if (!open || candidateId === null) return
    setStep("pick")
    setQuery("")
    setPickedId(candidateAuraId ?? "")
    setDraft("")
    autoDraftRef.current = ""
    draftOwnerRef.current = null
    setBusy(false)
    setError(null)
    setPageExists(false)
    setAuras(null)
    let current = true
    void listCharacterAuras(projectPath)
      .then((list) => {
        if (current) setAuras(list)
      })
      // 读不到就当空名单：空态会告诉用户去哪儿补，绝不能因此挡住弹窗
      .catch(() => {
        if (current) setAuras([])
      })
    return () => {
      current = false
    }
  }, [open, projectPath, candidateId, candidateAuraId])

  const keyword = query.trim().toLowerCase()
  const visible = useMemo(() => {
    const list = auras ?? []
    if (!keyword) return list
    return list.filter((a) => a.name.toLowerCase().includes(keyword))
  }, [auras, keyword])

  // 过滤把已选项藏起来时必须清掉选中：否则按钮看着可点，绑的却是一个列表里
  // 看不见的灵魂，界面上也没有任何回显。
  // 名单还没读回来时（auras === null）不能清：那一刻 visible 恒为空，
  // 会把「当前已绑定灵魂」的预选也一起清掉。
  useEffect(() => {
    if (auras === null || !pickedId) return
    if (!visible.some((a) => a.id === pickedId)) setPickedId("")
  }, [auras, visible, pickedId])

  if (!candidate) return null

  /** 请求返回之后，人还是不是发请求的那一个。不相等就说明请求在飞时换了人。 */
  const isStillCurrent = (who: ScenarioCandidate) => candidateRef.current?.id === who.id

  const handleBind = async () => {
    if (!pickedId || busy) return
    const who = candidateRef.current
    if (!who) return
    setBusy(true)
    setError(null)
    try {
      const result = await bindScenarioSoul(projectPath, who.name, pickedId)
      // 换了人：这次结果不属于当前角色，整条作废，一个界面状态都不碰。
      // 不复位 busy：新角色可能正在绑定，复位会把它误判成已结束；
      // 换人会重跑上面的 effect，由它复位。
      if (!isStillCurrent(who)) return
      setBusy(false)
      if (result.ok) {
        onBound()
        onOpenChange(false)
        return
      }
      if (result.reason === "missing-profile") {
        // 只有这一条路径才切到补小传：草稿不调模型、不消耗 token
        draftOwnerRef.current = who.id
        // 用户改过的草稿不能被他自己的「返回重选 → 再绑定」冲掉：只有草稿为空、
        // 或跟上次自动生成的一模一样（等于没改过）时才重新生成。
        if (!draft.trim() || draft === autoDraftRef.current) {
          const generated = buildProfileDraftFromCandidate(who)
          autoDraftRef.current = generated
          setDraft(generated)
        }
        setPageExists(false)
        setStep("profile")
        return
      }
      setError(result.message)
    } catch (err) {
      // 历史/导入数据缺 personality、knowledgeScope 时 buildProfileDraftFromCandidate
      // 会抛 TypeError；接不住就变成「点了绑定毫无反应」（与 handleUnbind 同风格）
      if (!isStillCurrent(who)) return
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCreateAndBind = async () => {
    if (busy || !draft.trim()) return
    const who = candidateRef.current
    if (!who) return
    // 写盘前先比对一次：这份草稿是不是当前这个角色的。createProfilePageThenBind 是
    // 「先写盘、再绑定」，名字只要取错一个，磁盘上就多出一份内容属于别人的页面。
    // ⚠️ 这一句目前测不到：换人时上面的 effect 会清空草稿并把 draftOwnerRef 复位，
    // 而「创建小传并绑定」要求草稿非空，所以走到这里时归属必然相等 —— 实测删掉这一行，
    // 本文件全部用例仍然全绿，不会有红灯。它守的是「草稿已提交、effect 还没跑」的
    // 理论一帧（React 处理下一个离散事件前会先冲刷被动 effect，故实际不可达）。
    // 保留它，但请勿在没有新证据的情况下删除。
    if (draftOwnerRef.current !== who.id) return
    setBusy(true)
    setError(null)
    try {
      const result = await createProfilePageThenBind(
        projectPath,
        who.name,
        pickedId,
        draft,
      )
      // 写盘已经发生（那是换人前用户自己点的那次，名字与草稿同属一个人），
      // 但结果不能再回写到换了人之后的界面
      if (!isStillCurrent(who)) return
      setBusy(false)
      if (result.ok) {
        onBound()
        onOpenChange(false)
        return
      }
      // created=false 说明同名人物页本来就存在、按「绝不覆盖」我们没动它，
      // 上面那句「还没有档案」与这条错误矛盾，故隐藏（见 pageExists 的渲染处）
      setPageExists(!result.created)
      setError(result.message)
    } catch (err) {
      if (!isStillCurrent(who)) return
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleUnbind = async () => {
    if (busy) return
    const who = candidateRef.current
    if (!who) return
    setBusy(true)
    setError(null)
    try {
      await unbindCharacterAura(projectPath, who.name)
      // 换了人：这次结果不属于当前角色，整条作废，一个界面状态都不碰。
      // 不复位 busy：新角色可能正在飞它自己的请求（解绑，或刚点了绑定），
      // 复位会把它的请求误判成已结束；换人会重跑上面的 effect，由它复位。
      if (!isStillCurrent(who)) return
      setBusy(false)
      onBound()
      onOpenChange(false)
    } catch (err) {
      // 同上：换了人就整条作废，既不弹错误也不复位 busy
      if (!isStillCurrent(who)) return
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="scenario-soul-bind-dialog"
        className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto sm:max-w-[720px]"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {step === "pick"
              ? t("storySimulation.scenarioSoulDialogTitle", { name: candidate.name })
              : t("storySimulation.scenarioSoulProfileTitle")}
          </DialogTitle>
        </DialogHeader>

        {step === "pick" ? (
          <>
            <DialogDescription className="shrink-0">
              {t("storySimulation.scenarioSoulDialogDesc")}
            </DialogDescription>

            <label className="flex shrink-0 items-center gap-2 rounded-md border px-2">
              <Search className="size-4 shrink-0 opacity-60" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("storySimulation.scenarioSoulSearch")}
                aria-label={t("storySimulation.scenarioSoulSearch")}
                className="h-9 w-full bg-transparent text-sm outline-none"
              />
            </label>

            <div className="min-h-0 flex-1 overflow-y-auto" data-testid="scenario-soul-list">
              {auras === null ? (
                <p className="text-sm text-muted-foreground">
                  {t("storySimulation.scenarioSoulLoading")}
                </p>
              ) : visible.length === 0 ? (
                <p role="alert" className="text-sm">
                  {/* 名单为空才叫用户去灵魂页建一个；搜不到只是关键词的问题 */}
                  {keyword
                    ? t("storySimulation.scenarioSoulNoMatch", { query: query.trim() })
                    : t("storySimulation.scenarioSoulEmpty")}
                </p>
              ) : (
                <div
                  role="radiogroup"
                  aria-label={t("storySimulation.scenarioSoul")}
                  className="flex flex-col gap-1"
                >
                  {visible.map((aura) => (
                    <label key={aura.id} className="flex items-center gap-2 py-1.5 text-sm">
                      <input
                        type="radio"
                        name="scenario-soul"
                        checked={pickedId === aura.id}
                        onChange={() => setPickedId(aura.id)}
                        aria-label={aura.name}
                      />
                      <span className="truncate" title={aura.name}>
                        {aura.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <p role="alert" className="shrink-0 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <DialogFooter className="shrink-0">
              {candidate.auraId && (
                <Button variant="ghost" disabled={busy} onClick={() => void handleUnbind()}>
                  {t("storySimulation.scenarioSoulUnbind")}
                </Button>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("storySimulation.back")}
              </Button>
              <Button disabled={!pickedId || busy} onClick={() => void handleBind()}>
                {busy
                  ? t("storySimulation.scenarioSoulBinding")
                  : t("storySimulation.scenarioSoulConfirm")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {/* 同名人物页本来就存在（created=false）时，我们没写过任何东西，
                这句「还没有档案，直接绑定会被拒绝」与下面的错误自相矛盾，故整条隐藏 */}
            {!pageExists && (
              <DialogDescription className="shrink-0">
                {t("storySimulation.scenarioSoulProfileDesc", { name: candidate.name })}
              </DialogDescription>
            )}

            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              aria-label={t("storySimulation.scenarioSoulProfileTitle")}
              className="min-h-0 flex-1 font-mono text-xs"
            />

            {error && (
              <p role="alert" className="shrink-0 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <DialogFooter className="shrink-0">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStep("pick")
                  setError(null)
                }}
              >
                {t("storySimulation.scenarioSoulProfileBack")}
              </Button>
              <Button
                disabled={busy || !draft.trim()}
                onClick={() => void handleCreateAndBind()}
              >
                {busy
                  ? t("storySimulation.scenarioSoulBinding")
                  : t("storySimulation.scenarioSoulProfileCreate")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
