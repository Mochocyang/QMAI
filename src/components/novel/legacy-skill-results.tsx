import { useState } from "react"
import type { AnalysisSkill } from "@/lib/novel/book-analysis/analysis-pipeline-types"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import { BookAnalysisCharacterPanel } from "./book-analysis-character-panel"
import { BookAnalysisStyleCard } from "./book-analysis-style-card"
import { StoryMapContent } from "./book-analysis-library-layout"

/**
 * 把旧版各技能的结果并进新版对应页签。
 *
 * 只呈现**结果**：这里刻意不传任何管理类回调（重新提取／启用／删除／生成 Skill），
 * 按 legacy-panel-variant.ts 的约定，管理控件会随回调缺失而消失，
 * 因此页签里不会出现点了没反应的按钮。
 *
 * 角色面板里两种机制并存：顶层那两个按钮（选择角色生成 Skill／加入自定义灵魂库）
 * 是靠 variant="embedded" 隐藏的（它们是被剥离的重复标题块的一部分），
 * 只有逐角色的删除按钮是靠回调缺失消失的。
 *
 * StoryMapContent 没有 variant：它没有需要剥离的外壳，删除按钮由 onDeleteStoryMap 门控。
 *
 * 空状态由各面板自己负责，这里不判断「有没有旧版资料」：
 * 那样做会逼 wrapper 为了故事页签重复一遍 listStoryMapHistory。
 */
export function LegacySkillResults({
  book,
  skill,
  storyMapRefreshKey = 0,
}: {
  book: BookAnalysisLibraryBook
  skill: AnalysisSkill
  storyMapRefreshKey?: number
}) {
  // 角色选中状态放在这里持有，让 BookAnalysisCharacterPanel 保持受控。
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  return (
    <div
      className="wb-legacy-results"
      data-testid="legacy-skill-results"
      aria-label="旧版资料"
    >
      <p className="wb-legacy-hint">旧版资料</p>
      {skill === "characters" && (
        <BookAnalysisCharacterPanel
          variant="embedded"
          book={book}
          selectedCharacterId={selectedCharacterId}
          onSelectCharacter={setSelectedCharacterId}
        />
      )}
      {/* 刻意不传 onDeleteStoryMap：删除按钮随回调消失，「查看全部」预览保留。 */}
      {skill === "story" && <StoryMapContent bookPath={book.path} refreshKey={storyMapRefreshKey} />}
      {skill === "style" && <BookAnalysisStyleCard variant="embedded" book={book} />}
    </div>
  )
}
