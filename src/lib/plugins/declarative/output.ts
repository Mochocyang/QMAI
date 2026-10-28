/**
 * 模型输出解析（设计 D3：**解析失败必须可降级**）。
 *
 * 这里是整个声明式链路里最容易被"模型不听话"打穿的一环：让它每行一个书名，
 * 它可能加编号、加引号、加解释、套 JSON、或者干脆返回空。因此本文件的铁律是：
 *
 *   **永不抛错。** 解析不出来就返回 `degraded`，把原文原样交给 UI 展示并允许手动复制。
 *   模型不听话是常态，不是用户的错 —— 把异常抛给用户等于让他为别人的错误买单。
 *
 * 同时 `reason` 会进日志（设计 §3.5），作者据此改提示词；降级不是"掩盖问题"，
 * 是"不打断用户，但留下证据"。
 */
import type { ActionOutput, OutputMode } from "./types"

export type ParsedOutput =
  | { kind: "list"; items: string[]; degraded: false }
  | { kind: "text"; text: string; degraded?: false }
  | { kind: "degraded"; text: string; reason: string }

/** 行首编号/项目符号：`1.` `2、` `3)` `-` `*` `•`（模型十次有九次会自己加）。 */
const LEADING_MARKER = /^\s*(?:\d+[.、)]|[-*•])\s*/

/**
 * 成对包裹的引号。只去**成对**的：单边去会把 `《书名》` 这类中文书名号里的
 * 正常内容也吃掉，而去成对引号不会误伤（不成对时根本不匹配）。
 */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["「", "」"],
]

function stripPairedQuotes(value: string): string {
  for (const [open, close] of QUOTE_PAIRS) {
    if (value.length >= 2 && value.startsWith(open) && value.endsWith(close)) {
      return value.slice(open.length, value.length - close.length).trim()
    }
  }
  return value
}

/** 单行清洗：去编号 → 去首尾空白 → 去成对引号 → 再去首尾空白（引号里常带空格）。 */
function cleanListLine(line: string): string {
  const withoutMarker = line.replace(LEADING_MARKER, "")
  return stripPairedQuotes(withoutMarker.trim()).trim()
}

function degrade(raw: string, reason: string): ParsedOutput {
  return { kind: "degraded", text: raw, reason }
}

/**
 * `degraded` 里的 `text` 一律保留**原文**：UI 降级展示的就是它，
 * 清洗过的版本会丢掉用户手动复制的可能性（比如他只想从噪音里挑两条）。
 */
function parseList(raw: string, maxItems: number | undefined): ParsedOutput {
  const items: string[] = []
  // 兼容 `\r\n`：Windows 侧模型输出常带 `\r`，不切它会让每条末尾多一个不可见字符
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = cleanListLine(line)
    if (cleaned === "") continue
    items.push(cleaned)
    // 早停：超长输出（上万行）没必要全部清洗，`maxItems` 之外的行注定被丢掉
    if (maxItems !== undefined && items.length >= maxItems) break
  }
  if (items.length === 0) return degrade(raw, "没有解析出任何条目")
  return { kind: "list", items, degraded: false }
}

/**
 * 从一段"带说明文字的输出"里抽第一个 JSON 片段。
 *
 * 判断依据是括号位置而不是正则配对：模型常写"好的，结果如下：\n[...]\n希望满意"，
 * 这里按最靠前的 `[` / `{` 起步，配到该字符最后一次出现，失败就换另一种括号再试。
 */
function extractJsonFragment(raw: string): unknown {
  const candidates: Array<[string, string]> = [
    ["[", "]"],
    ["{", "}"],
  ]
  const ordered = candidates
    .map(([open, close]) => ({ open, close, at: raw.indexOf(open) }))
    .filter((candidate) => candidate.at >= 0)
    .sort((a, b) => a.at - b.at)

  for (const { close, at } of ordered) {
    const end = raw.lastIndexOf(close)
    if (end <= at) continue
    try {
      // 这里的抛错是**预期路径**：切错了括号就继续循环，绝不给调用方
      return JSON.parse(raw.slice(at, end + 1))
    } catch {
      // 接着试另一种括号
    }
  }
  return undefined
}

function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = raw.trim()
  if (trimmed !== "") {
    try {
      return { ok: true, value: JSON.parse(trimmed) }
    } catch {
      // 整体不是 JSON：下面按片段再试一次
    }
  }
  const fragment = extractJsonFragment(raw)
  return fragment === undefined ? { ok: false } : { ok: true, value: fragment }
}

/** 对象里优先取这几个字段：声明式输出的常见包裹形状。 */
const PREFERRED_TEXT_KEYS = ["text", "content", "result"] as const

function parseJson(raw: string, maxItems: number | undefined): ParsedOutput {
  const parsed = tryParseJson(raw)
  if (!parsed.ok) return degrade(raw, "JSON 解析失败")

  const value = parsed.value

  if (Array.isArray(value)) {
    const items: string[] = []
    for (const item of value) {
      // 非字符串元素 stringify：数组里塞对象是作者没约束好 schema，
      // 但把它显示成 JSON 比丢掉更能让作者看出问题在哪
      const text = typeof item === "string" ? item.trim() : JSON.stringify(item) ?? ""
      if (text === "") continue
      items.push(text)
      if (maxItems !== undefined && items.length >= maxItems) break
    }
    // 解析成功但一条都没有 → 与 list 模式保持同一口径：降级展示原文
    if (items.length === 0) return degrade(raw, "没有解析出任何条目")
    return { kind: "list", items, degraded: false }
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of PREFERRED_TEXT_KEYS) {
      const field = record[key]
      if (typeof field === "string" && field.trim() !== "") {
        return { kind: "text", text: field }
      }
    }
    // 没有约定字段：整体 stringify（缩进 2 格，结果面板里可读）
    return { kind: "text", text: JSON.stringify(value, null, 2) }
  }

  if (typeof value === "string") return { kind: "text", text: value }
  if (typeof value === "number" || typeof value === "boolean") {
    return { kind: "text", text: String(value) }
  }
  // `null` / 其它：什么都展示不出来，按降级处理
  return degrade(raw, "JSON 解析失败")
}

function normalizeMode(mode: unknown): OutputMode {
  return mode === "list" || mode === "json" || mode === "text" ? mode : "text"
}

/**
 * 按 mode 解析模型输出。永不抛错 —— 解析失败降级成 `degraded`（D3）。
 *
 * `maxItems` 只在 `list` / `json` 有意义；写成 0 或负数等于"没有上限"，
 * 这与"截断到 0 条"的直觉相反，故按无上限处理。
 */
export function parseOutput(raw: string, output: ActionOutput): ParsedOutput {
  // 运行期防御：TS 说 raw 是 string，但流式拼接/上游异常都可能塞进非字符串
  const text = typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : String(raw)

  if (text.trim() === "") return degrade(text, "模型没有返回内容")

  const declaredMaxItems = output?.maxItems
  const maxItems =
    typeof declaredMaxItems === "number" && Number.isFinite(declaredMaxItems) && declaredMaxItems > 0
      ? Math.floor(declaredMaxItems)
      : undefined

  switch (normalizeMode(output?.mode)) {
    case "list":
      return parseList(text, maxItems)
    case "json":
      return parseJson(text, maxItems)
    case "text":
      return { kind: "text", text }
  }
}
