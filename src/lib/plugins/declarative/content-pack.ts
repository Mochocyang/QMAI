/**
 * 内容包（设计第 4 章）：**随包分发、离线可用、零网络权限**（决策 D4）。
 *
 * 解析与检索都是纯函数，因此同一套规则既能被宿主（加载时）用，也能被将来的
 * `qmai-plugin validate` CLI 用 —— 作者在本地看到的错误与用户装包时看到的错误
 * 必须是同一句话，否则"能装上但打不开"的包会源源不断。
 *
 * `parseContentPack` 返回 `{ ok: false, errors }` 而不是抛错：错误要一次性
 * 全部列出（带条目索引），作者才能一次改完；抛第一个错只会让他反复试。
 */
import type { ContentPack, ContentPackItem } from "./types"

/** 单包条目上限（设计 D4）：5000 条 / 5MB。体积由 Rust 侧校验，条数在这里兜。 */
export const DEFAULT_MAX_CONTENT_ITEMS = 5000

/** 声明侧只需要这三个字段，多传不收（避免把整份清单固化进 pack）。 */
export interface ContentPackDeclaration {
  id: string
  title: string
  maxItems?: number
}

export type ContentPackParseResult =
  | { ok: true; pack: ContentPack }
  | { ok: false; errors: string[] }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

function resolveItemLimit(declared: number | undefined): number {
  if (typeof declared !== "number" || !Number.isFinite(declared) || declared <= 0) {
    return DEFAULT_MAX_CONTENT_ITEMS
  }
  return Math.floor(declared)
}

/** 解析并校验内容包 JSON；错误带具体 item 索引。 */
export function parseContentPack(raw: unknown, decl: ContentPackDeclaration): ContentPackParseResult {
  const source = asRecord(raw)
  if (!source) return { ok: false, errors: ["内容包必须是 JSON 对象"] }

  const errors: string[] = []

  // version 必须是**数字** 1：字符串 "1" 也拒绝，因为它是版本契约而不是展示字段，
  // 放宽一次就再也收不紧（将来 v2 结构上线时无法区分"字符串 1"的真实意图）。
  if (source.version !== 1) errors.push("内容包 version 必须为 1")

  const rawItems = source.items
  if (!Array.isArray(rawItems)) {
    // items 不是数组就没法继续往下校验，直接返回已收集的错误
    return { ok: false, errors: ["内容包 items 必须是数组"] }
  }

  const limit = resolveItemLimit(decl.maxItems)
  if (rawItems.length > limit) {
    errors.push(`内容包条目数 ${rawItems.length} 超过上限 ${limit}`)
  }

  const items: ContentPackItem[] = []
  const seenIds = new Set<string>()

  rawItems.forEach((rawItem, index) => {
    // 索引从 1 起报：作者看的是"第 3 条"，不是"第 2 个元素"
    const position = `第 ${index + 1} 条`
    const item = asRecord(rawItem)
    if (!item) {
      errors.push(`${position}必须是对象`)
      return
    }

    const id = item.id
    const title = item.title
    const body = item.body
    let usable = true

    if (!isNonEmptyString(id)) {
      errors.push(`${position}缺少有效的 id`)
      usable = false
    }
    if (!isNonEmptyString(title)) {
      errors.push(`${position}缺少有效的 title`)
      usable = false
    }
    if (!isNonEmptyString(body)) {
      errors.push(`${position}缺少有效的 body`)
      usable = false
    }

    // 唯一性以**去空白后**的 id 为准：落库存的是 trimmed 版本，如果按原串去重，
    // " i001" 与 "i001" 会双双通过校验却在包里撞成同一个 id。
    const idValue = typeof id === "string" ? id.trim() : ""
    if (idValue !== "") {
      if (seenIds.has(idValue)) {
        // 必须带上重复的那个值：几万条数据里只说"有重复"等于没说
        errors.push(`${position}的 id 重复：${idValue}`)
        usable = false
      } else {
        seenIds.add(idValue)
      }
    }

    // tags 可选，但给了就必须是字符串数组：混进数字会让筛选器的计数与匹配都失真
    let tags: string[] | undefined
    if (item.tags !== undefined) {
      if (Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === "string")) {
        tags = item.tags as string[]
      } else {
        errors.push(`${position}的 tags 必须是字符串数组`)
        usable = false
      }
    }

    if (!usable) return

    const clean: ContentPackItem = {
      id: (id as string).trim(),
      title: (title as string).trim(),
      body: (body as string).trim(),
    }
    if (tags !== undefined) clean.tags = tags
    items.push(clean)
  })

  if (errors.length > 0) return { ok: false, errors }

  return { ok: true, pack: { id: decl.id, title: decl.title, items } }
}

/**
 * 搜索 + 标签过滤（大小写不敏感，标题/正文/标签都参与）。
 *
 * 标签之间是 **AND**：用户勾「科幻」+「末世」时想看的是同时具备两条的切入点，
 * 用 OR 会让结果越筛越多，等于筛选器失效。
 */
export function filterContentItems(
  items: ContentPackItem[],
  query: string,
  tags: string[],
): ContentPackItem[] {
  const keyword = (query ?? "").trim().toLowerCase()
  const wantedTags = (tags ?? [])
    .filter((tag) => typeof tag === "string" && tag.trim() !== "")
    .map((tag) => tag.trim().toLowerCase())

  // 无任何条件时原样返回（连数组都不复制）：灵感库全量列表动辄 5000 条，
  // 每次渲染都复制一遍是白白的 GC 压力。
  if (keyword === "" && wantedTags.length === 0) return items

  return items.filter((item) => {
    const itemTags = (item.tags ?? []).map((tag) => tag.toLowerCase())

    if (wantedTags.length > 0) {
      const hasAll = wantedTags.every((tag) => itemTags.includes(tag))
      if (!hasAll) return false
    }

    if (keyword === "") return true

    if (item.title.toLowerCase().includes(keyword)) return true
    if (item.body.toLowerCase().includes(keyword)) return true
    return itemTags.some((tag) => tag.includes(keyword))
  })
}

/**
 * 汇总所有标签及其计数，供筛选器渲染。
 *
 * 同一条里重复写两次同一标签只计 1 次：计数表示"有多少条属于这个标签"，
 * 不是"这个字符串出现了几次"。
 */
export function collectTags(items: ContentPackItem[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const seen = new Set<string>()
    for (const tag of item.tags ?? []) {
      const normalized = tag.trim()
      if (normalized === "" || seen.has(normalized)) continue
      seen.add(normalized)
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }
  }

  // count 降序；同 count 按标签字典序，保证渲染顺序稳定（否则每次 setState 都在跳）
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag, "zh"))
}
