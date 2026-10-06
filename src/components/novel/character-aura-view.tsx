import { useEffect, useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { PencilLine, Plus, Save, Sparkles, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore } from "@/stores/wiki-store"
import {
  bindCharacterAura,
  BUILT_IN_CHARACTER_AURAS,
  CHARACTER_AURA_RESEARCH_FILES,
  createCustomCharacterAuraSkill,
  deleteCustomCharacterAura,
  getCharacterAuraBindings,
  listBindableNovelCharacters,
  listCharacterAuras,
  loadCharacterAuraResearchDocument,
  loadCharacterAuraSkillDocument,
  unbindCharacterAura,
  updateCustomCharacterAura,
  type CharacterAura,
  type CharacterAuraBinding,
  type CharacterAuraGenerationProgress,
  type CharacterAuraResearchFileName,
} from "@/lib/novel/character-aura"
import { SoulDocEditor } from "./soul-doc-editor"
import { refreshProjectState } from "@/lib/project-refresh"
import type { PortablePersonality } from "@/lib/novel/portable-personality"

type AuraFormState = {
  portablePersonality?: PortablePersonality
  name: string
  category: string
  sourceNote: string
  corpus: string
  styleDescription: string
  expressionDna: string
  mentalModel: string
  decisionHeuristics: string
  valueAntiPatterns: string
  honestyBoundaries: string
  behaviorRules: string
  boundaries: string
  notes: string
  sourceUrls: string
  localDocumentPaths: string
  generationPrompt: string
  enableWebSearch: boolean
}

const EMPTY_FORM: AuraFormState = {
  name: "",
  category: "",
  sourceNote: "",
  corpus: "",
  styleDescription: "",
  expressionDna: "",
  mentalModel: "",
  decisionHeuristics: "",
  valueAntiPatterns: "",
  honestyBoundaries: "",
  behaviorRules: "",
  boundaries: "",
  notes: "",
  sourceUrls: "",
  localDocumentPaths: "",
  generationPrompt: "",
  enableWebSearch: false,
}

function formFromAura(aura: CharacterAura) {
  return {
    portablePersonality: aura.portablePersonality,
    name: aura.name,
    category: aura.category ?? "",
    sourceNote: aura.sourceNote,
    corpus: aura.corpus,
    styleDescription: aura.styleDescription,
    expressionDna: aura.expressionDna ?? aura.styleDescription,
    mentalModel: aura.mentalModel ?? aura.corpus,
    decisionHeuristics: aura.decisionHeuristics ?? aura.behaviorRules,
    valueAntiPatterns: aura.valueAntiPatterns ?? aura.notes,
    honestyBoundaries: aura.honestyBoundaries ?? aura.boundaries,
    behaviorRules: aura.behaviorRules,
    boundaries: aura.boundaries,
    notes: aura.notes,
    sourceUrls: aura.sourceUrls ?? "",
    localDocumentPaths: aura.localDocumentPaths ?? "",
    generationPrompt: aura.generationPrompt ?? "",
    enableWebSearch: aura.webSearchEnabled ?? false,
  }
}

function buildUpdatePayload(form: AuraFormState) {
  const decisionHeuristics = form.decisionHeuristics.trim()
  const valueAntiPatterns = form.valueAntiPatterns.trim()
  const honestyBoundaries = form.honestyBoundaries.trim()

  return {
    ...(form.portablePersonality ? { portablePersonality: form.portablePersonality } : {}),
    name: form.name.trim(),
    category: form.category.trim(),
    sourceNote: form.sourceNote.trim(),
    corpus: form.corpus.trim(),
    styleDescription: form.styleDescription.trim(),
    behaviorRules: decisionHeuristics || form.behaviorRules.trim(),
    boundaries: honestyBoundaries || form.boundaries.trim(),
    notes: valueAntiPatterns || form.notes.trim(),
    expressionDna: form.expressionDna.trim(),
    mentalModel: form.mentalModel.trim(),
    decisionHeuristics,
    valueAntiPatterns,
    honestyBoundaries,
    sourceUrls: form.sourceUrls.trim(),
    localDocumentPaths: form.localDocumentPaths.trim(),
    generationPrompt: form.generationPrompt.trim(),
    webSearchEnabled: form.enableWebSearch,
  }
}

export function CharacterAuraView({ hideSidebar = false }: { hideSidebar?: boolean }) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const storedSelectedSoulId = useWikiStore((s) => s.selectedSoulId)
  const setStoredSelectedSoulId = useWikiStore((s) => s.setSelectedSoulId)
  const storedSelectedSoulSection = useWikiStore((s) => s.selectedSoulSection)
  const setStoredSelectedSoulSection = useWikiStore((s) => s.setSelectedSoulSection)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const [section, setSection] = useState<"builtIn" | "custom">("builtIn")
  const [mode, setMode] = useState<"create" | "edit">("create")
  const [showCustomEditor, setShowCustomEditor] = useState(false)
  const [auras, setAuras] = useState<CharacterAura[]>(BUILT_IN_CHARACTER_AURAS)
  const [selectedId, setSelectedId] = useState(BUILT_IN_CHARACTER_AURAS[0]?.id ?? "")
  const [form, setForm] = useState<AuraFormState>(EMPTY_FORM)
  const [characterOptions, setCharacterOptions] = useState<string[]>([])
  const [bindings, setBindings] = useState<CharacterAuraBinding[]>([])
  const [isGeneratingCustomAura, setIsGeneratingCustomAura] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<CharacterAuraGenerationProgress | null>(null)
  const [message, setMessage] = useState("")
  const [soulTab, setSoulTab] = useState<"project" | "character">("project")
  const effectiveSection = hideSidebar ? storedSelectedSoulSection : section
  const effectiveSelectedId = hideSidebar ? (storedSelectedSoulId ?? "") : selectedId

  const builtInAuras = useMemo(() => auras.filter((aura) => aura.builtIn), [auras])
  const customAuras = useMemo(() => auras.filter((aura) => !aura.builtIn), [auras])
  const visibleAuras = effectiveSection === "builtIn" ? builtInAuras : customAuras
  const selected = useMemo(
    () => {
      if (effectiveSelectedId === "new-custom-soul") return null
      return visibleAuras.find((aura) => aura.id === effectiveSelectedId) ?? visibleAuras[0] ?? null
    },
    [visibleAuras, effectiveSelectedId],
  )
  const selectedBindings = useMemo(
    () => bindings.filter((binding) => binding.auraId === selected?.id),
    [bindings, selected?.id],
  )

  function updateSelectedId(nextId: string) {
    if (hideSidebar) {
      setStoredSelectedSoulId(nextId)
      return
    }
    setSelectedId(nextId)
  }

  function updateSection(nextSection: "builtIn" | "custom") {
    if (hideSidebar) {
      setStoredSelectedSoulSection(nextSection)
      return
    }
    setSection(nextSection)
  }

  useEffect(() => {
    if (!project) return
    void runAction(refresh, "角色灵魂加载失败，请稍后重试")
  }, [project?.path])

  useEffect(() => {
    if (!selected || selected.builtIn || mode !== "edit" || !showCustomEditor) return
    setForm(formFromAura(selected))
  }, [selected?.id, mode, showCustomEditor])

  useEffect(() => {
    if (!hideSidebar) return
    if (storedSelectedSoulSection === "custom" && storedSelectedSoulId === "new-custom-soul") {
      setMode("create")
      setForm(EMPTY_FORM)
      setShowCustomEditor(true)
      return
    }
    setShowCustomEditor(false)
  }, [hideSidebar, storedSelectedSoulId, storedSelectedSoulSection])

  async function refresh() {
    if (!project) return
    const [loaded, loadedCharacters, loadedBindings] = await Promise.all([
      listCharacterAuras(project.path),
      listBindableNovelCharacters(project.path),
      getCharacterAuraBindings(project.path),
    ])
    setAuras(loaded)
    setCharacterOptions(loadedCharacters)
    setBindings(loadedBindings)
    setSelectedId((current) => {
      const currentSelectedId = hideSidebar ? (storedSelectedSoulId ?? "") : current
      // 正在新建自定义灵魂时保留哨兵选中值，否则会被回退值覆盖，导致新建表单被立即关闭。
      if (currentSelectedId === "new-custom-soul") return current
      if (loaded.some((aura) => aura.id === currentSelectedId)) {
        return currentSelectedId
      }
      const fallback = effectiveSection === "custom"
        ? loaded.find((aura) => !aura.builtIn)?.id
        : loaded.find((aura) => aura.builtIn)?.id
      const nextId = fallback ?? loaded[0]?.id ?? ""
      if (hideSidebar) {
        setStoredSelectedSoulId(nextId)
      }
      return nextId
    })
  }

  async function runAction(action: () => Promise<void>, fallbackMessage: string) {
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : fallbackMessage)
    }
  }

  function blockWhileGenerating(nextMessage?: string): boolean {
    if (!isGeneratingCustomAura) return false
    const progressLabel = generationProgress
      ? `当前正在执行「${generationProgress.stage}」(${generationProgress.step}/${generationProgress.total})`
      : "当前正在生成角色灵魂"
    setMessage(nextMessage ?? `${progressLabel}，请等待完成后再切换或操作其他灵魂。`)
    return true
  }

  async function handleCreate() {
    if (!project || !form.name.trim() || blockWhileGenerating()) return
    setIsGeneratingCustomAura(true)
    setGenerationProgress(null)
    setMessage("正在启动角色灵魂工作流，请稍候。")
    try {
      const created = await createCustomCharacterAuraSkill(project.path, {
        name: form.name.trim(),
        category: form.category.trim(),
        corpus: form.corpus.trim(),
        sourceUrls: form.sourceUrls.trim(),
        localDocumentPaths: form.localDocumentPaths.trim(),
        generationPrompt: form.generationPrompt.trim(),
        enableWebSearch: form.enableWebSearch,
      }, {
        onProgress: (progress) => {
          setGenerationProgress(progress)
          setMessage(`${progress.stage}（${progress.step}/${progress.total}）：${progress.detail}`)
        },
      })
      await refresh()
      updateSection("custom")
      setMode("edit")
      setShowCustomEditor(false)
      updateSelectedId(created.id)
      await refreshProjectState(project.path)
      setMessage("自定义灵魂已按 6 步工作流生成并保存到当前小说项目")
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : "自定义灵魂生成失败，请检查项目文件权限后重试")
    } finally {
      setIsGeneratingCustomAura(false)
      setGenerationProgress(null)
    }
  }

  async function handleUpdate() {
    if (!project || !selected || selected.builtIn || !form.name.trim() || blockWhileGenerating()) return
    await runAction(async () => {
      const updated = await updateCustomCharacterAura(project.path, selected.id, buildUpdatePayload(form))
      await refresh()
      updateSelectedId(updated.id)
      setShowCustomEditor(false)
      await refreshProjectState(project.path)
      setMessage("自定义灵魂已更新")
    }, "自定义灵魂更新失败，请检查项目文件权限后重试")
  }

  async function handleDelete(targetAura?: CharacterAura) {
    const aura = targetAura ?? selected
    if (!project || !aura || aura.builtIn || blockWhileGenerating()) return
    if (!window.confirm(`删除「${aura.name}」这个自定义灵魂？删除后会同时移除相关绑定关系。`)) return
    await runAction(async () => {
      await deleteCustomCharacterAura(project.path, aura.id)
      setForm(EMPTY_FORM)
      setMode("create")
      setShowCustomEditor(false)
      await refresh()
      await refreshProjectState(project.path)
      setMessage("自定义灵魂已删除")
    }, "自定义灵魂删除失败，请检查项目文件权限后重试")
  }

  async function handleBindCharacter(nextCharacterName: string) {
    if (!project || !selected || !nextCharacterName.trim() || blockWhileGenerating("角色灵魂生成完成后再绑定人物，避免把半成品绑定进剧情。")) return
    if (selectedBindings.some((binding) => binding.characterName === nextCharacterName)) return
    await runAction(async () => {
      await bindCharacterAura(project.path, {
        characterName: nextCharacterName.trim(),
        auraId: selected.id,
      })
      await refresh()
      bumpDataVersion()
      setMessage(`已将「${selected.name}」绑定到人物「${nextCharacterName.trim()}」`)
    }, "绑定失败，请稍后重试")
  }

  async function handleUnbind(targetCharacterName: string) {
    if (!project || !selected || blockWhileGenerating()) return
    await runAction(async () => {
      await unbindCharacterAura(project.path, targetCharacterName, selected.id)
      await refresh()
      bumpDataVersion()
      setMessage(`已取消“${targetCharacterName}”与“${selected.name}”的绑定`)
    }, "取消绑定失败，请稍后重试")
  }

  function handleSelectBuiltInSection() {
    if (blockWhileGenerating()) return
    updateSection("builtIn")
    setShowCustomEditor(false)
    if (!selected?.builtIn && builtInAuras[0]) {
      updateSelectedId(builtInAuras[0].id)
    }
  }

  function handleSelectCustomSection() {
    if (blockWhileGenerating()) return
    updateSection("custom")
    setShowCustomEditor(false)
    if ((selected?.builtIn ?? true) && customAuras[0]) {
      updateSelectedId(customAuras[0].id)
    }
  }

  function handleStartCreatingCustomAura() {
    if (blockWhileGenerating()) return
    updateSection("custom")
    setMode("create")
    setForm(EMPTY_FORM)
    setShowCustomEditor(true)
  }

  function handleStartEditingCustomAura() {
    if (!selected || selected.builtIn || blockWhileGenerating()) return
    setForm(formFromAura(selected))
    setMode("edit")
    setShowCustomEditor(true)
  }

  return (
    <div data-ui="soul-role-content" className="flex flex-col h-full">
      {!hideSidebar && (
      <div className="flex border-b shrink-0">
        <button
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            soulTab === "project"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setSoulTab("project")}
        >
          {t("novel.soul.projectSoul")}
        </button>
        <button
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            soulTab === "character"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setSoulTab("character")}
        >
          {t("novel.soul.characterSoul")}
        </button>
      </div>
      )}

      {soulTab === "project" && !hideSidebar ? (
        <SoulDocEditor />
      ) : (
        <div className="min-h-0 flex-1 flex overflow-hidden">
      {!hideSidebar && (
      <aside className="flex w-72 shrink-0 flex-col border-r bg-muted/30">
        <div className="border-b p-4">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-primary" />
            角色灵魂
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            角色灵魂必须绑定到已有小说人物；建议先在大纲中写清人物小传、性格、动机和关系，再绑定灵魂。
          </p>
        </div>

        <div className="flex border-b text-sm">
          <button
            type="button"
            onClick={handleSelectBuiltInSection}
            disabled={isGeneratingCustomAura}
            className={`flex-1 px-3 py-2 ${section === "builtIn" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"} ${isGeneratingCustomAura ? "cursor-not-allowed opacity-60" : ""}`}
          >
            内置灵魂
          </button>
          <button
            type="button"
            onClick={handleSelectCustomSection}
            disabled={isGeneratingCustomAura}
            className={`flex-1 px-3 py-2 ${section === "custom" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"} ${isGeneratingCustomAura ? "cursor-not-allowed opacity-60" : ""}`}
          >
            自定义灵魂
          </button>
        </div>

          {effectiveSection === "custom" && (
          <div className="border-b p-2">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={handleStartCreatingCustomAura}
              disabled={isGeneratingCustomAura}
            >
              <Plus className="mr-2 h-4 w-4" />
              新建角色灵魂
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visibleAuras.map((aura) => (
            <button
              key={aura.id}
              type="button"
              disabled={isGeneratingCustomAura}
              onClick={() => {
                if (blockWhileGenerating()) return
                updateSelectedId(aura.id)
                if (!aura.builtIn) setShowCustomEditor(false)
              }}
              className={`mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${selected?.id === aura.id ? "qm-selected" : "text-muted-foreground qm-hover"} ${isGeneratingCustomAura ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <div className="font-medium">{aura.name}</div>
              <div className="mt-1 text-xs opacity-80">{aura.category ?? "自定义灵魂"}</div>
              <div className="mt-1 line-clamp-2 text-xs opacity-80">{aura.styleDescription}</div>
            </button>
          ))}

          {effectiveSection === "custom" && visibleAuras.length === 0 && (
            <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
              <div>暂无自定义灵魂</div>
              <div className="mt-2 text-xs">点击上方“新建角色灵魂”后，再填写资料并生成。</div>
            </div>
          )}
        </div>
      </aside>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {message && <div role="status" className="text-sm text-muted-foreground">{message}</div>}

          {effectiveSection === "custom" ? (
            showCustomEditor ? (
              <CustomAuraForm
                form={form}
                setForm={setForm}
                onCreate={handleCreate}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onCancel={() => setShowCustomEditor(false)}
                mode={mode}
                editing={Boolean(selected && !selected.builtIn)}
                isGenerating={isGeneratingCustomAura}
                generationProgress={generationProgress}
              />
            ) : selected ? (
              <AuraDetails
                aura={selected}
                badgeLabel="自定义灵魂"
                onEdit={!selected.builtIn ? handleStartEditingCustomAura : undefined}
                onDelete={!selected.builtIn ? () => void handleDelete(selected) : undefined}
                actionsDisabled={isGeneratingCustomAura}
                characterOptions={characterOptions}
                bindings={selectedBindings}
                onBind={handleBindCharacter}
                onUnbind={handleUnbind}
              />
            ) : (
              <div className="rounded-lg border border-dashed bg-card p-6 text-sm text-muted-foreground">
                还没有自定义灵魂。点击左侧上方“新建角色灵魂”后，就可以生成并保存到当前小说项目。
              </div>
            )
          ) : selected && selected.builtIn ? (
            <AuraDetails
              aura={selected}
              badgeLabel="内置灵魂"
              actionsDisabled={isGeneratingCustomAura}
              characterOptions={characterOptions}
              bindings={selectedBindings}
              onBind={handleBindCharacter}
              onUnbind={handleUnbind}
            />
          ) : null}
        </div>
      </main>
        </div>
      )}
    </div>
  )
}

function AuraDetails({
  aura,
  badgeLabel,
  onEdit,
  onDelete,
  actionsDisabled = false,
  characterOptions,
  bindings,
  onBind,
  onUnbind,
}: {
  aura: CharacterAura
  badgeLabel: string
  onEdit?: () => void
  onDelete?: () => void
  actionsDisabled?: boolean
  characterOptions: string[]
  bindings: CharacterAuraBinding[]
  onBind: (characterName: string) => void
  onUnbind: (characterName: string) => void
}) {
  const project = useWikiStore((s) => s.project)
  const [skillDocument, setSkillDocument] = useState("")
  const [skillLoading, setSkillLoading] = useState(false)
  const [skillError, setSkillError] = useState("")
  const [researchFile, setResearchFile] = useState<CharacterAuraResearchFileName>("01-writings.md")
  const [researchDocument, setResearchDocument] = useState("")
  const [researchLoading, setResearchLoading] = useState(false)
  const [researchError, setResearchError] = useState("")

  useEffect(() => {
    let cancelled = false
    setSkillDocument("")
    setSkillError("")
    if (!aura.skillFolder) return
    setSkillLoading(true)
    loadCharacterAuraSkillDocument(aura, project?.path)
      .then((document) => {
        if (!cancelled) setSkillDocument(document)
      })
      .catch(() => {
        if (!cancelled) setSkillError(`灵魂文档读取失败：${aura.skillFolder}/SKILL.md`)
      })
      .finally(() => {
        if (!cancelled) setSkillLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [aura.id, aura.skillFolder, project?.path])

  useEffect(() => {
    let cancelled = false
    setResearchDocument("")
    setResearchError("")
    if (!aura.skillFolder) return
    setResearchLoading(true)
    loadCharacterAuraResearchDocument(aura, researchFile, project?.path)
      .then((document) => {
        if (!cancelled) setResearchDocument(document)
      })
      .catch(() => {
        if (!cancelled) setResearchError(`研究文件读取失败：${aura.skillFolder}/references/research/${researchFile}`)
      })
      .finally(() => {
        if (!cancelled) setResearchLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [aura.id, aura.skillFolder, researchFile, project?.path])

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-xl font-semibold">{aura.name}</h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit} disabled={actionsDisabled}>
              <PencilLine className="mr-2 h-4 w-4" />
              编辑灵魂
            </Button>
          )}
          {onDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              disabled={actionsDisabled}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              删除灵魂
            </Button>
          )}
          <CharacterBindingControl
            badgeLabel={badgeLabel}
            options={characterOptions}
            bindings={bindings}
            disabled={actionsDisabled}
            onBind={onBind}
            onUnbind={onUnbind}
          />
        </div>
      </div>

      <Detail label="人物分类" value={aura.category ?? "自定义灵魂"} />
      <Detail label="灵魂文件夹" value={aura.skillFolder ?? "未关联灵魂文件夹"} />
      {!aura.builtIn && (
        <>
          <Detail label="生成提示词" value={aura.generationPrompt ?? ""} />
          <Detail label="AI 搜索" value={aura.webSearchEnabled ? "已开启" : "未开启"} />
        </>
      )}
      <Detail label="气质说明" value={aura.sourceNote} />
      <Detail label="灵魂摘要" value={aura.styleDescription} />
      <Detail label="怎么说话 / 表达特征" value={aura.expressionDna ?? aura.styleDescription} />
      <Detail label="怎么想 / 心智模型" value={aura.mentalModel ?? aura.corpus} />
      <Detail label="怎么判断 / 决策启发式" value={aura.decisionHeuristics ?? aura.behaviorRules} />
      <Detail label="什么不做 / 价值观反模式" value={aura.valueAntiPatterns ?? aura.notes} />
      <Detail label="知道局限 / 诚实边界" value={aura.honestyBoundaries ?? aura.boundaries} />

      <div className="mt-5 rounded-md border bg-muted/20 p-4">
        <div className="mb-2 text-sm font-medium">灵魂文档预览</div>
        {skillLoading && <div className="text-sm text-muted-foreground">正在读取灵魂文档。</div>}
        {skillError && <div className="text-sm text-destructive">{skillError}</div>}
        {!skillLoading && !skillError && skillDocument && <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{skillDocument}</pre>}
        {!skillLoading && !skillError && !skillDocument && <div className="text-sm text-muted-foreground">暂无灵魂文档。</div>}
      </div>

      <div className="mt-5 rounded-md border bg-muted/20 p-4">
        <div className="mb-3 text-sm font-medium">研究文件</div>
        <div className="mb-3 flex flex-wrap gap-2">
          {CHARACTER_AURA_RESEARCH_FILES.map((file) => (
            <button
              key={file.fileName}
              type="button"
              onClick={() => setResearchFile(file.fileName)}
              className={`rounded-md border px-2 py-1 text-xs ${researchFile === file.fileName ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"}`}
            >
              {file.label}
            </button>
          ))}
        </div>
        <div className="mb-2 text-xs text-muted-foreground">{researchFile}</div>
        {researchLoading && <div className="text-sm text-muted-foreground">正在读取研究文件。</div>}
        {researchError && <div className="text-sm text-destructive">{researchError}</div>}
        {!researchLoading && !researchError && researchDocument && <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{researchDocument}</pre>}
        {!researchLoading && !researchError && !researchDocument && <div className="text-sm text-muted-foreground">暂无研究文件。</div>}
      </div>
    </div>
  )
}

function CustomAuraForm({
  form,
  setForm,
  onCreate,
  onUpdate,
  onDelete,
  onCancel,
  mode,
  editing,
  isGenerating,
  generationProgress,
}: {
  form: AuraFormState
  setForm: (form: AuraFormState) => void
  onCreate: () => void
  onUpdate: () => void
  onDelete: () => void
  onCancel: () => void
  mode: "create" | "edit"
  editing: boolean
  isGenerating: boolean
  generationProgress: CharacterAuraGenerationProgress | null
}) {
  const setField = (key: Exclude<keyof AuraFormState, "enableWebSearch" | "portablePersonality">, value: string) => setForm({ ...form, [key]: value })
  const setBooleanField = (key: "enableWebSearch", value: boolean) => setForm({ ...form, [key]: value })

  return (
    <div data-ui="soul-custom-form" className="rounded-lg border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{mode === "edit" ? "编辑角色灵魂" : "新建角色灵魂"}</h2>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isGenerating}>返回预览</Button>
      </div>

      <div data-ui="soul-form-body" className="space-y-5">
        <section>
          <h3 className="mb-3 text-sm font-medium">基础设置</h3>
          <div data-ui="soul-form-basics" className="grid gap-4">
            <Field label="名称" value={form.name} onChange={(value) => setField("name", value)} />
            <Field label="人物分类" value={form.category} onChange={(value) => setField("category", value)} />
          </div>
        </section>

        {!form.portablePersonality && <section>
          <h3 className="mb-2 text-sm font-medium">生成设置</h3>
          <div className="grid gap-4">
            <TextField
              label="生成提示词"
              helper="例如：强调她的权力感、失而复得的克制、对亲密关系的防御性"
              value={form.generationPrompt}
              onChange={(value) => setField("generationPrompt", value)}
            />
            <label data-ui="soul-form-search" className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border"
                checked={form.enableWebSearch}
                onChange={(event) => setBooleanField("enableWebSearch", event.target.checked)}
              />
              <span className="space-y-1">
                <span className="block font-medium">开启 AI 搜索</span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  未配置搜索服务时，仅使用已提供的资料。
                </span>
              </span>
            </label>
          </div>
        </section>}

        {form.portablePersonality ? (
          <section>
            <h3 className="mb-2 text-sm font-medium">可迁移人格规则</h3>
            <div className="grid gap-4">
              <TextField label="人格摘要" value={form.portablePersonality.summary} onChange={(summary) =>
                setForm({ ...form, portablePersonality: { ...form.portablePersonality!, summary } })} />
              {form.portablePersonality.rules.map((rule, index) => (
                <div key={rule.id} className="grid gap-4 border-t pt-4">
                  <h4 className="text-sm font-medium">{rule.id} · 人格规则</h4>
                  {(["condition", "tendency", "boundary"] as const).map((field) => (
                    <TextField key={field}
                      label={`${rule.id} · ${field === "condition" ? "触发条件" : field === "tendency" ? "行为倾向" : "例外与边界"}`}
                      value={rule[field]} onChange={(value) => setForm({
                        ...form, portablePersonality: {
                          ...form.portablePersonality!,
                          rules: form.portablePersonality!.rules.map((item, i) => i === index ? { ...item, [field]: value } : item),
                        },
                      })} />
                  ))}
                </div>
              ))}
            </div>
          </section>
        ) : mode === "edit" ? (
          <>
            <section>
              <h3 className="mb-2 text-sm font-medium">当前灵魂信息</h3>
              <p className="mb-3 text-xs text-muted-foreground">这里编辑当前自定义灵魂已经生成的人物信息，保存后会同步更新预览内容。</p>
              <div className="grid gap-4">
                <TextField label="气质说明" value={form.sourceNote} onChange={(value) => setField("sourceNote", value)} />
                <TextField label="灵魂摘要" value={form.styleDescription} onChange={(value) => setField("styleDescription", value)} />
                <TextField label="怎么说话 / 表达特征" value={form.expressionDna} onChange={(value) => setField("expressionDna", value)} />
                <TextField label="怎么想 / 心智模型" value={form.mentalModel} onChange={(value) => setField("mentalModel", value)} />
                <TextField label="怎么判断 / 决策启发式" value={form.decisionHeuristics} onChange={(value) => setField("decisionHeuristics", value)} />
                <TextField label="什么不做 / 价值观反模式" value={form.valueAntiPatterns} onChange={(value) => setField("valueAntiPatterns", value)} />
                <TextField label="知道局限 / 诚实边界" value={form.honestyBoundaries} onChange={(value) => setField("honestyBoundaries", value)} />
                <TextField label="资料文本 / 来源摘要" value={form.corpus} onChange={(value) => setField("corpus", value)} />
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">资料来源索引</h3>
              <p className="mb-3 text-xs text-muted-foreground">如果你要补充或修正网页资料、本地文档来源，也可以在这里一起维护。</p>
              <div data-ui="soul-form-sources" className="grid gap-4">
                <TextField label="网页资料地址" helper="一行一个网页地址" value={form.sourceUrls} onChange={(value) => setField("sourceUrls", value)} />
                <TextField label="本地文档路径" helper="一行一个本地文档路径" value={form.localDocumentPaths} onChange={(value) => setField("localDocumentPaths", value)} />
              </div>
            </section>
          </>
        ) : (
          <section>
            <h3 className="mb-2 text-sm font-medium">资料导入设置</h3>
            <div className="grid gap-4">
              <TextField label="资料文本" value={form.corpus} onChange={(value) => setField("corpus", value)} />
              <div data-ui="soul-form-sources" className="grid gap-4">
                <TextField label="网页资料地址" helper="一行一个网页地址" value={form.sourceUrls} onChange={(value) => setField("sourceUrls", value)} />
                <TextField label="本地文档路径" helper="一行一个本地文档路径" value={form.localDocumentPaths} onChange={(value) => setField("localDocumentPaths", value)} />
              </div>
            </div>
          </section>
        )}
        {mode === "create" && (
          <section data-ui="soul-form-progress" aria-live="polite">
            <h3 className="mb-2 text-sm font-medium">生成流程预览</h3>
            {generationProgress ? (
              <div>
                <div className="text-sm font-medium">
                  {generationProgress.stage}（{generationProgress.step}/{generationProgress.total}）
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{generationProgress.detail}</div>
                {generationProgress.researchFileName && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    当前研究文件：{generationProgress.researchFileName}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs leading-5 text-muted-foreground">
                公开资料 → 对话方式 → 表达特征 → 外部评价 → 决策记录 → 时间线
              </div>
            )}
          </section>
        )}
      </div>

      <div data-ui="soul-form-actions" className="mt-4 flex gap-2">
        <Button
          onClick={mode === "edit" ? onUpdate : onCreate}
          disabled={!form.name.trim() || (mode === "edit" && !editing) || isGenerating}
        >
          {mode === "edit" ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {mode === "edit"
            ? "保存修改"
            : isGenerating
              ? `正在生成角色灵魂${generationProgress ? `（${generationProgress.step}/${generationProgress.total}）` : ""}`
              : "从资料生成角色灵魂"}
        </Button>
        {mode === "edit" && editing && (
          <Button variant="outline" onClick={onDelete} disabled={isGenerating}>
            <Trash2 className="mr-2 h-4 w-4" />
            删除
          </Button>
        )}
      </div>
    </div>
  )
}

function CharacterBindingControl({
  badgeLabel,
  options,
  bindings,
  disabled,
  onBind,
  onUnbind,
}: {
  badgeLabel: string
  options: string[]
  bindings: CharacterAuraBinding[]
  disabled: boolean
  onBind: (characterName: string) => void
  onUnbind: (characterName: string) => void
}) {
  const [pendingName, setPendingName] = useState("")
  const boundNames = bindings.map((binding) => binding.characterName)
  const pendingBound = pendingName !== "" && boundNames.includes(pendingName)
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <select
        aria-label="绑定小说人物"
        value={pendingName}
        disabled={disabled || options.length === 0}
        onChange={(event) => setPendingName(event.target.value)}
        className="min-w-40 max-w-64 rounded-md border bg-background px-2 py-1 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      >
        <option value="">
          {options.length === 0 ? "请先添加小说人物" : "选择小说人物"}
        </option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        variant={pendingBound ? "outline" : "default"}
        disabled={disabled || !pendingName}
        onClick={() => {
          if (pendingBound) onUnbind(pendingName)
          else onBind(pendingName)
        }}
      >
        {pendingBound ? "取消绑定" : "绑定"}
      </Button>
      <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
        {boundNames.length > 0 ? `已绑定${boundNames.join("、")}` : badgeLabel}
      </span>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-4">
      <div className="text-sm font-semibold text-foreground">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm font-normal leading-6 text-muted-foreground">{value || "未填写"}</div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="mt-1" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function TextField({
  label,
  helper,
  value,
  onChange,
}: {
  label: string
  helper?: string
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {helper && <div id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{helper}</div>}
      <textarea
        id={id}
        aria-describedby={helper ? `${id}-hint` : undefined}
        className="mt-1 min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
