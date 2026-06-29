import { useEffect, useMemo, useState } from "react"
import {
  BUILT_IN_DE_AI_SKILLS,
  createProjectDeAiSkillFromTemplate,
  deleteProjectDeAiSkill,
  getAllDeAiSkills,
  isDeAiSkillModified,
  loadDeAiSkillConfig,
  resetBuiltInDeAiSkill,
  saveDeAiSkillConfig,
  setDeAiSkillEnabled,
  setDefaultDeAiSkill,
  updateDeAiSkill,
  type DeAiSkill,
  type DeAiSkillConfig,
} from "@/lib/novel/de-ai-skill-library"
import { confirmDiscardSkillLibraryDraft, useWikiStore } from "@/stores/wiki-store"

function sourceLabel(skill: DeAiSkill): string {
  if (skill.source === "built-in") return "内置"
  if (skill.source === "legacy") return "旧版"
  return "项目"
}

function resolveInitialSkillId(config: DeAiSkillConfig, requested: string | null): string {
  const allSkills = getAllDeAiSkills(config)
  if (requested && allSkills.some((skill) => skill.id === requested)) return requested
  return config.defaultSkillId || allSkills[0]?.id || ""
}

function normalizeDraftText(value: string): string {
  return value.trim()
}

function hasSkillDraftChanged(skill: DeAiSkill, name: string, description: string, content: string): boolean {
  return normalizeDraftText(name) !== normalizeDraftText(skill.name)
    || normalizeDraftText(description) !== normalizeDraftText(skill.description)
    || normalizeDraftText(content) !== normalizeDraftText(skill.content)
}

export function SkillLibrarySidebarPanel() {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const selectedSkillId = useWikiStore((s) => s.selectedSkillLibrarySkillId)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedSkillLibrarySkillId)
  const draftDirty = useWikiStore((s) => s.skillLibraryDraftDirty)
  const setDraftDirty = useWikiStore((s) => s.setSkillLibraryDraftDirty)

  const [config, setConfig] = useState<DeAiSkillConfig | null>(null)
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)

  const allSkills = useMemo(() => config ? getAllDeAiSkills(config) : [], [config])
  const disabledSkillIds = new Set(config?.disabledSkillIds ?? [])

  useEffect(() => {
    let cancelled = false
    setConfig(null)
    setMessage("")
    loadDeAiSkillConfig(project?.path)
      .then((loaded) => {
        if (cancelled) return
        setConfig(loaded)
        setSelectedSkillId(resolveInitialSkillId(loaded, selectedSkillId))
      })
      .catch(() => {
        if (!cancelled) setMessage("技能库加载失败")
      })
    return () => {
      cancelled = true
    }
  }, [dataVersion, project?.path])

  async function persist(nextConfig: DeAiSkillConfig, nextSelectedSkillId: string) {
    setSaving(true)
    try {
      if (project) {
        await saveDeAiSkillConfig(project.path, nextConfig)
        bumpDataVersion()
      }
      setConfig(nextConfig)
      setSelectedSkillId(nextSelectedSkillId)
      setMessage("已保存")
    } catch {
      setMessage("技能库保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateSkill() {
    if (!config || saving) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    const now = Date.now()
    const next = createProjectDeAiSkillFromTemplate(config, BUILT_IN_DE_AI_SKILLS[0].id, now)
    await persist(next, `project:${now}`)
  }

  async function handleToggleSkill(skill: DeAiSkill, enabled: boolean) {
    if (!config || saving) return
    const next = setDeAiSkillEnabled(config, skill.id, enabled)
    await persist(next, selectedSkillId ?? next.defaultSkillId)
  }

  return (
    <div data-testid="skill-library-sidebar" className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-2">
        <h1 className="text-sm font-semibold">技能库</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">管理当前项目可用的去AI味技能。</p>
      </div>

      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-medium">去AI味技能</div>
        <button
          type="button"
          onClick={() => void handleCreateSkill()}
          className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
          disabled={!config || saving}
        >
          新建技能
        </button>
      </div>

      {message ? <div className="border-b px-3 py-2 text-xs text-muted-foreground">{message}</div> : null}

      <div data-testid="skill-list" className="min-h-0 flex-1 overflow-y-auto p-2">
        {allSkills.map((skill) => {
          const active = skill.id === selectedSkillId
          const enabled = !disabledSkillIds.has(skill.id)
          const modified = isDeAiSkillModified(config!, skill.id)
          return (
            <div
              key={skill.id}
              data-skill-id={skill.id}
              onClick={() => setSelectedSkillId(skill.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  setSelectedSkillId(skill.id)
                }
              }}
              role="button"
              tabIndex={0}
              className={`mb-2 w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent ${
                active ? "border-primary bg-accent/60" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {sourceLabel(skill)}
                </span>
                {config?.defaultSkillId === skill.id ? (
                  <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">默认</span>
                ) : null}
                {modified ? (
                  <span
                    data-testid="skill-modified-badge"
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800"
                  >
                    已修改
                  </span>
                ) : null}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">{skill.description}</div>
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={enabled}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => void handleToggleSkill(skill, event.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                  disabled={saving}
                />
                显示在调用入口
              </label>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SkillLibraryView() {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const selectedSkillId = useWikiStore((s) => s.selectedSkillLibrarySkillId)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedSkillLibrarySkillId)
  const draftDirty = useWikiStore((s) => s.skillLibraryDraftDirty)
  const setDraftDirty = useWikiStore((s) => s.setSkillLibraryDraftDirty)

  const [config, setConfig] = useState<DeAiSkillConfig | null>(null)
  const [draftName, setDraftName] = useState("")
  const [draftDescription, setDraftDescription] = useState("")
  const [draftContent, setDraftContent] = useState("")
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)

  const allSkills = useMemo(() => config ? getAllDeAiSkills(config) : [], [config])
  const selectedSkill = allSkills.find((skill) => skill.id === selectedSkillId) ?? allSkills[0] ?? null
  const selectedIsEditable = selectedSkill != null
  const selectedIsBuiltIn = selectedSkill?.id.startsWith("built-in:") ?? false
  const selectedHasBuiltInOverride = selectedIsBuiltIn
    && Boolean(config?.builtInSkillOverrides.some((skill) => skill.id === selectedSkill?.id))
  const selectedModified = Boolean(config && selectedSkill && isDeAiSkillModified(config, selectedSkill.id))
  const draftChanged = Boolean(
    selectedSkill && hasSkillDraftChanged(selectedSkill, draftName, draftDescription, draftContent),
  )
  const canSaveDraft = selectedIsEditable && draftChanged && !saving

  useEffect(() => {
    let cancelled = false
    setConfig(null)
    setMessage("")
    loadDeAiSkillConfig(project?.path)
      .then((loaded) => {
        if (cancelled) return
        setConfig(loaded)
        setSelectedSkillId(resolveInitialSkillId(loaded, selectedSkillId))
      })
      .catch(() => {
        if (!cancelled) setMessage("技能库加载失败")
      })
    return () => {
      cancelled = true
    }
  }, [dataVersion, project?.path])

  useEffect(() => {
    if (!draftDirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [draftDirty])

  useEffect(() => {
    if (!selectedSkill) {
      setDraftName("")
      setDraftDescription("")
      setDraftContent("")
      setDraftDirty(false)
      return
    }
    setDraftName(selectedSkill.name)
    setDraftDescription(selectedSkill.description)
    setDraftContent(selectedSkill.content)
    setMessage("")
    setDraftDirty(false)
  }, [selectedSkill?.id, selectedSkill?.name, selectedSkill?.description, selectedSkill?.content])

  function updateDraftDirty(name: string, description: string, content: string) {
    setDraftDirty(selectedSkill ? hasSkillDraftChanged(selectedSkill, name, description, content) : false)
  }

  async function persist(nextConfig: DeAiSkillConfig, nextSelectedSkillId = selectedSkillId ?? "") {
    setSaving(true)
    try {
      if (project) {
        await saveDeAiSkillConfig(project.path, nextConfig)
        bumpDataVersion()
      }
      setConfig(nextConfig)
      setDraftDirty(false)
      setSelectedSkillId(nextSelectedSkillId)
      setMessage("已保存")
    } catch {
      setMessage("技能库保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleCopySkill() {
    if (!config || !selectedSkill) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    const now = Date.now()
    const next = createProjectDeAiSkillFromTemplate(config, selectedSkill.id, now)
    await persist(next, `project:${now}`)
  }

  async function handleSaveSkill() {
    if (!config || !selectedSkill || !canSaveDraft) return
    const name = normalizeDraftText(draftName)
    const description = normalizeDraftText(draftDescription)
    const content = normalizeDraftText(draftContent)
    if (!name) {
      setMessage("技能名称不能为空")
      return
    }
    if (!content) {
      setMessage("技能规则不能为空")
      return
    }
    await persist(updateDeAiSkill(config, selectedSkill.id, {
      name,
      description,
      content,
    }))
  }

  function handleDiscardDraft() {
    if (!selectedSkill || !draftChanged || saving) return
    setDraftName(selectedSkill.name)
    setDraftDescription(selectedSkill.description)
    setDraftContent(selectedSkill.content)
    setDraftDirty(false)
    setMessage("已放弃未保存修改")
  }

  async function handleSetDefault() {
    if (!config || !selectedSkill) return
    await persist(setDefaultDeAiSkill(config, selectedSkill.id))
  }

  async function handleDeleteSkill() {
    if (!config || !selectedSkill || selectedIsBuiltIn) return
    const confirmed = window.confirm(`确定删除「${selectedSkill.name}」吗？`)
    if (!confirmed) return
    const next = deleteProjectDeAiSkill(config, selectedSkill.id)
    const nextSelected = next.defaultSkillId || getAllDeAiSkills(next)[0]?.id || ""
    await persist(next, nextSelected)
  }

  async function handleResetBuiltInSkill() {
    if (!config || !selectedSkill || !selectedIsBuiltIn || !selectedHasBuiltInOverride) return
    const confirmed = window.confirm(`确定将「${selectedSkill.name}」恢复为内置默认内容吗？当前项目对此技能的修改会被清除。`)
    if (!confirmed) return
    await persist(resetBuiltInDeAiSkill(config, selectedSkill.id), selectedSkill.id)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return
      event.preventDefault()
      if (canSaveDraft) {
        void handleSaveSkill()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [canSaveDraft, config, draftContent, draftDescription, draftName, selectedSkill?.id])

  return (
    <div data-testid="skill-library-view" className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-5 py-4">
        <h1 className="text-lg font-semibold">技能库</h1>
        <p className="mt-1 text-sm text-muted-foreground">编辑当前选中的去AI味 Skill 内容。</p>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {!selectedSkill ? (
          <div className="text-sm text-muted-foreground">暂无技能。</div>
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm text-muted-foreground">{sourceLabel(selectedSkill)}技能</div>
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-xl font-semibold">{selectedSkill.name}</h2>
                  {selectedModified ? (
                    <span
                      data-testid="skill-modified-badge"
                      className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                    >
                      已修改
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  data-testid="skill-copy-button"
                  type="button"
                  onClick={() => void handleCopySkill()}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                  disabled={saving}
                >
                  复制为项目技能
                </button>
                <button
                  data-testid="skill-default-button"
                  type="button"
                  onClick={() => void handleSetDefault()}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                  disabled={saving || config?.defaultSkillId === selectedSkill.id}
                >
                  设为默认
                </button>
                {selectedIsBuiltIn ? (
                  <button
                    data-testid="skill-reset-default-button"
                    type="button"
                    onClick={() => void handleResetBuiltInSkill()}
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={saving || !selectedHasBuiltInOverride}
                  >
                    恢复默认
                  </button>
                ) : null}
                {!selectedIsBuiltIn ? (
                  <button
                    data-testid="skill-delete-button"
                    type="button"
                    onClick={() => void handleDeleteSkill()}
                    className="rounded-md border px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                    disabled={saving}
                  >
                    删除
                  </button>
                ) : null}
              </div>
            </div>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">技能名称</span>
              <input
                data-testid="skill-name-input"
                value={draftName}
                onChange={(event) => {
                  const nextName = event.target.value
                  setDraftName(nextName)
                  updateDraftDirty(nextName, draftDescription, draftContent)
                }}
                disabled={!selectedIsEditable}
                className="rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
              />
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">说明</span>
              <input
                data-testid="skill-description-input"
                value={draftDescription}
                onChange={(event) => {
                  const nextDescription = event.target.value
                  setDraftDescription(nextDescription)
                  updateDraftDirty(draftName, nextDescription, draftContent)
                }}
                disabled={!selectedIsEditable}
                className="rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
              />
            </label>

            <label className="grid min-h-0 gap-1.5 text-sm">
              <span className="font-medium">规则正文</span>
              <textarea
                data-testid="skill-content-input"
                value={draftContent}
                onChange={(event) => {
                  const nextContent = event.target.value
                  setDraftContent(nextContent)
                  updateDraftDirty(draftName, draftDescription, nextContent)
                }}
                disabled={!selectedIsEditable}
                className="min-h-[520px] rounded-md border bg-background px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
              />
            </label>

            <div className="flex items-center gap-3">
              <button
                data-testid="skill-save-button"
                type="button"
                onClick={() => void handleSaveSkill()}
                disabled={!canSaveDraft}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "保存中..." : "保存"}
              </button>
              <button
                data-testid="skill-discard-button"
                type="button"
                onClick={handleDiscardDraft}
                disabled={!draftChanged || saving}
                className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                放弃修改
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
