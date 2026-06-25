/**
 * 章节选择面板
 * 显示已识别的章节列表，支持用户勾选需要分析的章节
 *
 * 改造：
 *   - 移除"深度选择弹窗"（快速/标准），默认走 LLM 提取
 *   - 识别完成后自动打开"角色选择"弹窗（CharacterSelectionPanel）
 *   - 提取阶段在面板内显示进度，不再关闭面板
 *   - 支持"后台运行"（关闭面板，任务继续在后台）
 *   - 增加"已提取角色"按钮，加载以前提取过的角色
 */

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { CheckSquare, Square, Play, X, Loader2, Minimize2, Users, CheckCircle2 } from "lucide-react"
import type { RecognizedCharacter } from "@/lib/novel/book-analysis/types"
import { CharacterSelectionPanel } from "./character-selection-panel"

interface ChapterSelectionPanelProps {
  chapters: Array<{
    id: string
    title: string
    order: number
    wordCount: number
    path: string
  }>
  onConfirm: (selectedChapterIds: string[]) => void
  onCancel: () => void
  /** 后台运行：只关闭面板，不取消任务 */
  onBackground?: () => void
  // 角色识别
  recognitionStatus?: "idle" | "heuristic" | "llm_scoring" | "llm_recognizing" | "done" | "error"
  recognizedCharacters?: RecognizedCharacter[]
  selectedCharacterIds?: string[]
  recognitionError?: string
  onToggleCharacter?: (id: string) => void
  onSelectAllMain?: () => void
  onClearSelection?: () => void
  onDeepExtract?: () => void
  onSimpleExtract?: () => void
  /** 关闭"角色选择"弹窗：回到章节选择页，不取消任务 */
  onCharacterPickerClose?: () => void
  /** 同步"分析中"状态给父组件 */
  onAnalyzingChange?: (analyzing: boolean) => void
  // 提取进度
  extractionPhase?: "deep" | "simple" | null
  extractionProgress?: {
    stageLabel?: string
    percentage?: number
    currentItem?: string
    isCompleted?: boolean
    error?: string
  }
  // 已提取角色
  onLoadExtractedCharacters?: (selectedChapterIds: string[]) => void
  hasExtractedCharacters?: boolean
}

export function ChapterSelectionPanel({
  chapters,
  onConfirm,
  onCancel,
  onBackground,
  recognitionStatus = "idle",
  recognizedCharacters = [],
  selectedCharacterIds = [],
  recognitionError: _recognitionError,
  onToggleCharacter,
  onSelectAllMain,
  onClearSelection,
  onDeepExtract,
  onSimpleExtract,
  onCharacterPickerClose,
  onAnalyzingChange,
  extractionPhase,
  extractionProgress,
  onLoadExtractedCharacters,
  hasExtractedCharacters,
}: ChapterSelectionPanelProps) {
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isBackgrounded, setIsBackgrounded] = useState(false)

  // 同步 isAnalyzing 到父组件
  useEffect(() => {
    onAnalyzingChange?.(isAnalyzing)
  }, [isAnalyzing, onAnalyzingChange])

  // 识别完成时同步恢复 isAnalyzing = false
  useEffect(() => {
    if (recognitionStatus === "done" || recognitionStatus === "error") {
      setIsAnalyzing(false)
    }
  }, [recognitionStatus])

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

  // 识别完成时弹出"角色选择"弹窗
  const showCharacterPicker =
    recognitionStatus === "done" &&
    recognizedCharacters.length > 0 &&
    !extractionPhase &&
    !!onToggleCharacter &&
    !!onSelectAllMain &&
    !!onClearSelection &&
    !!onDeepExtract &&
    !!onSimpleExtract

  // 是否正在提取中
  const isExtracting = !!extractionPhase && !extractionProgress?.isCompleted

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-4xl mx-4 bg-background rounded-lg shadow-lg flex flex-col max-h-[90vh]">
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold">
              {isExtracting
                ? extractionPhase === "deep"
                  ? "深度 6 维提取中"
                  : "简单提取中"
                : extractionProgress?.isCompleted
                  ? "提取完成"
                  : "选择分析章节"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {isExtracting
                ? "正在提取角色特征，请耐心等待"
                : extractionProgress?.isCompleted
                  ? "角色特征提取已完成"
                  : `已识别 ${chapters.length} 章，请选择需要分析的章节`}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* 提取进度显示 */}
        {isExtracting && (
          <div className="shrink-0 mx-6 mt-4 rounded-md border border-primary/40 bg-primary/5 px-4 py-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="font-medium text-foreground">
                {extractionProgress?.stageLabel || "准备中..."}
              </span>
            </div>
            {/* 进度条 */}
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${extractionProgress?.percentage ?? 0}%` }}
              />
            </div>
            {extractionProgress?.currentItem && (
              <div className="text-xs text-muted-foreground">
                {extractionProgress.currentItem}
              </div>
            )}
            {/* 后台运行按钮 */}
            <div className="flex justify-end">
              {!isBackgrounded && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsBackgrounded(true)
                    if (onBackground) {
                      onBackground()
                    }
                  }}
                >
                  <Minimize2 className="h-4 w-4 mr-1" />
                  后台运行
                </Button>
              )}
            </div>
          </div>
        )}

        {/* 提取完成提示 */}
        {extractionProgress?.isCompleted && (
          <div className="shrink-0 mx-6 mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-4 py-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="font-medium text-foreground">提取完成</span>
            </div>
            {extractionProgress.error && (
              <div className="text-xs text-amber-600">{extractionProgress.error}</div>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={onCancel}>
                关闭
              </Button>
            </div>
          </div>
        )}

        {/* 提取错误提示 */}
        {extractionPhase && extractionProgress?.error && !extractionProgress.isCompleted && (
          <div className="shrink-0 mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
            <div className="text-sm text-destructive">{extractionProgress.error}</div>
          </div>
        )}

        {/* 分析中提示条（角色识别阶段） */}
        {isAnalyzing && !extractionPhase && (
          <div className="shrink-0 mx-6 mt-3 rounded-md border border-primary/40 bg-primary/5 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="font-medium text-foreground">正在分析中</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {recognitionStatus === "heuristic" && "读取章节中"}
                {recognitionStatus === "llm_scoring" && "LLM 评分中"}
                {recognitionStatus === "llm_recognizing" && "AI 识别角色中（可能需要较长时间，请耐心等待）"}
                {recognitionStatus === "idle" && "准备中"}
                {recognitionStatus === "done" && "识别完成"}
                {recognitionStatus === "error" && "识别失败"}
              </span>
            </div>
            {!isBackgrounded && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsBackgrounded(true)
                  if (onBackground) {
                    onBackground()
                  }
                }}
              >
                <Minimize2 className="h-4 w-4 mr-1" />
                后台运行
              </Button>
            )}
          </div>
        )}

        {/* 工具栏 + 章节列表（非提取阶段显示） */}
        {!isExtracting && !extractionProgress?.isCompleted && (
          <>
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

              <div className="flex items-center gap-3">
                {/* 已提取角色按钮 */}
                {hasExtractedCharacters && onLoadExtractedCharacters && (
                  <Button
                    variant="outline"
                    size="default"
                    onClick={() => onLoadExtractedCharacters(Array.from(selectedChapters))}
                  >
                    <Users className="h-4 w-4 mr-2" />
                    已提取角色
                  </Button>
                )}
                {/* 开始分析按钮 */}
                <Button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!canConfirm) return
                    setIsAnalyzing(true)
                    try {
                      onConfirm(Array.from(selectedChapters))
                    } catch (err) {
                      console.error('[开始分析] onConfirm 调用出错:', err)
                      setIsAnalyzing(false)
                    }
                  }}
                  disabled={!canConfirm || isAnalyzing}
                  size="default"
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  {isAnalyzing ? "分析中..." : `开始分析（${selectedCount} 章）`}
                </Button>
              </div>
            </div>

            {/* 统计信息 */}
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
                  提示：分析大量章节会消耗较多时间和 token，建议先选择部分章节测试
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
          </>
        )}

        {/* 底部操作栏 */}
        <div className="shrink-0 border-t px-6 py-4 flex justify-end">
          <Button variant="outline" onClick={onCancel}>
            {extractionProgress?.isCompleted ? "关闭" : "取消"}
          </Button>
        </div>
      </div>

      {/* 角色选择弹窗 */}
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
          onClose={onCharacterPickerClose}
        />
      )}
    </div>
  )
}
