import { describe, expect, it } from "vitest"
import { collectMemoryRecords, memoryIssueKey, parseMemoryCleanupIssues } from "./memory-cleanup"
import { filterRemovedMemories, memoryRemovalKey, type MemoryCleanupPolicy } from "./memory-cleanup-policy"
import { relevantCognitionContext } from "./cognition-context"
import { stripGeneratedChapterInfo } from "./graph-adapter"
import type { ChapterSnapshot } from "./chapter-ingest"

const snapshot = (n: number, changes: string[]): ChapterSnapshot => ({
  chapterId: `chapter-${n}`, chapterNumber: n, summary: "", characters: ["林默"], locations: [], organizations: [], items: [], events: [],
  characterStateChanges: [], relationshipChanges: [], knowledgeChanges: changes, foreshadowingChanges: [], newCanonFacts: [], timelineEvents: [], conflicts: [], endingHook: "", graphNodes: [], graphEdges: [],
})

describe("来源记忆清理决策", () => {
  it("保留重复组后，模型交换建议保留项也不会再次建议同一组", () => {
    expect(memoryIssueKey({ removeIds: ["a"], keepId: "b" })).toBe(memoryIssueKey({ removeIds: ["b"], keepId: "a" }))
  })
  it("以章节和字段隔离删除，只阻止同一来源的已删记忆，并清理对应认知图边", () => {
    const removal = { chapterNumber: 1, field: "knowledgeChanges" as const, text: "林默知道：密室位置" }
    const policy: MemoryCleanupPolicy = { version: 1, removed: [removal], kept: [] }
    const source = { ...snapshot(1, ["林默知道: 密室位置", "林默知道钥匙位置"]), newCanonFacts: [removal.text], graphEdges: ["林默->KNOWS->密室位置", "林默->KNOWS->钥匙位置"] }
    const next = filterRemovedMemories(source, policy)
    expect(next.knowledgeChanges).toEqual(["林默知道钥匙位置"])
    expect(next.newCanonFacts).toEqual([removal.text])
    expect(next.graphEdges).toEqual(["林默->KNOWS->钥匙位置"])
    expect(source.knowledgeChanges).toHaveLength(2)
    expect(filterRemovedMemories(snapshot(2, [removal.text]), policy).knowledgeChanges).toEqual([removal.text])
    expect(memoryRemovalKey(removal)).toBe(memoryRemovalKey({ ...removal, text: "林默知道: 密室位置" }))
  })
  it("拒绝模型编造的 ID、跨类合并及没有保留依据的删除历史状态", () => {
    const records = collectMemoryRecords([snapshot(1, ["林默不知道密室位置"]), snapshot(2, ["林默知道密室位置"])])
    const [old, newer] = [...records].sort((a, b) => a.chapterNumber - b.chapterNumber)
    const base = { reason: "已揭晓", confidence: "high" }
    expect(parseMemoryCleanupIssues({ issues: [
      { ...base, kind: "noise", removeIds: ["invented"] },
      { ...base, kind: "duplicate", removeIds: [old.id] },
      { ...base, kind: "superseded", removeIds: [newer.id], keepId: old.id },
      { ...base, kind: "superseded", removeIds: [old.id], keepId: newer.id },
    ] }, records)).toMatchObject([{ kind: "superseded", removeIds: [old.id], keepId: newer.id }])
  })
})

describe("人物认知按本章筛选", () => {
  const state = { characters: [{ character: "林默", knows: ["密室位于钟楼", "旧消息"], doesNotKnow: ["钥匙藏处"] }, { character: "路人", knows: ["无关秘密"], doesNotKnow: [] }], readerKnows: ["密室位于钟楼地下", "遥远国家发生战乱"], lastUpdatedChapter: 2 }
  it("保留出场人物和相关读者认知，排除其他角色的整个认知库", () => {
    const text = relevantCognitionContext(state, "林默前往钟楼调查密室")
    expect(text).toContain("林默不知道：钥匙藏处")
    expect(text).toContain("读者知道：密室位于钟楼地下")
    expect(text).not.toContain("路人")
    expect(text).not.toContain("遥远国家")
    expect(relevantCognitionContext(state, "生成正文")).toBe("")
  })
  it("遵守字符上限且不截断单条认知中的否定语句", () => {
    const text = relevantCognitionContext(state, "林默调查密室", 20)
    expect(text.length).toBeLessThanOrEqual(20)
    for (const line of text.split("\n").filter(Boolean)) expect(["林默知道：密室位于钟楼", "林默知道：旧消息", "林默不知道：钥匙藏处"]).toContain(line)
  })
})

it("重建实体时只移除自动生成的章节信息块，保留用户章节", () => {
  const text = "# 林默\n\n作者写的背景。\n\n## 章节信息\n- **角色认知**: 旧信息\n## 身份\n旧身份\n\n## 作者备注\n必须保留\n"
  expect(stripGeneratedChapterInfo(text)).toBe("# 林默\n\n作者写的背景。\n\n## 身份\n旧身份\n\n## 作者备注\n必须保留\n")
})
