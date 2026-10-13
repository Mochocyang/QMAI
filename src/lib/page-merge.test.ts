/**
 * Tests for the page-merge layer that decides what content to write
 * when an ingest produces a wiki page that already exists on disk.
 *
 * The merger function (LLM call) is injected so these tests run
 * deterministically without hitting any model. A separate real-llm
 * test suite exercises the wired-up production path against the
 * actual generation model.
 */
import { describe, it, expect, vi } from "vitest"
import { mergePageContent } from "./page-merge"
import { parseFrontmatter } from "./frontmatter"

const PAGE = (fm: string, body: string) => `---\n${fm}\n---\n\n${body}`

const FIXED_TODAY = () => "2026-04-30"
const baseOpts = {
  sourceFileName: "doc-B.pdf",
  pagePath: "wiki/entities/foo.md",
  today: FIXED_TODAY,
}

// ──────────────────────────────────────────────────────────────────
// Fast paths — no LLM call should happen
// ──────────────────────────────────────────────────────────────────

describe("mergePageContent — fast paths", () => {
  it("returns newContent when existingContent is null (new page)", async () => {
    const merger = vi.fn()
    const out = await mergePageContent(
      PAGE('type: entity\ntitle: Foo\nsources: ["doc.pdf"]', "body"),
      null,
      merger,
      baseOpts,
    )
    expect(out).toContain('sources: ["doc.pdf"]')
    expect(merger).not.toHaveBeenCalled()
  })

  it("returns existingContent when both contents are byte-identical", async () => {
    const merger = vi.fn()
    const c = PAGE("type: entity\ntitle: Foo", "body")
    const out = await mergePageContent(c, c, merger, baseOpts)
    expect(out).toBe(c)
    expect(merger).not.toHaveBeenCalled()
  })

  it("skips LLM when bodies are identical (only sources differ)", async () => {
    // Re-ingest of the same file from a different source just adds
    // its source filename — body is byte-identical. Don't waste an
    // LLM call on this.
    const merger = vi.fn()
    const existing = PAGE(
      'type: entity\ntitle: Foo\nsources: ["a.pdf"]',
      "same body",
    )
    const incoming = PAGE(
      'type: entity\ntitle: Foo\nsources: ["b.pdf"]',
      "same body",
    )
    const out = await mergePageContent(incoming, existing, merger, baseOpts)
    expect(out).toContain('sources: ["a.pdf", "b.pdf"]')
    expect(out).toContain("same body")
    expect(merger).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────────
// LLM merge happy path
// ──────────────────────────────────────────────────────────────────

describe("mergePageContent — LLM merge", () => {
  it("calls the merger when bodies differ and uses the merged output", async () => {
    const existing = PAGE(
      'type: entity\ntitle: Accumulibacter\ncreated: 2026-04-09\ntags: [microbiology, ebpr]\nrelated: [dpao, vfa]\nsources: ["doc-A.pdf"]',
      "## Anaerobic Phase\n\nDescription from doc A.\n\n## Denitrification\n\nMore from doc A.",
    )
    const incoming = PAGE(
      'type: entity\ntitle: Accumulibacter\ncreated: 2026-04-30\ntags: [paos, propionate]\nrelated: [pha]\nsources: ["doc-B.pdf"]',
      "## Carbon Source Preferences\n\nDescription from doc B.\n\n## Acetate vs Propionate\n\nMore from doc B.",
    )
    const mergedBody = "## Anaerobic Phase\n\nDescription from doc A.\n\n## Denitrification\n\nMore from doc A.\n\n## Carbon Source Preferences\n\nDescription from doc B.\n\n## Acetate vs Propionate\n\nMore from doc B."
    const merger = vi.fn().mockResolvedValue(
      PAGE(
        // LLM might also output frontmatter — we'll override locked fields.
        'type: entity\ntitle: Accumulibacter\ncreated: 2026-04-09\ntags: [paos, propionate]\nrelated: [pha]\nsources: ["doc-B.pdf"]',
        mergedBody,
      ),
    )
    const out = await mergePageContent(incoming, existing, merger, baseOpts)

    expect(merger).toHaveBeenCalledOnce()

    // Body uses LLM-merged version
    expect(out).toContain("Anaerobic Phase")
    expect(out).toContain("Carbon Source Preferences")

    // Locked fields preserved from existing
    expect(out).toContain("title: Accumulibacter")
    expect(out).toContain("created: 2026-04-09")
    expect(out).toContain("type: entity")

    // updated forced to today
    expect(out).toContain("updated: 2026-04-30")

    // Array fields are unions
    expect(out).toMatch(/sources:\s*\[\s*"doc-A.pdf",\s*"doc-B.pdf"\s*\]/)
    expect(out).toMatch(/tags:\s*\[\s*"microbiology",\s*"ebpr",\s*"paos",\s*"propionate"\s*\]/)
    expect(out).toMatch(/related:\s*\[\s*"dpao",\s*"vfa",\s*"pha"\s*\]/)
  })

  it("preserves locked title even if LLM rewrote it", async () => {
    // Title changes break wikilinks — never accept LLM-rewritten title.
    const existing = PAGE("type: entity\ntitle: Accumulibacter", "old body content here")
    const incoming = PAGE("type: entity\ntitle: Accumulibacter", "very different new body here")
    const merger = vi.fn().mockResolvedValue(
      PAGE("type: entity\ntitle: ACCUMULIBACTER (renamed)", "merged body that is reasonably long enough to pass the threshold check"),
    )
    const out = await mergePageContent(incoming, existing, merger, baseOpts)
    expect(out).toContain("title: Accumulibacter")
    expect(out).not.toContain("ACCUMULIBACTER (renamed)")
  })

  it("preserves locked type even if LLM changed it", async () => {
    const existing = PAGE("type: entity\ntitle: Foo", "original body content")
    const incoming = PAGE("type: entity\ntitle: Foo", "new content from another source")
    const merger = vi.fn().mockResolvedValue(
      PAGE("type: concept\ntitle: Foo", "merged body that is long enough to clear the seventy percent threshold"),
    )
    const out = await mergePageContent(incoming, existing, merger, baseOpts)
    expect(out).toContain("type: entity")
    expect(out).not.toContain("type: concept")
  })

  it("锁回的原值含冒号时必须加引号，否则写出去的 YAML 自己读不回来", async () => {
    // 真实来源：ingest.ts 的兜底摘要页写的是
    //   title: "Source: 文件名"
    // 这个值天然含 ": "（ASCII 冒号 + 空格），而 YAML 的裸标量不允许出现它。
    // 锁回 title 时若原样拼 `title: ${value}`，磁盘上就留下一个解析不了的
    // 文件 —— 页面标题、正文、乃至整个 frontmatter 全部读不回来。
    const existing = PAGE(
      'type: source\ntitle: "Source: doc-A.pdf"',
      "旧的来源摘要正文，长度足够。",
    )
    const incoming = PAGE(
      'type: source\ntitle: "Source: doc-B.pdf"',
      "另一份来源的摘要正文，长度足够，不会被当成截断。",
    )
    const merger = vi.fn().mockResolvedValue(
      PAGE(
        'type: source\ntitle: "Source: doc-B.pdf"',
        "两份来源合并后的摘要正文，长度足够，不会被当成截断，并且明显更长一些。",
      ),
    )
    const out = await mergePageContent(incoming, existing, merger, baseOpts)

    // 用「写盘后会被真读一遍」的同一个解析器验收：写得出去，就必须读得回来
    expect(parseFrontmatter(out).frontmatter?.title).toBe("Source: doc-A.pdf")
  })

  it("普通值（标识符 / ISO 日期 / 数字）仍然不加引号，写法与以前逐字一致", async () => {
    // 加引号只应为「不加就写坏」服务。这条用例是护栏：证明修复没有顺手
    // 把正常的 frontmatter 全部改成带引号的写法。
    const existing = PAGE(
      "type: entity\ntitle: Foo\ncreated: 2026-04-09\nchapter_number: 12",
      "旧的正文内容。",
    )
    const incoming = PAGE(
      "type: entity\ntitle: Foo\ncreated: 2026-04-09\nchapter_number: 12",
      "另一份正文内容，长度足够，不会被当成截断。",
    )
    const merger = vi.fn().mockResolvedValue(
      PAGE(
        'type: entity\ntitle: "LLM 想改的名字"\ncreated: 2026-01-01\nchapter_number: 99',
        "合并后的正文内容，长度足够，不会被当成截断，并且明显更长一些。",
      ),
    )
    const out = await mergePageContent(incoming, existing, merger, baseOpts)

    expect(out).toContain("title: Foo\n")
    expect(out).toContain("created: 2026-04-09\n")
    expect(out).toContain("chapter_number: 12\n")
    expect(out).not.toContain('"Foo"')
    expect(out).not.toContain('"2026-04-09"')
  })
})

// ──────────────────────────────────────────────────────────────────
// LLM failure / sanity rejection — always falls back safely
// ──────────────────────────────────────────────────────────────────

describe("mergePageContent — LLM failure fallback", () => {
  it("falls back to array-merged incoming when LLM throws", async () => {
    const existing = PAGE(
      'type: entity\ntitle: Foo\ntags: [old]\nsources: ["a.pdf"]',
      "old body content",
    )
    const incoming = PAGE(
      'type: entity\ntitle: Foo\ntags: [new]\nsources: ["b.pdf"]',
      "new body content",
    )
    const merger = vi.fn().mockRejectedValue(new Error("LLM rate limited"))
    const out = await mergePageContent(incoming, existing, merger, baseOpts)

    // Array fields are still merged (no LLM needed for that)
    expect(out).toMatch(/tags:\s*\[\s*"old",\s*"new"\s*\]/)
    expect(out).toMatch(/sources:\s*\[\s*"a.pdf",\s*"b.pdf"\s*\]/)
    // Body is the new (incoming) one — old body is lost; this is the
    // pre-LLM-merge behavior, the documented fallback contract.
    expect(out).toContain("new body content")
  })

  it("rejects LLM output that shrinks body below 70% of max(old, new)", async () => {
    const longBody = "long body content ".repeat(200) // ~3600 chars
    const existing = PAGE("type: entity\ntitle: Foo", longBody)
    const incoming = PAGE("type: entity\ntitle: Foo", "incoming body that is also pretty long " + longBody)
    const merger = vi.fn().mockResolvedValue(
      PAGE("type: entity\ntitle: Foo", "tiny merged body"),
    )
    const out = await mergePageContent(incoming, existing, merger, baseOpts)
    // Should fall back to incoming (array-merged) — not the tiny LLM output
    expect(out).not.toContain("tiny merged body")
    expect(out).toContain("incoming body that is also pretty long")
  })

  it("rejects LLM output that has no frontmatter at all", async () => {
    const existing = PAGE("type: entity\ntitle: Foo", "old body content here")
    const incoming = PAGE("type: entity\ntitle: Foo", "new body content here")
    const merger = vi.fn().mockResolvedValue(
      "raw markdown with no frontmatter at all and definitely no opening triple-dash",
    )
    const out = await mergePageContent(incoming, existing, merger, baseOpts)
    // Falls back to incoming — never writes frontmatter-less output to disk
    expect(out.startsWith("---")).toBe(true)
    expect(out).toContain("new body content here")
  })

  it("calls the optional backup callback when falling back", async () => {
    const existing = PAGE("type: entity\ntitle: Foo", "old body")
    const incoming = PAGE("type: entity\ntitle: Foo", "new body")
    const backup = vi.fn().mockResolvedValue(undefined)
    const merger = vi.fn().mockRejectedValue(new Error("network error"))
    await mergePageContent(incoming, existing, merger, {
      ...baseOpts,
      backup,
    })
    expect(backup).toHaveBeenCalledWith(existing)
  })

  it("does not call backup when LLM merge succeeds", async () => {
    const existing = PAGE("type: entity\ntitle: Foo", "old body")
    const incoming = PAGE("type: entity\ntitle: Foo", "new body content")
    const backup = vi.fn().mockResolvedValue(undefined)
    const merger = vi.fn().mockResolvedValue(
      PAGE("type: entity\ntitle: Foo", "merged body that is long enough to clear the threshold check"),
    )
    await mergePageContent(incoming, existing, merger, {
      ...baseOpts,
      backup,
    })
    expect(backup).not.toHaveBeenCalled()
  })

  it("backup failure is swallowed (best-effort, never blocks the write)", async () => {
    const existing = PAGE("type: entity\ntitle: Foo", "old body")
    const incoming = PAGE("type: entity\ntitle: Foo", "new body content")
    const backup = vi.fn().mockRejectedValue(new Error("disk full"))
    const merger = vi.fn().mockRejectedValue(new Error("network error"))

    // Should still resolve — backup error must not propagate
    const out = await mergePageContent(incoming, existing, merger, {
      ...baseOpts,
      backup,
    })
    expect(out).toContain("new body content")
  })
})
