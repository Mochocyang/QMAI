import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { PencilLine, Plus, RotateCcw, Save, Sparkles, Trash2 } from "lucide-react"
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
  listEditedBuiltInAuraIds,
  loadCharacterAuraResearchDocument,
  loadCharacterAuraStore,
  loadCharacterAuraSkillDocument,
  refineBindableCharactersWithLlm,
  unbindCharacterAura,
  updateBuiltInCharacterAura,
  resetBuiltInCharacterAura,
  updateCustomCharacterAura,
  type CharacterAura,
  type CharacterAuraBinding,
  type CharacterAuraGenerationProgress,
  type CharacterAuraResearchFileName,
} from "@/lib/novel/character-aura"
import { SoulDocEditor } from "./soul-doc-editor"
import { refreshProjectState } from "@/lib/project-refresh"
import { filterBindableCharacters, readBindableIgnoreList } from "@/lib/novel/bindable-characters-filter"
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
  /** 台词与画面在表单里用「每行一条」的纯文本维护，比数组编辑器轻，也方便粘贴。 */
  signatureLinesText: string
  signatureScenesText: string
  sourceUrls: string
  localDocumentPaths: string
  generationPrompt: string
  enableWebSearch: boolean
}

const EMPTY_FORM: AuraFormState = {
  signatureLinesText: "",
  signatureScenesText: "",
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

/** 把「每行一条」的文本拆成数组：去掉空行与首尾空白，顺手清掉用户可能带进来的引号。 */
function splitSignatureLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[「『"]+|[」』"]+$/g, "").trim())
    .filter((line) => line.length > 0)
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
    signatureLinesText: (aura.signatureLines ?? []).join("\n"),
    signatureScenesText: (aura.signatureScenes ?? []).join("\n"),
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

/** 本地/缓存名单在前、后台精修发现的新名字在后，trim 后保序去重。 */
function mergeCharacterOptions(current: readonly string[], incoming: readonly string[]): string[] {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const raw of [...current, ...incoming]) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    merged.push(name)
  }
  return merged
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
  // 原始名单（本地/缓存 + 后台精修并集），展示前再过一遍忽略规则。
  const [rawCharacterOptions, setRawCharacterOptions] = useState<string[]>([])
  const [characterIgnoreList, setCharacterIgnoreList] = useState<string[]>([])
  const [characterOptionsLoading, setCharacterOptionsLoading] = useState(false)
  const [bindings, setBindings] = useState<CharacterAuraBinding[]>([])
  const [isGeneratingCustomAura, setIsGeneratingCustomAura] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<CharacterAuraGenerationProgress | null>(null)
  const [message, setMessage] = useState("")
  /**
   * 被用户改过的内置灵魂 id 集合。
   *
   * 为什么单独存而不从 `auras` 里推断：出厂内容与改后内容可能长得一样（用户改完又改回去），
   * 只看内容判断不出「有没有改动记录」。「恢复默认」按钮的可用状态依赖这个集合。
   */
  const [editedBuiltInIds, setEditedBuiltInIds] = useState<Set<string>>(new Set())
  const [builtInForm, setBuiltInForm] = useState<AuraFormState>(EMPTY_FORM)
  const [builtInEditing, setBuiltInEditing] = useState(false)
  const [resetCandidate, setResetCandidate] = useState<CharacterAura | null>(null)
  const [soulTab, setSoulTab] = useState<"project" | "character">("project")
  // 同一项目同一时间只允许一条后台精修在飞，避免重复请求模型。
  const refiningProjectsRef = useRef<Set<string>>(new Set())
  // 加载提示只跟「最新一次快线请求」对齐：旧项目的迟到请求不许提前关掉它。
  const characterOptionsRequestRef = useRef(0)
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
  // 已经绑定过灵魂的名字是安全阀：命中忽略表或内置噪声规则也绝不能从下拉框消失。
  const boundCharacterNames = useMemo(
    () => bindings.map((binding) => binding.characterName),
    [bindings],
  )
  const characterOptions = useMemo(
    () => filterBindableCharacters(rawCharacterOptions, characterIgnoreList, boundCharacterNames),
    [rawCharacterOptions, characterIgnoreList, boundCharacterNames],
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
    // 与详情页文档加载同一套约定：卸载或切换项目后，迟到的本地/精修结果一律丢弃。
    const cancellation = { cancelled: false }
    void runAction(() => refresh(() => cancellation.cancelled), "角色灵魂加载失败，请稍后重试")
    return () => {
      cancellation.cancelled = true
    }
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

  // 三条互不依赖的加载线：人物列表需要扫描小说资料，可能非常慢，
  // 绝不能把灵魂列表和绑定关系的渲染挂在同一次 await 上。
  async function refreshAuras(path: string) {
    await runAction(async () => {
      const loaded = await listCharacterAuras(path)
      setAuras(loaded)
      // 覆盖层里出现过的内置 id 就是「用户改过」；恢复默认后这里会同步收窄。
      const store = await loadCharacterAuraStore(path)
      setEditedBuiltInIds(new Set(listEditedBuiltInAuraIds(store)))
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
    }, "角色灵魂加载失败，请稍后重试")
  }

  async function refreshBindings(path: string) {
    await runAction(async () => {
      setBindings(await getCharacterAuraBindings(path))
    }, "角色灵魂绑定关系读取失败，请稍后重试")
  }

  async function refreshCharacterOptions(path: string, isCancelled: () => boolean) {
    const requestId = characterOptionsRequestRef.current + 1
    characterOptionsRequestRef.current = requestId
    setCharacterOptionsLoading(true)
    let localListLoaded = false
    try {
      await runAction(async () => {
        const [names, ignoreList] = await Promise.all([
          listBindableNovelCharacters(path),
          readBindableIgnoreList(path),
        ])
        if (isCancelled()) return
        setRawCharacterOptions(names)
        setCharacterIgnoreList(ignoreList)
        localListLoaded = true
      }, "小说人物列表读取失败，请稍后重试")
    } finally {
      if (characterOptionsRequestRef.current === requestId) setCharacterOptionsLoading(false)
    }
    // 本地名单已经可用；精修只在后台补名字，绝不 await，也绝不拖住加载提示。
    if (localListLoaded && !isCancelled()) {
      void refineCharacterOptions(path, isCancelled)
    }
  }

  async function refineCharacterOptions(path: string, isCancelled: () => boolean) {
    if (refiningProjectsRef.current.has(path)) return
    refiningProjectsRef.current.add(path)
    try {
      const refined = await refineBindableCharactersWithLlm(path)
      if (isCancelled() || refined.length === 0) return
      setRawCharacterOptions((current) => mergeCharacterOptions(current, refined))
    } catch {
      // refineBindableCharactersWithLlm 约定不抛错；这里兜底，失败一律静默。
    } finally {
      refiningProjectsRef.current.delete(path)
    }
  }

  async function refresh(isCancelled: () => boolean = () => false) {
    if (!project) return
    const path = project.path
    // 人物列表只服务“绑定小说人物”控件，故意不参与下面的 await：扫描再慢，灵魂列表也会先渲染出来。
    void refreshCharacterOptions(path, isCancelled)
    await Promise.all([refreshAuras(path), refreshBindings(path)])
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
  /** 进入内置灵魂的编辑抽屉。内置灵魂不进 customAuras，所以单独一套表单状态。 */
  function handleStartEditingBuiltIn() {
    if (!selected || !selected.builtIn || blockWhileGenerating()) return
    setBuiltInForm(formFromAura(selected))
    setBuiltInEditing(true)
  }

  async function handleSaveBuiltIn() {
    const project = useWikiStore.getState().project
    if (!project || !selected || !selected.builtIn || blockWhileGenerating()) return
    if (!builtInForm.name.trim()) {
      setMessage("灵魂名称不能为空")
      return
    }
    const targetId = selected.id
    const patch = {
      name: builtInForm.name,
      category: builtInForm.category,
      sourceNote: builtInForm.sourceNote,
      styleDescription: builtInForm.styleDescription,
      expressionDna: builtInForm.expressionDna,
      mentalModel: builtInForm.mentalModel,
      decisionHeuristics: builtInForm.decisionHeuristics,
      valueAntiPatterns: builtInForm.valueAntiPatterns,
      honestyBoundaries: builtInForm.honestyBoundaries,
      signatureLines: splitSignatureLines(builtInForm.signatureLinesText),
      signatureScenes: splitSignatureLines(builtInForm.signatureScenesText),
    }
    await runAction(async () => {
      await updateBuiltInCharacterAura(project.path, targetId, patch)
      setAuras(await listCharacterAuras(project.path))
      const store = await loadCharacterAuraStore(project.path)
      setEditedBuiltInIds(new Set(listEditedBuiltInAuraIds(store)))
      setBuiltInEditing(false)
      setMessage("已保存修改。内置灵魂的原始定义仍保留，可随时恢复默认。")
    }, "保存内置灵魂修改失败，请稍后重试")
  }

  async function handleConfirmReset() {
    const project = useWikiStore.getState().project
    const target = resetCandidate
    if (!project || !target) return
    await runAction(async () => {
      await resetBuiltInCharacterAura(project.path, target.id)
      setAuras(await listCharacterAuras(project.path))
      const store = await loadCharacterAuraStore(project.path)
      setEditedBuiltInIds(new Set(listEditedBuiltInAuraIds(store)))
      setResetCandidate(null)
      setBuiltInEditing(false)
      setMessage(`已把「${target.name}」恢复为默认状态。`)
    }, "恢复默认失败，请稍后重试")
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
              新建灵魂
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
              <div className="mt-2 text-xs">点击上方“新建灵魂”后，再填写资料并生成。</div>
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
                characterOptionsLoading={characterOptionsLoading}
                bindings={selectedBindings}
                onBind={handleBindCharacter}
                onUnbind={handleUnbind}
              />
            ) : (
              <div className="rounded-lg border border-dashed bg-card p-6 text-sm text-muted-foreground">
                还没有自定义灵魂。点击左侧上方“新建灵魂”后，就可以生成并保存到当前小说项目。
              </div>
            )
          ) : selected && selected.builtIn ? (
            <>
              <AuraDetails
                aura={selected}
                badgeLabel="内置灵魂"
                edited={editedBuiltInIds.has(selected.id)}
                onEdit={blockWhileGenerating() ? undefined : () => void handleStartEditingBuiltIn()}
                onReset={editedBuiltInIds.has(selected.id) ? () => setResetCandidate(selected) : undefined}
                actionsDisabled={isGeneratingCustomAura}
                characterOptions={characterOptions}
                characterOptionsLoading={characterOptionsLoading}
                bindings={selectedBindings}
                onBind={handleBindCharacter}
                onUnbind={handleUnbind}
              />
              {builtInEditing && (
                <BuiltInAuraEditDrawer
                  aura={selected}
                  form={builtInForm}
                  setForm={setBuiltInForm}
                  saving={isGeneratingCustomAura}
                  onCancel={() => setBuiltInEditing(false)}
                  onSave={() => void handleSaveBuiltIn()}
                  onReset={() => setResetCandidate(selected)}
                />
              )}
            </>
          ) : null}
        </div>
      </main>
        </div>
      )}

      {resetCandidate && (
        <ResetBuiltInAuraDialog
          aura={resetCandidate}
          onCancel={() => setResetCandidate(null)}
          onConfirm={() => void handleConfirmReset()}
        />
      )}
    </div>
  )
}

function AuraDetails({
  aura,
  badgeLabel,
  edited = false,
  onEdit,
  onReset,
  onDelete,
  actionsDisabled = false,
  characterOptions,
  characterOptionsLoading = false,
  bindings,
  onBind,
  onUnbind,
}: {
  aura: CharacterAura
  badgeLabel: string
  /** 内置灵魂是否被用户改过（由覆盖层决定）；只有改过才允许「恢复默认」。 */
  edited?: boolean
  onEdit?: () => void
  onReset?: () => void
  onDelete?: () => void
  actionsDisabled?: boolean
  characterOptions: string[]
  characterOptionsLoading?: boolean
  bindings: CharacterAuraBinding[]
  onBind: (characterName: string) => void
  onUnbind: (characterName: string) => void
}) {
  const project = useWikiStore((s) => s.project)
  /**
   * 台词与画面：优先用结构化字段；老数据没有这两个字段时，退回到 corpus 里的关键词，
   * 至少不让面板空成一片（用户看到的会是提炼语而不是假台词，比编一句假对白诚实）。
   */
  const signatureLines = useMemo(() => {
    const lines = (aura.signatureLines ?? []).filter((line) => line.trim().length > 0)
    if (lines.length > 0) return lines
    const fallback = (aura.corpus ?? "").split(/[、；;]/).map((part) => part.trim()).filter(Boolean)
    return fallback.length > 0 ? [fallback[0]] : []
  }, [aura.signatureLines, aura.corpus])
  const signatureScenes = useMemo(
    () => (aura.signatureScenes ?? []).filter((scene) => scene.trim().length > 0),
    [aura.signatureScenes],
  )

  const [libraryOpen, setLibraryOpen] = useState(false)
  const [skillDocument, setSkillDocument] = useState("")
  const [skillLoading, setSkillLoading] = useState(false)
  const [skillError, setSkillError] = useState("")
  const [researchFile, setResearchFile] = useState<CharacterAuraResearchFileName | null>(null)
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
    // 资料库收起、或停在「全文概览」时，不必去读研究文件。
    if (!aura.skillFolder || !libraryOpen || researchFile === null) return
    setResearchLoading(true)
    loadCharacterAuraResearchDocument(aura, researchFile, project?.path)
      .then((document) => {
        if (!cancelled) setResearchDocument(document)
      })
      .catch(() => {
        if (!cancelled) setResearchError(`研究文件读取失败：${researchFile}`)
      })
      .finally(() => {
        if (!cancelled) setResearchLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [aura.id, aura.skillFolder, libraryOpen, researchFile, project?.path])

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-semibold text-primary">
            {aura.name.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-xl font-semibold">{aura.name}</h2>
              {edited && (
                <span data-ui="soul-edited-badge" className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                  已修改
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {aura.category ?? "自定义灵魂"}
              {aura.builtIn ? " · 内置灵魂" : " · 自定义灵魂"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit} disabled={actionsDisabled}>
              <PencilLine className="mr-2 h-4 w-4" />
              编辑
            </Button>
          )}
          {onReset && (
            <Button variant="outline" size="sm" onClick={onReset} disabled={actionsDisabled || !edited}>
              <RotateCcw className="mr-2 h-4 w-4" />
              恢复默认
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
            optionsLoading={characterOptionsLoading}
            bindings={bindings}
            disabled={actionsDisabled}
            onBind={onBind}
            onUnbind={onUnbind}
          />
        </div>
      </div>

      <div data-ui="soul-signature-quote" className="mt-4 rounded-r-lg border-l-[3px] border-primary bg-primary/5 px-4 py-3">
        <div className="mb-2 text-[11px] tracking-widest text-primary/80">标志性台词</div>
        {signatureLines.length > 0 ? (
          <div className="space-y-1.5">
            {signatureLines.map((line, index) => (
              <div key={index} className="text-[15px] leading-7 text-foreground">
                「{line}」
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">尚未设置标志性台词。</div>
        )}
      </div>

      <div data-ui="soul-signature-scenes" className="mt-3 rounded-lg border bg-muted/20 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] tracking-widest text-muted-foreground">标志性动作</div>
          {signatureScenes.length > 0 && <div className="text-[11px] text-muted-foreground">{signatureScenes.length} 条</div>}
        </div>
        {signatureScenes.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2">
            {signatureScenes.map((scene, index) => (
              <div key={index} className="rounded-md border-l-2 border-primary/40 bg-background px-3 py-2 text-[13px] leading-6 text-muted-foreground">
                {scene}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">尚未设置标志性动作。</div>
        )}
      </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <AuraCapabilityCard title="怎么说话" icon="说" text={aura.expressionDna ?? aura.styleDescription} />
          <AuraCapabilityCard title="怎么想" icon="想" text={aura.mentalModel ?? aura.corpus} />
          <AuraCapabilityCard title="怎么判断" icon="判" text={aura.decisionHeuristics ?? aura.behaviorRules} />
          <AuraCapabilityCard title="什么不做" icon="避" text={aura.valueAntiPatterns ?? aura.notes} />
        </div>

        <div data-ui="soul-doc-library" className="mt-4 overflow-hidden rounded-lg border">
          <button
            type="button"
            onClick={() => setLibraryOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 bg-muted/50 px-4 py-3 text-left text-sm font-medium hover:bg-muted"
          >
            <span className="flex items-center gap-2">
              资料库
              <span className="text-xs font-normal text-muted-foreground">灵魂文档 + 6 份研究文件</span>
            </span>
            <span className="text-xs text-muted-foreground">{libraryOpen ? "收起 ▴" : "展开 ▾"}</span>
          </button>
          {libraryOpen && (
            <div className="grid md:grid-cols-[170px_1fr]">
              <div className="border-b bg-muted/20 py-2 md:border-b-0 md:border-r">
                <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">灵魂文档</div>
                <button
                  type="button"
                  onClick={() => setResearchFile(null)}
                  className={`block w-full border-l-2 px-4 py-2 text-left text-xs ${researchFile === null ? "border-primary bg-primary/5 font-medium text-primary" : "border-transparent text-muted-foreground hover:bg-accent"}`}
                >
                  全文概览
                </button>
                <div className="px-4 py-1 pt-3 text-[10px] uppercase tracking-wider text-muted-foreground">研究文件</div>
                {CHARACTER_AURA_RESEARCH_FILES.map((file) => (
                  <button
                    key={file.fileName}
                    type="button"
                    onClick={() => setResearchFile(file.fileName)}
                    className={`block w-full border-l-2 px-4 py-2 text-left text-xs ${researchFile === file.fileName ? "border-primary bg-primary/5 font-medium text-primary" : "border-transparent text-muted-foreground hover:bg-accent"}`}
                  >
                    {file.label}
                  </button>
                ))}
              </div>
              <div className="min-h-[210px] p-4">
                {researchFile === null ? (
                  <>
                    {skillLoading && <div className="text-sm text-muted-foreground">正在读取灵魂文档。</div>}
                    {skillError && <div className="text-sm text-destructive">{skillError}</div>}
                    {!skillLoading && !skillError && skillDocument && <AuraDocumentView markdown={skillDocument} />}
                    {!skillLoading && !skillError && !skillDocument && <div className="text-sm text-muted-foreground">暂无灵魂文档。</div>}
                  </>
                ) : (
                  <>
                    {researchLoading && <div className="text-sm text-muted-foreground">正在读取研究文件。</div>}
                    {researchError && <div className="text-sm text-destructive">{researchError}</div>}
                    {!researchLoading && !researchError && researchDocument && <AuraDocumentView markdown={researchDocument} />}
                    {!researchLoading && !researchError && !researchDocument && <div className="text-sm text-muted-foreground">暂无研究文件。</div>}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-dashed pt-3 text-xs text-muted-foreground">
          知道局限：{aura.honestyBoundaries ?? aura.boundaries}
        </div>
      </div>
    )
  }

  /** 详情页的一张能力卡。长文默认折到三行，点一下展开，避免一屏被文字淹掉。 */
  /**
   * 内置灵魂的编辑抽屉。
   *
   * 为什么是抽屉而不是另开一页：改的时候用户需要对照上面那份成品效果（口头禅、能力卡、画面），
   * 跳页就看不到了。抽屉只暴露台词、位置与四个能力字段，其余（id、文件夹、来源）不给改。
   */
  function BuiltInAuraEditDrawer({
    aura,
    form,
    setForm,
    saving,
    onCancel,
    onSave,
    onReset,
  }: {
    aura: CharacterAura
    form: AuraFormState
    setForm: (form: AuraFormState) => void
    saving: boolean
    onCancel: () => void
    onSave: () => void
    onReset: () => void
  }) {
    const setField = (key: keyof AuraFormState, value: string) => setForm({ ...form, [key]: value })
    const fields: Array<{ key: keyof AuraFormState; label: string; rows: number; hint?: string }> = [
      { key: "name", label: "灵魂名称", rows: 0 },
      { key: "category", label: "人物分类", rows: 0 },
      { key: "signatureLinesText", label: "标志性台词", rows: 3, hint: "每行一条，不用加引号" },
      { key: "signatureScenesText", label: "标志性动作", rows: 4, hint: "每行一个画面" },
      { key: "expressionDna", label: "怎么说话", rows: 3, hint: "语气、句长、口头禅、禁忌" },
      { key: "mentalModel", label: "怎么想", rows: 3, hint: "这个角色判断事情的底层依据" },
      { key: "decisionHeuristics", label: "怎么判断", rows: 3, hint: "面对局面时的具体动作" },
      { key: "valueAntiPatterns", label: "什么不做", rows: 3, hint: "写这个角色时不能犯的错" },
      { key: "honestyBoundaries", label: "知道局限", rows: 2 },
    ]
    return (
      <div data-ui="soul-builtin-edit-drawer" className="mt-6 overflow-hidden rounded-lg border border-blue-200">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
            <PencilLine className="h-4 w-4" />
            修改内容
            <span className="text-xs font-normal text-blue-600/80">只改这个项目里的副本，原始定义不会丢</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onReset} disabled={saving}>
              <RotateCcw className="mr-2 h-4 w-4" />
              恢复默认
            </Button>
            <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
              取消
            </Button>
            <Button size="sm" onClick={onSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              保存
            </Button>
          </div>
        </div>
        <div className="divide-y">
          {fields.map((field) => (
            <div key={field.key} className="grid gap-2 px-4 py-3 md:grid-cols-[120px_1fr] md:items-start">
              <div className="pt-1 text-xs text-muted-foreground">
                {field.label}
                {field.hint && <span className="mt-0.5 block text-[11px] opacity-70">{field.hint}</span>}
              </div>
              <div>
                {field.rows === 0 ? (
                  <Input
                    value={String(form[field.key] ?? "")}
                    onChange={(event) => setField(field.key, event.target.value)}
                    disabled={saving}
                  />
                ) : (
                  <textarea
                    value={String(form[field.key] ?? "")}
                    onChange={(event) => setField(field.key, event.target.value)}
                    rows={field.rows}
                    disabled={saving}
                    className="w-full resize-y rounded-md border bg-background px-3 py-2 text-[13px] leading-6 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:opacity-60"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          恢复默认会清空你对「{aura.name}」做过的所有修改，回到软件出厂时的内容。已绑定的人物关系不受影响。
        </div>
      </div>
    )
  }

  /** 恢复默认的确认弹窗。破坏性操作不弹确认，用户会误点。 */
  function ResetBuiltInAuraDialog({ aura, onCancel, onConfirm }: { aura: CharacterAura; onCancel: () => void; onConfirm: () => void }) {
    return (
      <div
        data-ui="soul-reset-dialog"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) onCancel()
        }}
      >
        <div className="w-full max-w-md overflow-hidden rounded-xl bg-background shadow-2xl">
          <div className="px-5 pt-5">
            <h3 className="text-base font-semibold">恢复为默认状态？</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              你将丢失对「{aura.name}」做过的所有修改，恢复到软件出厂时的内容。此操作不可撤销。
            </p>
            <div className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              会被重置：口头禅、人物分类、怎么说话、怎么想、怎么判断、什么不做、知道局限。
              <div className="mt-1">你为这个灵魂建立的人物绑定不会被删除。</div>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2 border-t px-5 py-3">
            <Button variant="outline" size="sm" onClick={onCancel}>
              取消
            </Button>
            <Button size="sm" variant="destructive" onClick={onConfirm}>
              确认恢复
            </Button>
          </div>
        </div>
      </div>
    )
  }
  function AuraCapabilityCard({ title, icon, text }: { title: string; icon: string; text: string }) {
    const [expanded, setExpanded] = useState(false)
    const content = (text || "").trim()
    return (
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/40"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-[11px] text-primary">{icon}</span>
            {title}
          </span>
          <span className="text-[11px] text-muted-foreground">{expanded ? "收起" : "展开"}</span>
        </div>
        <div className={`text-[13px] leading-6 text-muted-foreground ${expanded ? "" : "line-clamp-3"}`}>
          {content || "暂无内容。"}
        </div>
      </button>
    )
  }

  /**
   * 把 Markdown 渲染成读者能读的正文。
   *
   * 为什么不再用 `<pre>` 原样打印：原来把 `---`、`name:`、`description:` 这些 YAML 头部和 `##` 符号
   * 全显示出来，看起来像开发调试视图，不像成品。这里只认标题、列表、引用三种最常用的语法，
   * 不引入 Markdown 依赖 —— 灵魂文档是我们自己生成的，格式可控。
   */
  function AuraDocumentView({ markdown }: { markdown: string }) {
    const blocks = useMemo(() => parseAuraMarkdown(markdown), [markdown])
    return (
      <div data-ui="soul-doc-rendered" className="space-y-2">
        {blocks.map((block, index) => {
          if (block.type === "quote") {
            return (
              <blockquote key={index} className="border-l-2 border-primary/30 bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
                {block.text}
              </blockquote>
            )
          }
          if (block.type === "heading") {
            return (
              <div key={index} className="pt-1 text-sm font-semibold">
                {block.text}
              </div>
            )
          }
          if (block.type === "subheading") {
            return (
              <div key={index} className="pt-1 text-[13px] font-medium text-primary">
                {block.text}
              </div>
            )
          }
          if (block.type === "list") {
            return (
              <ul key={index} className="list-disc space-y-1 pl-5 text-[13px] leading-6 text-muted-foreground">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            )
          }
          return (
            <p key={index} className="text-[13px] leading-6 text-muted-foreground">
              {block.text}
            </p>
          )
        })}
      </div>
    )
  }

  type AuraDocBlock =
    | { type: "heading"; text: string }
    | { type: "subheading"; text: string }
    | { type: "paragraph"; text: string }
    | { type: "quote"; text: string }
    | { type: "list"; items: string[] }

  /** 极简 Markdown 解析：丢掉 frontmatter，只保留标题、列表、引用和段落。 */
  function parseAuraMarkdown(markdown: string): AuraDocBlock[] {
    const withoutFrontmatter = markdown.replace(/^---[\s\S]*?\n---[ \t]*\n?/, "")
    const blocks: AuraDocBlock[] = []
    let list: string[] = []
    const flushList = () => {
      if (list.length > 0) {
        blocks.push({ type: "list", items: list })
        list = []
      }
    }
    for (const rawLine of withoutFrontmatter.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) {
        flushList()
        continue
      }
      if (line.startsWith("- ")) {
        list.push(line.slice(2).trim())
        continue
      }
      flushList()
      if (line.startsWith("### ")) blocks.push({ type: "subheading", text: line.slice(4).trim() })
      else if (line.startsWith("## ")) blocks.push({ type: "subheading", text: line.slice(3).trim() })
      else if (line.startsWith("# ")) blocks.push({ type: "heading", text: line.slice(2).trim() })
      else if (line.startsWith("> ")) blocks.push({ type: "quote", text: line.slice(2).trim() })
      else if (line.startsWith("|")) continue
      else blocks.push({ type: "paragraph", text: line })
    }
    flushList()
    return blocks
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
        <h2 className="text-xl font-semibold">{mode === "edit" ? "编辑角色灵魂" : "新建灵魂"}</h2>
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
  optionsLoading = false,
  bindings,
  disabled,
  onBind,
  onUnbind,
}: {
  badgeLabel: string
  options: string[]
  optionsLoading?: boolean
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
          {options.length === 0
            ? (optionsLoading ? "正在读取小说人物…" : "请先添加小说人物")
            : "选择小说人物"}
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