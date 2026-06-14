/**
 * 章节选择面板
 * 显示已识别的章节列表，支持用户勾选需要分析的章节
 *
 * 6 维度扩展（feature/book-analysis-6d-skill）：
 *   - 点击"开始分析"时弹出深度选择对话框（快速 / 标准 / 完整）
 *   - 选完后才真正调用 onConfirm，并附带 depth
 *   - 打开弹窗时自动选上一次的深度档（depth-preference 持久化）
 */

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { CheckSquare, Square, Play, X } from "lucide-react"
import type { AnalysisDepth } from "@/lib/novel/book-analysis/types"
import { DEPTH_DESCRIPTIONS } from "@/lib/novel/book-analysis/six-dimension-engine"
import {
  loadDepthPreference,
  saveDepthPreference,
} from "@/lib/novel/book-analysis/depth-preference"

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
}

export function ChapterSelectionPanel({
  chapters,
  onConfirm,
  onCancel,
}: ChapterSelectionPanelProps) {
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(false)
  const [showDepthPicker, setShowDepthPicker] = useState(false)
  const [pendingDepth, setPendingDepth] = useState<AnalysisDepth | null>(null)

  // 初始化：默认全选
  useEffect(() => {
    const allIds = new Set(chapters.map(ch => ch.id))
    setSelectedChapters(allIds)
    setSelectAll(true)
  }, [chapters])

  // 深度选择弹窗打开时，自动选上一次的深度档
  useEffect(() => {
    if (showDepthPicker) {
      setPendingDepth(loadDepthPreference())
    }
  }, [showDepthPicker])

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

          {/* 开始分析按钮 - 移到顶部 */}
          <Button
            onClick={() => setShowDepthPicker(true)}
            disabled={!canConfirm}
            size="default"
          >
            <Play className="h-4 w-4 mr-2" />
            开始分析（{selectedCount} 章）
          </Button>
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

      {/* 深度选择弹窗（feature/book-analysis-6d-skill） */}
      {showDepthPicker && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg max-h-[90vh] flex flex-col">
            <h3 className="text-lg font-semibold mb-2">选择分析深度</h3>
            <p className="text-sm text-muted-foreground mb-4">
              选择更深的分析会消耗更多 token，请根据需要选择。
            </p>
            <div className="space-y-3 overflow-y-auto min-h-0 flex-1">
              {(["fast", "standard", "deep"] as AnalysisDepth[]).map((d) => {
                const info = DEPTH_DESCRIPTIONS[d]
                const checked = pendingDepth === d
                return (
                  <label
                    key={d}
                    className={`block cursor-pointer rounded-md border p-4 transition-colors ${
                      checked
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                    onClick={() => setPendingDepth(d)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="depth"
                          checked={checked}
                          onChange={() => setPendingDepth(d)}
                        />
                        <span className="font-semibold">{info.label}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        约 {info.approxTokenMultiplier} token
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground ml-6">
                      {info.description}
                    </p>
                  </label>
                )
              })}
            </div>
            {pendingDepth === "deep" && (
              <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                完整模式会通过 DuckDuckGo / Wikipedia 获取公开资料，6 维度提取约消耗 6 倍 token，请确认。
              </div>
            )}
            <div className="shrink-0 mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDepthPicker(false)
                  setPendingDepth(null)
                }}
              >
                取消
              </Button>
              <Button
                disabled={!pendingDepth}
                onClick={() => {
                  if (!pendingDepth) return
                  const depth = pendingDepth
                  saveDepthPreference(depth)
                  setShowDepthPicker(false)
                  setPendingDepth(null)
                  onConfirm(Array.from(selectedChapters), depth)
                }}
              >
                开始
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
