/**
 * Hybrid retrieval (RRF) tests for searchWiki.
 *
 * search.scenarios.test.ts disables embedding to test token search in
 * isolation. THIS file does the inverse: scripts both token search
 * input (real materialized wiki dir) AND vector search output (via
 * a stubbed searchByEmbedding) so we can pin the exact RRF math
 * and ranking semantics.
 *
 * Why RRF matters and what these tests guard:
 *   Before this refactor, vector results contributed `vr.score * 5`
 *   to the existing token score. Token-only signals (FILENAME_EXACT
 *   = 200, PHRASE_IN_TITLE = 50, …) drowned out the cosine sim ≤ 1.0
 *   range, so a page with NO keyword overlap but perfect semantic
 *   match would max out at score 5 and never make top-10 against any
 *   keyword-matching page. This file pins that this is no longer true.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import path from "node:path"
import fs from "node:fs/promises"
import { realFs, createTempProject } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)

// Stub searchByEmbedding so each test scripts the exact ranked list
// of vector results coming from LanceDB, with no real model calls.
const mockSearchByEmbedding =
  vi.fn<(...args: unknown[]) => Promise<Array<{ id: string; score: number }>>>()
vi.mock("./embedding", () => ({
  searchByEmbedding: (...args: unknown[]) => mockSearchByEmbedding(...args),
}))

import { searchWiki } from "./search"
import { useWikiStore } from "@/stores/wiki-store"

interface Ctx {
  tmp: { path: string; cleanup: () => Promise<void> }
}
let ctx: Ctx | undefined

/** Lay out a small project on disk: just the wiki/* files we need. */
async function setupProject(files: Record<string, string>): Promise<Ctx> {
  const tmp = await createTempProject("search-rrf")
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(tmp.path, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, "utf-8")
  }
  return { tmp }
}

beforeEach(() => {
  mockSearchByEmbedding.mockReset()
  // Default: embedding ENABLED (the whole point of this file). Tests
  // that want token-only override locally.
  useWikiStore.getState().setEmbeddingConfig({
    enabled: true,
    endpoint: "http://test/v1/embeddings",
    apiKey: "",
    model: "test-embed",
  })
})

afterEach(async () => {
  if (ctx) {
    await ctx.tmp.cleanup()
    ctx = undefined
  }
})

// Vitest's `afterEach` import — declare here to keep the import block
// near the top tidy and use the same lifecycle hooks shape as
// search.scenarios.test.ts.
import { afterEach } from "vitest"

describe("searchWiki — RRF fusion of token + vector lists", () => {
  it("a vector-only match (no keyword overlap) surfaces ahead of a token-only weak match", async () => {
    // The query mentions "memory bandwidth"; flash-attention.md doesn't
    // contain that phrase verbatim but is semantically about it. A
    // separate page literally contains the word "memory" in unrelated
    // context. Old behavior: token-match page wins. RRF behavior:
    // vector match wins because it ranks #1 in vector list while the
    // token match ranks deep in token list.
    ctx = await setupProject({
      "wiki/concepts/flash-attention.md":
        "---\ntitle: Flash Attention\n---\n\n# Flash Attention\n\nIO-aware tiled attention.",
      "wiki/concepts/memory-leak.md":
        "---\ntitle: Memory Leak Diagnosis\n---\n\n# Memory Leak\n\nRSS growing over time.",
    })

    // Token search will find "memory-leak" (literal "Memory" hit) and
    // possibly nothing for flash-attention. Vector search ranks
    // flash-attention #1.
    mockSearchByEmbedding.mockResolvedValueOnce([
      { id: "flash-attention", score: 0.85 },
      { id: "memory-leak", score: 0.4 },
    ])

    const out = await searchWiki(ctx.tmp.path, "GPU memory bandwidth optimization for attention")

    // The vector match must be in the top result. Without RRF, the
    // keyword-only "memory-leak" page would dominate.
    expect(out[0].title).toBe("Flash Attention")
    // Both pages still appear (RRF surfaces both lists' contents).
    const titles = out.map((r) => r.title)
    expect(titles).toContain("Memory Leak Diagnosis")
  })

  it("a page in BOTH lists outranks a page in only one (combined contribution)", async () => {
    // Construct three pages:
    //   - A: matches token search (rank 1) AND vector search (rank 1)
    //   - B: only matches token search (rank 1's neighbor at rank 2)
    //   - C: only matches vector search (rank 2)
    //
    // RRF expectation:
    //   A: 1/61 + 1/61 = 0.0328
    //   B: 1/62 + 0    = 0.0161
    //   C: 0    + 1/62 = 0.0161
    //
    // → A wins clearly; B and C tie (broken by alphabetical path).
    ctx = await setupProject({
      "wiki/concepts/aaa.md": "---\ntitle: AAA\n---\n\n# AAA\n\nrope rope rope.",
      "wiki/concepts/bbb.md": "---\ntitle: BBB\n---\n\n# BBB\n\nrope.",
      "wiki/concepts/ccc.md": "---\ntitle: CCC\n---\n\n# CCC\n\nunrelated.",
    })

    mockSearchByEmbedding.mockResolvedValueOnce([
      { id: "aaa", score: 0.95 },
      { id: "ccc", score: 0.7 },
    ])

    const out = await searchWiki(ctx.tmp.path, "rope")

    expect(out[0].title).toBe("AAA")
    // Score: aaa got contributions from BOTH; bbb and ccc each from ONE.
    expect(out[0].score).toBeCloseTo(1 / 61 + 1 / 61, 6)
    // The runner-up is bbb or ccc — both at rank 2 of their list, both
    // contributing 1/62. Tie broken by path → alphabetical. concepts/bbb
    // < concepts/ccc, so bbb is #2.
    expect(out[1].title).toBe("BBB")
    expect(out[2].title).toBe("CCC")
    expect(out[1].score).toBeCloseTo(1 / 62, 6)
    expect(out[2].score).toBeCloseTo(1 / 62, 6)
  })

  it("vector list is empty (embedding disabled) → behaves like pure token rank", async () => {
    useWikiStore.getState().setEmbeddingConfig({
      enabled: false,
      endpoint: "",
      apiKey: "",
      model: "",
    })

    ctx = await setupProject({
      "wiki/concepts/attention.md":
        "---\ntitle: Attention\n---\n\n# Attention\n\nbody about attention.",
      "wiki/concepts/random.md":
        "---\ntitle: Random\n---\n\n# Random\n\nattention is mentioned briefly.",
    })

    const out = await searchWiki(ctx.tmp.path, "attention")
    // Token search puts attention.md (filename exact match → 200 bonus)
    // at rank 1, random.md at rank 2.
    expect(out[0].title).toBe("Attention")
    expect(out[0].score).toBeCloseTo(1 / 61, 6)
    expect(out[1].title).toBe("Random")
    expect(out[1].score).toBeCloseTo(1 / 62, 6)
    // searchByEmbedding must NOT have been called at all.
    expect(mockSearchByEmbedding).not.toHaveBeenCalled()
  })

  it("skips vector retrieval entirely when includeVector is false", async () => {
    ctx = await setupProject({
      "wiki/concepts/attention.md":
        "---\ntitle: Attention\n---\n\n# Attention\n\nbody about attention.",
    })

    const out = await searchWiki(ctx.tmp.path, "attention", { includeVector: false })

    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("Attention")
    expect(mockSearchByEmbedding).not.toHaveBeenCalled()
  })

  it("token list empty (no keyword match anywhere) → vector ranks alone determine order", async () => {
    ctx = await setupProject({
      "wiki/concepts/foo.md": "---\ntitle: Foo\n---\n\n# Foo\n\nfoo body.",
      "wiki/concepts/bar.md": "---\ntitle: Bar\n---\n\n# Bar\n\nbar body.",
    })

    // Query has no token overlap with either page; vector finds them.
    mockSearchByEmbedding.mockResolvedValueOnce([
      { id: "bar", score: 0.7 },
      { id: "foo", score: 0.3 },
    ])

    const out = await searchWiki(ctx.tmp.path, "completely unrelated query terms")
    // Order matches vector ranks: bar (rank 1) > foo (rank 2).
    expect(out.map((r) => r.title)).toEqual(["Bar", "Foo"])
    expect(out[0].score).toBeCloseTo(1 / 61, 6)
    expect(out[1].score).toBeCloseTo(1 / 62, 6)
  })

  it("vector contribution is rank-based, NOT score-magnitude — fixes the score-dwarfing bug", async () => {
    // This is the precise regression we're guarding. Old code:
    //   existing.score += vr.score * 5
    //   → vector cos_sim 0.95 boosts by only 4.75
    //   → buried under any token PHRASE_IN_TITLE_BONUS (50)
    //
    // Build: page A is the ONLY token match (low-quality match,
    // rank 1 of token but at the absolute floor of token scoring);
    // page B is vector rank 1 (no token hits at all).
    // Expected: B (in top-1 of vector) MUST appear at the top
    // alongside A — under the old behavior, B never made it in.
    ctx = await setupProject({
      "wiki/concepts/quick-mention.md":
        "---\ntitle: Quick Mention\n---\n\n# Quick Mention\n\nrope is mentioned once.",
      "wiki/concepts/positional-encoding.md":
        "---\ntitle: Positional Encoding\n---\n\n# Positional Encoding\n\nstrong semantic match.",
    })

    // Token search will hit "rope" only in quick-mention.md.
    // Vector search puts positional-encoding at rank 1.
    mockSearchByEmbedding.mockResolvedValueOnce([
      { id: "positional-encoding", score: 0.92 },
    ])

    const out = await searchWiki(ctx.tmp.path, "rope")

    // Both must be present.
    const ids = out.map((r) => r.path.split("/").pop())
    expect(ids).toContain("quick-mention.md")
    expect(ids).toContain("positional-encoding.md")
    // positional-encoding contributes 1/61 (vector rank 1) and
    // quick-mention contributes 1/61 (token rank 1). They tie on
    // score; alphabetical tie-break gives positional-encoding (p < q).
    expect(out[0].title).toBe("Positional Encoding")
    expect(out[1].title).toBe("Quick Mention")
    // Both scores should be 1/61 — proving vector rank 1 carries
    // the same weight as token rank 1, NOT 5/200th of it.
    expect(out[0].score).toBeCloseTo(1 / 61, 6)
    expect(out[1].score).toBeCloseTo(1 / 61, 6)
  })

  it("vector results referencing nonexistent page ids are silently dropped (post-source-delete safety)", async () => {
    // After a source-delete cascade, LanceDB *should* have its chunks
    // gone too (we just fixed that bug), but be defensive: if vector
    // search returns an id whose .md file doesn't exist, the search
    // pipeline must not crash and must not surface a phantom result.
    ctx = await setupProject({
      "wiki/concepts/exists.md":
        "---\ntitle: Exists\n---\n\n# Exists\n\nbody.",
    })

    mockSearchByEmbedding.mockResolvedValueOnce([
      { id: "exists", score: 0.9 },
      { id: "ghost", score: 0.85 }, // no file with this slug
    ])

    const out = await searchWiki(ctx.tmp.path, "anything")
    // Only the real page surfaces. Ghost is dropped during
    // materialization (every `tryPath` readFile throws ENOENT).
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("Exists")
  })
})
