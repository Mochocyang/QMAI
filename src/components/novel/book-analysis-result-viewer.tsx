/**
 * 拆书分析结果查看器（重构版）
 * 显示提取的角色列表和生成的 Skills
 */

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { User, FileText, X, Download, BookOpen, Plus, RefreshCw } from "lucide-react"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { useWikiStore } from "@/stores/wiki-store"
import { bindCharacterAura, listBindableNovelCharacters } from "@/lib/novel/character-aura"
import { importBookAnalysisSkillsAsAuras, type ImportedBookAnalysisAura } from "@/lib/novel/book-analysis/aura-adapter"
import { reanalyzeSixDimensions, DEPTH_DESCRIPTIONS } from "@/lib/novel/book-analysis/six-dimension-engine"
import { isSixDimensionSkill } from "@/lib/novel/book-analysis/skill-generator"
import { revealInFileManager } from "@/lib/reveal-in-file-manager"
import { toast } from "@/lib/toast"
import type { AnalysisDepth, BookAnalysisResult, CharacterSkill, ExtractedCharacter } from "@/lib/novel/book-analysis/types"

interface BookAnalysisResultViewerProps {
  projectPath: string
  result?: BookAnalysisResult | null
  onClose: () => void
}

export function BookAnalysisResultViewer({ projectPath, result, onClose }: BookAnalysisResultViewerProps) {
  const [activeTab, setActiveTab] = useState<"characters" | "skills">("characters")
  const [error, setError] = useState<string>("")
  const [selectedCharacter, setSelectedCharacter] = useState<ExtractedCharacter | null>(null)
  const [sortByImportance, setSortByImportance] = useState(true)
  const [addingToSoul, setAddingToSoul] = useState(false)
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set())
  const [importedAuras, setImportedAuras] = useState<ImportedBookAnalysisAura[]>([])
  const [bindableCharacters, setBindableCharacters] = useState<string[]>([])
  const [selectedAuraId, setSelectedAuraId] = useState("")
  const [selectedNovelCharacter, setSelectedNovelCharacter] = useState("")
  const [reanalyzingSkillId, setReanalyzingSkillId] = useState<string | null>(null)

  const currentProject = useWikiStore((s) => s.project)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const tasks = useBookAnalysisStore((s) => s.tasks)
  const task = tasks.find((t) => t.projectPath === projectPath && t.status === "completed")
  const effectiveResult = result ?? (task?.metadata ? {
    metadata: task.metadata,
    characters: task.characters ?? [],
    skills: task.skills ?? [],
  } : null)

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
        setSelectedNovelCharacter((current) => current || names[0] || "")
      })
      .catch(() => {
        if (!cancelled) setBindableCharacters([])
      })
    return () => {
      cancelled = true
    }
  }, [currentProject?.path])

  const characters = effectiveResult?.characters || []
  const skills = effectiveResult?.skills || []
  const sortedCharacters = sortByImportance
    ? [...characters].sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name, "zh-CN"))
    : characters

  const handleAddSkillsToSoul = async () => {
    if (!currentProject?.path || !effectiveResult) {
      toast.error("未找到当前项目或分析结果")
      return
    }

    const ids = Array.from(selectedSkillIds)
    if (ids.length === 0) {
      toast.info("请先勾选要添加的角色 Skill")
      return
    }

    setAddingToSoul(true)

    try {
      const imported = await importBookAnalysisSkillsAsAuras(
        currentProject.path,
        effectiveResult.metadata,
        characters,
        skills,
        ids,
      )
      setImportedAuras((current) => [...current, ...imported])
      setSelectedAuraId((current) => current || imported[0]?.auraId || "")
      setSelectedSkillIds(new Set())
      bumpDataVersion()
      toast.success(`已添加 ${imported.length} 个角色 Skill 到自定义灵魂`)
    } catch (err) {
      const errorMsg = err instanceof Error && err.message ? err.message : "未知错误"
      toast.error(`添加失败：${errorMsg}`)
    } finally {
      setAddingToSoul(false)
    }
  }

  const handleSelectAllSkills = () => {
    setSelectedSkillIds(new Set(skills.map((skill) => skill.id)))
  }

  const handleClearSkillSelection = () => {
    setSelectedSkillIds(new Set())
  }

  const handleBindImportedAura = async () => {
    if (!currentProject?.path || !selectedAuraId || !selectedNovelCharacter.trim()) {
      toast.error("请先选择自定义灵魂和小说人物")
      return
    }

    try {
      await bindCharacterAura(currentProject.path, {
        characterName: selectedNovelCharacter.trim(),
        auraId: selectedAuraId,
      })
      bumpDataVersion()
      const auraName = importedAuras.find((item) => item.auraId === selectedAuraId)?.auraName ?? "角色灵魂"
      toast.success(`已将「${auraName}」绑定到「${selectedNovelCharacter.trim()}」`)
    } catch (err) {
      const errorMsg = err instanceof Error && err.message ? err.message : "未知错误"
      toast.error(`绑定失败：${errorMsg}`)
    }
  }

  const handleReanalyzeSkill = async (skill: CharacterSkill) => {
    if (!effectiveResult) return
    const character = effectiveResult.characters.find((c) => c.id === skill.characterId)
    if (!character) {
      toast.error("未找到对应角色")
      return
    }
    if (!isSixDimensionSkill(character)) {
      toast.error("该角色未生成 6 维度研究内容，请重新分析整本书")
      return
    }
    // 选择深度（简单 confirm）
    const pick = window.prompt(
      `重新分析「${skill.characterName}」的 6 维度内容\n\n请选择深度：\n1 = 快速（无 LLM）\n2 = 标准（6 次 LLM）\n3 = 完整（6 次 LLM + 网络搜索）`,
      "2"
    )
    let depth: AnalysisDepth = "standard"
    if (pick === "1") depth = "fast"
    else if (pick === "2") depth = "standard"
    else if (pick === "3") depth = "deep"
    else return

    setReanalyzingSkillId(skill.id)
    try {
      const { streamChat: _ignore } = await import("@/lib/llm-client")
      const { useWikiStore: w } = await import("@/stores/wiki-store")
      const llmConfig = w.getState().llmConfig
      const { writeFile } = await import("@/commands/fs")
      const result = await reanalyzeSixDimensions({
        character: { ...character },
        corpus: character.corpus || "",
        llmConfig,
        depth,
        bookTitle: effectiveResult.metadata.title,
        bookAuthor: effectiveResult.metadata.author,
      })
      // 写回 character
      const idx = effectiveResult.characters.findIndex((c) => c.id === character.id)
      if (idx >= 0) effectiveResult.characters[idx] = result.character
      // 重写 skill 文件
      const { generateCharacterSkill } = await import("@/lib/novel/book-analysis/skill-generator")
      const { joinPath } = await import("@/lib/path-utils")
      const skillContent = await generateCharacterSkill(
        result.character,
        effectiveResult.metadata,
        llmConfig
      )
      const safeName = skill.characterName.replace(/[^一-龥a-zA-Z0-9]/g, "_")
      const skillPath = joinPath(projectPath, "skills", `${safeName}-skill.md`)
      await writeFile(skillPath, skillContent)
      // 写回 character.json
      const { joinPath: jp } = await import("@/lib/path-utils")
      const charPath = jp(projectPath, "characters", `${character.id}.json`)
      await writeFile(charPath, JSON.stringify(result.character, null, 2))

      // 更新 skill 内存数据
      skill.skillContent = skillContent
      skill.depth = result.character.sixDimensionMeta?.depth
      skill.sixDimensionMeta = result.character.sixDimensionMeta
      bumpDataVersion()
      toast.success(
        `已重新分析「${skill.characterName}」（${DEPTH_DESCRIPTIONS[depth].label}）`
      )
    } catch (err) {
      const errorMsg = err instanceof Error && err.message ? err.message : "未知错误"
      toast.error(`重跑 6 维度失败：${errorMsg}`)
    } finally {
      setReanalyzingSkillId(null)
    }
  }

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
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b">
          <button
            className={`flex items-center gap-2 px-6 py-3 border-b-2 transition-colors ${
              activeTab === "characters"
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("characters")}
          >
            <User className="h-4 w-4" />
            角色列表 ({characters.length})
          </button>
          <button
            className={`flex items-center gap-2 px-6 py-3 border-b-2 transition-colors ${
              activeTab === "skills"
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("skills")}
          >
            <FileText className="h-4 w-4" />
            生成的 Skills ({skills.length})
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "characters" && (
            <div className="h-full flex">
              {/* 角色列表 */}
              <ScrollArea className="w-1/3 border-r">
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
                        </span>
                        <button
                          type="button"
                          onClick={() => setSortByImportance((current) => !current)}
                          className="rounded border px-2 py-0.5 text-foreground hover:bg-muted"
                        >
                          {sortByImportance ? "恢复原序" : "按重要性排序"}
                        </button>
                      </div>
                      {sortedCharacters.map((character) => (
                      <button
                        key={character.id}
                        className={`w-full text-left p-4 rounded-lg border transition-colors ${
                          selectedCharacter?.id === character.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted"
                        }`}
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
                    ))}
                    </>
                  )}
                </div>
              </ScrollArea>

              {/* 角色详情 */}
              <ScrollArea className="flex-1">
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
              </ScrollArea>
            </div>
          )}

          {activeTab === "skills" && (
            <ScrollArea className="h-full">
              <div className="p-6 space-y-4">
                {skills.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无生成的 Skills
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">
                        已选 {selectedSkillIds.size} / {skills.length} 个 Skill
                      </span>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleSelectAllSkills}
                          disabled={selectedSkillIds.size === skills.length}
                        >
                          全选
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleClearSkillSelection}
                          disabled={selectedSkillIds.size === 0}
                        >
                          清空
                        </Button>
                      </div>
                    </div>
                    {skills.map((skill) => (
                      <div
                        key={skill.id}
                        className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                      >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <BookOpen className="h-5 w-5 text-primary" />
                            <h3 className="font-semibold text-lg">{skill.characterName}</h3>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            来源：{skill.sourceBook}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            章节范围：{skill.chapterRange.join(" - ")}
                          </p>
                          <label className="mt-3 flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={selectedSkillIds.has(skill.id)}
                              onChange={(event) => {
                                setSelectedSkillIds((current) => {
                                  const next = new Set(current)
                                  if (event.target.checked) next.add(skill.id)
                                  else next.delete(skill.id)
                                  return next
                                })
                              }}
                            />
                            <span>选择此 Skill</span>
                          </label>
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          {!skill.depth && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={reanalyzingSkillId === skill.id}
                              onClick={() => handleReanalyzeSkill(skill)}
                            >
                              <RefreshCw className={`h-4 w-4 mr-2 ${reanalyzingSkillId === skill.id ? "animate-spin" : ""}`} />
                              {reanalyzingSkillId === skill.id ? "分析中..." : "升级到 6 维度"}
                            </Button>
                          )}
                          {skill.depth && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={reanalyzingSkillId === skill.id}
                              onClick={() => handleReanalyzeSkill(skill)}
                              title={`当前深度：${DEPTH_DESCRIPTIONS[skill.depth].label}，点击重新分析`}
                            >
                              <RefreshCw className={`h-4 w-4 mr-2 ${reanalyzingSkillId === skill.id ? "animate-spin" : ""}`} />
                              {reanalyzingSkillId === skill.id ? "分析中..." : "重跑 6 维度"}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              if (!skill.filePath) {
                                toast.error("该 Skill 暂未保存到本地文件")
                                return
                              }
                              try {
                                await revealInFileManager(skill.filePath)
                              } catch (error) {
                                const message = error instanceof Error ? error.message : "未知错误"
                                toast.error(`打开文件失败：${message}`)
                              }
                            }}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            查看 Skill
                          </Button>
                        </div>
                      </div>
                      {skill.skillContent && (
                        <details className="mt-4">
                          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                            展开预览
                          </summary>
                          <pre className="mt-2 text-xs bg-muted p-3 rounded overflow-x-auto max-h-60">
                            {skill.skillContent.substring(0, 500)}...
                          </pre>
                        </details>
                      )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="border-t px-6 py-4 flex items-center justify-end gap-2">
          {skills.length > 0 && (
            <div className="mr-auto flex flex-wrap items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">绑定到小说人物</span>
              <select
                value={selectedAuraId}
                onChange={(event) => setSelectedAuraId(event.target.value)}
                className="rounded-md border bg-background px-2 py-1 text-xs"
                disabled={importedAuras.length === 0}
              >
                {importedAuras.length === 0 ? (
                  <option value="">请先添加 Skill</option>
                ) : (
                  importedAuras.map((item) => (
                    <option key={item.auraId} value={item.auraId}>{item.auraName}</option>
                  ))
                )}
              </select>
              <select
                value={selectedNovelCharacter}
                onChange={(event) => setSelectedNovelCharacter(event.target.value)}
                className="rounded-md border bg-background px-2 py-1 text-xs"
                disabled={bindableCharacters.length === 0}
              >
                {bindableCharacters.length === 0 ? (
                  <option value="">请先在人物小传或实体页中添加小说人物</option>
                ) : (
                  bindableCharacters.map((name) => <option key={name} value={name}>{name}</option>)
                )}
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBindImportedAura}
                disabled={!selectedAuraId || !selectedNovelCharacter}
              >
                绑定
              </Button>
            </div>
          )}
          {skills.length > 0 && (
            <Button
              variant="outline"
              onClick={handleAddSkillsToSoul}
              disabled={addingToSoul || selectedSkillIds.size === 0}
            >
              <Plus className="h-4 w-4 mr-2" />
              {addingToSoul ? "添加中..." : `添加所选 Skill 到自定义灵魂 (${selectedSkillIds.size})`}
            </Button>
          )}
          <Button onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  )
}
