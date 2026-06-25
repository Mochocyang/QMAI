"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import type { RecognizedCharacter } from "@/lib/novel/book-analysis/types"
import { Search } from "lucide-react"

export interface CharacterSelectionPanelProps {
  characters: RecognizedCharacter[]
  selectedIds: string[]
  onToggle: (id: string) => void
  onSelectAllMain: () => void
  onClear: () => void
  onDeepExtract: () => void
  onSimpleExtract: () => void
  onCancel: () => void
  /** 关闭弹窗（X / 返回）：应回到章节选择页，而不是取消整个任务。默认回退到 onCancel。 */
  onClose?: () => void
  // 受控搜索词和排序（默认内部 state）
  search?: string
  sortBy?: "importance" | "appearances"
}

export function CharacterSelectionPanel(props: CharacterSelectionPanelProps) {
  const {
    characters,
    selectedIds,
    onToggle,
    onSelectAllMain,
    onClear,
    onDeepExtract,
    onSimpleExtract,
    onCancel,
    onClose,
  } = props
  const dismiss = onClose ?? onCancel
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<"importance" | "appearances">("importance")

  const filtered = useMemo(() => {
    const list = characters.filter(
      (c) => !search || c.name.includes(search)
    )
    return list.sort((a, b) =>
      sortBy === "importance"
        ? b.importanceScore - a.importanceScore
        : b.appearances - a.appearances
    )
  }, [characters, search, sortBy])

  const selectedCount = selectedIds.length
  const canExtract = selectedCount > 0

  return (
    <Dialog open onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>识别出 {characters.length} 个角色，请选择</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索角色名"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "importance" | "appearances")}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="importance">按重要度</option>
            <option value="appearances">按出场次数</option>
          </select>
          <Button variant="outline" size="sm" onClick={onSelectAllMain}>
            全选主角配角
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear}>
            清空
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto border rounded min-h-0">
          {filtered.length === 0 ? (
            <p className="p-4 text-center text-muted-foreground">无匹配角色</p>
          ) : (
            <ul>
              {filtered.map((c) => {
                const checked = selectedIds.includes(c.id)
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted cursor-pointer"
                    onClick={() => onToggle(c.id)}
                    data-testid={`character-row-${c.id}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4"
                    />
                    <span className="font-medium">{c.name}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        c.category === "主角"
                          ? "bg-primary text-primary-foreground"
                          : c.category === "配角"
                          ? "bg-secondary text-secondary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {c.category}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {c.appearances} 章 · 重要度 {c.importanceScore}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="mt-2 text-sm text-muted-foreground">
          已选 {selectedCount} 个角色
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={dismiss}>返回章节</Button>
          <Button
            disabled={!canExtract}
            onClick={onDeepExtract}
            variant="default"
          >
            🎯 深度 6 维提取 {selectedCount} 个角色
          </Button>
          <Button
            disabled={!canExtract}
            onClick={onSimpleExtract}
            variant="default"
            className="bg-amber-500 hover:bg-amber-600"
          >
            ⚡ 简单提取 {selectedCount} 个角色
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
