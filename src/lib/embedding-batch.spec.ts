import { describe, expect, it } from "vitest"
import {
  EMBED_REBUILD_DIRTY_LIMIT,
  collectEmbeddingBatch,
  embeddingConfigFingerprint,
  parseDashScopeEmbeddingBatch,
  parseGoogleEmbeddingBatch,
  parseOpenAiEmbeddingBatch,
  planEmbeddingReindex,
  type EmbeddingIndexManifest,
} from "./embedding-batch"

describe("parseOpenAiEmbeddingBatch", () => {
  it("places vectors by index when the server returns them out of order", () => {
    const vectors = parseOpenAiEmbeddingBatch({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
    }, 2)
    expect(vectors).toEqual([[1, 0], [0, 1]])
  })
})

describe("parseDashScopeEmbeddingBatch", () => {
  it("places vectors by text_index", () => {
    const vectors = parseDashScopeEmbeddingBatch({
      output: {
        embeddings: [
          { text_index: 1, embedding: [2, 2] },
          { text_index: 0, embedding: [3, 3] },
        ],
      },
    }, 2)
    expect(vectors).toEqual([[3, 3], [2, 2]])
  })
})

describe("parseGoogleEmbeddingBatch", () => {
  it("keeps response order", () => {
    const vectors = parseGoogleEmbeddingBatch({
      embeddings: [
        { values: [4, 4] },
        { values: [5, 5] },
      ],
    }, 2)
    expect(vectors).toEqual([[4, 4], [5, 5]])
  })
})

describe("collectEmbeddingBatch", () => {
  async function splitUntilSingle(texts: string[], body: string) {
    const calls: string[][] = []
    const vectors = await collectEmbeddingBatch(texts, async (batch) => {
      calls.push([...batch])
      if (batch.length > 1) return { ok: false, status: 400, body }
      return { ok: true, vectors: [[batch[0].length]] }
    })
    return { calls, vectors }
  }

  it("splits when the server rejects the batch size and does not truncate the texts", async () => {
    const { calls, vectors } = await splitUntilSingle(
      ["alpha", "beta", "gamma", "delta"],
      "batch size is too large",
    )
    expect(vectors).toEqual([[5], [4], [5], [5]])
    expect(calls[0]).toEqual(["alpha", "beta", "gamma", "delta"])
    expect(calls.filter((batch) => batch.length === 1)).toEqual([
      ["alpha"],
      ["beta"],
      ["gamma"],
      ["delta"],
    ])
  })

  it("splits when the server reports a max batch and does not truncate the texts", async () => {
    const { calls, vectors } = await splitUntilSingle(
      ["alpha", "beta", "gamma", "delta"],
      "max batch is 1",
    )
    expect(vectors).toEqual([[5], [4], [5], [5]])
    expect(calls.filter((batch) => batch.length === 1)).toEqual([
      ["alpha"],
      ["beta"],
      ["gamma"],
      ["delta"],
    ])
  })

  it("splits an oversize batch in half and does not truncate the texts", async () => {
    const calls: string[][] = []
    const vectors = await collectEmbeddingBatch(
      ["alpha", "beta", "gamma", "delta"],
      async (batch) => {
        calls.push([...batch])
        if (batch.length > 1) {
          return { ok: false, status: 413, body: "input too long" }
        }
        return { ok: true, vectors: [[batch[0].length]] }
      },
    )

    expect(vectors).toEqual([[5], [4], [5], [5]])
    expect(calls[0]).toEqual(["alpha", "beta", "gamma", "delta"])
    expect(calls.filter((batch) => batch.length === 1)).toEqual([
      ["alpha"],
      ["beta"],
      ["gamma"],
      ["delta"],
    ])
  })
})

describe("planEmbeddingReindex", () => {
  const manifest: EmbeddingIndexManifest = {
    configHash: "same",
    pages: { a: "hash-a", b: "hash-b" },
  }

  it("skips every page when the config and content hashes match", () => {
    const plan = planEmbeddingReindex(
      { a: "hash-a", b: "hash-b" },
      manifest,
      "same",
    )
    expect(plan).toEqual({ mode: "incremental", dirtyIds: [], removedIds: [] })
  })

  it("replaces only the dirty page and drops pages that disappeared", () => {
    const plan = planEmbeddingReindex(
      { a: "hash-a", b: "hash-b-new" },
      { configHash: "same", pages: { a: "hash-a", b: "hash-b", gone: "hash-gone" } },
      "same",
    )
    expect(plan).toEqual({
      mode: "incremental",
      dirtyIds: ["b"],
      removedIds: ["gone"],
    })
  })

  it("rebuilds when the embedding config changes", () => {
    expect(embeddingConfigFingerprint({ model: "a" })).not.toBe(
      embeddingConfigFingerprint({ model: "b" }),
    )
    const plan = planEmbeddingReindex({ a: "hash-a" }, manifest, "other")
    expect(plan.mode).toBe("rebuild")
    expect(plan.dirtyIds).toEqual(["a"])
  })

  it("rebuilds when too many pages are dirty", () => {
    const pages: Record<string, string> = {}
    const previous: Record<string, string> = {}
    for (let i = 0; i < EMBED_REBUILD_DIRTY_LIMIT + 1; i++) {
      pages[`p${i}`] = "new"
      previous[`p${i}`] = "old"
    }
    const plan = planEmbeddingReindex(pages, { configHash: "same", pages: previous }, "same")
    expect(plan.mode).toBe("rebuild")
    expect(plan.dirtyIds).toHaveLength(EMBED_REBUILD_DIRTY_LIMIT + 1)
  })
})
