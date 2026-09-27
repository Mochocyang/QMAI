import { useWikiStore } from "@/stores/wiki-store"
import { BookOpen, ChevronDown, Plus, Search, Sparkles, Users } from "lucide-react"
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
  const [uiTestQuery, setUiTestQuery] = useState("")
  const [uiTestBindingsOpen, setUiTestBindingsOpen] = useState(true)

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

  const filteredAuras = visibleAuras.filter(aura => `${aura.name} ${aura.category ?? ""}`.toLocaleLowerCase().includes(uiTestQuery.trim().toLocaleLowerCase()))
    const selectSection = (section: "builtIn" | "custom") => {
      setSelectedSoulTab("character"); setSelectedSoulSection(section); setUiTestQuery("")
      const candidates = section === "builtIn" ? builtInAuras : customAuras
      if (!candidates.some(aura => aura.id === selectedSoulId)) setSelectedSoulId(candidates[0]?.id ?? "new-custom-soul")
    }
    return <div className="ui-test-soul-directory">
      <div className="ui-test-directory-head"><h2>灵魂</h2><Sparkles size={16} /></div>
      <div className="ui-test-soul-directory-scroll">
        <button type="button" className={`ui-test-soul-section${selectedSoulTab === "project" ? " is-active" : ""}`} onClick={() => { setSelectedSoulTab("project"); setSelectedSoulId("project-soul") }}><BookOpen />项目灵魂</button>
        <button type="button" className="ui-test-soul-section" aria-expanded={uiTestBindingsOpen} onClick={() => setUiTestBindingsOpen(!uiTestBindingsOpen)}><Users />已绑定人物<ChevronDown className={uiTestBindingsOpen ? "" : "is-collapsed"} /></button>
        {uiTestBindingsOpen && <div className="ui-test-soul-bindings">
          {bindings.length ? bindings.map(binding => <div key={binding.characterName} className="ui-test-soul-binding">
            <button type="button" title={`查看${binding.characterName}的角色灵魂`} onClick={() => { setSelectedSoulTab("character"); setSelectedSoulSection(auras.find(aura => aura.id === binding.auraId)?.builtIn ? "builtIn" : "custom"); setSelectedSoulId(binding.auraId) }}>{binding.characterName}</button>
            <details><summary>绑定管理</summary><label>绑定角色灵魂<select aria-label={`${binding.characterName}绑定的角色灵魂`} value={binding.auraId} onChange={event => void handleBindingAuraChange(binding, event.target.value)}>{auras.map(aura => <option key={aura.id} value={aura.id}>{aura.name}</option>)}</select></label><button type="button" onClick={() => void handleUnbind(binding)}>取消绑定</button></details>
          </div>) : <p>还没有人物绑定角色灵魂</p>}
          {message && <p role="status">{message}</p>}
        </div>}
        <button type="button" className={`ui-test-soul-section${selectedSoulTab === "character" && selectedSoulSection === "builtIn" ? " is-active" : ""}`} onClick={() => selectSection("builtIn")}><Sparkles />角色灵魂</button>
        <button type="button" className={`ui-test-soul-section${selectedSoulTab === "character" && selectedSoulSection === "custom" ? " is-active" : ""}`} onClick={() => selectSection("custom")}><Users />自定义灵魂</button>
        {selectedSoulTab === "character" && <div className="ui-test-soul-aura-list">
          <label className="ui-test-directory-search"><Search /><input aria-label="搜索灵魂" placeholder="搜索灵魂…" value={uiTestQuery} onChange={event => setUiTestQuery(event.target.value)} /></label>
          {selectedSoulSection === "custom" && <button type="button" className="ui-test-soul-section" onClick={() => setSelectedSoulId("new-custom-soul")}><Plus />新建自定义灵魂</button>}
          {filteredAuras.map(aura => <button key={aura.id} type="button" className={`ui-test-soul-aura${selectedSoulId === aura.id ? " is-active" : ""}`} title={aura.name} onClick={() => setSelectedSoulId(aura.id)}><span>{aura.name}</span><small>{aura.category ?? (aura.builtIn ? "内置灵魂" : "自定义灵魂")}</small></button>)}
          {!filteredAuras.length && <p className="ui-test-soul-empty">{uiTestQuery ? "没有找到匹配的灵魂" : "还没有自定义灵魂"}</p>}
        </div>}
      </div>
      <p className="ui-test-directory-note">风格是一种选择。<br />让每个人物，有自己的声音。</p>
    </div>
}
