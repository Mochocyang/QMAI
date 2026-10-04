import "@/components/uitest/ui-test-tools.css"
import { useEffect, useMemo, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { ArrowLeft, Plus, Search, Star, Upload } from "lucide-react"
import { readFile } from "@/commands/fs"
import { confirmDiscardSkillLibraryDraft, useWikiStore } from "@/stores/wiki-store"
import { useFavoriteSkillStore } from "@/stores/favorite-skill-store"
import {
  createBlankProjectDeAiSkill,
  getAllDeAiSkills,
  loadDeAiSkillConfig,
  normalizeDeAiSkillConfig,
  saveDeAiSkillConfig,
  setDeAiSkillEnabled,
  type DeAiSkill,
  type DeAiSkillConfig,
} from "@/lib/novel/de-ai-skill-library"
import {
  createBlankWritingSkill,
  createSkillCategory,
  deleteSkillCategory,
  importSkillFromJson,
  importWritingSkill,
  loadUserSkillConfig,
  normalizeUserSkillConfig,
  renameSkillCategory,
  saveUserSkillConfig,
  setWritingSkillEnabled,
  type UserSkillConfig,
} from "@/lib/novel/user-skill-store"
import { SKILL_KIND_LABELS, skillDisplayName, type SkillKind, type UserSkill } from "@/lib/novel/skill-library"
import { SkillLibraryView } from "./skill-library-view"
import { WritingSkillLibraryView } from "./writing-skill-library-view"
import { FavoriteListView } from "./favorite-list-view"

const skillLibraryTabs = [
  { view: "skillLibrary" as const, label: "去AI味技能" },
  { view: "writingSkillLibrary" as const, label: "写作 Skill" },
  { view: "skillFavorites" as const, label: "收藏" },
]

type SkillLibraryTab = (typeof skillLibraryTabs)[number]["view"]
type GalleryTab = "skillLibrary" | "writingSkillLibrary"

type UnifiedSkillCategory = "all" | "recent" | "uncategorized" | SkillKind | "de-ai" | "writing"

interface UnifiedSkillEntry {
  id: string
  sourceId: string
  type: "writing" | "de-ai"
  name: string
  description: string
  content: string
  kinds: SkillKind[]
  /** toggleFavorite 需要原始技能对象（v3 新增） */
  rawSkill: UserSkill | DeAiSkill
}

function deAiSkillToEntry(skill: DeAiSkill): UnifiedSkillEntry {
  return {
    id: `de-ai:${skill.id}`,
    sourceId: skill.id,
    type: "de-ai",
    name: skill.name,
    description: skill.description,
    content: skill.content,
    kinds: ["rewrite", "style"],
    rawSkill: skill,
  }
}

function writingSkillToEntry(skill: UserSkill): UnifiedSkillEntry {
  return {
    id: `writing:${skill.id}`,
    sourceId: skill.id,
    type: "writing",
    name: skillDisplayName(skill),
    description: skill.description,
    content: skill.content,
    kinds: skill.kind,
    rawSkill: skill,
  }
}

function entrySourceLabel(entry: UnifiedSkillEntry): string {
  if (entry.type === "de-ai") {
    const source = (entry.rawSkill as DeAiSkill).source
    if (source === "built-in") return "内置"
    if (source === "legacy") return "旧版"
    return "项目"
  }
  const source = (entry.rawSkill as UserSkill).source
  if (source === "built-in") return "内置"
  if (source === "uploaded") return "上传"
  if (source === "linked") return "引用"
  return "项目"
}

function fileBaseName(path: string): string {
  return path.split(/[\\/]/).pop() || "未命名 Skill"
}

function stripSkillFileExtension(name: string): string {
  return name.replace(/\.(json|md|txt)$/i, "")
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!match) return { body: content }
  const yamlBlock = match[1]
  const nameMatch = yamlBlock.match(/^name:\s*(.+?)\s*$/m)
  const descMatch = yamlBlock.match(/^description:\s*(.+?)\s*$/m)
  return {
    name: nameMatch ? nameMatch[1].trim() : undefined,
    description: descMatch ? descMatch[1].trim() : undefined,
    body: content.slice(match[0].length),
  }
}

function importedDeAiSkillFromContent(path: string, content: string): DeAiSkill | null {
  const now = Date.now()
  const nameFromPath = stripSkillFileExtension(fileBaseName(path))
  if (/\.json$/i.test(path)) {
    try {
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed !== "object") return null
      const raw = parsed as Record<string, unknown>
      if (typeof raw.name !== "string" || !raw.name.trim()) return null
      if (typeof raw.content !== "string" || !raw.content.trim()) return null
      return {
        id: `project:${now}`,
        name: raw.name.trim(),
        description: typeof raw.description === "string" ? raw.description.trim() : "",
        templateId: typeof raw.templateId === "string" ? raw.templateId : "custom",
        content: raw.content.trim(),
        source: "project",
        createdAt: now,
        updatedAt: now,
      }
    } catch {
      return null
    }
  }

  const parsed = parseSkillFrontmatter(content)
  const body = parsed.body.trim()
  if (!body) return null
  return {
    id: `project:${now}`,
    name: parsed.name || nameFromPath || "未命名去AI味 Skill",
    description: parsed.description || "",
    templateId: "custom",
    content: body,
    source: "project",
    createdAt: now,
    updatedAt: now,
  }
}

function SkillLibraryActions({ activeTab, onAfterCreate }: { activeTab: GalleryTab; onAfterCreate: () => void }) {
  const project = useWikiStore((s) => s.project)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedSkillLibrarySkillId)
  const setSelectedWritingSkillId = useWikiStore((s) => s.setSelectedWritingSkillLibrarySkillId)
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)

  async function persistWritingConfig(nextConfig: UserSkillConfig, nextSkillId: string | null) {
    if (!project || saving) return false
    setSaving(true)
    try {
      await saveUserSkillConfig(project.path, nextConfig)
      if (nextSkillId) setSelectedWritingSkillId(nextSkillId)
      setActiveView("writingSkillLibrary")
      bumpDataVersion()
      setMessage("写作 Skill 已保存")
      return true
    } catch {
      setMessage("写作 Skill 保存失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function persistDeAiConfig(nextConfig: DeAiSkillConfig, nextSkillId: string) {
    if (!project || saving) return false
    setSaving(true)
    try {
      await saveDeAiSkillConfig(project.path, nextConfig)
      setSelectedSkillId(nextSkillId)
      setActiveView("skillLibrary")
      bumpDataVersion()
      setMessage("去AI味技能已保存")
      return true
    } catch {
      setMessage("去AI味技能保存失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateDeAiSkill() {
    if (!project || saving) return
    const config = await loadDeAiSkillConfig(project.path)
    const now = Date.now()
    const next = createBlankProjectDeAiSkill(config, now)
    if (await persistDeAiConfig(next, `project:${now}`)) onAfterCreate()
  }

  async function handleImportDeAiSkillFile() {
    if (!project || saving) return
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "去AI味 Skill 文件", extensions: ["json", "md", "txt"] }],
      })
      if (!selected || typeof selected !== "string") return
      const content = await readFile(selected)
      const imported = importedDeAiSkillFromContent(selected, content)
      if (!imported) {
        setMessage("导入失败：文件内容不是有效的去AI味 Skill")
        return
      }
      const config = await loadDeAiSkillConfig(project.path)
      const next = normalizeDeAiSkillConfig({
        ...config,
        defaultSkillId: imported.id,
        projectSkills: [imported, ...config.projectSkills],
      })
      if (await persistDeAiConfig(next, imported.id)) onAfterCreate()
    } catch {
      setMessage("导入去AI味 Skill 失败")
    }
  }

  async function handleCreateWritingSkill() {
    if (!project || saving) return
    const config = await loadUserSkillConfig(project.path)
    const next = createBlankWritingSkill(config)
    if (await persistWritingConfig(next, next.selectedSkillId)) onAfterCreate()
  }

  async function handleImportWritingSkill() {
    if (!project || saving) return
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Skill 文件", extensions: ["json", "md", "txt"] }],
      })
      if (!selected || typeof selected !== "string") return
      const content = await readFile(selected)
      const fileName = fileBaseName(selected)
      const config = await loadUserSkillConfig(project.path)
      const next = /\.json$/i.test(fileName)
        ? (() => {
            const imported = importSkillFromJson(content)
            if (!imported) return null
            return normalizeUserSkillConfig({
              ...config,
              selectedSkillId: imported.id,
              skills: [imported, ...config.skills],
            })
          })()
        : importWritingSkill(config, {
            name: fileName.replace(/\.(md|txt)$/i, ""),
            content,
          })

      if (!next) {
        setMessage("JSON 文件格式不正确，导入失败")
        return
      }
      if (await persistWritingConfig(next, next.selectedSkillId)) onAfterCreate()
    } catch {
      setMessage("导入失败")
    }
  }

  const buttonClass = "ui-test-skills-action"
  const disabled = !project || saving

  return (
    <div data-testid="skill-library-header-actions" className="ui-test-skills-actions">
      {activeTab === "skillLibrary" ? (
        <>
          <button type="button" onClick={() => void handleCreateDeAiSkill()} disabled={disabled} className={buttonClass}>
            <Plus /> 新建技能
          </button>
          <button type="button" onClick={() => void handleImportDeAiSkillFile()} disabled={disabled} className={buttonClass}>
            <Upload /> 导入
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => void handleCreateWritingSkill()} disabled={disabled} className={buttonClass}>
            <Plus /> 新建 Skill
          </button>
          <button type="button" onClick={() => void handleImportWritingSkill()} disabled={disabled} className={buttonClass}>
            <Upload /> 导入
          </button>
        </>
      )}
      {message ? <span className="ui-test-skills-message">{message}</span> : null}
    </div>
  )
}

function SkillCard({
  entry,
  enabled,
  favorited,
  categoryName,
  toggleLabel,
  busy,
  onOpen,
  onToggleEnabled,
  onToggleFavorite,
}: {
  entry: UnifiedSkillEntry
  enabled: boolean
  favorited: boolean
  categoryName?: string
  toggleLabel: string
  busy: boolean
  onOpen: () => void
  onToggleEnabled: (enabled: boolean) => void
  onToggleFavorite: () => void
}) {
  const kindLabels = entry.kinds.slice(0, 3).map((kind) => SKILL_KIND_LABELS[kind]).filter(Boolean)
  return (
    <article
      data-testid={`unified-skill-entry-${entry.id}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
      className="ui-test-skill-card"
    >
      <header className="ui-test-skill-card-head">
        <h3 className="ui-test-skill-card-name" title={entry.name}>{entry.name}</h3>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggleFavorite()
          }}
          aria-label={favorited ? "取消收藏" : "收藏"}
          title={favorited ? "取消收藏" : "收藏"}
          className={`ui-test-skill-card-star${favorited ? " is-on" : ""}`}
        >
          <Star fill={favorited ? "currentColor" : "none"} />
        </button>
      </header>
      <div className="ui-test-skill-card-badges">
        <span className="ui-test-skill-badge is-type">{entry.type === "writing" ? "写作" : "去AI味"}</span>
        <span className="ui-test-skill-badge">{entrySourceLabel(entry)}</span>
        {categoryName ? <span className="ui-test-skill-badge">{categoryName}</span> : null}
      </div>
      <p className="ui-test-skill-card-desc">{entry.description || "未填写说明"}</p>
      {kindLabels.length > 0 ? (
        <div className="ui-test-skill-card-kinds">
          {kindLabels.map((label) => (
            <span key={label} className="ui-test-skill-kind">{label}</span>
          ))}
        </div>
      ) : null}
      <footer className="ui-test-skill-card-foot">
        <label className="ui-test-skill-toggle" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) => onToggleEnabled(event.target.checked)}
          />
          {toggleLabel}
        </label>
        <span className="ui-test-skill-card-open">编辑</span>
      </footer>
    </article>
  )
}

function SkillGallery({ activeTab, onOpen }: { activeTab: GalleryTab; onOpen: (entry: UnifiedSkillEntry) => void }) {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const toggleFavorite = useFavoriteSkillStore((s) => s.toggleFavorite)
  // 必须订阅 favorites 本身：只订阅 isFavorited 函数时，收藏状态变化不会触发重渲染。
  const favorites = useFavoriteSkillStore((s) => s.favorites)
  const favoritedKeys = useMemo(
    () => new Set(favorites.map((favorite) => `${favorite.library}:${favorite.skillId}`)),
    [favorites],
  )
  const [writingConfig, setWritingConfig] = useState<UserSkillConfig | null>(null)
  const [deAiConfig, setDeAiConfig] = useState<DeAiSkillConfig | null>(null)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<UnifiedSkillCategory>("all")
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadError("")
    Promise.all([loadUserSkillConfig(project?.path), loadDeAiSkillConfig(project?.path)])
      .then(([writing, deAi]) => {
        if (cancelled) return
        setWritingConfig(writing)
        setDeAiConfig(deAi)
      })
      .catch(() => {
        if (cancelled) return
        setWritingConfig(null)
        setDeAiConfig(null)
        setLoadError("技能库加载失败")
      })
    return () => {
      cancelled = true
    }
  }, [dataVersion, project?.path])

  useEffect(() => {
    setCategory("all")
  }, [activeTab])

  const writingEntries = useMemo(
    () => (writingConfig?.skills ?? []).map(writingSkillToEntry),
    [writingConfig],
  )
  const deAiEntries = useMemo(
    () => (deAiConfig ? getAllDeAiSkills(deAiConfig).map(deAiSkillToEntry) : []),
    [deAiConfig],
  )

  const categoryChips = useMemo(() => {
    if (activeTab !== "writingSkillLibrary") return []
    const chips: { id: UnifiedSkillCategory; label: string }[] = [
      { id: "all", label: "全部" },
      { id: "recent", label: "最近使用" },
      { id: "uncategorized", label: "未分类" },
    ]
    for (const cat of writingConfig?.categories ?? []) {
      chips.push({ id: cat.id as UnifiedSkillCategory, label: cat.name })
    }
    return chips
  }, [activeTab, writingConfig])

  const filteredEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    let list = activeTab === "writingSkillLibrary" ? writingEntries : deAiEntries
    if (activeTab === "writingSkillLibrary" && category !== "all") {
      if (category === "recent") {
        list = [...list].sort((a, b) => (b.rawSkill.updatedAt ?? 0) - (a.rawSkill.updatedAt ?? 0))
      } else if (category === "uncategorized") {
        list = list.filter((entry) => !(entry.rawSkill as UserSkill).categoryId)
      } else {
        list = list.filter((entry) => (entry.rawSkill as UserSkill).categoryId === category)
      }
    }
    if (keyword) {
      list = list.filter((entry) =>
        [entry.name, entry.rawSkill.name, entry.description, entry.content]
          .some((value) => value.toLowerCase().includes(keyword)),
      )
    }
    return list
  }, [activeTab, writingEntries, deAiEntries, category, query])

  function entryEnabled(entry: UnifiedSkillEntry): boolean {
    if (entry.type === "de-ai") {
      return deAiConfig ? !deAiConfig.disabledSkillIds.includes(entry.sourceId) : true
    }
    return writingConfig ? !writingConfig.disabledSkillIds.includes(entry.sourceId) : true
  }

  const activeCategoryChip = categoryChips.find(
    (chip) => chip.id === category && chip.id !== "all" && chip.id !== "recent" && chip.id !== "uncategorized",
  )

  async function persistWritingConfig(next: UserSkillConfig) {
    if (!project || busy) return
    setBusy(true)
    try {
      await saveUserSkillConfig(project.path, next)
      setWritingConfig(next)
      bumpDataVersion()
    } catch {
      setLoadError("保存失败")
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateCategory() {
    if (!project || !writingConfig || busy) return
    const name = window.prompt("新建分类名称")?.trim()
    if (!name) return
    await persistWritingConfig(createSkillCategory(writingConfig, name))
  }

  async function handleRenameCategory(categoryId: string, currentName: string) {
    if (!project || !writingConfig || busy) return
    const name = window.prompt("重命名分类", currentName)?.trim()
    if (!name || name === currentName) return
    await persistWritingConfig(renameSkillCategory(writingConfig, categoryId, name))
  }

  async function handleDeleteCategory(categoryId: string, name: string) {
    if (!project || !writingConfig || busy) return
    if (!window.confirm(`确定删除分类「${name}」吗？分类下的 Skill 将变为未分类。`)) return
    setCategory("all")
    await persistWritingConfig(deleteSkillCategory(writingConfig, categoryId))
  }

  async function handleToggleEnabled(entry: UnifiedSkillEntry, enabled: boolean) {
    if (!project || busy) return
    setBusy(true)
    try {
      if (entry.type === "writing") {
        if (!writingConfig) return
        const next = setWritingSkillEnabled(writingConfig, entry.sourceId, enabled)
        await saveUserSkillConfig(project.path, next)
        setWritingConfig(next)
      } else {
        if (!deAiConfig) return
        const next = setDeAiSkillEnabled(deAiConfig, entry.sourceId, enabled)
        await saveDeAiSkillConfig(project.path, next)
        setDeAiConfig(next)
      }
      bumpDataVersion()
    } catch {
      setLoadError("保存失败")
    } finally {
      setBusy(false)
    }
  }

  const emptyCopy = activeTab === "writingSkillLibrary"
    ? "还没有写作 Skill，点击右上角「新建 Skill」开始。"
    : "还没有去AI味技能，点击右上角「新建技能」开始。"

  return (
    <div className="ui-test-skills-gallery">
      <div className="ui-test-skills-toolbar">
        <label className="ui-test-skills-search">
          <Search />
          <input
            data-testid="unified-skill-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索技能名称、说明或规则"
          />
        </label>
        {categoryChips.length > 0 ? (
          <div className="ui-test-skills-chips">
            {categoryChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                aria-pressed={category === chip.id}
                onClick={() => setCategory(chip.id)}
                className={`ui-test-skills-chip${category === chip.id ? " is-active" : ""}`}
              >
                {chip.label}
              </button>
            ))}
            <button
              type="button"
              className="ui-test-skills-chip is-add"
              onClick={() => void handleCreateCategory()}
              disabled={!writingConfig || busy}
            >
              + 新建分类
            </button>
            {activeCategoryChip ? (
              <>
                <button
                  type="button"
                  className="ui-test-skills-chip is-ghost"
                  onClick={() => void handleRenameCategory(activeCategoryChip.id, activeCategoryChip.label)}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="ui-test-skills-chip is-ghost is-danger"
                  onClick={() => void handleDeleteCategory(activeCategoryChip.id, activeCategoryChip.label)}
                >
                  删除
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {loadError ? <div className="ui-test-skills-error">{loadError}</div> : null}

      {filteredEntries.length === 0 && !loadError ? (
        <div className="ui-test-skills-empty">{query.trim() ? "没有匹配的技能。" : emptyCopy}</div>
      ) : (
        <div className="ui-test-skills-grid">
          {filteredEntries.map((entry) => {
            const library = entry.type === "writing" ? "writing" : "de-ai"
            const categoryName = entry.type === "writing"
              ? writingConfig?.categories.find((cat) => cat.id === (entry.rawSkill as UserSkill).categoryId)?.name
              : undefined
            return (
              <SkillCard
                key={entry.id}
                entry={entry}
                enabled={entryEnabled(entry)}
                favorited={favoritedKeys.has(`${library}:${entry.sourceId}`)}
                categoryName={categoryName}
                toggleLabel={entry.type === "writing" ? "参与 AI 会话" : "显示在调用入口"}
                busy={busy}
                onOpen={() => onOpen(entry)}
                onToggleEnabled={(enabled) => void handleToggleEnabled(entry, enabled)}
                onToggleFavorite={() =>
                  void toggleFavorite({ library, skill: entry.rawSkill, originProjectPath: project?.path })
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export function UnifiedSkillLibraryView() {
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedSkillLibrarySkillId)
  const setSelectedWritingSkillId = useWikiStore((s) => s.setSelectedWritingSkillLibrarySkillId)
  const skillDraftDirty = useWikiStore((s) => s.skillLibraryDraftDirty)
  const writingDraftDirty = useWikiStore((s) => s.writingSkillLibraryDraftDirty)
  const setSkillDraftDirty = useWikiStore((s) => s.setSkillLibraryDraftDirty)
  const setWritingDraftDirty = useWikiStore((s) => s.setWritingSkillLibraryDraftDirty)

  const [editing, setEditing] = useState(false)

  const activeTab: SkillLibraryTab = activeView === "writingSkillLibrary"
    ? "writingSkillLibrary"
    : activeView === "skillFavorites"
    ? "skillFavorites"
    : "skillLibrary"

  useEffect(() => {
    setEditing(false)
  }, [activeView])

  function handleBackToList() {
    const dirty = activeTab === "writingSkillLibrary" ? writingDraftDirty : skillDraftDirty
    if (dirty) {
      if (!confirmDiscardSkillLibraryDraft()) return
      if (activeTab === "writingSkillLibrary") setWritingDraftDirty(false)
      else setSkillDraftDirty(false)
    }
    setEditing(false)
  }

  function handleOpenEntry(entry: UnifiedSkillEntry) {
    if (entry.type === "writing") setSelectedWritingSkillId(entry.sourceId)
    else setSelectedSkillId(entry.sourceId)
    setEditing(true)
  }

  const isFavorites = activeTab === "skillFavorites"

  return (
    <div
      data-ui-page="skills"
      data-ui-state={activeView}
      data-testid="unified-skill-library-view"
      className="ui-test-skills-page"
    >
      <header data-ui="skills-tabs">
        <div className="ui-test-skills-heading-row">
          <div className="ui-test-skills-heading-copy">
            <h1>技能库</h1>
            <p>管理写作 Skill 与去AI味技能，点开卡片即可编辑。</p>
          </div>
          {!editing && !isFavorites ? (
            <SkillLibraryActions activeTab={activeTab} onAfterCreate={() => setEditing(true)} />
          ) : null}
        </div>
        <nav className="ui-test-skills-tab-row" aria-label="技能分类">
          {skillLibraryTabs.map((tab) => (
            <button
              key={tab.view}
              type="button"
              aria-pressed={activeTab === tab.view}
              onClick={() => {
                if (tab.view === activeView) {
                  handleBackToList()
                  return
                }
                setActiveView(tab.view)
              }}
              className={`ui-test-skills-tab${activeTab === tab.view ? " is-active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <div data-ui="skills-content">
        {isFavorites ? (
          <FavoriteListView />
        ) : editing ? (
          <div className="ui-test-skills-editor">
            <button type="button" className="ui-test-skills-back" onClick={handleBackToList}>
              <ArrowLeft /> 返回技能库
            </button>
            {activeTab === "writingSkillLibrary" ? <WritingSkillLibraryView /> : <SkillLibraryView />}
          </div>
        ) : (
          <SkillGallery activeTab={activeTab as GalleryTab} onOpen={handleOpenEntry} />
        )}
      </div>
    </div>
  )
}

