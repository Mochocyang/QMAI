/**
 * 章节选择面板
 * 显示已识别的章节列表，支持用户勾选需要分析的章节
 *
 * 改造（feature/character-recognition-and-simple-mode）：
 *   - 移除"深度选择弹窗"（fast/standard/deep 三档）
 *   - "开始分析"按钮旁加二档单选：快速（仅启发式）/ 标准（启发式 + LLM 评分）
 *   - 选完深度档后调用 onConfirm（深度参数由用户在面板内选择）
 *   - 识别完成后自动打开"角色选择"弹窗（CharacterSelectionPanel）
 */

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { CheckSquare, Square, Play, X } from "lucide-react"
import type { AnalysisDepth, RecognizedCharacter } from "@/lib/novel/book-analysis/types"
import { CharacterSelectionPanel } from "./character-selection-panel"
import { loadDepthPreference, saveDepthPreference } from "@/lib/novel/book-analysis/depth-preference"

interface ChapterSelectionPanelProps {
  chapters: Array<{
    id: string
    title: string
    order: number
    wordCount: number
    path: string
  }>
  onConfirm: (selectedChapterIds: string[], depth: AnalysisDepth) => void
  onCancel: () => void
  // 角色识别（feature/character-recognition-and-simple-mode）
  recognitionStatus?: "idle" | "heuristic" | "llm_scoring" | "done" | "error"
  recognizedCharacters?: RecognizedCharacter[]
  selectedCharacterIds?: string[]
  onToggleCharacter?: (id: string) => void
  onSelectAllMain?: () => void
  onClearSelection?: () => void
  onDeepExtract?: () => void
  onSimpleExtract?: () => void
}

export function ChapterSelectionPanel({
  chapters,
  onConfirm,
  onCancel,
  recognitionStatus = "idle",
  recognizedCharacters = [],
  selectedCharacterIds = [],
  onToggleCharacter,
  onSelectAllMain,
  onClearSelection,
  onDeepExtract,
  onSimpleExtract,
}: ChapterSelectionPanelProps) {
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(false)
  // 深度档：快速（仅启发式）/ 标准（启发式 + LLM 评分）
  // 初始化时优先用用户上次保存的偏好；兼容旧值"deep"（映射为"standard"）
  const [depth, setDepth] = useState<AnalysisDepth>(() => {
    const saved = loadDepthPreference()
    return saved === "fast" ? "fast" : "standard"
  })

  useEffect(() => {
    // 每次用户切换都记忆（feature/character-recognition-and-simple-mode）
    saveDepthPreference(depth)
  }, [depth])

  // 初始化：默认全选
  useEffect(() => {
    const allIds = new Set(chapters.map(ch => ch.id))
    setSelectedChapters(allIds)
    setSelectAll(true)
  }, [chapters])

  const handleToggleChapter = (chapterId: string) => {
    setSelectedChapters(prev => {
      const next = new Set(prev)
      if (next.has(chapterId)) {
        next.delete(chapterId)
      } else {
        next.add(chapterId)
      }
      return next
    })
    setSelectAll(false)
  }

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedChapters(new Set())
      setSelectAll(false)
    } else {
      const allIds = new Set(chapters.map(ch => ch.id))
      setSelectedChapters(allIds)
      setSelectAll(true)
    }
  }

  const handleSelectRange = (start: number, end: number) => {
    const rangeIds = chapters
      .filter(ch => ch.order >= start && ch.order <= end)
      .map(ch => ch.id)
    setSelectedChapters(new Set(rangeIds))
    setSelectAll(false)
  }

  const selectedCount = selectedChapters.size
  const totalWords = chapters
    .filter(ch => selectedChapters.has(ch.id))
    .reduce((sum, ch) => sum + ch.wordCount, 0)

  const canConfirm = selectedCount > 0

  // 识别完成时弹出"角色选择"弹窗（feature/character-recognition-and-simple-mode）
  const showCharacterPicker =
    recognitionStatus === "done" &&
    recognizedCharacters.length > 0 &&
    !!onToggleCharacter &&
    !!onSelectAllMain &&
    !!onClearSelection &&
    !!onDeepExtract &&
    !!onSimpleExtract

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-4xl mx-4 bg-background rounded-lg shadow-lg flex flex-col max-h-[90vh]">
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold">选择分析章节</h2>
            <p className="text-sm text-muted-foreground mt-1">
              已识别 {chapters.length} 章，请选择需要分析的章节
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* 工具栏 */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-6 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSelectAll}
            >
              {selectAll ? (
                <>
                  <Square className="h-4 w-4 mr-2" />
                  取消全选
                </>
              ) : (
                <>
                  <CheckSquare className="h-4 w-4 mr-2" />
                  全选
                </>
              )}
            </Button>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">快捷选择：</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSelectRange(1, 10)}
              >
                前10章
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSelectRange(1, 50)}
              >
                前50章
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSelectRange(1, 100)}
              >
                前100章
              </Button>
            </div>
          </div>

          {/* 深度档 + 开始分析（feature/character-recognition-and-simple-mode） */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground mr-1">识别深度：</span>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="depth-mode"
                  value="fast"
                  checked={depth === "fast"}
                  onChange={() => setDepth("fast")}
                  className="h-3 w-3"
                />
                <span>快速</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="depth-mode"
                  value="standard"
                  checked={depth === "standard"}
                  onChange={() => setDepth("standard")}
                  className="h-3 w-3"
                />
                <span>标准</span>
              </label>
            </div>
            <Button
              onClick={() => onConfirm(Array.from(selectedChapters), depth)}
              disabled={!canConfirm}
              size="default"
            >
              <Play className="h-4 w-4 mr-2" />
              开始分析（{selectedCount} 章）
            </Button>
          </div>
        </div>

        {/* 统计信息 + 提示 */}
        <div className="shrink-0 px-6 py-3 bg-muted/50">
          <div className="flex items-center justify-between text-sm">
            <div>
              <span className="font-medium">已选择：</span>
              <span className="ml-2 text-primary font-semibold">{selectedCount}</span>
              <span className="ml-1 text-muted-foreground">章</span>
              <span className="mx-3 text-muted-foreground">|</span>
              <span className="font-medium">总字数：</span>
              <span className="ml-2 text-primary font-semibold">
                {totalWords.toLocaleString()}
              </span>
              <span className="ml-1 text-muted-foreground">字</span>
            </div>
            <div className="text-muted-foreground">
              💡 提示：分析大量章节会消耗较多时间和 token，建议先选择部分章节测试
            </div>
          </div>
        </div>

        {/* 章节列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          <div className="py-4 space-y-2">
            {chapters.map((chapter) => {
              const isSelected = selectedChapters.has(chapter.id)
              return (
                <label
                  key={chapter.id}
                  className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted"
                  }`}
                  onClick={() => handleToggleChapter(chapter.id)}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {}}
                    className="h-4 w-4"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">
                        #{chapter.order}
                      </span>
                      <span className="font-medium truncate">{chapter.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {chapter.wordCount.toLocaleString()} 字
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {/* 底部操作栏 - 只保留取消按钮 */}
        <div className="shrink-0 border-t px-6 py-4 flex justify-end">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
        </div>
      </div>

      {/* 角色选择弹窗（feature/character-recognition-and-simple-mode） */}
      {showCharacterPicker && (
        <CharacterSelectionPanel
          characters={recognizedCharacters}
          selectedIds={selectedCharacterIds}
          onToggle={onToggleCharacter!}
          onSelectAllMain={onSelectAllMain!}
          onClear={onClearSelection!}
          onDeepExtract={onDeepExtract!}
          onSimpleExtract={onSimpleExtract!}
          onCancel={onCancel}
        />
      )}
    </div>
  )
}
