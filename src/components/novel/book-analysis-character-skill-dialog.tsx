import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import { selectCharacterCandidates } from "@/lib/novel/book-analysis/character-candidate-selection"

interface BookAnalysisCharacterSkillDialogProps {
  book: BookAnalysisLibraryBook
  open: boolean
  generating?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (characterIds: string[]) => Promise<void> | void
}

const CATEGORY_LABELS = { protagonist: "主角", supporting: "配角", minor: "次要配角" } as const

export function BookAnalysisCharacterSkillDialog({ book, open, generating = false, onOpenChange, onSubmit }: BookAnalysisCharacterSkillDialogProps) {
  const candidates = useMemo(() => selectCharacterCandidates(book.characters), [book.characters])
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setSelectedIds(candidates.filter((item) => !book.skills.some((skill) => skill.characterId === item.id)).map((item) => item.id))
  }, [book.skills, candidates, open])

  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  return (
    <Dialog open={open} onOpenChange={(next) => !generating && onOpenChange(next)}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>选择角色生成 Skill</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-3">
          {candidates.length === 0 ? <p className="text-sm text-muted-foreground">暂无可提取角色信息。</p> : candidates.map((character) => {
            const hasSkill = book.skills.some((skill) => skill.characterId === character.id || skill.characterName === character.name)
            return (
              <label key={character.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/50">
                <input className="mt-1" type="checkbox" checked={selectedIds.includes(character.id)} onChange={() => toggle(character.id)} disabled={generating} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{character.name}</span>
                    <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[character.candidateCategory]} · 出场 {character.appearanceCount} 次</span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{hasSkill ? "已生成 Skill，可重新生成" : character.description || "暂无角色简介"}</span>
                </span>
              </label>
            )
          })}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" disabled={generating} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={generating || selectedIds.length === 0} onClick={() => void onSubmit(selectedIds)}>{generating ? "正在生成..." : `生成选中 Skill（${selectedIds.length}）`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
