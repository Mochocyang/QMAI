import { diffChars } from "diff"
import { parseFrontmatter } from "@/lib/frontmatter"

/**
 * 写作字数的来源归属。
 *
 * - `human`：用户一个字一个字敲出来的。
 * - `ai`：AI 一次性生成/改写出来的。
 * - `unknown`：来源不可知的写入（外部同步、改动前就存在的章节、跨重启后的
 *   带外修改）。**故意不计入任何一栏**——宁可少算，也不能把来路不明的文字
 *   算成用户手写的，那会让「今日手写」这个数字撒谎。
 */
export type WritingSource = "human" | "ai" | "unknown"

/** 单次变更带来的增减量，单位是「计数字符」。 */
export interface WritingDelta {
  humanAdded: number
  aiAdded: number
  unknownAdded: number
  humanRemoved: number
  aiRemoved: number
  unknownRemoved: number
}

export function emptyWritingDelta(): WritingDelta {
  return {
    humanAdded: 0,
    aiAdded: 0,
    unknownAdded: 0,
    humanRemoved: 0,
    aiRemoved: 0,
    unknownRemoved: 0,
  }
}

export function addWritingDelta(a: WritingDelta, b: WritingDelta): WritingDelta {
  return {
    humanAdded: a.humanAdded + b.humanAdded,
    aiAdded: a.aiAdded + b.aiAdded,
    unknownAdded: a.unknownAdded + b.unknownAdded,
    humanRemoved: a.humanRemoved + b.humanRemoved,
    aiRemoved: a.aiRemoved + b.aiRemoved,
    unknownRemoved: a.unknownRemoved + b.unknownRemoved,
  }
}

/** 一天之内的净增减：手写 = 手写新增 − 手写删除，AI 同理。 */
export function netDailyChange(delta: WritingDelta): { human: number; ai: number } {
  return {
    human: delta.humanAdded - delta.humanRemoved,
    ai: delta.aiAdded - delta.aiRemoved,
  }
}

/** 计数字符口径：丢掉 frontmatter → 丢掉首个 `# 标题` 行 → 丢掉所有空白（含全角空格）。 */
export function normalizeCountableText(markdown: string): string {
  const { body } = parseFrontmatter(markdown)
  const withoutHeading = body.replace(/^#\s+.+?(?:\r?\n|$)/, "")
  return withoutHeading.replace(/[\s\u3000]+/g, "")
}

const SOURCE_CODES: Record<WritingSource, string> = {
  human: "h",
  ai: "a",
  unknown: "u",
}

const CODES_TO_SOURCE: Record<string, WritingSource> = {
  h: "human",
  a: "ai",
  u: "unknown",
}

/**
 * 来源数组 → 游程编码串（`h12a3000u5`）。
 *
 * 正典文本整段是 AI 产出时游程极短，所以落盘体积极小；逐字符存 `"0"/"1"`
 * 会让 300 万字的小说撑出几 MB 的无用 JSON。
 */
export function encodeWritingSources(sources: readonly WritingSource[]): string {
  let out = ""
  let index = 0
  while (index < sources.length) {
    const source = sources[index]!
    let end = index + 1
    while (end < sources.length && sources[end] === source) end += 1
    out += `${SOURCE_CODES[source]}${end - index}`
    index = end
  }
  return out
}

/**
 * 游程编码串 → 来源数组。
 *
 * 解出的长度必须等于 `expectedLength`，否则返回 `null`：长度对不上说明编码
 * 与文本已经错位，此时**必须**让调用方重新打基线，绝不能猜着对齐把归属算错。
 */
export function decodeWritingSources(
  encoded: string,
  expectedLength: number,
): WritingSource[] | null {
  if (expectedLength === 0) return encoded === "" ? [] : null
  const sources: WritingSource[] = []
  const re = /([hau])(\d+)/g
  let consumed = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(encoded)) !== null) {
    const source = CODES_TO_SOURCE[match[1]!]
    const count = Number(match[2])
    if (!source || !Number.isSafeInteger(count) || count <= 0) return null
    for (let i = 0; i < count; i += 1) sources.push(source)
    consumed += match[0].length
  }
  if (consumed !== encoded.length) return null
  if (sources.length !== expectedLength) return null
  return sources
}

/**
 * 章节的归属账本：`text` 是**计数口径**下的正文，`sources` 与它逐字符对齐。
 *
 * 刻意存计数后的文本而不是原始 markdown：这样「归属」与「字数」永远同一把尺子，
 * 改标题、加空行、动 frontmatter 都不会污染字数统计。
 */
export interface WritingProvenance {
  text: string
  sources: WritingSource[]
}

export function emptyProvenance(): WritingProvenance {
  return { text: "", sources: [] }
}

/** 游程解码失败（长度错位）或哈希不符时，整段重新打基线且不计账。 */
export function rebaselineProvenance(
  markdown: string,
  source: WritingSource,
): WritingProvenance {
  const text = normalizeCountableText(markdown)
  return { text, sources: new Array<WritingSource>(text.length).fill(source) }
}

/** 32 位 FNV-1a。只用来判断「还是不是同一段文本」，不做安全用途。 */
export function writingTextHash(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16)
}

export interface WritingChangeResult {
  provenance: WritingProvenance
  delta: WritingDelta
}

/**
 * 把一次文本变更记到归属账本上。
 *
 * 思路：先把新旧 markdown 归一到计数口径，再在**计数口径的字符**上做差异。
 * 于是「插入」就是用户/AI 真正新增的字，「删除」就是真正消失的字，删除能按
 * 被删字符原本的归属精确扣到对应那一栏——这正是需求里要的「删除扣减」。
 *
 * 只有当新旧文本都存在非空变更段时才动用字符级 diff；纯插入/纯删除走
 * 公共前后缀快路径，是 O(n) 且完全精确的（打字、退格、粘贴、剪切都属于它）。
 */
export function applyWritingChange(
  previous: WritingProvenance,
  nextMarkdown: string,
  sourceForInsertions: WritingSource,
): WritingChangeResult {
  const nextText = normalizeCountableText(nextMarkdown)
  if (previous.sources.length !== previous.text.length) {
    // 账本自己坏了：重新打基线，本次数额不记（记了就是凭空造数）。
    return {
      provenance: rebaselineProvenance(nextMarkdown, "unknown"),
      delta: emptyWritingDelta(),
    }
  }
  if (nextText === previous.text) {
    return { provenance: previous, delta: emptyWritingDelta() }
  }

  const previousText = previous.text
  const previousSources = previous.sources

  let prefix = 0
  const maxPrefix = Math.min(previousText.length, nextText.length)
  while (prefix < maxPrefix && previousText[prefix] === nextText[prefix]) prefix += 1

  let suffix = 0
  const maxSuffix = Math.min(previousText.length - prefix, nextText.length - prefix)
  while (
    suffix < maxSuffix
    && previousText[previousText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const removedStart = prefix
  const removedEnd = previousText.length - suffix
  const removedText = previousText.slice(removedStart, removedEnd)
  const removedSources = previousSources.slice(removedStart, removedEnd)
  const addedText = nextText.slice(prefix, nextText.length - suffix)

  const delta = emptyWritingDelta()
  const insertedSources: WritingSource[] = []

  const recordRemoved = (source: WritingSource, count: number) => {
    if (count <= 0) return
    if (source === "human") delta.humanRemoved += count
    else if (source === "ai") delta.aiRemoved += count
    else delta.unknownRemoved += count
  }
  const recordAdded = (count: number) => {
    if (count <= 0) return
    if (sourceForInsertions === "human") delta.humanAdded += count
    else if (sourceForInsertions === "ai") delta.aiAdded += count
    else delta.unknownAdded += count
  }

  // 新旧变更段都非空 = 这是一次「替换」。逐字符 diff 能认出替换里保留下来的字
  // （把「他」改成「她」只算 1 增 1 删），比整段当替换精确得多。
  //
  // `maxEditLength` + `timeout` 是必须的：这两个上限一旦触发，`diffChars` 返回
  // `undefined`，我们退化成「整段替换」。没有它们的话，用户在几千字的章节里
  // 做一次大范围改写就会在**每次击键**上跑一次二次方级的 diff，输入框直接卡死。
  const parts = removedText.length > 0 && addedText.length > 0
    ? diffChars(removedText, addedText, { maxEditLength: 4000, timeout: 120 })
    : undefined

  if (parts) {
    // `diffChars` 按顺序吐出分段：未变段与删除段依次消耗 removedText，
    // 所以一个从 0 开始推进的游标就能把每段对回原归属，不需要再搜索定位。
    let removedCursor = 0
    for (const part of parts) {
      if (part.added) {
        for (let i = 0; i < part.value.length; i += 1) insertedSources.push(sourceForInsertions)
        recordAdded(part.value.length)
        continue
      }
      for (let i = 0; i < part.value.length; i += 1) {
        const source = removedSources[removedCursor + i] ?? "unknown"
        if (part.removed) recordRemoved(source, 1)
        else insertedSources.push(source)
      }
      removedCursor += part.value.length
    }
  } else {
    for (const source of removedSources) recordRemoved(source, 1)
    for (let i = 0; i < addedText.length; i += 1) insertedSources.push(sourceForInsertions)
    recordAdded(addedText.length)
  }

  const sources: WritingSource[] = [
    ...previousSources.slice(0, prefix),
    ...insertedSources,
    ...previousSources.slice(removedEnd),
  ]

  return { provenance: { text: nextText, sources }, delta }
}

/** 今日累计：从 0 开始，删除扣减，且不允许为负。 */
export function applyDeltaToDaily(
  current: { humanChars: number; aiChars: number },
  delta: WritingDelta,
): { humanChars: number; aiChars: number } {
  const net = netDailyChange(delta)
  return {
    humanChars: Math.max(0, current.humanChars + net.human),
    aiChars: Math.max(0, current.aiChars + net.ai),
  }
}
