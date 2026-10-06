import { useState } from "react"
import type { AnalysisSkill } from "@/lib/novel/book-analysis/analysis-pipeline-types"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import { BookAnalysisStyleCard } from "./book-analysis-style-card"
import { StoryMapContent } from "./book-analysis-library-layout"

/**
 * 把旧版各技能的结果并进新版对应页签。
 *
 * 只呈现**结果**：这里刻意不传任何管理类回调（重新提取／启用／删除／生成 Skill），
 * 按 legacy-panel-variant.ts 的约定，管理控件会随回调缺失而消失，
 * 因此页签里不会出现点了没反应的按钮。
 *
 * 角色那一支已经搬走：旧版角色数据现在由工作台合并进新版条目（含旧版迁移条目），
 * 本组件再渲染一遍，同一个页签里就会出现第三份角色列表，所以 characters 直接不渲染。
 *
 * StoryMapContent 没有 variant：它没有需要剥离的外壳，删除按钮由 onDeleteStoryMap 门控。
 *
 * 没有旧版资料时整块不渲染：把这些结果并进新版页签之后，空区块只会把各面板自己的
 * 空状态摆在新版结果下面（故事页签尤其别扭——「旧版历史导图」标题下写着「请先分析
 * 「故事」技能生成导图」，而那句话说的是新版流程）。
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
  // 故事页签空不空只能从盘上读出来，由 StoryMapContent 读完后回传。
  // 回传结果连同「哪本书 + 哪个刷新键」一起记：判定为空时整块（含 StoryMapContent）会卸载，
  // 不再重新判断的话，之后生成的导图就永远显示不出来。键一变，下面就算回「未知」并重新挂载去读。
  const storyKey = `${book.path}:${storyMapRefreshKey}`
  const [storyReport, setStoryReport] = useState<{ key: string; count: number | null }>({ key: "", count: null })
  const storyCount = storyReport.key === storyKey ? storyReport.count : null

  // 角色已由工作台合并进新版条目（含旧版迁移条目），
  // 这里再渲染一次就是同一页签里的第三份列表。
  if (skill === "characters") return null

  // 故事页签未知（还没读完）时先照常渲染，只有确知是 0 才当作没有。
  const hasLegacy = skill === "style" ? Boolean(book.styleProfile) : storyCount !== 0
  if (!hasLegacy) return null

  // 故事页签要写明是「历史导图」：新版结果区展示的是当前那一份导图，
  // 这里列的是历次生成的旧版导图，只写「旧版资料」分不清两者维度不同。
  const hint = skill === "story" ? "旧版历史导图" : "旧版资料"
  return (
    // role="region" 不能省：aria-label 在隐式 role=generic 的裸 div 上是「禁止的命名来源」
    // （ARIA 1.2），读屏会直接忽略它，等于没写。加了 role 才是真正可命名的区域。
    <div
      className="wb-legacy-results"
      data-testid="legacy-skill-results"
      role="region"
      aria-label={hint}
    >
      <p className="wb-legacy-hint">{hint}</p>
      {/* 刻意不传 onDeleteStoryMap：删除按钮随回调消失，「查看全部」预览保留。 */}
      {skill === "story" && (
        <StoryMapContent
          bookPath={book.path}
          refreshKey={storyMapRefreshKey}
          onCardCountChange={(count) => setStoryReport({ key: storyKey, count })}
        />
      )}
      {skill === "style" && <BookAnalysisStyleCard variant="embedded" book={book} />}
    </div>
  )
}
