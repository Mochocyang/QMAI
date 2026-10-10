import "@/components/uitest/ui-test-tools.css"
import { useEffect, useMemo, useState, type ComponentType } from "react"
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
import { loadWritingStyleStore, type WritingStylePreset } from "@/lib/novel/writing-style-store"
import { SkillLibraryView } from "./skill-library-view"
import { WritingSkillLibraryView } from "./writing-skill-library-view"
import { FavoriteListView } from "./favorite-list-view"

/**
 * 技能库 tab 的**唯一事实来源**：视图名 + 文案。
 *
 * 下面每一张分派表都是 `Record<SkillLibraryTab, …>`，所以往这里加一个 tab
 * 而忘了补某张表 = **编译错误**，不会静默走错分支。
 */
const skillLibraryTabs = [
  { view: "skillLibrary" as const, label: "去AI味技能" },
  { view: "writingSkillLibrary" as const, label: "写作 Skill" },
  { view: "writingStyleLibrary" as const, label: "文风" },
  { view: "skillFavorites" as const, label: "收藏" },
]

type SkillLibraryTab = (typeof skillLibraryTabs)[number]["view"]
/** 卡片画廊承载的 tab；「收藏」走独立的 FavoriteListView。 */
type GalleryTab = Exclude<SkillLibraryTab, "skillFavorites">
type ActiveView = ReturnType<typeof useWikiStore.getState>["activeView"]

/**
 * activeView → 列表 tab 的**显式映射**。
 *
 * ⚠️ 不要改回 `activeView === "writingSkillLibrary" ? … : activeView === "skillFavorites" ? … : "skillLibrary"`
 * 那种二元三元链——那是本文件原先的形状，而给联合类型加第三个成员时
 * **每一处三元都仍然合法编译**（`"writingStyleLibrary" === "writingSkillLibrary"` 只是恒 false），
 * 于是全部静默落到 else 兜底分支，`npm run typecheck` 抓不到任何一处。
 * 换成 `Record` 之后，「加了 tab 没加映射」是编译错误。
 */
const ACTIVE_TAB_BY_VIEW: Record<SkillLibraryTab, SkillLibraryTab> = {
  skillLibrary: "skillLibrary",
  writingSkillLibrary: "writingSkillLibrary",
  writingStyleLibrary: "writingStyleLibrary",
  skillFavorites: "skillFavorites",
}

/**
 * 草稿标记归属。显式映射，避免 `activeTab === "writingSkillLibrary" ? writing : skill`
 * 把「文风」静默归到写作 Skill 的脏标记上。
 */
const TAB_DRAFT_KIND: Record<SkillLibraryTab, "skill" | "writing" | "none"> = {
  skillLibrary: "skill",
  writingSkillLibrary: "writing",
  // 文风库本批只读（没有编辑器也就没有草稿）；收藏列表同样没有草稿标记。
  writingStyleLibrary: "none",
  skillFavorites: "none",
}

/**
 * 头部动作区形态。显式映射：加 tab 忘了补 = 编译错误，
 * 而不是静默显示成「新建技能 / 导入」。
 */
const TAB_ACTIONS: Record<GalleryTab, "de-ai" | "writing" | "none"> = {
  skillLibrary: "de-ai",
  writingSkillLibrary: "writing",
  // 文风预设由拆书库 / 书库流程写入 `.qmai/writing-style.json`。
  // 设计 §3 待确认项 3 明确本批**不新增**文风的编辑能力，所以这里没有新建/导入。
  writingStyleLibrary: "none",
}

/** 只有带分类的库显示分类 chips（目前只有写作 Skill）。 */
const TABS_WITH_CATEGORY_CHIPS: ReadonlySet<GalleryTab> = new Set<GalleryTab>(["writingSkillLibrary"])

/** 各 tab 的空态文案。显式映射，避免二元三元把新 tab 说成「还没有去AI味技能」。 */
const EMPTY_COPY: Record<GalleryTab, string> = {
  skillLibrary: "还没有去AI味技能，点击右上角「新建技能」开始。",
  writingSkillLibrary: "还没有写作 Skill，点击右上角「新建 Skill」开始。",
  writingStyleLibrary: "文风库还是空的：对一部作品做完文风提炼后，它的文风预设会出现在这里。",
}

/** 编辑器分派。显式映射：新 tab 不会静默渲染成**另一个库**的编辑器。 */
const SKILL_EDITORS: Record<GalleryTab, ComponentType> = {
  skillLibrary: SkillLibraryView,
  writingSkillLibrary: WritingSkillLibraryView,
  // 文风条目本批只读，没有编辑器（设计 §3 待确认项 3）。
  writingStyleLibrary: () => null,
}

function resolveActiveTab(activeView: ActiveView): SkillLibraryTab {
  // ACTIVE_TAB_BY_VIEW 的键恰好是 4 个技能库视图；其余视图不会渲染本组件，
  // 兜底到「去AI味技能」与改动前一致。
  return (ACTIVE_TAB_BY_VIEW as Partial<Record<ActiveView, SkillLibraryTab>>)[activeView] ?? "skillLibrary"
}

function tabDraftDirty(draftKind: "skill" | "writing" | "none", skillDirty: boolean, writingDirty: boolean): boolean {
  if (draftKind === "writing") return writingDirty
  if (draftKind === "skill") return skillDirty
  return false
}

type UnifiedSkillCategory = "all" | "recent" | "uncategorized" | SkillKind

interface UnifiedSkillEntryBase {
  id: string
  /** 底层来源对象的 id（用于启用态、收藏、选择态）。 */
  sourceId: string
  name: string
  description: string
  content: string
  kinds: SkillKind[]
}

interface WritingSkillEntry extends UnifiedSkillEntryBase {
  type: "writing"
  rawSkill: UserSkill
}

interface DeAiSkillEntry extends UnifiedSkillEntryBase {
  type: "de-ai"
  rawSkill: DeAiSkill
}

/**
 * 文风条目是**引用**：只持有项目里那份预设本身。
 * `WritingStylePreset` 没有 tags / kind / categoryId / priority / description / content，
 * 所以这里**不假装**它是 `UserSkill`——这正是「引用而非复制」的类型层表达。
 */
interface WritingStyleEntry extends UnifiedSkillEntryBase {
  type: "style"
  rawStylePreset: WritingStylePreset
}

type UnifiedSkillEntry = WritingSkillEntry | DeAiSkillEntry | WritingStyleEntry

/** 类型谓词：分类 / 收藏等只对写作 Skill 生效的逻辑先按它收窄。 */
function isWritingSkillEntry(entry: UnifiedSkillEntry): entry is WritingSkillEntry {
  return entry.type === "writing"
}

/** 卡片类型徽章。显式映射，避免二元三元把新类型静默标成「去AI味」。 */
const ENTRY_TYPE_LABELS: Record<UnifiedSkillEntry["type"], string> = {
  writing: "写作",
  "de-ai": "去AI味",
  style: "文风",
}

/**
 * 条目能力表。显式映射：新类型不会静默继承别的类型的能力。
 * 文风条目全部为 false——选中它**不写任何文件**，尤其不写
 * `.qmai/writing-style.json` 的 `enabledStyleId`（用户决定 2：项目设置不得被改）。
 */
const ENTRY_CAPABILITIES: Record<UnifiedSkillEntry["type"], {
  favoritable: boolean
  toggleable: boolean
  openable: boolean
}> = {
  writing: { favoritable: true, toggleable: true, openable: true },
  "de-ai": { favoritable: true, toggleable: true, openable: true },
  style: { favoritable: false, toggleable: false, openable: false },
}

/** 启用勾选框文案。显式映射，避免二元三元把新类型写成「显示在调用入口」。 */
const ENTRY_TOGGLE_LABELS: Record<UnifiedSkillEntry["type"], string> = {
  writing: "参与 AI 会话",
  "de-ai": "显示在调用入口",
  style: "只读引用",
}

/**
 * `writing-style-store.ts:32` 的 `interface WritingStyleStore` **没有 export**，
 * 引用不到类型名；而本批对那个文件是只读的（落盘格式与 `buildWritingStyleContext` 都冻结），
 * 不为一个类型名去动它，改用 `Awaited<ReturnType<…>>` 推导。
 */
type WritingStyleStore = Awaited<ReturnType<typeof loadWritingStyleStore>>

const EMPTY_WRITING_STYLE_STORE: WritingStyleStore = { version: 1, enabledStyleId: null, styles: [] }

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

/**
 * 把项目里的文风预设投影成技能库条目（引用式：只带 `rawStylePreset`）。
 * 预设**没有** description / content / kind / tags 字段：
 *  `description` 由来源作品如实拼出，`content` 只是把画像里可检索的文本拼起来供搜索用，
 *  `kinds` 留空（不把「风格」这个 SkillKind 硬塞给它）。
 */
function writingStylePresetToEntry(preset: WritingStylePreset): UnifiedSkillEntry {
  const profile = preset.profile
  const samples = Array.isArray(profile?.samples) ? profile.samples : []
  const content = [profile?.integratedDna, profile?.constitution, ...samples]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n")
  return {
    id: `style:${preset.id}`,
    sourceId: preset.id,
    type: "style",
    name: preset.name?.trim() || "未命名文风",
    description: `来源作品《${preset.sourceBook?.trim() || "未知"}》的文风预设。`,
    content,
    kinds: [],
    rawStylePreset: preset,
  }
}

function entrySourceLabel(entry: UnifiedSkillEntry): string {
  if (entry.type === "style") return "引用"
  if (entry.type === "de-ai") {
    const source = entry.rawSkill.source
    if (source === "built-in") return "内置"
    if (source === "legacy") return "旧版"
    return "项目"
  }
  const source = entry.rawSkill.source
  if (source === "built-in") return "内置"
  if (source === "uploaded") return "上传"
  if (source === "linked") return "引用"
  return "项目"
}

/** 搜索用文本。文风条目没有 `rawSkill`，只能从预设自身的字段取。 */
function entrySearchValues(entry: UnifiedSkillEntry): string[] {
  const values = [entry.name, entry.description, entry.content]
  if (entry.type !== "style") values.push(entry.rawSkill.name)
  return values
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

  async function persistDeAiConfig(nextConfig: DeAiSkillConfig, nextSkillId: string | null) {
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
  const actions = TAB_ACTIONS[activeTab]

  return (
    <div data-testid="skill-library-header-actions" className="ui-test-skills-actions">
      {actions === "de-ai" ? (
        <>
          <button type="button" onClick={() => void handleCreateDeAiSkill()} disabled={disabled} className={buttonClass}>
            <Plus /> 新建技能
          </button>
          <button type="button" onClick={() => void handleImportDeAiSkillFile()} disabled={disabled} className={buttonClass}>
            <Upload /> 导入
          </button>
        </>
      ) : null}
      {actions === "writing" ? (
        <>
          <button type="button" onClick={() => void handleCreateWritingSkill()} disabled={disabled} className={buttonClass}>
            <Plus /> 新建 Skill
          </button>
          <button type="button" onClick={() => void handleImportWritingSkill()} disabled={disabled} className={buttonClass}>
            <Upload /> 导入
          </button>
        </>
      ) : null}
      {message ? <span className="ui-test-skills-message">{message}</span> : null}
    </div>
  )
}

function SkillCard({
  entry,
  enabled,
  favorited,
  selected,
  badge,
  busy,
  onOpen,
  onSelect,
  onToggleEnabled,
  onToggleFavorite,
}: {
  entry: UnifiedSkillEntry
  enabled: boolean
  favorited: boolean
  selected: boolean
  badge?: string
  busy: boolean
  onOpen: () => void
  onSelect: () => void
  onToggleEnabled: (enabled: boolean) => void
  onToggleFavorite: () => void
}) {
  const capabilities = ENTRY_CAPABILITIES[entry.type]
  const kindLabels = entry.kinds.slice(0, 3).map((kind) => SKILL_KIND_LABELS[kind]).filter(Boolean)
  const activate = () => {
    if (capabilities.openable) onOpen()
    else onSelect()
  }
  return (
    <article
      data-testid={`unified-skill-entry-${entry.id}`}
      role="button"
      tabIndex={0}
      aria-pressed={capabilities.openable ? undefined : selected}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          activate()
        }
      }}
      className={`ui-test-skill-card${selected ? " is-selected" : ""}`}
    >
      <header className="ui-test-skill-card-head">
        <h3 className="ui-test-skill-card-name" title={entry.name}>{entry.name}</h3>
        {capabilities.favoritable ? (
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
        ) : null}
      </header>
      <div className="ui-test-skill-card-badges">
        <span className="ui-test-skill-badge is-type">{ENTRY_TYPE_LABELS[entry.type]}</span>
        <span className="ui-test-skill-badge">{entrySourceLabel(entry)}</span>
        {entry.type === "style" && enabled ? (
          <span className="ui-test-skill-badge is-current">当前启用</span>
        ) : null}
        {badge ? <span className="ui-test-skill-badge">{badge}</span> : null}
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
        {capabilities.toggleable ? (
          <label className="ui-test-skill-toggle" onClick={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(event) => onToggleEnabled(event.target.checked)}
            />
            {ENTRY_TOGGLE_LABELS[entry.type]}
          </label>
        ) : (
          <span className="ui-test-skill-toggle">{selected ? "已选中" : "点击选中"}</span>
        )}
        {capabilities.openable ? <span className="ui-test-skill-card-open">编辑</span> : null}
      </footer>
    </article>
  )
}

/** 收藏库只认 writing / de-ai 两种快照形状；文风条目不参与收藏。 */
function entryFavoriteKey(entry: UnifiedSkillEntry): string | null {
  if (entry.type === "style") return null
  return `${entry.type === "writing" ? "writing" : "de-ai"}:${entry.sourceId}`
}

function entryExtraBadge(entry: UnifiedSkillEntry, writingConfig: UserSkillConfig | null): string | undefined {
  if (entry.type === "writing") {
    return writingConfig?.categories.find((cat) => cat.id === entry.rawSkill.categoryId)?.name
  }
  // 文风条目把来源作品摆在卡片上：它是一条「来自某本书的引用」。
  if (entry.type === "style") return `《${entry.rawStylePreset.sourceBook?.trim() || "未知"}》`
  return undefined
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
  const [styleStore, setStyleStore] = useState<WritingStyleStore | null>(null)
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null)
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
    /*
     * 文风库走**单独**一条链，绝不并进上面那个 Promise.all：
     * 那个 catch 会把两份配置一起置 null 并显示「技能库加载失败」，
     * 于是「文风库读取失败」会扩散成「三个库全空 + 整页报错」——
     * 一个来源的故障不该由另外两个来源承担。这里失败只退化成「文风 tab 为空」。
     *
     * 顺带：`loadWritingStyleStore(projectPath: string)` 不接受 undefined
     * （两个 Skill loader 接受 null/undefined，但它不接受），所以先判 project?.path。
     */
    const styleLoad = project?.path
      ? loadWritingStyleStore(project.path).catch(() => EMPTY_WRITING_STYLE_STORE)
      : Promise.resolve(EMPTY_WRITING_STYLE_STORE)
    styleLoad.then((store) => {
      if (!cancelled) setStyleStore(store)
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
  const styleEntries = useMemo(
    () => (styleStore?.styles ?? []).map(writingStylePresetToEntry),
    [styleStore],
  )

  /**
   * tab → 条目列表的**显式映射**。
   * 原先 `activeTab === "writingSkillLibrary" ? writingEntries : deAiEntries`：
   * 加第三个成员后文风 tab 会显示**去AI味技能列表**，而 `tsc` 不报错。
   */
  const entriesByTab = useMemo<Record<GalleryTab, UnifiedSkillEntry[]>>(
    () => ({
      skillLibrary: deAiEntries,
      writingSkillLibrary: writingEntries,
      writingStyleLibrary: styleEntries,
    }),
    [writingEntries, deAiEntries, styleEntries],
  )

  const categoryChips = useMemo(() => {
    if (!TABS_WITH_CATEGORY_CHIPS.has(activeTab)) return []
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
    let list = entriesByTab[activeTab]
    if (activeTab === "writingSkillLibrary" && category !== "all") {
      // 分类只属于写作 Skill；先按类型收窄，文风条目没有 categoryId（也不假装有）。
      const scoped = list.filter(isWritingSkillEntry)
      if (category === "recent") {
        list = [...scoped].sort((a, b) => (b.rawSkill.updatedAt ?? 0) - (a.rawSkill.updatedAt ?? 0))
      } else if (category === "uncategorized") {
        list = scoped.filter((entry) => !entry.rawSkill.categoryId)
      } else {
        list = scoped.filter((entry) => entry.rawSkill.categoryId === category)
      }
    }
    if (keyword) {
      list = list.filter((entry) =>
        entrySearchValues(entry).some((value) => value.toLowerCase().includes(keyword)),
      )
    }
    return list
  }, [activeTab, entriesByTab, category, query])

  function entryEnabled(entry: UnifiedSkillEntry): boolean {
    if (entry.type === "style") return styleStore?.enabledStyleId === entry.sourceId
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
      /*
       * 按类型**显式**分派，不用 `if (writing) … else …`：
       * 那个 else 会把**任何新类型**（文风）静默当成去AI味，进而去写 de-ai-skills.json。
       * 文风条目是显式 no-op —— 技能库的选中/切换动作**不得**去写
       * `.qmai/writing-style.json` 的 `enabledStyleId`（用户决定 2：项目设置不得被改）。
       */
      switch (entry.type) {
        case "de-ai": {
          if (!deAiConfig) return
          const next = setDeAiSkillEnabled(deAiConfig, entry.sourceId, enabled)
          await saveDeAiSkillConfig(project.path, next)
          setDeAiConfig(next)
          bumpDataVersion()
          break
        }
        case "writing": {
          if (!writingConfig) return
          const next = setWritingSkillEnabled(writingConfig, entry.sourceId, enabled)
          await saveUserSkillConfig(project.path, next)
          setWritingConfig(next)
          bumpDataVersion()
          break
        }
        case "style":
          break
        default: {
          /*
           * 穷尽性检查：`switch (entry.type)` 已穷尽时 `entry` 本身被收窄成 `never`，
           * 所以取的是 `entry` 而不是 `entry.type`。
           * 将来新增条目类型而这里没补 case，本行就是**编译错误**。
           */
          const unhandled: never = entry
          throw new Error(`未知的技能条目类型：${String(unhandled)}`)
        }
      }
    } catch {
      setLoadError("保存失败")
    } finally {
      setBusy(false)
    }
  }

  const emptyCopy = EMPTY_COPY[activeTab]

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
            const favoriteKey = entryFavoriteKey(entry)
            return (
              <SkillCard
                key={entry.id}
                entry={entry}
                enabled={entryEnabled(entry)}
                favorited={favoriteKey !== null && favoritedKeys.has(favoriteKey)}
                selected={entry.type === "style" && selectedStyleId === entry.sourceId}
                badge={entryExtraBadge(entry, writingConfig)}
                busy={busy}
                onOpen={() => onOpen(entry)}
                onSelect={() => {
                  // 文风条目是引用：选中只改本组件的本地状态，**不落盘、不写项目设置**。
                  if (entry.type === "style") setSelectedStyleId(entry.sourceId)
                }}
                onToggleEnabled={(enabled) => void handleToggleEnabled(entry, enabled)}
                onToggleFavorite={() => {
                  if (entry.type === "style") return
                  void toggleFavorite({
                    library: entry.type === "writing" ? "writing" : "de-ai",
                    skill: entry.rawSkill,
                    originProjectPath: project?.path,
                  })
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * 内容区分派。先用 `if` 把「收藏」收窄掉，
 * 于是下面的 `SKILL_EDITORS[activeTab]` 拿到的是 `GalleryTab`——不需要 `as` 断言，
 * 也就不会把「新 tab 漏了编辑器」这件事藏进一个宽类型里。
 */
function SkillLibraryContent({
  activeTab,
  editing,
  onOpen,
  onBack,
}: {
  activeTab: SkillLibraryTab
  editing: boolean
  onOpen: (entry: UnifiedSkillEntry) => void
  onBack: () => void
}) {
  if (activeTab === "skillFavorites") return <FavoriteListView />
  const Editor = SKILL_EDITORS[activeTab]
  if (!editing) return <SkillGallery activeTab={activeTab} onOpen={onOpen} />
  return (
    <div className="ui-test-skills-editor">
      <button type="button" className="ui-test-skills-back" onClick={onBack}>
        <ArrowLeft /> 返回技能库
      </button>
      <Editor />
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

  const activeTab = resolveActiveTab(activeView)
  const draftKind = TAB_DRAFT_KIND[activeTab]

  useEffect(() => {
    setEditing(false)
  }, [activeView])

  function handleBackToList() {
    const dirty = tabDraftDirty(draftKind, skillDraftDirty, writingDraftDirty)
    if (dirty) {
      if (!confirmDiscardSkillLibraryDraft()) return
      if (draftKind === "writing") setWritingDraftDirty(false)
      else if (draftKind === "skill") setSkillDraftDirty(false)
    }
    setEditing(false)
  }

  function handleOpenEntry(entry: UnifiedSkillEntry) {
    // 文风条目本批只读：没有编辑器可进（否则会渲染成**另一个库**的编辑器）。
    if (entry.type === "style") return
    if (entry.type === "writing") setSelectedWritingSkillId(entry.sourceId)
    else setSelectedSkillId(entry.sourceId)
    setEditing(true)
  }

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
          {!editing && activeTab !== "skillFavorites" ? (
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
        <SkillLibraryContent
          activeTab={activeTab}
          editing={editing}
          onOpen={handleOpenEntry}
          onBack={handleBackToList}
        />
      </div>
    </div>
  )
}
