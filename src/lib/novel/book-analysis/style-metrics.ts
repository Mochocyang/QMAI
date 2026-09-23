/**
 * L1 语言 / L6 排版节奏的确定性统计（feature/writing-dna）
 *
 * 纯函数、零依赖、不调 LLM。分层蒸馏里 L1 和 L6 的数字全部由这里算出，
 * 再把数字喂进 prompt 让模型解读，避免让模型凭感觉猜"句子偏短""节奏偏快"。
 *
 * 中文分词用运行时自带的 Intl.Segmenter；不可用时降级为相邻汉字二元窗口，
 * 并把 segmenterAvailable 置为 false，供 UI 与 prompt 标注可信度。
 */

/** 原始计数：多分片合并时直接相加，再重新派生比率，避免"比率的平均"失真。 */
export interface StyleMetricCounts {
  chapters: number
  chars: number
  latinChars: number
  sentences: number
  shortSentences: number
  longSentences: number
  sentenceCharTotal: number
  paragraphs: number
  oneSentenceParagraphs: number
  longParagraphs: number
  dialogueParagraphs: number
  punctuation: {
    dash: number
    ellipsis: number
    quote: number
    exclamation: number
    question: number
    comma: number
    semicolon: number
    colon: number
  }
}

export interface WordFrequency {
  word: string
  count: number
}

/** 派生指标：全部可由 counts 重算，落盘只为可读性与 prompt 直接引用。 */
export interface StyleMetricDerived {
  /** 平均句长（字符） */
  avgSentenceChars: number
  /** 短句占比：不超过 SHORT_SENTENCE_MAX_CHARS 字 */
  shortSentenceRatio: number
  /** 长句占比：不少于 LONG_SENTENCE_MIN_CHARS 字 */
  longSentenceRatio: number
  /** 平均段落字数 */
  avgParagraphChars: number
  /** 平均每段句数 */
  avgParagraphSentences: number
  /** 一句一段占比 */
  oneSentenceParagraphRatio: number
  /** 长段（不少于 LONG_PARAGRAPH_MIN_CHARS 字）占比 */
  longParagraphRatio: number
  /** 含引号对白的段落占比 */
  dialogueParagraphRatio: number
  /** 各标点每千字频次 */
  punctuationPerThousand: Record<keyof StyleMetricCounts["punctuation"], number>
  /** 拉丁字符占比（中英混用程度） */
  latinCharRatio: number
}

export interface StyleMetrics {
  schemaVersion: 1
  segmenterAvailable: boolean
  counts: StyleMetricCounts
  derived: StyleMetricDerived
  /** 高频实词（已过滤单字与功能词） */
  topWords: WordFrequency[]
  /** 高频二元搭配 */
  topBigrams: WordFrequency[]
  /** 高频句首词 */
  topSentenceOpeners: WordFrequency[]
}

export const SHORT_SENTENCE_MAX_CHARS = 15
export const LONG_SENTENCE_MIN_CHARS = 50
export const LONG_PARAGRAPH_MIN_CHARS = 200

const TOP_WORD_LIMIT = 40
const TOP_BIGRAM_LIMIT = 25
const TOP_OPENER_LIMIT = 20

/** 中文功能词：高频但不体现文风，从 topWords 里剔除。 */
const STOP_WORDS = new Set([
  "自己", "什么", "怎么", "这样", "那样", "已经", "可以", "可能", "但是", "因为", "所以",
  "如果", "虽然", "然后", "现在", "时候", "起来", "出来", "过去", "一个", "一些", "没有",
  "就是", "还是", "这个", "那个", "我们", "你们", "他们", "她们", "于是", "不过", "只是",
  "而且", "以后", "以前", "一下", "一样", "这些", "那些", "而是", "不是", "有些", "非常",
  "十分", "particularly", "however",
])

function isCjk(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return code >= 0x4e00 && code <= 0x9fff
}

function isLatinLetter(char: string): boolean {
  return /[A-Za-z]/.test(char)
}

function emptyCounts(): StyleMetricCounts {
  return {
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
      dash: 0,
      ellipsis: 0,
      quote: 0,
      exclamation: 0,
      question: 0,
      comma: 0,
      semicolon: 0,
      colon: 0,
    },
  }
}

/** 按中文句末标点切句；省略号与连续标点算一个句末。 */
export function splitSentences(text: string): string[] {
  return text
    .replace(/([。！？…]+["'”』」）)]?)/g, "$1\u0000")
    .split("\u0000")
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

/**
 * Intl.Segmenter 的最小结构声明。
 * 当前 tsconfig 的 lib 里没有它，为一个可选运行时能力去抬 lib 版本不值得。
 */
interface WordSegment {
  segment: string
  isWordLike?: boolean
}

interface WordSegmenter {
  segment(input: string): Iterable<WordSegment>
}

type WordSegmenterCtor = new (
  locale: string,
  options: { granularity: "word" },
) => WordSegmenter

let segmenterCache: WordSegmenter | null | undefined

/** 拿一个中文分词器；运行时不支持时返回 null（只探测一次）。 */
function getSegmenter(): WordSegmenter | null {
  if (segmenterCache !== undefined) return segmenterCache
  try {
    const SegmenterCtor = (Intl as unknown as { Segmenter?: WordSegmenterCtor }).Segmenter
    if (!SegmenterCtor) {
      segmenterCache = null
      return null
    }
    const instance = new SegmenterCtor("zh-CN", { granularity: "word" })
    // 探测：不支持中文粒度的实现会把整句当一个 segment
    const probe = [...instance.segment("他没有回头，只是把烟按在栏杆上")].filter((item) => item.isWordLike)
    segmenterCache = probe.length >= 3 ? instance : null
  } catch {
    segmenterCache = null
  }
  return segmenterCache
}

/** 仅供测试：重置分词器探测缓存。 */
export function resetSegmenterCache(): void {
  segmenterCache = undefined
}

/** 降级分词：相邻汉字二元窗口 + 连续拉丁词。 */
function fallbackTokenize(text: string): string[] {
  const tokens: string[] = []
  const latin = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []
  tokens.push(...latin.map((item) => item.toLowerCase()))
  const chars = [...text].filter(isCjk)
  for (let i = 0; i + 1 < chars.length; i += 1) {
    tokens.push(chars[i] + chars[i + 1])
  }
  return tokens
}

function tokenize(text: string): { tokens: string[]; segmented: boolean } {
  const segmenter = getSegmenter()
  if (!segmenter) return { tokens: fallbackTokenize(text), segmented: false }
  const tokens: string[] = []
  for (const item of segmenter.segment(text)) {
    if (!item.isWordLike) continue
    const word = item.segment.trim()
    if (word) tokens.push(isLatinLetter(word[0]) ? word.toLowerCase() : word)
  }
  return { tokens, segmented: true }
}

function bump(map: Map<string, number>, key: string, delta = 1): void {
  map.set(key, (map.get(key) ?? 0) + delta)
}

function topEntries(map: Map<string, number>, limit: number): WordFrequency[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }))
}

/** 由原始计数派生比率；分母为 0 时全部返回 0，不产生 NaN。 */
export function deriveStyleMetrics(counts: StyleMetricCounts): StyleMetricDerived {
  const ratio = (numerator: number, denominator: number): number =>
    denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0
  const perThousand = (value: number): number =>
    counts.chars > 0 ? Number(((value * 1000) / counts.chars).toFixed(2)) : 0

  return {
    avgSentenceChars: counts.sentences > 0
      ? Number((counts.sentenceCharTotal / counts.sentences).toFixed(2))
      : 0,
    shortSentenceRatio: ratio(counts.shortSentences, counts.sentences),
    longSentenceRatio: ratio(counts.longSentences, counts.sentences),
    avgParagraphChars: counts.paragraphs > 0
      ? Number((counts.chars / counts.paragraphs).toFixed(2))
      : 0,
    avgParagraphSentences: counts.paragraphs > 0
      ? Number((counts.sentences / counts.paragraphs).toFixed(2))
      : 0,
    oneSentenceParagraphRatio: ratio(counts.oneSentenceParagraphs, counts.paragraphs),
    longParagraphRatio: ratio(counts.longParagraphs, counts.paragraphs),
    dialogueParagraphRatio: ratio(counts.dialogueParagraphs, counts.paragraphs),
    punctuationPerThousand: {
      dash: perThousand(counts.punctuation.dash),
      ellipsis: perThousand(counts.punctuation.ellipsis),
      quote: perThousand(counts.punctuation.quote),
      exclamation: perThousand(counts.punctuation.exclamation),
      question: perThousand(counts.punctuation.question),
      comma: perThousand(counts.punctuation.comma),
      semicolon: perThousand(counts.punctuation.semicolon),
      colon: perThousand(counts.punctuation.colon),
    },
    latinCharRatio: ratio(counts.latinChars, counts.chars),
  }
}

/**
 * 对一批章节正文做 L1 / L6 统计。
 * @param chapterBodies 已剥掉 frontmatter 的章节正文
 */
export function computeStyleMetrics(chapterBodies: string[]): StyleMetrics {
  const counts = emptyCounts()
  const wordFreq = new Map<string, number>()
  const bigramFreq = new Map<string, number>()
  const openerFreq = new Map<string, number>()
  let segmented = true

  for (const body of chapterBodies) {
    const text = body.trim()
    if (!text) continue
    counts.chapters += 1
    counts.chars += text.length
    for (const char of text) {
      if (isLatinLetter(char)) counts.latinChars += 1
    }

    counts.punctuation.dash += countMatches(text, /——|—/g)
    counts.punctuation.ellipsis += countMatches(text, /…{1,2}|\.{3,}/g)
    counts.punctuation.quote += countMatches(text, /[“”「」『』"]/g)
    counts.punctuation.exclamation += countMatches(text, /[！!]/g)
    counts.punctuation.question += countMatches(text, /[？?]/g)
    counts.punctuation.comma += countMatches(text, /[，,、]/g)
    counts.punctuation.semicolon += countMatches(text, /[；;]/g)
    counts.punctuation.colon += countMatches(text, /[：:]/g)

    for (const paragraph of splitParagraphs(text)) {
      counts.paragraphs += 1
      if (paragraph.length >= LONG_PARAGRAPH_MIN_CHARS) counts.longParagraphs += 1
      if (/[“”「」『』]/.test(paragraph)) counts.dialogueParagraphs += 1
      const sentences = splitSentences(paragraph)
      if (sentences.length <= 1) counts.oneSentenceParagraphs += 1
      for (const sentence of sentences) {
        counts.sentences += 1
        counts.sentenceCharTotal += sentence.length
        if (sentence.length <= SHORT_SENTENCE_MAX_CHARS) counts.shortSentences += 1
        if (sentence.length >= LONG_SENTENCE_MIN_CHARS) counts.longSentences += 1

        const { tokens, segmented: ok } = tokenize(sentence)
        if (!ok) segmented = false
        if (tokens.length > 0) bump(openerFreq, tokens[0])
        for (let i = 0; i < tokens.length; i += 1) {
          const token = tokens[i]
          if (token.length >= 2 && !STOP_WORDS.has(token)) bump(wordFreq, token)
          if (i + 1 < tokens.length) bump(bigramFreq, `${token}${tokens[i + 1]}`)
        }
      }
    }
  }

  return {
    schemaVersion: 1,
    segmenterAvailable: segmented && counts.chapters > 0,
    counts,
    derived: deriveStyleMetrics(counts),
    topWords: topEntries(wordFreq, TOP_WORD_LIMIT),
    topBigrams: topEntries(bigramFreq, TOP_BIGRAM_LIMIT),
    topSentenceOpeners: topEntries(openerFreq, TOP_OPENER_LIMIT),
  }
}

/** 多分片合并：计数相加后重新派生，词频表相加后重新取 top。 */
export function mergeStyleMetrics(items: StyleMetrics[]): StyleMetrics {
  const present = items.filter(Boolean)
  if (present.length === 0) return computeStyleMetrics([])
  if (present.length === 1) return present[0]

  const counts = emptyCounts()
  const wordFreq = new Map<string, number>()
  const bigramFreq = new Map<string, number>()
  const openerFreq = new Map<string, number>()

  for (const item of present) {
    counts.chapters += item.counts.chapters
    counts.chars += item.counts.chars
    counts.latinChars += item.counts.latinChars
    counts.sentences += item.counts.sentences
    counts.shortSentences += item.counts.shortSentences
    counts.longSentences += item.counts.longSentences
    counts.sentenceCharTotal += item.counts.sentenceCharTotal
    counts.paragraphs += item.counts.paragraphs
    counts.oneSentenceParagraphs += item.counts.oneSentenceParagraphs
    counts.longParagraphs += item.counts.longParagraphs
    counts.dialogueParagraphs += item.counts.dialogueParagraphs
    for (const key of Object.keys(counts.punctuation) as Array<keyof StyleMetricCounts["punctuation"]>) {
      counts.punctuation[key] += item.counts.punctuation[key]
    }
    for (const entry of item.topWords) bump(wordFreq, entry.word, entry.count)
    for (const entry of item.topBigrams) bump(bigramFreq, entry.word, entry.count)
    for (const entry of item.topSentenceOpeners) bump(openerFreq, entry.word, entry.count)
  }

  return {
    schemaVersion: 1,
    segmenterAvailable: present.every((item) => item.segmenterAvailable),
    counts,
    derived: deriveStyleMetrics(counts),
    topWords: topEntries(wordFreq, TOP_WORD_LIMIT),
    topBigrams: topEntries(bigramFreq, TOP_BIGRAM_LIMIT),
    topSentenceOpeners: topEntries(openerFreq, TOP_OPENER_LIMIT),
  }
}

function formatFrequencies(items: WordFrequency[], limit: number): string {
  const sliced = items.slice(0, limit)
  if (sliced.length === 0) return "（无）"
  return sliced.map((item) => `${item.word}(${item.count})`).join("、")
}

/**
 * 把统计结果渲染成给 LLM 读的紧凑文本块。
 * 只给数字，不给结论——结论由模型在 L1/L6 prompt 里产出。
 */
export function formatStyleMetricsForPrompt(metrics: StyleMetrics): string {
  const { counts, derived } = metrics
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`
  return [
    `样本规模：${counts.chapters} 章 / ${counts.chars} 字 / ${counts.sentences} 句 / ${counts.paragraphs} 段`,
    `平均句长：${derived.avgSentenceChars} 字`,
    `短句（≤${SHORT_SENTENCE_MAX_CHARS}字）占比：${percent(derived.shortSentenceRatio)}`,
    `长句（≥${LONG_SENTENCE_MIN_CHARS}字）占比：${percent(derived.longSentenceRatio)}`,
    `平均段落：${derived.avgParagraphChars} 字 / ${derived.avgParagraphSentences} 句`,
    `一句一段占比：${percent(derived.oneSentenceParagraphRatio)}`,
    `长段（≥${LONG_PARAGRAPH_MIN_CHARS}字）占比：${percent(derived.longParagraphRatio)}`,
    `含引号对白段落占比：${percent(derived.dialogueParagraphRatio)}`,
    `标点每千字频次：破折号 ${derived.punctuationPerThousand.dash}、省略号 ${derived.punctuationPerThousand.ellipsis}、`
      + `引号 ${derived.punctuationPerThousand.quote}、感叹号 ${derived.punctuationPerThousand.exclamation}、`
      + `问号 ${derived.punctuationPerThousand.question}、逗号 ${derived.punctuationPerThousand.comma}、`
      + `分号 ${derived.punctuationPerThousand.semicolon}、冒号 ${derived.punctuationPerThousand.colon}`,
    `拉丁字符占比：${percent(derived.latinCharRatio)}`,
    `高频实词：${formatFrequencies(metrics.topWords, 30)}`,
    `高频二元搭配：${formatFrequencies(metrics.topBigrams, 20)}`,
    `高频句首词：${formatFrequencies(metrics.topSentenceOpeners, 15)}`,
    metrics.segmenterAvailable
      ? ""
      : "注意：本次运行环境缺少中文分词能力，上面的词频表来自相邻汉字二元窗口，属近似结果，请只用作参考，不要把它当成精确词表。",
  ].filter(Boolean).join("\n")
}

/** 把统计结果渲染成人类可读 markdown 表格（写入语言DNA.md 与排版节奏指南.md）。 */
export function formatStyleMetricsForMarkdown(metrics: StyleMetrics): string {
  const { counts, derived } = metrics
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`
  const rows: Array<[string, string]> = [
    ["样本章数", String(counts.chapters)],
    ["样本字数", String(counts.chars)],
    ["平均句长", `${derived.avgSentenceChars} 字`],
    [`短句占比（≤${SHORT_SENTENCE_MAX_CHARS}字）`, percent(derived.shortSentenceRatio)],
    [`长句占比（≥${LONG_SENTENCE_MIN_CHARS}字）`, percent(derived.longSentenceRatio)],
    ["平均段落字数", `${derived.avgParagraphChars} 字`],
    ["平均每段句数", `${derived.avgParagraphSentences} 句`],
    ["一句一段占比", percent(derived.oneSentenceParagraphRatio)],
    [`长段占比（≥${LONG_PARAGRAPH_MIN_CHARS}字）`, percent(derived.longParagraphRatio)],
    ["含对白段落占比", percent(derived.dialogueParagraphRatio)],
    ["破折号（每千字）", String(derived.punctuationPerThousand.dash)],
    ["省略号（每千字）", String(derived.punctuationPerThousand.ellipsis)],
    ["感叹号（每千字）", String(derived.punctuationPerThousand.exclamation)],
    ["问号（每千字）", String(derived.punctuationPerThousand.question)],
    ["逗号（每千字）", String(derived.punctuationPerThousand.comma)],
    ["分号（每千字）", String(derived.punctuationPerThousand.semicolon)],
    ["拉丁字符占比", percent(derived.latinCharRatio)],
  ]
  const lines = ["| 指标 | 数值 |", "| - | - |", ...rows.map(([key, value]) => `| ${key} | ${value} |`)]
  lines.push("", `**高频实词**：${formatFrequencies(metrics.topWords, 30)}`)
  lines.push("", `**高频二元搭配**：${formatFrequencies(metrics.topBigrams, 20)}`)
  lines.push("", `**高频句首词**：${formatFrequencies(metrics.topSentenceOpeners, 15)}`)
  if (!metrics.segmenterAvailable) {
    lines.push("", "> 本次运行环境缺少中文分词能力，词频表为相邻汉字二元窗口的近似结果。")
  }
  return lines.join("\n")
}
