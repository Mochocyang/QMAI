import { Link2, Sparkles } from "lucide-react"
import type { BookAnalysisAuraBindingSummary } from "@/lib/novel/book-analysis/library-state"
import type { WritingStylePreset } from "@/lib/novel/writing-style-store"

interface BookAnalysisActiveContextProps {
  enabledStyle: WritingStylePreset | null
  bindings: BookAnalysisAuraBindingSummary[]
}

export function BookAnalysisActiveContext({ enabledStyle, bindings }: BookAnalysisActiveContextProps) {
  return (
    <aside className="flex min-h-0 w-80 shrink-0 flex-col border-l bg-background">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold">当前 AI 会话约束</div>
        <div className="mt-1 text-xs text-muted-foreground">显示当前项目生成时实际生效的拆书资源。</div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-lg border bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" />
            启用文风
          </div>
          {enabledStyle ? (
            <>
              <div className="mt-2 text-sm">{enabledStyle.sourceBook} · 文风</div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                单选规则：启用其他文风会自动替换当前文风。
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">当前未启用拆书文风。</p>
          )}
        </section>
        <section className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="h-4 w-4 text-primary" />
            角色绑定
          </div>
          <div className="mt-3 space-y-2">
            {bindings.length === 0 ? (
              <p className="text-xs leading-5 text-muted-foreground">当前没有小说人物绑定拆书角色 Skill。</p>
            ) : (
              bindings.map((binding) => (
                <div key={`${binding.characterName}-${binding.auraId}`} className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                  {binding.characterName} → {binding.auraName || "未知角色 Skill"}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </aside>
  )
}
