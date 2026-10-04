import { useEffect, useMemo, useState } from "react"
import { open, save } from "@tauri-apps/plugin-dialog"
import { readFile, writeFile } from "@/commands/fs"
import {
  createBlankWritingSkill,
  createSkillCategory,
  deleteWritingSkill,
  deleteSkillCategory,
  exportSkillToJson,
  importSkillFromJson,
  importWritingSkill,
  loadAllLinkedSkillsContent,
  loadLinkedSkillContent,
  loadUserSkillConfig,
  moveSkillToCategory,
  normalizeUserSkillConfig,
  renameSkillCategory,
  reorderSkillCategories,
  resolveEnabledWritingSkills,
  saveUserSkillConfig,
  setWritingSkillEnabled,
  touchSkillUsage,
  updateWritingSkill,
  WRITING_SKILL_KIND_OPTIONS,
  WRITING_SKILL_MODE_OPTIONS,
  WRITING_SKILL_STAGE_OPTIONS,
  type UserSkillConfig,
} from "@/lib/novel/user-skill-store"
import {
  SKILL_KIND_LABELS,
  SKILL_MODE_LABELS,
  SKILL_STAGE_LABELS,
  skillDisplayName,
  type SkillCategory,
  type SkillKind,
  type SkillMode,
  type SkillStage,
  type UserSkill,
} from "@/lib/novel/skill-library"
import { confirmDiscardSkillLibraryDraft, useWikiStore } from "@/stores/wiki-store"
import { GripVertical, Pencil, Trash2 } from "lucide-react"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

function resolveInitialSkillId(config: UserSkillConfig, requested: string | null): string | null {
  if (requested && config.skills.some((skill) => skill.id === requested)) return requested
  return config.selectedSkillId ?? config.skills[0]?.id ?? null
}

function hasDraftChanged(
  skill: UserSkill,
  name: string,
  description: string,
  content: string,
  kind: SkillKind[],
  stages: SkillStage[],
  modes: SkillMode[],
  priority: number,
  tags: string[],
  categoryId: string,
): boolean {
  return name.trim() !== skillDisplayName(skill)
    || description.trim() !== skill.description
    || content.trim() !== skill.content
    || kind.join("|") !== skill.kind.join("|")
    || stages.join("|") !== skill.stages.join("|")
    || modes.join("|") !== skill.modes.join("|")
    || priority !== skill.priority
    || tags.join("|") !== skill.tags.join("|")
    || categoryId !== skill.categoryId
}

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

function OptionCheckbox({
  label,
  checked,
  testId,
  onToggle,
}: {
  label: string
  checked: boolean
  testId: string
  onToggle: () => void
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground">
      <input
        data-testid={testId}
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-3.5 w-3.5 accent-primary"
      />
      {label}
    </label>
  )
}

function useWritingSkillConfig() {
  const projectPath = useWikiStore((s) => s.project?.path)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const selectedSkillId = useWikiStore((s) => s.selectedWritingSkillLibrarySkillId)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedWritingSkillLibrarySkillId)
  const [config, setConfig] = useState<UserSkillConfig | null>(null)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let cancelled = false
    setConfig(null)
    setLoadError("")
    loadUserSkillConfig(projectPath)
      .then(async (loaded) => {
        if (cancelled) return
        try {
          const withLinkedContent = await loadAllLinkedSkillsContent(loaded)
          if (!cancelled) {
            setConfig(withLinkedContent)
          }
        } catch {
          if (!cancelled) {
            setConfig(loaded)
          }
        }
        setSelectedSkillId(resolveInitialSkillId(loaded, selectedSkillId))
      })
      .catch(() => {
        if (cancelled) return
        setConfig(null)
        setLoadError("写作 Skill 加载失败")
      })
    return () => {
      cancelled = true
    }
  }, [dataVersion, projectPath])

  return { config, setConfig, loadError }
}

interface SortableCategoryItemProps {
  category: SkillCategory
  count: number
  isSelected: boolean
  isEditing: boolean
  isHovered: boolean
  editingCategoryName: string
  onSelect: () => void
  onStartEdit: () => void
  onRename: () => void
  onCancelEdit: () => void
  onEditingNameChange: (name: string) => void
  onDelete: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function SortableCategoryItem({
  category,
  count,
  isSelected,
  isEditing,
  isHovered,
  editingCategoryName,
  onSelect,
  onStartEdit,
  onRename,
  onCancelEdit,
  onEditingNameChange,
  onDelete,
  onMouseEnter,
  onMouseLeave,
}: SortableCategoryItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`group relative ${isDragging ? "z-10 opacity-80 shadow-md" : ""}`}
    >
      {isEditing ? (
        <div className="flex items-center gap-1 rounded-md px-2 py-1">
          <input
            autoFocus
            type="text"
            value={editingCategoryName}
            onChange={(e) => onEditingNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                onRename()
              } else if (e.key === "Escape") {
                onCancelEdit()
              }
            }}
            onBlur={onRename}
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onSelect()
            }
          }}
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent ${
            isSelected ? "bg-accent/60" : ""
          }`}
        >
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
            title="拖拽排序"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="flex-1 truncate">{category.name}</span>
          <span className="text-xs text-muted-foreground">{count}</span>
          {(isHovered || isSelected) && (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={onStartEdit}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                title="重命名"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                title="删除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function WritingSkillLibrarySidebarPanel() {
  const project = useWikiStore((s) => s.project)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const selectedSkillId = useWikiStore((s) => s.selectedWritingSkillLibrarySkillId)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedWritingSkillLibrarySkillId)
  const draftDirty = useWikiStore((s) => s.writingSkillLibraryDraftDirty)
  const setDraftDirty = useWikiStore((s) => s.setWritingSkillLibraryDraftDirty)
  const { config, setConfig, loadError } = useWritingSkillConfig()
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all")
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState("")
  const [hoveredCategoryId, setHoveredCategoryId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  )

  const categoryIds = useMemo(
    () => config?.categories.map((cat) => cat.id) ?? [],
    [config?.categories],
  )

  const disabledSkillIds = new Set(config?.disabledSkillIds ?? [])

  const recentSkills = useMemo(() => {
    if (!config) return []
    return config.skills
      .filter((s) => s.source !== "built-in")
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 5)
  }, [config])

  const filteredSkills = useMemo(() => {
    if (!config) return []
    if (selectedCategoryId === "all") return config.skills
    if (selectedCategoryId === "uncategorized") return config.skills.filter((s) => !s.categoryId)
    if (selectedCategoryId === "recent") return recentSkills
    return config.skills.filter((s) => s.categoryId === selectedCategoryId)
  }, [config, selectedCategoryId, recentSkills])

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || !config || !project || saving) return
    const oldIndex = config.categories.findIndex((cat) => cat.id === active.id)
    const newIndex = config.categories.findIndex((cat) => cat.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const next = reorderSkillCategories(config, oldIndex, newIndex)
    await persist(next, selectedSkillId)
  }

  async function persist(nextConfig: UserSkillConfig, nextSelectedSkillId: string | null) {
    if (!project) {
      setMessage("请先打开项目")
      return
    }
    setSaving(true)
    try {
      await saveUserSkillConfig(project.path, nextConfig)
      setConfig(nextConfig)
      setSelectedSkillId(nextSelectedSkillId)
      setMessage("已保存")
      bumpDataVersion()
    } catch {
      setMessage("写作 Skill 保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleSelectSkill(skillId: string) {
    if (!config || !project || saving) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    const next = touchSkillUsage(config, skillId)
    await persist(next, skillId)
  }

  async function handleCreateSkill() {
    if (!config || !project || saving) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    const next = createBlankWritingSkill(config)
    if (selectedCategoryId !== "all" && selectedCategoryId !== "uncategorized") {
      const withCategory = moveSkillToCategory(next, next.selectedSkillId!, selectedCategoryId)
      await persist(withCategory, withCategory.selectedSkillId)
    } else {
      await persist(next, next.selectedSkillId)
    }
  }

  async function handleImportSkill() {
    if (!config || !project || saving) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Skill 文件",
            extensions: ["json", "md", "txt"],
          },
        ],
      })
      if (!selected || typeof selected !== "string") return
      const content = await readFile(selected)
      const fileName = selected.split(/[\\/]/).pop() || "未命名 Skill"
      const isJson = /\.json$/i.test(fileName)
      let next: UserSkillConfig
      if (isJson) {
        const imported = importSkillFromJson(content)
        if (!imported) {
          setMessage("JSON 文件格式不正确，导入失败")
          return
        }
        next = normalizeUserSkillConfig({
          ...config,
          selectedSkillId: imported.id,
          skills: [imported, ...config.skills],
        })
      } else {
        const nameWithoutExt = fileName.replace(/\.(md|txt)$/i, "")
        next = importWritingSkill(config, { name: nameWithoutExt, content })
      }
      if (selectedCategoryId !== "all" && selectedCategoryId !== "uncategorized") {
        next = moveSkillToCategory(next, next.selectedSkillId!, selectedCategoryId)
      }
      await persist(next, next.selectedSkillId)
    } catch {
      setMessage("导入失败")
    }
  }

  async function handleToggleSkill(skill: UserSkill, enabled: boolean) {
    if (!config || !project || saving) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    const next = setWritingSkillEnabled(config, skill.id, enabled)
    await persist(next, selectedSkillId ?? next.selectedSkillId)
  }

  async function handleCreateCategory() {
    if (!config || !project || saving) return
    const trimmed = newCategoryName.trim()
    if (!trimmed) {
      setShowNewCategoryInput(false)
      return
    }
    const next = createSkillCategory(config, trimmed)
    setShowNewCategoryInput(false)
    setNewCategoryName("")
    await persist(next, selectedSkillId)
  }

  async function handleRenameCategory(categoryId: string) {
    if (!config || !project || saving) return
    const trimmed = editingCategoryName.trim()
    if (!trimmed) {
      setEditingCategoryId(null)
      return
    }
    const next = renameSkillCategory(config, categoryId, trimmed)
    setEditingCategoryId(null)
    setEditingCategoryName("")
    await persist(next, selectedSkillId)
  }

  async function handleDeleteCategory(categoryId: string, categoryName: string) {
    if (!config || !project || saving) return
    const confirmed = window.confirm(`确定删除分类「${categoryName}」吗？删除分类后，分类下的Skill将变为未分类。`)
    if (!confirmed) return
    const next = deleteSkillCategory(config, categoryId)
    if (selectedCategoryId === categoryId) {
      setSelectedCategoryId("all")
    }
    await persist(next, selectedSkillId)
  }

  function startEditCategory(category: SkillCategory) {
    setEditingCategoryId(category.id)
    setEditingCategoryName(category.name)
  }

  return (
    <div data-testid="writing-skill-library-sidebar" className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-2">
        <h1 className="text-sm font-semibold">写作 Skill</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">管理 AI 会话自动使用的写作方法。</p>
      </div>
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-medium">分类</div>
      </div>
      <div className="shrink-0 border-b px-2 py-1">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSelectedCategoryId("all")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              setSelectedCategoryId("all")
            }
          }}
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent ${
            selectedCategoryId === "all" ? "bg-accent/60" : ""
          }`}
        >
          <span className="flex-1 truncate">全部</span>
          <span className="text-xs text-muted-foreground">{config?.skills.length ?? 0}</span>
        </div>
        {recentSkills.length > 0 ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setSelectedCategoryId("recent")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                setSelectedCategoryId("recent")
              }
            }}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent ${
              selectedCategoryId === "recent" ? "bg-accent/60" : ""
            }`}
          >
            <span className="flex-1 truncate">最近使用</span>
            <span className="text-xs text-muted-foreground">{recentSkills.length}</span>
          </div>
        ) : null}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSelectedCategoryId("uncategorized")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              setSelectedCategoryId("uncategorized")
            }
          }}
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent ${
            selectedCategoryId === "uncategorized" ? "bg-accent/60" : ""
          }`}
        >
          <span className="flex-1 truncate">未分类</span>
          <span className="text-xs text-muted-foreground">
            {config?.skills.filter((s) => !s.categoryId).length ?? 0}
          </span>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
            {config?.categories.map((category) => {
              const count = config.skills.filter((s) => s.categoryId === category.id).length
              const isEditing = editingCategoryId === category.id
              const isHovered = hoveredCategoryId === category.id
              return (
                <SortableCategoryItem
                  key={category.id}
                  category={category}
                  count={count}
                  isSelected={selectedCategoryId === category.id}
                  isEditing={isEditing}
                  isHovered={isHovered}
                  editingCategoryName={editingCategoryName}
                  onSelect={() => setSelectedCategoryId(category.id)}
                  onStartEdit={() => startEditCategory(category)}
                  onRename={() => void handleRenameCategory(category.id)}
                  onCancelEdit={() => setEditingCategoryId(null)}
                  onEditingNameChange={(name) => setEditingCategoryName(name)}
                  onDelete={() => void handleDeleteCategory(category.id, category.name)}
                  onMouseEnter={() => setHoveredCategoryId(category.id)}
                  onMouseLeave={() => setHoveredCategoryId(null)}
                />
              )
            })}
          </SortableContext>
        </DndContext>
        {showNewCategoryInput ? (
          <div className="mt-1 flex items-center gap-1 rounded-md px-2 py-1">
            <input
              autoFocus
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void handleCreateCategory()
                } else if (e.key === "Escape") {
                  setShowNewCategoryInput(false)
                  setNewCategoryName("")
                }
              }}
              onBlur={() => void handleCreateCategory()}
              placeholder="输入分类名称"
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowNewCategoryInput(true)
              setNewCategoryName("")
            }}
            className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            + 新建分类
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-medium">写作 Skill</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleImportSkill()}
            disabled={!config || !project || saving}
            className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            导入
          </button>
          <button
            type="button"
            onClick={() => void handleCreateSkill()}
            disabled={!config || !project || saving}
            className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            新建 Skill
          </button>
        </div>
      </div>
      {loadError || message ? (
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">{loadError || message}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {config && filteredSkills.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs leading-5 text-muted-foreground">
            还没有写作 Skill。可以新建“三翻四抖”“章节计划”“伏笔检查”等规则。
          </div>
        ) : null}
        {filteredSkills.map((skill) => {
          const active = skill.id === selectedSkillId
          const enabled = !disabledSkillIds.has(skill.id)
          const isLinked = skill.source === "linked"
          return (
            <div
              key={skill.id}
              role="button"
              tabIndex={0}
              onClick={() => void handleSelectSkill(skill.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  void handleSelectSkill(skill.id)
                }
              }}
              className={`mb-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent ${
                active ? "border-primary bg-accent/60" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">写作</span>
                {isLinked ? (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">引用</span>
                ) : null}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">{skill.description || "未填写说明"}</div>
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={enabled}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => void handleToggleSkill(skill, event.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                  disabled={saving}
                />
                参与 AI 会话
              </label>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function WritingSkillLibraryView() {
  const project = useWikiStore((s) => s.project)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const selectedSkillId = useWikiStore((s) => s.selectedWritingSkillLibrarySkillId)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedWritingSkillLibrarySkillId)
  const draftDirty = useWikiStore((s) => s.writingSkillLibraryDraftDirty)
  const setDraftDirty = useWikiStore((s) => s.setWritingSkillLibraryDraftDirty)
  const { config, setConfig, loadError } = useWritingSkillConfig()
  const [draftName, setDraftName] = useState("")
  const [draftDescription, setDraftDescription] = useState("")
  const [draftContent, setDraftContent] = useState("")
  const [draftKind, setDraftKind] = useState<SkillKind[]>([])
  const [draftStages, setDraftStages] = useState<SkillStage[]>([])
  const [draftModes, setDraftModes] = useState<SkillMode[]>([])
  const [draftPriority, setDraftPriority] = useState(50)
  const [draftTags, setDraftTags] = useState<string[]>([])
  const [draftCategoryId, setDraftCategoryId] = useState("")
  const [tagInput, setTagInput] = useState("")
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)

  const selectedSkill = useMemo(
    () => config?.skills.find((skill) => skill.id === selectedSkillId) ?? config?.skills[0] ?? null,
    [config, selectedSkillId],
  )
  const enabledSkillIds = new Set(resolveEnabledWritingSkills(config ?? {
    version: 1,
    selectedSkillId: null,
    disabledSkillIds: [],
    skills: [],
    categories: [],
  }).map((skill) => skill.id))
  const selectedEnabled = selectedSkill ? enabledSkillIds.has(selectedSkill.id) : false
  const isLinkedSkill = selectedSkill?.source === "linked"
  const draftChanged = Boolean(
    selectedSkill && (isLinkedSkill
      ? (draftName.trim() !== skillDisplayName(selectedSkill)
        || draftDescription.trim() !== selectedSkill.description
        || draftKind.join("|") !== selectedSkill.kind.join("|")
        || draftStages.join("|") !== selectedSkill.stages.join("|")
        || draftModes.join("|") !== selectedSkill.modes.join("|")
        || draftPriority !== selectedSkill.priority
        || draftTags.join("|") !== selectedSkill.tags.join("|")
        || draftCategoryId !== selectedSkill.categoryId)
      : hasDraftChanged(
        selectedSkill,
        draftName,
        draftDescription,
        draftContent,
        draftKind,
        draftStages,
        draftModes,
        draftPriority,
        draftTags,
        draftCategoryId,
      )),
  )
  const canSaveDraft = Boolean(project && config && selectedSkill && draftChanged && !saving)

  useEffect(() => {
    if (!selectedSkill) {
      setDraftName("")
      setDraftDescription("")
      setDraftContent("")
      setDraftKind([])
      setDraftStages([])
      setDraftModes([])
      setDraftPriority(50)
      setDraftTags([])
      setDraftCategoryId("")
      setDraftDirty(false)
      return
    }
    setDraftName(skillDisplayName(selectedSkill))
    setDraftDescription(selectedSkill.description)
    setDraftContent(selectedSkill.content)
    setDraftKind(selectedSkill.kind)
    setDraftStages(selectedSkill.stages)
    setDraftModes(selectedSkill.modes)
    setDraftPriority(selectedSkill.priority)
    setDraftTags(selectedSkill.tags)
    setDraftCategoryId(selectedSkill.categoryId)
    setDraftDirty(false)
    setMessage("")
  }, [selectedSkill?.id, selectedSkill?.name, selectedSkill?.description, selectedSkill?.content])

  function updateDraftDirty(
    name = draftName,
    description = draftDescription,
    content = draftContent,
    kind = draftKind,
    stages = draftStages,
    modes = draftModes,
    priority = draftPriority,
    tags = draftTags,
    categoryId = draftCategoryId,
  ) {
    setDraftDirty(selectedSkill
      ? hasDraftChanged(selectedSkill, name, description, content, kind, stages, modes, priority, tags, categoryId)
      : false)
  }

  async function persist(nextConfig: UserSkillConfig, nextSelectedSkillId = selectedSkillId) {
    if (!project) {
      setMessage("请先打开项目")
      return
    }
    setSaving(true)
    try {
      await saveUserSkillConfig(project.path, nextConfig)
      setConfig(nextConfig)
      setSelectedSkillId(nextSelectedSkillId)
      setDraftDirty(false)
      setMessage("已保存")
      bumpDataVersion()
    } catch {
      setMessage("写作 Skill 保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveSkill() {
    if (!config || !selectedSkill || !canSaveDraft) return
    const name = draftName.trim()
    if (!name) {
      setMessage("Skill 名称不能为空")
      return
    }
    if (!isLinkedSkill) {
      const content = draftContent.trim()
      if (!content) {
        setMessage("规则正文不能为空")
        return
      }
    }
    const patch: Partial<Pick<UserSkill, "name" | "displayName" | "description" | "kind" | "stages" | "modes" | "content" | "priority" | "tags" | "categoryId">> = {
      description: draftDescription.trim(),
      kind: draftKind,
      stages: draftStages,
      modes: draftModes,
      priority: draftPriority,
      tags: draftTags,
      categoryId: draftCategoryId,
    }
    if (selectedSkill.source === "built-in") {
      // 内置技能的 name 是路由机器键，改名只落在展示名上。
      patch.displayName = name === selectedSkill.name ? "" : name
    } else {
      patch.name = name
    }
    if (!isLinkedSkill) {
      patch.content = draftContent.trim()
    }
    await persist(updateWritingSkill(config, selectedSkill.id, patch))
  }

  async function handleToggleEnabled(enabled: boolean) {
    if (!config || !selectedSkill || !project || saving) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    await persist(setWritingSkillEnabled(config, selectedSkill.id, enabled), selectedSkill.id)
  }

  async function handleDeleteSkill() {
    if (!config || !selectedSkill || !project || saving) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    const confirmed = window.confirm(`确定删除「${skillDisplayName(selectedSkill)}」吗？删除后无法恢复。`)
    if (!confirmed) return
    const next = deleteWritingSkill(config, selectedSkill.id)
    await persist(next, next.selectedSkillId)
  }

  async function handleExportSkill() {
    if (!selectedSkill) return
    try {
      const jsonStr = exportSkillToJson(selectedSkill)
      const filePath = await save({
        defaultPath: `${skillDisplayName(selectedSkill)}.json`,
        filters: [
          {
            name: "JSON 文件",
            extensions: ["json"],
          },
        ],
      })
      if (!filePath) return
      await writeFile(filePath, jsonStr)
      setMessage("导出成功")
    } catch {
      setMessage("导出 Skill 失败")
    }
  }

  async function handleReloadLinkedContent() {
    if (!selectedSkill || selectedSkill.source !== "linked" || !config) return
    try {
      const content = await loadLinkedSkillContent(selectedSkill)
      const updatedSkill = { ...selectedSkill, content }
      const updatedSkills = config.skills.map((s) =>
        s.id === selectedSkill.id ? updatedSkill : s
      )
      setConfig({ ...config, skills: updatedSkills })
      setDraftContent(content)
      setMessage("已重新读取内容")
    } catch {
      setMessage("读取内容失败")
    }
  }

  function handleAddTag() {
    const trimmed = tagInput.trim()
    if (!trimmed) return
    if (draftTags.includes(trimmed)) {
      setTagInput("")
      return
    }
    const next = [...draftTags, trimmed]
    setDraftTags(next)
    setTagInput("")
    updateDraftDirty(draftName, draftDescription, draftContent, draftKind, draftStages, draftModes, draftPriority, next)
  }

  function handleRemoveTag(tag: string) {
    const next = draftTags.filter((t) => t !== tag)
    setDraftTags(next)
    updateDraftDirty(draftName, draftDescription, draftContent, draftKind, draftStages, draftModes, draftPriority, next)
  }

  function handleTagKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault()
      handleAddTag()
    }
  }

  return (
    <div data-testid="writing-skill-library-view" className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-5 py-4">
        <h1 className="text-lg font-semibold">写作 Skill</h1>
        <p className="mt-1 text-sm text-muted-foreground">编辑 AI 会话会自动选择的通用写作 Skill。</p>
        {!project ? <p className="mt-1 text-sm text-destructive">请先打开项目</p> : null}
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {loadError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {loadError}
          </div>
        ) : !selectedSkill ? (
          <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
            还没有写作 Skill。请在左侧新建 Skill。
          </div>
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-sm text-muted-foreground">项目写作 Skill</div>
                  <h2 className="text-xl font-semibold">{skillDisplayName(selectedSkill)}</h2>
                </div>
                {isLinkedSkill ? (
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">引用</span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    data-testid="writing-skill-enabled-checkbox"
                    type="checkbox"
                    checked={selectedEnabled}
                    onChange={(event) => void handleToggleEnabled(event.target.checked)}
                    className="h-4 w-4 accent-primary"
                    disabled={saving}
                  />
                  参与 AI 会话
                </label>
                <button
                  type="button"
                  onClick={() => void handleExportSkill()}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
                >
                  导出
                </button>
                <button
                  data-testid="writing-skill-delete-button"
                  type="button"
                  onClick={() => void handleDeleteSkill()}
                  disabled={!project || saving}
                  className="rounded-md border px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                >
                  删除
                </button>
              </div>
            </div>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">
                {selectedSkill.source === "built-in" ? "显示名称（内置技能内部标识保持不变）" : "Skill 名称"}
              </span>
              <input
                data-testid="writing-skill-name-input"
                value={draftName}
                onChange={(event) => {
                  const next = event.target.value
                  setDraftName(next)
                  updateDraftDirty(next)
                }}
                className="rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">说明</span>
              <input
                data-testid="writing-skill-description-input"
                value={draftDescription}
                onChange={(event) => {
                  const next = event.target.value
                  setDraftDescription(next)
                  updateDraftDirty(draftName, next)
                }}
                className="rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">分类</span>
              <select
                value={draftCategoryId}
                onChange={(event) => {
                  const next = event.target.value
                  setDraftCategoryId(next)
                  updateDraftDirty(draftName, draftDescription, draftContent, draftKind, draftStages, draftModes, draftPriority, draftTags, next)
                }}
                className="rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">未分类</option>
                {config?.categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </label>

            <div className="grid gap-2 text-sm">
              <span className="font-medium">类型</span>
              <div className="flex flex-wrap gap-2">
                {WRITING_SKILL_KIND_OPTIONS.map((kind) => (
                  <OptionCheckbox
                    key={kind}
                    label={SKILL_KIND_LABELS[kind]}
                    checked={draftKind.includes(kind)}
                    testId={`writing-skill-kind-${kind}`}
                    onToggle={() => {
                      const next = toggleValue(draftKind, kind)
                      setDraftKind(next)
                      updateDraftDirty(draftName, draftDescription, draftContent, next)
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-2 text-sm">
              <span className="font-medium">阶段</span>
              <div className="flex flex-wrap gap-2">
                {WRITING_SKILL_STAGE_OPTIONS.map((stage) => (
                  <OptionCheckbox
                    key={stage}
                    label={SKILL_STAGE_LABELS[stage]}
                    checked={draftStages.includes(stage)}
                    testId={`writing-skill-stage-${stage}`}
                    onToggle={() => {
                      const next = toggleValue(draftStages, stage)
                      setDraftStages(next)
                      updateDraftDirty(draftName, draftDescription, draftContent, draftKind, next)
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-2 text-sm">
              <span className="font-medium">模式</span>
              <div className="flex flex-wrap gap-2">
                {WRITING_SKILL_MODE_OPTIONS.map((mode) => (
                  <OptionCheckbox
                    key={mode}
                    label={SKILL_MODE_LABELS[mode]}
                    checked={draftModes.includes(mode)}
                    testId={`writing-skill-mode-${mode}`}
                    onToggle={() => {
                      const next = toggleValue(draftModes, mode)
                      setDraftModes(next)
                      updateDraftDirty(draftName, draftDescription, draftContent, draftKind, draftStages, next)
                    }}
                  />
                ))}
              </div>
            </div>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">优先级（1-100，越小越优先）</span>
              <input
                type="number"
                min={1}
                max={100}
                value={draftPriority}
                onChange={(event) => {
                  const value = parseInt(event.target.value, 10)
                  const next = isNaN(value) ? 50 : Math.max(1, Math.min(100, value))
                  setDraftPriority(next)
                  updateDraftDirty(draftName, draftDescription, draftContent, draftKind, draftStages, draftModes, next)
                }}
                className="w-32 rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <div className="grid gap-2 text-sm">
              <span className="font-medium">标签</span>
              <div className="flex flex-wrap items-center gap-2">
                {draftTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={handleAddTag}
                  placeholder="输入标签后按回车添加"
                  className="flex-1 min-w-[150px] rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            {isLinkedSkill ? (
              <div className="grid gap-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">规则正文</span>
                  <button
                    type="button"
                    onClick={() => void handleReloadLinkedContent()}
                    className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                  >
                    重新读取
                  </button>
                </div>
                <div className="rounded-md border bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  此 Skill 为外部引用，内容实时读取
                </div>
                <textarea
                  readOnly
                  value={draftContent}
                  className="min-h-[420px] resize-y rounded-md border bg-muted px-3 py-2 font-mono text-xs leading-5 outline-none"
                />
                {selectedSkill.linkedPath ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>引用路径：</span>
                    <code className="truncate rounded bg-muted px-1.5 py-0.5">{selectedSkill.linkedPath}</code>
                  </div>
                ) : null}
              </div>
            ) : (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">规则正文</span>
                <textarea
                  data-testid="writing-skill-content-input"
                  value={draftContent}
                  onChange={(event) => {
                    const next = event.target.value
                    setDraftContent(next)
                    updateDraftDirty(draftName, draftDescription, next)
                  }}
                  className="min-h-[420px] rounded-md border bg-background px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            )}

            <div className="flex items-center gap-3">
              <button
                data-testid="writing-skill-save-button"
                type="button"
                onClick={() => void handleSaveSkill()}
                disabled={!canSaveDraft}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "保存中..." : "保存"}
              </button>
              {message ? (
                <span className="text-sm text-muted-foreground">{message}</span>
              ) : draftDirty ? (
                <span className="text-sm text-amber-700">未保存</span>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
