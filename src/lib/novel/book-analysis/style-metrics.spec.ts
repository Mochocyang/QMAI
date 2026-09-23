import { afterEach, describe, expect, it, vi } from "vitest"
import {
  computeStyleMetrics,
  deriveStyleMetrics,
  formatStyleMetricsForMarkdown,
  formatStyleMetricsForPrompt,
  mergeStyleMetrics,
  resetSegmenterCache,
  splitSentences,
} from "./style-metrics"

afterEach(() => {
  vi.unstubAllGlobals()
  resetSegmenterCache()
})

describe("splitSentences", () => {
  it("splits on Chinese terminal punctuation and keeps the punctuation", () => {
    expect(splitSentences("他走了。她没动！真的吗？")).toEqual(["他走了。", "她没动！", "真的吗？"])
  })

  it("treats an ellipsis as a single terminator", () => {
    expect(splitSentences("他想说什么……最后什么也没说。")).toEqual(["他想说什么……", "最后什么也没说。"])
  })

  it("keeps a trailing closing quote with the sentence", () => {
    expect(splitSentences("“别过来。”他退了一步。")).toEqual(["“别过来。”", "他退了一步。"])
  })

  it("returns a single sentence when there is no terminator", () => {
    expect(splitSentences("没有句末标点")).toEqual(["没有句末标点"])
  })
})

describe("computeStyleMetrics", () => {
  it("counts sentences, paragraphs and the short sentence ratio", () => {
    const metrics = computeStyleMetrics(["他走了。\n\n她没动。"])
    expect(metrics.counts.chapters).toBe(1)
    expect(metrics.counts.sentences).toBe(2)
    expect(metrics.counts.paragraphs).toBe(2)
    expect(metrics.counts.oneSentenceParagraphs).toBe(2)
    expect(metrics.derived.shortSentenceRatio).toBe(1)
    expect(metrics.derived.longSentenceRatio).toBe(0)
    expect(metrics.derived.oneSentenceParagraphRatio).toBe(1)
  })

  it("flags long sentences and long paragraphs", () => {
    const longSentence = `${"这是一个很长的句子用来测试长句判定".repeat(4)}。`
    const metrics = computeStyleMetrics([longSentence])
    expect(metrics.counts.longSentences).toBe(1)
    expect(metrics.counts.longParagraphs).toBe(0)
    expect(metrics.derived.longSentenceRatio).toBe(1)
  })

  it("detects dialogue paragraphs by quote marks", () => {
    const metrics = computeStyleMetrics(["“你来了。”\n他点头。"])
    expect(metrics.counts.dialogueParagraphs).toBe(1)
    expect(metrics.derived.dialogueParagraphRatio).toBe(0.5)
  })

  it("counts punctuation per thousand characters", () => {
    const metrics = computeStyleMetrics(["他——真的走了！你信吗？"])
    expect(metrics.counts.punctuation.dash).toBe(1)
    expect(metrics.counts.punctuation.exclamation).toBe(1)
    expect(metrics.counts.punctuation.question).toBe(1)
    expect(metrics.derived.punctuationPerThousand.dash).toBeGreaterThan(0)
  })

  it("measures the latin character ratio for mixed text", () => {
    const metrics = computeStyleMetrics(["他打开了 API 文档。"])
    expect(metrics.counts.latinChars).toBe(3)
    expect(metrics.derived.latinCharRatio).toBeGreaterThan(0)
  })

  it("filters single characters and stop words out of topWords", () => {
    const metrics = computeStyleMetrics(["他没有回头。他没有回头。他没有回头。"])
    expect(metrics.topWords.every((item) => item.word.length >= 2)).toBe(true)
    expect(metrics.topWords.some((item) => item.word === "没有")).toBe(false)
    expect(metrics.topWords.some((item) => item.word === "回头")).toBe(true)
  })

  it("collects sentence openers", () => {
    const metrics = computeStyleMetrics(["然后他走了。然后她走了。"])
    expect(metrics.topSentenceOpeners[0]).toEqual({ word: "然后", count: 2 })
  })

  it("returns all-zero metrics for empty input without producing NaN", () => {
    const metrics = computeStyleMetrics([])
    expect(metrics.counts.chapters).toBe(0)
    expect(metrics.derived.avgSentenceChars).toBe(0)
    expect(metrics.derived.shortSentenceRatio).toBe(0)
    expect(metrics.derived.punctuationPerThousand.comma).toBe(0)
    expect(metrics.segmenterAvailable).toBe(false)
  })

  it("skips blank chapter bodies", () => {
    const metrics = computeStyleMetrics(["", "   ", "他走了。"])
    expect(metrics.counts.chapters).toBe(1)
  })

  it("handles pure english text", () => {
    const metrics = computeStyleMetrics(["He left. She stayed."])
    expect(metrics.counts.chars).toBeGreaterThan(0)
    expect(metrics.derived.latinCharRatio).toBeGreaterThan(0.5)
  })

  it("falls back to character bigrams when Intl.Segmenter is unavailable", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined })
    resetSegmenterCache()
    const metrics = computeStyleMetrics(["他没有回头，只是把烟按在栏杆上。"])
    expect(metrics.segmenterAvailable).toBe(false)
    expect(metrics.topWords.length).toBeGreaterThan(0)
    expect(metrics.counts.sentences).toBe(1)
  })

  it("falls back when Segmenter cannot segment Chinese words", () => {
    class NoopSegmenter {
      segment(input: string) {
        return [{ segment: input, index: 0, input, isWordLike: true }]
      }
    }
    vi.stubGlobal("Intl", { ...Intl, Segmenter: NoopSegmenter })
    resetSegmenterCache()
    const metrics = computeStyleMetrics(["他没有回头，只是把烟按在栏杆上。"])
    expect(metrics.segmenterAvailable).toBe(false)
  })
})

describe("mergeStyleMetrics", () => {
  it("sums raw counts and re-derives ratios instead of averaging them", () => {
    const first = computeStyleMetrics(["他走了。"])
    const second = computeStyleMetrics([`${"这是一个很长的句子用来测试长句判定".repeat(4)}。`])
    const merged = mergeStyleMetrics([first, second])

    expect(merged.counts.chapters).toBe(2)
    expect(merged.counts.sentences).toBe(2)
    expect(merged.derived.shortSentenceRatio).toBe(0.5)
    expect(merged.derived.longSentenceRatio).toBe(0.5)
    expect(merged.derived.avgSentenceChars).toBe(
      Number(((first.counts.sentenceCharTotal + second.counts.sentenceCharTotal) / 2).toFixed(2)),
    )
  })

  it("merges word frequency tables by summing counts", () => {
    const merged = mergeStyleMetrics([
      computeStyleMetrics(["他没有回头。"]),
      computeStyleMetrics(["他没有回头。"]),
    ])
    expect(merged.topWords.find((item) => item.word === "回头")?.count).toBe(2)
  })

  it("returns the single item unchanged", () => {
    const only = computeStyleMetrics(["他走了。"])
    expect(mergeStyleMetrics([only])).toBe(only)
  })

  it("returns empty metrics for an empty list", () => {
    expect(mergeStyleMetrics([]).counts.chapters).toBe(0)
  })

  it("marks the segmenter unavailable when any chunk lacked it", () => {
    const good = computeStyleMetrics(["他没有回头。"])
    const degraded = { ...good, segmenterAvailable: false }
    expect(mergeStyleMetrics([good, degraded]).segmenterAvailable).toBe(false)
  })
})

describe("deriveStyleMetrics", () => {
  it("never divides by zero", () => {
    const derived = deriveStyleMetrics({
      chapters: 0,
      chars: 0,
      latinChars: 0,
      sentences: 0,
      shortSentences: 0,
      longSentences: 0,
      sentenceCharTotal: 0,
      paragraphs: 0,
      oneSentenceParagraphs: 0,
      longParagraphs: 0,
      dialogueParagraphs: 0,
      punctuation: {
        dash: 0, ellipsis: 0, quote: 0, exclamation: 0,
        question: 0, comma: 0, semicolon: 0, colon: 0,
      },
    })
    for (const value of Object.values(derived.punctuationPerThousand)) expect(value).toBe(0)
    expect(Number.isNaN(derived.avgParagraphChars)).toBe(false)
  })
})

describe("formatting", () => {
  it("renders numbers for the prompt without drawing conclusions", () => {
    const text = formatStyleMetricsForPrompt(computeStyleMetrics(["他走了。她没动。"]))
    expect(text).toContain("平均句长")
    expect(text).toContain("短句")
    expect(text).toContain("高频实词")
  })

  it("warns in the prompt when the segmenter was unavailable", () => {
    const metrics = { ...computeStyleMetrics(["他走了。"]), segmenterAvailable: false }
    expect(formatStyleMetricsForPrompt(metrics)).toContain("缺少中文分词能力")
  })

  it("renders a markdown table", () => {
    const markdown = formatStyleMetricsForMarkdown(computeStyleMetrics(["他走了。"]))
    expect(markdown).toContain("| 指标 | 数值 |")
    expect(markdown).toContain("平均句长")
  })
})
