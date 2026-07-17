import { Plus, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"

interface BookAnalysisCharacterPanelProps {
  book: BookAnalysisLibraryBook
  selectedCharacterId: string | null
  addingToSoul: boolean
  onOpenSkillSelection: () => void
  onSelectCharacter: (characterId: string) => void
  onAddSelectedSkillsToSoul: (skillId: string) => void
}

const categoryLabels: Record<string, string> = {
  protagonist: "主角",
  antagonist: "配角",
  supporting: "配角",
  minor: "次要配角",
}

export function BookAnalysisCharacterPanel({
  book,
  selectedCharacterId,
  addingToSoul,
  onOpenSkillSelection,
  onSelectCharacter,
  onAddSelectedSkillsToSoul,
}: BookAnalysisCharacterPanelProps) {
  const selectedCharacter = book.characters.find((character) => character.id === selectedCharacterId) ?? book.characters[0] ?? null
  const selectedSkill = selectedCharacter
    ? book.skills.find((skill) => skill.characterId === selectedCharacter.id || skill.characterName === selectedCharacter.name) ?? null
    : null
  const selectedAuraAdded = selectedCharacter ? book.addedAuraCharacterIds.includes(selectedCharacter.id) : false
  const addButtonLabel = addingToSoul
    ? "加入中..."
    : selectedAuraAdded
      ? "已加入自定义灵魂库"
      : "加入自定义灵魂库"

  const profile = selectedCharacter?.personalityProfile

  return (
    <section className="min-h-0 flex-1 rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">角色 Skill</h3>
          <p className="mt-1 text-xs text-muted-foreground">选择角色 Skill 加入自定义灵魂库。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onOpenSkillSelection}>选择角色生成 Skill</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => selectedSkill && !selectedAuraAdded && onAddSelectedSkillsToSoul(selectedSkill.id)}
            disabled={addingToSoul || !selectedSkill || selectedAuraAdded}
          >
            <Plus className="mr-2 h-4 w-4" />
            {addButtonLabel}
          </Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: "minmax(220px, 320px) 1fr" }}>
        <div className="min-h-0 space-y-2 overflow-y-auto border-r p-3">
          {book.characters.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">暂无角色数据。</div>
          ) : (
            book.characters.map((character) => {
              const active = selectedCharacter?.id === character.id
              const hasSkill = book.skills.some((skill) => skill.characterId === character.id || skill.characterName === character.name)
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => onSelectCharacter(character.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    active ? "border-primary bg-primary/5" : "hover:bg-muted"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{character.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {categoryLabels[character.category] ?? character.category} · 重要度 {character.importance}/10
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs">
                      {hasSkill ? "已生成" : "未生成"}
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </div>
        <div className="min-h-0 overflow-y-auto p-5">
          {selectedCharacter ? (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  <h4 className="text-lg font-semibold">{selectedCharacter.name}</h4>
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {categoryLabels[selectedCharacter.category] ?? selectedCharacter.category}
                  </span>
                </div>
                {selectedCharacter.description && (
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedCharacter.description}</p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <div className="font-medium">性格</div>
                  <div className="mt-1 text-muted-foreground">{profile?.personality || selectedCharacter.personality || "暂无"}</div>
                </div>
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <div className="font-medium">说话风格</div>
                  <div className="mt-1 text-muted-foreground">{profile?.speechStyle || selectedCharacter.speechStyle || "暂无"}</div>
                </div>
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <div className="font-medium">动机</div>
                  <div className="mt-1 text-muted-foreground">{profile?.motivation || "暂无"}</div>
                </div>
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <div className="font-medium">行为模式</div>
                  <div className="mt-1 text-muted-foreground">{profile?.behaviorPatterns || "暂无"}</div>
                </div>
              </div>
              {profile?.quotes && profile.quotes.length > 0 && (
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <div className="font-medium">代表性台词</div>
                  <div className="mt-1 space-y-1 text-muted-foreground">
                    {profile.quotes.map((q, i) => (
                      <div key={i}>「{q}」</div>
                    ))}
                  </div>
                </div>
              )}
              {selectedSkill && (
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <div className="font-medium">Skill 内容预览</div>
                  <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                    {selectedSkill.skillContent.slice(0, 800)}{selectedSkill.skillContent.length > 800 ? "..." : ""}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请从左侧选择角色。</div>
          )}
        </div>
      </div>
    </section>
  )
}
