import { useEffect, useMemo, useState } from "react"
import {
  createBlankWritingSkill,
  deleteWritingSkill,
  loadUserSkillConfig,
  resolveEnabledWritingSkills,
  saveUserSkillConfig,
  setWritingSkillEnabled,
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
  type SkillKind,
  type SkillMode,
  type SkillStage,
  type UserSkill,
} from "@/lib/novel/skill-library"
import { confirmDiscardSkillLibraryDraft, useWikiStore } from "@/stores/wiki-store"

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
): boolean {
  return name.trim() !== skill.name
    || description.trim() !== skill.description
    || content.trim() !== skill.content
    || kind.join("|") !== skill.kind.join("|")
    || stages.join("|") !== skill.stages.join("|")
    || modes.join("|") !== skill.modes.join("|")
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
      .then((loaded) => {
        if (cancelled) return
        setConfig(loaded)
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

  const disabledSkillIds = new Set(config?.disabledSkillIds ?? [])

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

  async function handleCreateSkill() {
    if (!config || !project || saving) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    const next = createBlankWritingSkill(config)
    await persist(next, next.selectedSkillId)
  }

  async function handleToggleSkill(skill: UserSkill, enabled: boolean) {
    if (!config || !project || saving) return
    if (draftDirty && !confirmDiscardSkillLibraryDraft()) return
    if (draftDirty) setDraftDirty(false)
    const next = setWritingSkillEnabled(config, skill.id, enabled)
    await persist(next, selectedSkillId ?? next.selectedSkillId)
  }

  return (
    <div data-testid="writing-skill-library-sidebar" className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-2">
        <h1 className="text-sm font-semibold">写作 Skill</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">管理 AI 会话自动使用的写作方法。</p>
      </div>
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-medium">写作 Skill</div>
        <button
          type="button"
          onClick={() => void handleCreateSkill()}
          disabled={!config || !project || saving}
          className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
        >
          新建 Skill
        </button>
      </div>
      {loadError || message ? (
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">{loadError || message}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {config && config.skills.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs leading-5 text-muted-foreground">
            还没有写作 Skill。可以新建“三翻四抖”“章节计划”“伏笔检查”等规则。
          </div>
        ) : null}
        {config?.skills.map((skill) => {
          const active = skill.id === selectedSkillId
          const enabled = !disabledSkillIds.has(skill.id)
          return (
            <div
              key={skill.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedSkillId(skill.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  setSelectedSkillId(skill.id)
                }
              }}
              className={`mb-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent ${
                active ? "border-primary bg-accent/60" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">写作</span>
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
  }).map((skill) => skill.id))
  const selectedEnabled = selectedSkill ? enabledSkillIds.has(selectedSkill.id) : false
  const draftChanged = Boolean(
    selectedSkill && hasDraftChanged(
      selectedSkill,
      draftName,
      draftDescription,
      draftContent,
      draftKind,
      draftStages,
      draftModes,
    ),
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
      setDraftDirty(false)
      return
    }
    setDraftName(selectedSkill.name)
    setDraftDescription(selectedSkill.description)
    setDraftContent(selectedSkill.content)
    setDraftKind(selectedSkill.kind)
    setDraftStages(selectedSkill.stages)
    setDraftModes(selectedSkill.modes)
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
  ) {
    setDraftDirty(selectedSkill
      ? hasDraftChanged(selectedSkill, name, description, content, kind, stages, modes)
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
    const content = draftContent.trim()
    if (!name) {
      setMessage("Skill 名称不能为空")
      return
    }
    if (!content) {
      setMessage("规则正文不能为空")
      return
    }
    await persist(updateWritingSkill(config, selectedSkill.id, {
      name,
      description: draftDescription.trim(),
      content,
      kind: draftKind,
      stages: draftStages,
      modes: draftModes,
    }))
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
    const confirmed = window.confirm(`确定删除「${selectedSkill.name}」吗？`)
    if (!confirmed) return
    const next = deleteWritingSkill(config, selectedSkill.id)
    await persist(next, next.selectedSkillId)
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
              <div>
                <div className="text-sm text-muted-foreground">项目写作 Skill</div>
                <h2 className="text-xl font-semibold">{selectedSkill.name}</h2>
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
              <span className="font-medium">Skill 名称</span>
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
