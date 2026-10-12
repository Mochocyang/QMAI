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
 */
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
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

  // 每次打开都重读名单：用户可能刚在灵魂页建了一个灵魂
  useEffect(() => {
    if (!open) return
    setStep("pick")
    setQuery("")
    setPickedId(candidate?.auraId ?? "")
    setDraft("")
    setBusy(false)
    setError(null)
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
  }, [open, projectPath, candidate])

  const keyword = query.trim().toLowerCase()
  const visible = useMemo(() => {
    const list = auras ?? []
    if (!keyword) return list
    return list.filter((a) => a.name.toLowerCase().includes(keyword))
  }, [auras, keyword])

  if (!candidate) return null

  const handleBind = async () => {
    if (!pickedId || busy) return
    setBusy(true)
    setError(null)
    const result = await bindScenarioSoul(projectPath, candidate.name, pickedId)
    setBusy(false)
    if (result.ok) {
      onBound()
      onOpenChange(false)
      return
    }
    if (result.reason === "missing-profile") {
      // 只有这一条路径才切到补小传：草稿不调模型、不消耗 token
      setDraft(buildProfileDraftFromCandidate(candidate))
      setStep("profile")
      return
    }
    setError(result.message)
  }

  const handleCreateAndBind = async () => {
    if (busy || !draft.trim()) return
    setBusy(true)
    setError(null)
    const result = await createProfilePageThenBind(
      projectPath,
      candidate.name,
      pickedId,
      draft,
    )
    setBusy(false)
    if (result.ok) {
      onBound()
      onOpenChange(false)
      return
    }
    setError(result.message)
  }

  const handleUnbind = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await unbindCharacterAura(projectPath, candidate.name)
      setBusy(false)
      onBound()
      onOpenChange(false)
    } catch (err) {
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
            <p className="shrink-0 text-sm text-muted-foreground">
              {t("storySimulation.scenarioSoulDialogDesc")}
            </p>

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
                  {t("storySimulation.scenarioSoulEmpty")}
                </p>
              ) : (
                <div className="flex flex-col gap-1">
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
            <p className="shrink-0 text-sm text-muted-foreground">
              {t("storySimulation.scenarioSoulProfileDesc", { name: candidate.name })}
            </p>

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
