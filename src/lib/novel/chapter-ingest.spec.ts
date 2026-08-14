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
    expect(source).toContain('failReason: "not_final"')
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
