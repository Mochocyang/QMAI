import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Plus } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import "@/components/uitest/ui-test-tools.css"
import { SoulDocEditor } from "./soul-doc-editor"
import { CharacterAuraView } from "./character-aura-view"
import {
  BUILT_IN_CHARACTER_AURAS,
  getCharacterAuraBindings,
  listCharacterAuras,
  type CharacterAura,
  type CharacterAuraBinding,
} from "@/lib/novel/character-aura"

/** 自定义灵魂新建入口的哨兵选中值。 */
const NEW_CUSTOM_SOUL_ID = "new-custom-soul"

type GallerySection = "builtIn" | "custom" | "bound"

const SECTION_LABELS: { id: GallerySection; label: string }[] = [
  { id: "builtIn", label: "内置灵魂" },
  { id: "custom", label: "自定义灵魂" },
  { id: "bound", label: "已绑定" },
]

export function SoulView() {
  const project = useWikiStore((s) => s.project)
  const selectedSoulTab = useWikiStore((s) => s.selectedSoulTab)
  const setSelectedSoulTab = useWikiStore((s) => s.setSelectedSoulTab)
  const selectedSoulSection = useWikiStore((s) => s.selectedSoulSection)
  const setSelectedSoulSection = useWikiStore((s) => s.setSelectedSoulSection)
  const selectedSoulId = useWikiStore((s) => s.selectedSoulId)
  const setSelectedSoulId = useWikiStore((s) => s.setSelectedSoulId)

  const [auras, setAuras] = useState<CharacterAura[]>(BUILT_IN_CHARACTER_AURAS)
  const [bindings, setBindings] = useState<CharacterAuraBinding[]>([])
  const [gallerySection, setGallerySection] = useState<GallerySection>(
    selectedSoulSection === "custom" ? "custom" : "builtIn",
  )
  const [builtInCategory, setBuiltInCategory] = useState<string>("all")
  const [view, setView] = useState<"gallery" | "detail">("gallery")

  const isProjectSoul = selectedSoulTab === "project"

  useEffect(() => {
    if (!project || isProjectSoul) return
    let cancelled = false
    Promise.all([listCharacterAuras(project.path), getCharacterAuraBindings(project.path)])
      .then(([loadedAuras, loadedBindings]) => {
        if (cancelled) return
        setAuras(loadedAuras)
        setBindings(loadedBindings)
        const current = selectedSoulId
        if (current !== NEW_CUSTOM_SOUL_ID && !loadedAuras.some((aura) => aura.id === current)) {
          const preferCustom = selectedSoulSection === "custom"
          const first = preferCustom
            ? loadedAuras.find((aura) => !aura.builtIn)
            : loadedAuras.find((aura) => aura.builtIn)
          setSelectedSoulId(first?.id ?? loadedAuras[0]?.id ?? null)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProjectSoul, project?.path, selectedSoulSection])

  const builtInAuras = useMemo(() => auras.filter((aura) => aura.builtIn), [auras])
  const customAuras = useMemo(() => auras.filter((aura) => !aura.builtIn), [auras])

  const bindingCount = useMemo(() => {
    const count = new Map<string, number>()
    for (const binding of bindings) count.set(binding.auraId, (count.get(binding.auraId) ?? 0) + 1)
    return count
  }, [bindings])

  // 内置灵魂按 category 汇总分类标签，便于检索。
  const builtInCategories = useMemo(() => {
    const set = new Set<string>()
    for (const aura of builtInAuras) {
      if (aura.category) set.add(aura.category)
    }
    return [...set]
  }, [builtInAuras])

  const boundAuras = useMemo(
    () => auras.filter((aura) => (bindingCount.get(aura.id) ?? 0) > 0),
    [auras, bindingCount],
  )

  const visibleAuras = useMemo(() => {
    if (gallerySection === "custom") return customAuras
    if (gallerySection === "bound") return boundAuras
    if (builtInCategory === "all") return builtInAuras
    return builtInAuras.filter((aura) => aura.category === builtInCategory)
  }, [gallerySection, builtInCategory, builtInAuras, customAuras, boundAuras])

  const section = (isProjectSoul
    ? "project"
    : gallerySection === "custom" ? "custom" : "role") as "project" | "custom" | "role"

  const emptyText = (() => {
    if (gallerySection === "custom") return "还没有自定义灵魂。点击右上角「新建灵魂」后，再填写资料并生成。"
    if (gallerySection === "bound") return "还没有绑定任何人物。打开一个灵魂，在详情顶部把它绑定到小说人物。"
    if (builtInCategory !== "all") return `「${builtInCategory}」分类下暂无内置灵魂。`
    return "暂无内置灵魂。"
  })()

  function backToCharacterSouls() {
    setSelectedSoulTab("character")
    setView("gallery")
  }

  function selectGallerySection(next: GallerySection) {
    setGallerySection(next)
    setView("gallery")
    if (next === "custom") setSelectedSoulSection("custom")
    else if (next === "builtIn") setSelectedSoulSection("builtIn")
  }

  function openAura(aura: CharacterAura) {
    setSelectedSoulSection(aura.builtIn ? "builtIn" : "custom")
    setSelectedSoulId(aura.id)
    setView("detail")
  }

  function startNewCustom() {
    setSelectedSoulSection("custom")
    setSelectedSoulId(NEW_CUSTOM_SOUL_ID)
    setView("detail")
  }

  /** 人物 Skill 在技能库里随章节学习自动建档，这里只负责把人送过去。 */
  function goToPersonaSkillLibrary() {
    useWikiStore.getState().setActiveView("personaSkillLibrary")
  }

  return (
    <section data-ui-page="soul" data-ui-soul={section} className="ui-test-soul-page">
      <header data-ui="soul-tabs" className="ui-test-soul-heading">
        <div className="ui-test-soul-heading-row">
          <h1>灵魂</h1>
          <nav className="ui-test-soul-tab-row" aria-label="灵魂分组">
            {isProjectSoul ? (
              <button type="button" className="ui-test-soul-tab" onClick={backToCharacterSouls}>
                <ArrowLeft /> 返回角色灵魂库
              </button>
            ) : (
              SECTION_LABELS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={gallerySection === item.id}
                  className={`ui-test-soul-chip${gallerySection === item.id ? " is-active" : ""}`}
                  onClick={() => selectGallerySection(item.id)}
                >
                  {item.label}
                  {item.id === "bound" && boundAuras.length > 0 ? ` ${boundAuras.length}` : ""}
                </button>
              ))
            )}
          </nav>
          {!isProjectSoul && view === "gallery" && gallerySection === "custom" ? (
            <div className="ui-test-soul-actions">
              <button
                type="button"
                className="ui-test-soul-action"
                data-testid="soul-go-persona-skill"
                title="去拆书库：从拆解出的角色里直接生成人物 Skill"
                onClick={goToPersonaSkillLibrary}
              >
                去拆书库生成角色 skill
              </button>
              <button type="button" className="ui-test-soul-action" onClick={startNewCustom}>
                <Plus /> 新建灵魂
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div data-ui="soul-content" className="ui-test-soul-content">
        {isProjectSoul ? (
          project ? <div data-ui="soul-project-editor"><SoulDocEditor /></div>
            : <p className="ui-test-empty-state">请先打开一本书，再编辑项目灵魂。</p>
        ) : view === "gallery" ? (
          <div className="ui-test-soul-gallery">
            <div className="ui-test-soul-toolbar">
              {gallerySection === "builtIn" && builtInCategories.length > 0 ? (
                <div className="ui-test-soul-tags" aria-label="内置灵魂分类">
                  <button
                    type="button"
                    aria-pressed={builtInCategory === "all"}
                    className={`ui-test-soul-tag${builtInCategory === "all" ? " is-active" : ""}`}
                    onClick={() => setBuiltInCategory("all")}
                  >
                    全部
                  </button>
                  {builtInCategories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={builtInCategory === category}
                      className={`ui-test-soul-tag${builtInCategory === category ? " is-active" : ""}`}
                      onClick={() => setBuiltInCategory(category)}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {visibleAuras.length === 0 ? (
              <div className="ui-test-soul-empty">{emptyText}</div>
            ) : (
              <div className="ui-test-soul-grid">
                {visibleAuras.map((aura) => {
                  const bound = bindingCount.get(aura.id) ?? 0
                  return (
                    <article
                      key={aura.id}
                      role="button"
                      tabIndex={0}
                      data-testid={`soul-aura-card-${aura.id}`}
                      onClick={() => openAura(aura)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          openAura(aura)
                        }
                      }}
                      className="ui-test-soul-card"
                    >
                      <h4 className="ui-test-soul-card-name">
                        <span className="ui-test-soul-card-title">{aura.name}</span>
                        <span className="ui-test-soul-badge">{aura.builtIn ? "内置" : "自定义"}</span>
                      </h4>
                      <div className="ui-test-soul-card-misc">
                        {aura.category || (aura.builtIn ? "内置灵魂" : "自定义灵魂")}
                      </div>
                      <p className="ui-test-soul-card-desc">{aura.styleDescription || "未填写气质说明"}</p>
                      <div className="ui-test-soul-card-foot">
                        <span className={`ui-test-soul-foot-tag${bound > 0 ? " is-bound" : ""}`}>
                          {bound > 0 ? `绑定 ${bound} 人` : "未绑定"}
                        </span>
                        <span className="ui-test-soul-card-open">查看 →</span>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="ui-test-soul-editor">
            <button type="button" className="ui-test-soul-back" onClick={() => setView("gallery")}>
              <ArrowLeft /> 返回灵魂库
            </button>
            <CharacterAuraView hideSidebar />
          </div>
        )}
      </div>
    </section>
  )
}
