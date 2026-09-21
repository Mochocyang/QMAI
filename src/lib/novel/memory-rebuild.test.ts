import { describe, expect, it } from "vitest"
import type { ChapterSnapshot } from "./chapter-ingest"
import {
  buildStructuredMemoryDocuments,
  isValidMemorySnapshot,
  looksLikeStableNovelEntityLabel,
} from "./memory-rebuild"

function makeSnapshot(partial: Partial<ChapterSnapshot>): ChapterSnapshot {
  return {
    chapterId: partial.chapterId ?? `chapter-${partial.chapterNumber ?? 1}`,
    chapterNumber: partial.chapterNumber ?? 1,
    summary: partial.summary ?? "",
    characters: partial.characters ?? [],
    locations: partial.locations ?? [],
    organizations: partial.organizations ?? [],
    items: partial.items ?? [],
    events: partial.events ?? [],
    characterStateChanges: partial.characterStateChanges ?? [],
    relationshipChanges: partial.relationshipChanges ?? [],
    knowledgeChanges: partial.knowledgeChanges ?? [],
    foreshadowingChanges: partial.foreshadowingChanges ?? [],
    newCanonFacts: partial.newCanonFacts ?? [],
    timelineEvents: partial.timelineEvents ?? [],
    conflicts: partial.conflicts ?? [],
    endingHook: partial.endingHook ?? "",
    graphNodes: partial.graphNodes ?? [],
    graphEdges: partial.graphEdges ?? [],
  }
}

describe("memory-rebuild", () => {
  it("只接受有效章节范围内的快照", () => {
    expect(isValidMemorySnapshot(makeSnapshot({ chapterNumber: 0 }), [1, 2, 3])).toBe(false)
    expect(isValidMemorySnapshot(makeSnapshot({ chapterNumber: 10 }), [1, 2, 3])).toBe(false)
    expect(isValidMemorySnapshot(makeSnapshot({ chapterNumber: 7 }), [1, 2, 3])).toBe(true)
  })

  it("会把不确定内容写入候选区，并过滤泛化人物状态", () => {
    const documents = buildStructuredMemoryDocuments([
      makeSnapshot({
        chapterNumber: 2,
        characters: ["杨寒", "307号女孩"],
        characterStateChanges: ["杨寒：仍在追查白塔", "307号女孩：短暂清醒"],
        knowledgeChanges: ["杨寒知道1849仍存活", "杨寒可能已经见过白塔诱导室"],
        foreshadowingChanges: ["新增伏笔：白塔地下诱导室"],
        newCanonFacts: ["白塔旧院地下存在诱导室"],
        timelineEvents: ["深夜：杨寒返回白塔旧院"],
        conflicts: ["杨寒与编号派的冲突升级"],
      }),
    ])

    expect(documents["character-states.md"]).toContain("### 杨寒")
    expect(documents["character-states.md"]).not.toContain("307号女孩")
    expect(documents["character-cognition.md"]).toContain("## 候选区")
    expect(documents["character-cognition.md"]).toContain("杨寒可能已经见过白塔诱导室")
  })

  it("会拦住句子型事件，只保留稳定命名事件", () => {
    expect(looksLikeStableNovelEntityLabel("event", "黑雨之夜")).toBe(true)
    expect(looksLikeStableNovelEntityLabel("event", "编号派试图以人格压缩和编号接管保全文明")).toBe(false)
    expect(looksLikeStableNovelEntityLabel("event", "1849在被广播点名时仍能以编号应答，说明其认知已遭诱导重塑。")).toBe(false)
  })
})
