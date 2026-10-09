import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "chapter-ingest.ts"), "utf8")

describe("chapter ingest draft boundary", () => {
  it("keeps draft ingestion opt-in so existing final-only flows do not change", () => {
    expect(source).toContain("interface IngestChapterOptions")
    expect(source).toContain("allowDraft?: boolean")
    expect(source).toContain("options: IngestChapterOptions = {}")
    expect(source).toContain("if (!options.allowDraft && !isFinalChapter(fm))")
    expect(source).toContain('return logFail("not_final", "章节不是正式稿")')
  })

  it("writes extract failures to .qmai/chapter-ingest.log and returns error", () => {
    expect(source).toContain("appendChapterIngestLog")
    expect(source).toContain('event: "fail"')
    expect(source).toContain('event: "start"')
    expect(source).toContain('event: "ok"')
    expect(source).toContain("failReason, error: message")
  })

  it("does not persist a snapshot before syncSnapshotToMemory", () => {
    const ingestFn = source.slice(
      source.indexOf("export async function ingestChapter"),
      source.indexOf("function createRetrievalStore"),
    )
    const saveBeforeSync = ingestFn.indexOf("await saveSnapshot(")
    const syncCall = ingestFn.indexOf("await syncSnapshotToMemory(")
    expect(syncCall).toBeGreaterThan(0)
    expect(saveBeforeSync).toBe(-1)
  })
})

/**
 * 这些名字曾经每摄入一章就写一次盘，但全仓库没有任何读取方。
 * 它们不是「暂时没人用」——查过 TS/Rust/脚本/快照查看器四条路径都没有读者，
 * 并且唯一读 .output.json 的 story-extractor 只用 wikiUpdatePatch.entries。
 * 这里钉死它们不会被无意中加回来（加回来等于每章多写两个没人读的文件）。
 */
describe("chapter ingest 不写无人读取的派生产物", () => {
  it("不再写搜索索引 / 向量索引文件", () => {
    expect(source).not.toContain(".search-index.json")
    expect(source).not.toContain(".vector-index.json")
    // 仍然写这两个：wiki-patch 被图谱与 story-extractor 读，output 被 story-extractor 读
    expect(source).toContain(".wiki-patch.json")
    expect(source).toContain(".output.json")
  })

  it("不再维护 entityIsNew（只写不读的逐实体标志位）", () => {
    expect(source).not.toContain("entityIsNew")
    expect(source).not.toContain("normalizeEntityFlags")
    // 但「新实体」这条校验警告必须保留：它会渲染进 .snapshot.md 给人看
    expect(source).toContain('type: "entity_new"')
  })
})
