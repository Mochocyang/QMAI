import { useEffect, useMemo, useState } from "react"
import {
  createBlankProjectDeAiSkill,
  deleteProjectDeAiSkill,
  getAllDeAiSkills,
  isDeAiSkillConfigCorruptError,
  loadDeAiSkillConfig,
  recreateDeAiSkillConfig,
  resetBuiltInDeAiSkill,
  restoreDeAiSkillConfigFromBackup,
  saveDeAiSkillConfig,
  setDeAiSkillEnabled,
  setDefaultDeAiSkill,
  updateDeAiSkill,
  deAiSkillToUserSkill,
  type DeAiSkill,
  type DeAiSkillConfig,
} from "@/lib/novel/de-ai-skill-library"
import { SKILL_KIND_LABELS, SKILL_MODE_LABELS, SKILL_STAGE_LABELS } from "@/lib/novel/skill-library"
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

const skillLibraryLoadPromises = new Map<string, Promise<DeAiSkillConfig>>()

function loadSharedDeAiSkillConfig(projectPath: string | null | undefined, dataVersion: number) {
  const key = `${projectPath ?? ""}:${dataVersion}`
  const existing = skillLibraryLoadPromises.get(key)
  if (existing) return existing
  const promise = loadDeAiSkillConfig(projectPath).finally(() => {
    skillLibraryLoadPromises.delete(key)
  })
  skillLibraryLoadPromises.set(key, promise)
  return promise
}

function useSkillLibraryConfig(
  projectPath: string | null | undefined,
  dataVersion: number,
  selectedSkillId: string | null,
  setSelectedSkillId: (id: string | null) => void,
) {
  const [config, setConfig] = useState<DeAiSkillConfig | null>(null)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let cancelled = false
    setConfig(null)
    setLoadError("")
    loadSharedDeAiSkillConfig(projectPath, dataVersion)
      .then((loaded) => {
        if (cancelled) return
        setConfig(loaded)
        setSelectedSkillId(resolveInitialSkillId(loaded, selectedSkillId))
      })
      .catch((error) => {
        if (cancelled) return
        setConfig(null)
        setLoadError(isDeAiSkillConfigCorruptError(error) ? "技能库配置文件损坏" : "技能库加载失败")
      })
    return () => {
      cancelled = true
    }
  }, [dataVersion, projectPath])

  return { config, setConfig, loadError, setLoadError }
}

export function SkillLibrarySidebarPanel() {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const selectedSkillId = useWikiStore((s) => s.selectedSkillLibrarySkillId)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedSkillLibrarySkillId)
  const draftDirty = useWikiStore((s) => s.skillLibraryDraftDirty)
  const setDraftDirty = useWikiStore((s) => s.setSkillLibraryDraftDirty)

  const { config, setConfig, loadError } = useSkillLibraryConfig(
    project?.path,
    dataVersion,
    selectedSkillId,
    setSelectedSkillId,
  )
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)

  const allSkills = useMemo(() => config ? getAllDeAiSkills(config) : [], [config])
  const disabledSkillIds = new Set(config?.disabledSkillIds ?? [])

  async function persist(nextConfig: DeAiSkillConfig, nextSelectedSkillId: string) {
    if (!project) {
      setMessage("请先打开项目")
      return
    }
    setSaving(true)
    try {
      await saveDeAiSkillConfig(project.path, nextConfig)
      bumpDataVersion()
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
    if (!config || !project || saving) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    const now = Date.now()
    const next = createBlankProjectDeAiSkill(config, now)
    await persist(next, `project:${now}`)
  }

  async function handleToggleSkill(skill: DeAiSkill, enabled: boolean) {
    if (!config || !project || saving) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
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
          disabled={!config || !project || saving}
        >
          新建技能
        </button>
      </div>

      {loadError || message ? (
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">{loadError || message}</div>
      ) : null}

      <div data-testid="skill-list" className="min-h-0 flex-1 overflow-y-auto p-2">
        {allSkills.map((skill) => {
          const active = skill.id === selectedSkillId
          const enabled = !disabledSkillIds.has(skill.id)
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

  const { config, setConfig, loadError, setLoadError } = useSkillLibraryConfig(
    project?.path,
    dataVersion,
    selectedSkillId,
    setSelectedSkillId,
  )
  const [draftName, setDraftName] = useState("")
  const [draftDescription, setDraftDescription] = useState("")
  const [draftContent, setDraftContent] = useState("")
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)

  const allSkills = useMemo(() => config ? getAllDeAiSkills(config) : [], [config])
  const selectedSkill = allSkills.find((skill) => skill.id === selectedSkillId) ?? allSkills[0] ?? null
  const selectedIsEditable = Boolean(project && selectedSkill)
  const selectedIsBuiltIn = selectedSkill?.id.startsWith("built-in:") ?? false
  const selectedGenericSkill = selectedSkill ? deAiSkillToUserSkill(selectedSkill) : null
  const selectedHasBuiltInOverride = selectedIsBuiltIn
    && Boolean(config?.builtInSkillOverrides.some((skill) => skill.id === selectedSkill?.id))
  const selectedEnabled = Boolean(
    config && selectedSkill && !config.disabledSkillIds.includes(selectedSkill.id),
  )
  const draftChanged = Boolean(
    selectedSkill && hasSkillDraftChanged(selectedSkill, draftName, draftDescription, draftContent),
  )
  const canSaveDraft = Boolean(project) && selectedIsEditable && draftChanged && !saving

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
    if (!project) {
      setMessage("请先打开项目")
      return
    }
    setSaving(true)
    try {
      await saveDeAiSkillConfig(project.path, nextConfig)
      bumpDataVersion()
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
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    await persist(setDefaultDeAiSkill(config, selectedSkill.id))
  }

  async function handleDeleteSkill() {
    if (!config || !selectedSkill || selectedIsBuiltIn) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    const confirmed = window.confirm(`确定删除「${selectedSkill.name}」吗？`)
    if (!confirmed) return
    const next = deleteProjectDeAiSkill(config, selectedSkill.id)
    const nextSelected = next.defaultSkillId || getAllDeAiSkills(next)[0]?.id || ""
    await persist(next, nextSelected)
  }

  async function handleResetBuiltInSkill() {
    if (!config || !selectedSkill || !selectedIsBuiltIn || !selectedHasBuiltInOverride) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    const confirmed = window.confirm(`确定将「${selectedSkill.name}」恢复为内置默认内容吗？当前项目对此技能的修改会被清除。`)
    if (!confirmed) return
    await persist(resetBuiltInDeAiSkill(config, selectedSkill.id), selectedSkill.id)
  }

  async function handleRestoreBackup() {
    if (!project || saving) return
    setSaving(true)
    try {
      const restored = await restoreDeAiSkillConfigFromBackup(project.path)
      setConfig(restored)
      setLoadError("")
      setDraftDirty(false)
      setSelectedSkillId(resolveInitialSkillId(restored, selectedSkillId))
      setMessage("已从备份恢复")
      bumpDataVersion()
    } catch {
      setMessage("备份恢复失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleRecreateConfig() {
    if (!project || saving) return
    const confirmed = window.confirm("确定重新创建技能库配置吗？这会用默认内置 Skill 覆盖当前损坏的配置文件。")
    if (!confirmed) return
    setSaving(true)
    try {
      const recreated = await recreateDeAiSkillConfig(project.path)
      setConfig(recreated)
      setLoadError("")
      setDraftDirty(false)
      setSelectedSkillId(resolveInitialSkillId(recreated, selectedSkillId))
      setMessage("已重新创建技能库配置")
      bumpDataVersion()
    } catch {
      setMessage("重新创建技能库配置失败")
    } finally {
      setSaving(false)
    }
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
        {!project ? <p className="mt-1 text-sm text-destructive">请先打开项目</p> : null}
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {loadError ? (
          <div className="mx-auto max-w-3xl rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="text-sm font-medium text-destructive">{loadError}</div>
            <p className="mt-2 text-sm text-muted-foreground">
              当前项目的技能库配置无法读取。你可以先尝试从备份恢复；如果没有可用备份，再重新创建默认配置。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                data-testid="skill-restore-backup-button"
                type="button"
                onClick={() => void handleRestoreBackup()}
                disabled={!project || saving}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                使用备份恢复
              </button>
              <button
                data-testid="skill-recreate-config-button"
                type="button"
                onClick={() => void handleRecreateConfig()}
                disabled={!project || saving}
                className="rounded-md border px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                重新创建配置
              </button>
              {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
            </div>
          </div>
        ) : !selectedSkill ? (
          <div className="text-sm text-muted-foreground">暂无技能。</div>
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm text-muted-foreground">{sourceLabel(selectedSkill)}技能</div>
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-xl font-semibold">{selectedSkill.name}</h2>
                </div>
                {selectedGenericSkill ? (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-2 py-0.5">
                      类型：{selectedGenericSkill.kind.map((kind) => SKILL_KIND_LABELS[kind]).join("、")}
                    </span>
                    <span className="rounded bg-muted px-2 py-0.5">
                      阶段：{selectedGenericSkill.stages.map((stage) => SKILL_STAGE_LABELS[stage]).join("、")}
                    </span>
                    <span className="rounded bg-muted px-2 py-0.5">
                      模式：{selectedGenericSkill.modes.map((mode) => SKILL_MODE_LABELS[mode]).join("、")}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  data-testid="skill-default-button"
                  type="button"
                  onClick={() => void handleSetDefault()}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                  disabled={!project || saving || !selectedEnabled || config?.defaultSkillId === selectedSkill.id}
                >
                  设为默认
                </button>
                {selectedIsBuiltIn ? (
                  <button
                    data-testid="skill-reset-default-button"
                    type="button"
                    onClick={() => void handleResetBuiltInSkill()}
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!project || saving || !selectedHasBuiltInOverride}
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
                    disabled={!project || saving}
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
