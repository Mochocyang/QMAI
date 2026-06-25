import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { Sparkles, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PanelHeaderWithHelp } from "@/components/layout/panel-header-with-help"
import {
  bindCharacterAura,
  BUILT_IN_CHARACTER_AURAS,
  getCharacterAuraBindings,
  listCharacterAuras,
  type CharacterAura,
  type CharacterAuraBinding,
  unbindCharacterAura,
} from "@/lib/novel/character-aura"
import { useEffect, useMemo, useState } from "react"

export function SoulSidebarPanel() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const selectedSoulId = useWikiStore((s) => s.selectedSoulId)
  const setSelectedSoulId = useWikiStore((s) => s.setSelectedSoulId)
  const selectedSoulTab = useWikiStore((s) => s.selectedSoulTab)
  const setSelectedSoulTab = useWikiStore((s) => s.setSelectedSoulTab)
  const selectedSoulSection = useWikiStore((s) => s.selectedSoulSection)
  const setSelectedSoulSection = useWikiStore((s) => s.setSelectedSoulSection)

  const [auras, setAuras] = useState<CharacterAura[]>(BUILT_IN_CHARACTER_AURAS)
  const [bindings, setBindings] = useState<CharacterAuraBinding[]>([])
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!project) return
    Promise.all([listCharacterAuras(project.path), getCharacterAuraBindings(project.path)])
      .then(([loadedAuras, loadedBindings]) => {
        setAuras(loadedAuras)
        setBindings(loadedBindings)
      })
      .catch(() => {})
  }, [project?.path, dataVersion])

  const builtInAuras = useMemo(() => auras.filter((a) => a.builtIn), [auras])
  const customAuras = useMemo(() => auras.filter((a) => !a.builtIn), [auras])
  const visibleAuras = selectedSoulSection === "builtIn" ? builtInAuras : customAuras
  const auraNameById = useMemo(
    () => new Map(auras.map((aura) => [aura.id, aura.name])),
    [auras],
  )

  async function refreshProjectBindings() {
    if (!project) return
    const [loadedAuras, loadedBindings] = await Promise.all([listCharacterAuras(project.path), getCharacterAuraBindings(project.path)])
    setAuras(loadedAuras)
    setBindings(loadedBindings)
  }

  async function handleBindingAuraChange(binding: CharacterAuraBinding, auraId: string) {
    if (!project || !auraId || auraId === binding.auraId) return
    try {
      await bindCharacterAura(project.path, { characterName: binding.characterName, auraId })
      await refreshProjectBindings()
      bumpDataVersion()
      setMessage(`已将「${binding.characterName}」改绑到「${auraNameById.get(auraId) ?? "新角色灵魂"}」`)
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : "修改角色灵魂绑定失败，请稍后重试")
    }
  }

  async function handleUnbind(binding: CharacterAuraBinding) {
    if (!project) return
    try {
      await unbindCharacterAura(project.path, binding.characterName, binding.auraId)
      await refreshProjectBindings()
      bumpDataVersion()
      setMessage(`已取消「${binding.characterName}」的人物绑定`)
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : "取消绑定失败，请稍后重试")
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          <PanelHeaderWithHelp title={t("nav.soul")} helpKey="soul" />
        </div>
      </div>

      <div className="flex border-b text-sm shrink-0">
        <button
          type="button"
          className={`flex-1 px-3 py-2 ${selectedSoulTab === "project" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          onClick={() => setSelectedSoulTab("project")}
        >
          {t("novel.soul.projectSoul")}
        </button>
        <button
          type="button"
          className={`flex-1 px-3 py-2 ${selectedSoulTab === "character" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          onClick={() => setSelectedSoulTab("character")}
        >
          {t("novel.soul.characterSoul")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {selectedSoulTab === "project" ? (
          <>
            <button
              type="button"
              onClick={() => setSelectedSoulId("project-soul")}
              className={`mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                selectedSoulId === "project-soul" ? "qm-selected" : "text-muted-foreground qm-hover"
              }`}
            >
              <div className="font-medium">{t("novel.soul.projectSoulItem")}</div>
              <div className="mt-1 text-xs opacity-80">{t("novel.soul.projectSoulDesc")}</div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedSoulId("de-ai-skill")}
              className={`mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                selectedSoulId === "de-ai-skill" ? "qm-selected" : "text-muted-foreground qm-hover"
              }`}
            >
              <div className="font-medium">去AI味Skill</div>
              <div className="mt-1 text-xs opacity-80">自定义去AI味规则，应用到全局</div>
            </button>

            <div className="mt-3 rounded-md border bg-muted/20 p-3">
              <div className="text-xs font-medium text-muted-foreground">已绑定人物</div>
              {bindings.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {bindings.map((binding) => (
                    <div key={binding.characterName} className="rounded-md border bg-background/80 p-2">
                      <div className="text-[11px] font-medium text-muted-foreground">小说人物</div>
                      <div className="mt-1 truncate text-sm font-medium text-foreground">{binding.characterName}</div>
                      <div className="mt-2 flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-muted-foreground">绑定角色灵魂</div>
                          <select
                            value={binding.auraId}
                            onChange={(event) => void handleBindingAuraChange(binding, event.target.value)}
                            className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
                          >
                            {auras.map((aura) => (
                              <option key={aura.id} value={aura.id}>{aura.name}</option>
                            ))}
                          </select>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 px-2 text-xs text-muted-foreground"
                          onClick={() => void handleUnbind(binding)}
                        >
                          取消绑定
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-xs text-muted-foreground">还没有人物绑定角色灵魂</div>
              )}
              {message && <div className="mt-2 text-xs text-muted-foreground">{message}</div>}
            </div>
          </>
        ) : (
          <>
            <div className="flex border-b text-xs mb-2">
              <button
                type="button"
                onClick={() => setSelectedSoulSection("builtIn")}
                className={`flex-1 px-3 py-1.5 ${selectedSoulSection === "builtIn" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
              >
                {t("novel.soul.builtInSoul")}
              </button>
              <button
                type="button"
                onClick={() => setSelectedSoulSection("custom")}
                className={`flex-1 px-3 py-1.5 ${selectedSoulSection === "custom" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
              >
                {t("novel.soul.customSoul")}
              </button>
            </div>

            {selectedSoulSection === "custom" && (
              <div className="mb-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setSelectedSoulId("new-custom-soul")}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t("novel.soul.newCustomSoul")}
                </Button>
              </div>
            )}

            {visibleAuras.map((aura) => (
              <button
                key={aura.id}
                type="button"
                onClick={() => setSelectedSoulId(aura.id)}
                className={`mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selectedSoulId === aura.id ? "qm-selected" : "text-muted-foreground qm-hover"
                }`}
              >
                <div className="font-medium">{aura.name}</div>
                <div className="mt-1 text-xs opacity-80">{aura.category ?? (aura.builtIn ? t("novel.soul.builtInSoul") : t("novel.soul.customSoul"))}</div>
              </button>
            ))}

            {selectedSoulSection === "custom" && visibleAuras.length === 0 && (
              <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                {t("novel.soul.noCustomSoul")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
