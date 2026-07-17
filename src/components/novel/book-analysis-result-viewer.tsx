/**
 * 拆书分析结果查看器（重构版）
 * 显示提取的角色列表和生成的 Skills
 */

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { User, X, Plus, Feather } from "lucide-react"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { useWikiStore } from "@/stores/wiki-store"
import { bindCharacterAura, listBindableNovelCharacters } from "@/lib/novel/character-aura"
import { importBookAnalysisSkillsAsAuras, type ImportedBookAnalysisAura } from "@/lib/novel/book-analysis/aura-adapter"
import { analyzeWritingStyle } from "@/lib/novel/book-analysis/style-extraction-engine"
import { STYLE_DIMENSIONS } from "@/lib/novel/book-analysis/style-prompts"
import { upsertWritingStylePreset, setEnabledWritingStyle, getEnabledWritingStyle } from "@/lib/novel/writing-style-store"
import { joinPath } from "@/lib/path-utils"
import { toast } from "@/lib/toast"
import { refreshProjectState } from "@/lib/project-refresh"
import { resolveDefaultModel } from "@/lib/novel/model-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import type { BookAnalysisResult, BookAnalysisMetadata, ExtractedCharacter, PersonalityProfile } from "@/lib/novel/book-analysis/types"

interface BookAnalysisResultViewerProps {
  projectPath: string
  result?: BookAnalysisResult | null
  onClose: () => void
}

export function BookAnalysisResultViewer({ projectPath, result, onClose }: BookAnalysisResultViewerProps) {
  const [error, setError] = useState<string>("")
  const [selectedCharacter, setSelectedCharacter] = useState<ExtractedCharacter | null>(null)
  const [sortByImportance, setSortByImportance] = useState(true)
  const [addingToSoul, setAddingToSoul] = useState(false)
  // feature/fix-viewer-ui：selectedCharacterIds 改为"选中的角色"id（多选）
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set())
  const [importedAuras, setImportedAuras] = useState<ImportedBookAnalysisAura[]>([])
  const [bindableCharacters, setBindableCharacters] = useState<string[]>([])
  const [selectedAuraId, setSelectedAuraId] = useState("")
  // feature/fix-viewer-ui：多选小说人物
  const [selectedNovelCharacterIds, setSelectedNovelCharacterIds] = useState<Set<string>>(new Set())
  // feature/book-style-extraction：作品文风提取 / 启用
  const [styleExtracting, setStyleExtracting] = useState(false)
  const [styleEnabledSourceBook, setStyleEnabledSourceBook] = useState<string | null>(null)

  const currentProject = useWikiStore((s) => s.project)
  const tasks = useBookAnalysisStore((s) => s.tasks)
  const normalizedProjectPath = projectPath.replace(/\\/g, "/")
  const task = tasks.find((t) => t.projectPath === normalizedProjectPath && t.status === "completed")
  // 关键修复（fix/character-reextract-and-loading-state v2）：
  //   之前 `result ?? (task?.metadata ? {...} : null)` 优先用 result prop（即 currentResult），
  //   但 currentResult 是从磁盘加载的快照，store 中 task.characters 更新时不会同步刷新，
  //   导致"再次提取"后 UI 看不到 personalityProfile 变化。
  //   这里改成：characters / skills 始终从 task 派生（task 是 source of truth），
  //   metadata 优先用 result.metadata（保持旧 UX），其次 task.metadata 兜底。
  const effectiveResult = task
    ? {
        metadata: result?.metadata ?? task.metadata,
        characters: task.characters ?? [],
        skills: task.skills ?? [],
        styleProfile: task.styleProfile ?? result?.styleProfile,
      }
    : result

  useEffect(() => {
    if (effectiveResult) {
      setError("")
    } else {
      setError("未找到分析结果")
    }
  }, [effectiveResult])

  useEffect(() => {
    let cancelled = false
    if (!currentProject?.path) return
    listBindableNovelCharacters(currentProject.path)
      .then((names) => {
        if (cancelled) return
        setBindableCharacters(names)
        // feature/fix-viewer-ui：多选模式下默认勾选第一个（兼容旧 UX）
        setSelectedNovelCharacterIds((current) => {
          if (current.size > 0) return current
          return names.length > 0 ? new Set([names[0]]) : new Set()
        })
      })
      .catch(() => {
        if (!cancelled) setBindableCharacters([])
      })
    return () => {
      cancelled = true
    }
  }, [currentProject?.path])

  // feature/book-style-extraction：加载"当前项目已启用的文风来源书"
  useEffect(() => {
    let cancelled = false
    if (!currentProject?.path) return
    getEnabledWritingStyle(currentProject.path)
      .then((preset) => {
        if (!cancelled) setStyleEnabledSourceBook(preset?.sourceBook ?? null)
      })
      .catch(() => {
        if (!cancelled) setStyleEnabledSourceBook(null)
      })
    return () => {
      cancelled = true
    }
  }, [currentProject?.path])
  const characters = effectiveResult?.characters || []
  const skills = effectiveResult?.skills || []
  // feature/book-style-extraction：当前作品的文风画像 + 是否已启用
  const styleProfile = effectiveResult?.styleProfile
  const bookTitle = effectiveResult?.metadata?.title || "未命名作品"
  const styleEnabled = styleEnabledSourceBook != null && styleEnabledSourceBook === bookTitle
  const sortedCharacters = sortByImportance
    ? [...characters].sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name, "zh-CN"))
    : characters

  // feature/book-style-extraction：提取作品级写作文风
  const handleExtractStyle = async () => {
    if (!currentProject?.path || styleExtracting) return
    const bookId = task?.bookId
    if (!bookId) {
      toast.error("未找到作品标识")
      return
    }
    const storeState = useWikiStore.getState()
    const llmConfig = resolveDefaultModel(storeState.llmConfig)
    if (!hasUsableLlm(llmConfig, storeState.providerConfigs)) {
      toast.error("未配置 LLM，请先在设置中配置")
      return
    }
    const bookPath = joinPath(currentProject.path, "book-analysis", bookId)
    setStyleExtracting(true)
    try {
      const profile = await analyzeWritingStyle(bookPath, llmConfig)
      if (task) useBookAnalysisStore.getState().updateTaskStyleProfile(task.id, profile)
      const cur = useBookAnalysisStore.getState().currentResult
      if (cur) useBookAnalysisStore.getState().setCurrentResult({ ...cur, styleProfile: profile })
      toast.success("已提取作品文风")
    } catch (err) {
      toast.error(`提取文风失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStyleExtracting(false)
    }
  }

  // feature/book-style-extraction：启用 / 取消启用该作品文风
  const handleToggleStyleEnabled = async () => {
    if (!currentProject?.path || !styleProfile) return
    try {
      if (styleEnabled) {
        await setEnabledWritingStyle(currentProject.path, null)
        setStyleEnabledSourceBook(null)
        toast.success("已取消启用该文风")
      } else {
        const preset = await upsertWritingStylePreset(currentProject.path, {
          name: `${bookTitle} · 文风`,
          sourceBook: bookTitle,
          profile: styleProfile,
        })
        await setEnabledWritingStyle(currentProject.path, preset.id)
        setStyleEnabledSourceBook(bookTitle)
        toast.success("已启用该文风，生成时会按此文风写作")
      }
    } catch (err) {
      toast.error(`操作失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleAddSkillsToSoul = async () => {
    if (!currentProject?.path || !effectiveResult) {
      toast.error("未找到当前项目或分析结果")
      return
    }

    // feature/fix-viewer-ui：把"选中的角色"映射到"选中的 skill"
    const selectedSkillIds = skills
      .filter((skill) => selectedCharacterIds.has(skill.characterId))
      .map((skill) => skill.id)
    if (selectedSkillIds.length === 0) {
      toast.info("请先勾选要添加的角色")
      return
    }

    setAddingToSoul(true)

    try {
      const imported = await importBookAnalysisSkillsAsAuras(
        currentProject.path,
        effectiveResult.metadata as BookAnalysisMetadata,
        characters,
        skills,
        selectedSkillIds,
      )
      setImportedAuras((current) => [...current, ...imported])
      setSelectedAuraId((current) => current || imported[0]?.auraId || "")
      setSelectedCharacterIds(new Set())
      await refreshProjectState(currentProject.path)
      toast.success(`已添加 ${imported.length} 个角色 Skill 到自定义灵魂`)
    } catch (err) {
      const errorMsg = err instanceof Error && err.message ? err.message : "未知错误"
      toast.error(`添加失败：${errorMsg}`)
    } finally {
      setAddingToSoul(false)
    }
  }

  const handleSelectAllSkills = () => {
    setSelectedCharacterIds(new Set(characters.map((c) => c.id)))
  }

  const handleClearSkillSelection = () => {
    setSelectedCharacterIds(new Set())
  }

  const handleBindImportedAura = async () => {
    if (!currentProject?.path || !selectedAuraId || selectedNovelCharacterIds.size === 0) {
      toast.error("请先选择自定义灵魂和至少一个小说人物")
      return
    }

    const names = Array.from(selectedNovelCharacterIds)
    let succeeded = 0
    let failed = 0
    for (const name of names) {
      try {
        await bindCharacterAura(currentProject.path, {
          characterName: name,
          auraId: selectedAuraId,
        })
        succeeded++
      } catch (err) {
        console.error(`[bind] 失败：${name}`, err)
        failed++
      }
    }
    await refreshProjectState(currentProject.path)
    const auraName = importedAuras.find((item) => item.auraId === selectedAuraId)?.auraName ?? "角色灵魂"
    if (failed === 0) {
      toast.success(`已将「${auraName}」绑定到 ${succeeded} 个小说人物`)
    } else {
      toast.info(`绑定完成：成功 ${succeeded}，失败 ${failed}`)
    }
    setSelectedNovelCharacterIds(new Set())
  }

  // feature/fix-viewer-ui：删 skills tab，连带删 handleReanalyzeSkill（已无调用点）

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      protagonist: "主角",
      antagonist: "反派",
      supporting: "配角",
      minor: "龙套",
    }
    return labels[category] || category
  }

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      protagonist: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      antagonist: "bg-red-500/10 text-red-600 border-red-500/20",
      supporting: "bg-green-500/10 text-green-600 border-green-500/20",
      minor: "bg-gray-500/10 text-gray-600 border-gray-500/20",
    }
    return colors[category] || "bg-gray-500/10 text-gray-600 border-gray-500/20"
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-background rounded-lg p-6">
          <div className="text-center text-destructive">{error}</div>
          <Button onClick={onClose} className="mt-4 w-full">关闭</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-6xl mx-4 bg-background rounded-lg shadow-lg flex flex-col max-h-[90vh]">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold">分析结果</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {effectiveResult?.metadata?.title || "未命名作品"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* feature/fix-viewer-ui：删 skills tab，只保留角色列表 */}
        <div className="flex border-b">
          <div className="flex items-center gap-2 px-6 py-3 border-b-2 border-primary text-foreground font-medium">
            <User className="h-4 w-4" />
            角色列表 ({characters.length})
          </div>
        </div>

        {/* 内容区域（feature/fix-viewer-ui：删除 skills tab，只剩角色列表） */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* feature/book-style-extraction：作品文风卡片 */}
          <div className="shrink-0 border-b px-6 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Feather className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium shrink-0">作品文风</span>
                <span className="text-xs text-muted-foreground truncate">
                  {styleProfile ? (styleProfile.narrativeDensity || "已提取") : "尚未提取叙事文风（与角色灵魂相互独立）"}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {styleProfile && (
                  <Button
                    variant={styleEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={handleToggleStyleEnabled}
                  >
                    {styleEnabled ? "已启用 ✓" : "启用此文风"}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleExtractStyle} disabled={styleExtracting}>
                  {styleExtracting ? "提取中..." : styleProfile ? "重新提取文风" : "提取文风"}
                </Button>
              </div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              也可以在拆书库主界面统一管理文风、角色 Skill 和绑定关系。
            </div>
            {styleProfile && (
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {STYLE_DIMENSIONS.map((d) => (
                  <div key={d.key} className="min-w-0">
                    <span className="text-foreground">{d.label}：</span>
                    <span className="break-all">{(styleProfile[d.key] as string) || "\u2014"}</span>
                  </div>
                ))}
              </div>
            )}
            {styleProfile?.constitution && (
              <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs">
                <div className="font-medium">风格宪法</div>
                <div className="mt-1 text-muted-foreground whitespace-pre-line leading-5">{styleProfile.constitution}</div>
              </div>
            )}
            {styleProfile?.samples && styleProfile.samples.length > 0 && (
              <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs">
                <div className="font-medium">代表原文样本</div>
                <div className="mt-1 space-y-1">
                  {styleProfile.samples.map((sample, i) => (
                    <div key={i} className="text-muted-foreground leading-5 border-l-2 border-primary/30 pl-2">{sample}</div>
                  ))}
                </div>
              </div>
            )}
            {styleEnabled && (
              <div className="mt-1.5 text-xs text-primary">
                已启用：生成时会按此文风写作（只模仿写法，不借用样本中的人物 / 剧情 / 设定）
              </div>
            )}
          </div>
          <div className="flex-1 flex min-h-0">
              {/* 角色列表（feature/fix-viewer-scroll：原生 div + overflow-y-auto + min-h-0） */}
              <div className="w-1/3 border-r overflow-y-auto min-h-0">
                <div className="p-4 space-y-2">
                  {sortedCharacters.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      暂无角色数据
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-xs">
                        <span className="text-muted-foreground">
                          共 {sortedCharacters.length} 个角色
                          {sortByImportance && " · 按重要性排序"}
                          {selectedCharacterIds.size > 0 && ` · 已选 ${selectedCharacterIds.size}`}
                        </span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setSortByImportance((current) => !current)}
                            className="rounded border px-2 py-0.5 text-foreground hover:bg-muted"
                          >
                            {sortByImportance ? "恢复原序" : "按重要性排序"}
                          </button>
                          <button
                            type="button"
                            onClick={handleSelectAllSkills}
                            className="rounded border px-2 py-0.5 text-foreground hover:bg-muted"
                          >
                            全选
                          </button>
                          <button
                            type="button"
                            onClick={handleClearSkillSelection}
                            className="rounded border px-2 py-0.5 text-foreground hover:bg-muted"
                          >
                            清空
                          </button>
                        </div>
                      </div>
                      {sortedCharacters.map((character) => {
                        const isChecked = selectedCharacterIds.has(character.id)
                        return (
                          <div
                            key={character.id}
                            className={`w-full text-left p-4 rounded-lg border transition-colors ${
                              isChecked
                                ? "border-primary bg-primary/5"
                                : "border-border hover:bg-muted"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {/* feature/fix-viewer-ui：复选框，多选角色 */}
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  setSelectedCharacterIds((prev) => {
                                    const next = new Set(prev)
                                    if (e.target.checked) next.add(character.id)
                                    else next.delete(character.id)
                                    return next
                                  })
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                              />
                              <button
                                type="button"
                                className="flex-1 min-w-0 text-left"
                                onClick={() => setSelectedCharacter(character)}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">{character.name}</div>
                                    {character.aliases.length > 0 && (
                                      <div className="text-xs text-muted-foreground mt-1 truncate">
                                        别名：{character.aliases.join("、")}
                                      </div>
                                    )}
                                  </div>
                                  <span
                                    className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${getCategoryColor(
                                      character.category
                                    )}`}
                                  >
                                    {getCategoryLabel(character.category)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                  <span>重要性: {character.importance}/10</span>
                                  <span>•</span>
                                  <span>出现: {character.appearanceCount}次</span>
                                </div>
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </>
                  )}
                </div>

                {/* feature/fix-viewer-ui：角色列表底部"绑定小说人物"区（多选） */}
                {importedAuras.length > 0 && bindableCharacters.length > 0 && (
                  <div className="mt-4 rounded-lg border bg-muted/10 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-muted-foreground">
                        绑定小说人物（多选）
                      </div>
                      {selectedNovelCharacterIds.size > 0 && (
                        <span className="text-xs text-muted-foreground">
                          已选 {selectedNovelCharacterIds.size}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                      {bindableCharacters.map((name) => {
                        const isChecked = selectedNovelCharacterIds.has(name)
                        return (
                          <label
                            key={name}
                            className={`flex items-center gap-2 rounded px-2 py-1 cursor-pointer text-sm hover:bg-muted ${
                              isChecked ? "bg-primary/5" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                setSelectedNovelCharacterIds((prev) => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(name)
                                  else next.delete(name)
                                  return next
                                })
                              }}
                              className="h-3.5 w-3.5 cursor-pointer accent-primary"
                            />
                            <span className="truncate">{name}</span>
                          </label>
                        )
                      })}
                    </div>
                    <div className="flex flex-col gap-1.5 pt-1">
                      <select
                        value={selectedAuraId}
                        onChange={(event) => setSelectedAuraId(event.target.value)}
                        className="rounded-md border bg-background px-2 py-1 text-xs"
                      >
                        {importedAuras.map((item) => (
                          <option key={item.auraId} value={item.auraId}>{item.auraName}</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleBindImportedAura}
                        disabled={selectedNovelCharacterIds.size === 0 || !selectedAuraId}
                      >
                        绑定 {selectedNovelCharacterIds.size > 0 ? `(${selectedNovelCharacterIds.size})` : ""} 并加入灵魂
                      </Button>
                    </div>
                  </div>
                )}
                {importedAuras.length === 0 && (
                  <div className="mt-4 rounded-lg border border-dashed bg-muted/10 p-3 text-xs text-muted-foreground">
                    先在上方勾选角色并点击「添加所选角色到自定义灵魂」，再回到这里绑定小说人物。
                  </div>
                )}
              </div>

              {/* 角色详情（feature/fix-viewer-scroll：原生 div + overflow-y-auto + min-h-0） */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {selectedCharacter ? (
                  <div className="p-6 space-y-6">
                    <div>
                      <h3 className="text-2xl font-bold">{selectedCharacter.name}</h3>
                      {selectedCharacter.aliases.length > 0 && (
                        <p className="text-muted-foreground mt-1">
                          别名：{selectedCharacter.aliases.join("、")}
                        </p>
                      )}
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">角色描述</h4>
                      <p className="text-sm leading-relaxed">{selectedCharacter.description || "暂无描述"}</p>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">性格特征</h4>
                      <p className="text-sm leading-relaxed">{selectedCharacter.personality || "暂无"}</p>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">说话方式</h4>
                      <p className="text-sm leading-relaxed">{selectedCharacter.speechStyle || "暂无"}</p>
                    </div>

                    {/* 简单提取 profile 渲染（feature/character-recognition-and-simple-mode） */}
                    {selectedCharacter.personalityProfile && !selectedCharacter.sixDimensionResearch && (
                      <SimpleProfileCard profile={selectedCharacter.personalityProfile} />
                    )}

                    {selectedCharacter.relationships.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2">关系网络</h4>
                        <div className="space-y-2">
                          {selectedCharacter.relationships.map((rel, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-sm">
                              <span className="font-medium">{rel.target}：</span>
                              <span className="text-muted-foreground">
                                {rel.relation}
                                {rel.description && ` - ${rel.description}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="pt-4 border-t">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">首次出现：</span>
                          <span className="ml-2 font-medium">第 {selectedCharacter.firstAppearance} 章</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">最后出现：</span>
                          <span className="ml-2 font-medium">第 {selectedCharacter.lastAppearance} 章</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">出现次数：</span>
                          <span className="ml-2 font-medium">{selectedCharacter.appearanceCount} 次</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">重要性：</span>
                          <span className="ml-2 font-medium">{selectedCharacter.importance}/10</span>
                        </div>
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    请从左侧选择角色查看详情
                  </div>
                )}
              </div>
            </div>

          {/* feature/fix-viewer-ui：删 skills tab 内容区 */}
        </div>

        {/* 底部操作栏（feature/fix-viewer-ui：绑定小说人物区移到角色列表底部） */}
        <div className="border-t px-6 py-4 flex items-center justify-end gap-2">
          {skills.length > 0 && (
            <Button
              variant="outline"
              onClick={handleAddSkillsToSoul}
              disabled={addingToSoul || selectedCharacterIds.size === 0}
            >
              <Plus className="h-4 w-4 mr-2" />
              {addingToSoul ? "添加中..." : `添加所选角色到自定义灵魂 (${selectedCharacterIds.size})`}
            </Button>
          )}
          <Button onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  )
}

/**
 * 简单提取 profile 卡片（feature/character-recognition-and-simple-mode）
 * 4 字段 + 代表性台词渲染
 */
function SimpleProfileCard({ profile }: { profile: PersonalityProfile }) {
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div>
        <h4 className="text-sm font-semibold">性格</h4>
        <p className="text-sm text-muted-foreground">{profile.personality}</p>
      </div>
      <div>
        <h4 className="text-sm font-semibold">动机</h4>
        <p className="text-sm text-muted-foreground">{profile.motivation}</p>
      </div>
      <div>
        <h4 className="text-sm font-semibold">说话风格</h4>
        <p className="text-sm text-muted-foreground">{profile.speechStyle}</p>
      </div>
      <div>
        <h4 className="text-sm font-semibold">行为模式</h4>
        <p className="text-sm text-muted-foreground">{profile.behaviorPatterns}</p>
      </div>
      {profile.quotes.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold">代表性台词</h4>
          <ul className="text-sm text-muted-foreground list-disc list-inside">
            {profile.quotes.map((q, i) => (
              <li key={i}>「{q}」</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
