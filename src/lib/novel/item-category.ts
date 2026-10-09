/**
 * 出场物品的分类与「相关道具」筛选。
 *
 * ## 为什么单独一个模块
 *
 * 物品此前是**只写不读**的：`ingestChapter` 把 `items` / `itemDetails` 写进快照，
 * 但 `ContextPack` 里没有物品字段、`DATA_SOURCE_CATEGORY_MAP` 里没有 items、
 * 检索式里也没有物品语义（段标题 `## 相关地点/组织/物品` 承诺了物品，
 * 检索式却是 `"setting 设定 location 地点"`）。于是「小说写作时能不能读到这些
 * 物品」的答案是**读不到**。
 *
 * 这里把「收集 → 分类 → 按本章相关性筛选 → 排版」做成纯函数，便于单测钉住；
 * 真正的读取（快照文件 I/O）留在 `section-briefing.ts`，因为那里才有 projectPath。
 *
 * ## 为什么分类不直接改 `items`
 *
 * `items` 是 `string[]`，而 `normalizeSnapshotList()`（chapter-ingest.ts）会把
 * 每个元素过一遍 `normalizeSnapshotText`：非字符串会变成 `""` 然后被
 * `filter(Boolean)` **静默丢掉**。改成对象数组不会有任何报错，只会表现为
 * 「物品莫名其妙全没了」，同时还污染图谱（生成 `[object Object]` 节点）。
 *
 * 因此分类走**旁挂**字段 `itemCategories: Record<string, ItemCategory>`：
 * `items` 形状不变，已有磁盘快照全部继续可用，缺字段时优雅降级为「未分类」。
 */

import type { ChapterSnapshot } from "./chapter-ingest"

/**
 * 物品分类。
 *
 * 前三类是**归属**判断（谁在用），第四类是**价值**判断（有没有意义）——
 * 后者必须对着已建立的内容判，不能孤立看（见 `selectBriefingItems`）。
 */
export type ItemCategory = "protagonist" | "supporting" | "antagonist" | "trivial"

export const ITEM_CATEGORIES: readonly ItemCategory[] = [
  "protagonist",
  "supporting",
  "antagonist",
  "trivial",
]

/** 中文标签：提示词与界面用中文，落盘用英文 id。 */
export const ITEM_CATEGORY_LABELS: Record<ItemCategory, string> = {
  protagonist: "主角使用",
  supporting: "配角使用",
  antagonist: "反派使用",
  trivial: "没有意义",
}

/**
 * 模型可能回中文标签、英文 id，或带「的」等口语变体，这里统一收敛。
 * 认不出来就返回 undefined —— **不猜**：猜错会把无意义道具当主角道具塞进提示词，
 * 比不分类更糟（未分类只是不进「已分类」的窄路，不会误导）。
 */
const CATEGORY_ALIASES: Record<string, ItemCategory> = {
  protagonist: "protagonist",
  "主角": "protagonist",
  "主角使用": "protagonist",
  "主角道具": "protagonist",
  "男主": "protagonist",
  "女主": "protagonist",
  supporting: "supporting",
  "配角": "supporting",
  "配角使用": "supporting",
  "配角道具": "supporting",
  "男配": "supporting",
  "女配": "supporting",
  antagonist: "antagonist",
  "反派": "antagonist",
  "反派使用": "antagonist",
  "反派道具": "antagonist",
  "敌人": "antagonist",
  trivial: "trivial",
  "没有意义": "trivial",
  "没有意义的物品": "trivial",
  "无意义": "trivial",
  "无关": "trivial",
  "闲笔": "trivial",
  "背景": "trivial",
}

export function normalizeItemCategory(value: unknown): ItemCategory | undefined {
  if (typeof value !== "string") return undefined
  return CATEGORY_ALIASES[value.trim().toLowerCase()] ?? CATEGORY_ALIASES[value.trim()]
}

/**
 * 归一化整份 `itemCategories`：丢掉认不出的键值，全空则不落盘。
 * 与 `normalizeSnapshotDetailRecord` 同风格（不抛错、不保留垃圾）。
 */
export function normalizeItemCategoryRecord(
  value: unknown,
): Record<string, ItemCategory> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([name, raw]) => [name.trim(), normalizeItemCategory(raw)] as const)
    .filter(([name, category]) => name.length > 0 && category !== undefined)
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries) as Record<string, ItemCategory>
}

/** 跨快照合并后的一件物品。 */
export interface ItemRecord {
  name: string
  /** 当前持有者；未知时为空串。 */
  holder: string
  previousHolders: string
  abilities: string
  limitations: string
  origin: string
  /** 未分类时为 undefined（旧快照没有 `itemCategories`）。 */
  category?: ItemCategory
  /** 最后一次出现的章节号，用于「越新越可能相关」的排序。 */
  lastChapterNumber: number
}

/**
 * 容错取文本：非字符串一律不试图文本化。
 *
 * 刻意**不**用 `String(value)`：对象会变成字面量 `"[object Object]"`，
 * 那正是「垃圾进提示词」的经典来源（也是 `items` 不能改成对象数组的原因之一）。
 * 数字/布尔按 `normalizeSnapshotText` 的既有口径保留（快照里 42 是合法的物品名）。
 */
function text(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return ""
}

/**
 * 按物品名合并多份快照。
 *
 * 两条规则，都是为了避免「后来的信息反而更少」：
 * 1. **空值不覆盖**。第 9 章提到某道具但提取没填 holder 时，第 5 章记下的持有者
 *    必须留着；否则越往后读，道具信息越退化成空，等于把已有记忆擦掉。
 * 2. **按章节升序应用**，所以「非空覆盖」得到的自然是最后一次出现的状态
 *    （持有者转移时后写的赢）。
 */
export function collectItemRecords(snapshots: readonly ChapterSnapshot[]): ItemRecord[] {
  const records = new Map<string, ItemRecord>()
  const ordered = [...snapshots].sort((left, right) => left.chapterNumber - right.chapterNumber)

  for (const snapshot of ordered) {
    // itemDetails 的键也算出现：有的提取只填了详情没列进 items。
    // 用 text() 而不是 .trim()：磁盘上可能存在任何历史形状的畸形元素，
    // 直接 .trim() 会在这里抛 TypeError，让整次上下文装配失败。
    const names = new Set<string>([
      ...(Array.isArray(snapshot.items) ? snapshot.items : []).map((name) => text(name)).filter(Boolean),
      ...Object.keys(snapshot.itemDetails ?? {}).map((name) => name.trim()).filter(Boolean),
    ])

    for (const name of names) {
      const detail = snapshot.itemDetails?.[name]
      const existing = records.get(name)
      const category = snapshot.itemCategories?.[name] ?? existing?.category
      records.set(name, {
        name,
        holder: text(detail?.holder) || existing?.holder || "",
        previousHolders: text(detail?.previousHolders) || existing?.previousHolders || "",
        abilities: text(detail?.abilities) || existing?.abilities || "",
        limitations: text(detail?.limitations) || existing?.limitations || "",
        origin: text(detail?.origin) || existing?.origin || "",
        category,
        lastChapterNumber: snapshot.chapterNumber,
      })
    }
  }

  return [...records.values()]
}

export interface SelectBriefingItemsOptions {
  /** 本章出场角色（来自细纲）。 */
  characterNames: readonly string[]
  /** 本章任务文本 + 细纲，用于判断「本章是否提到这件道具」。 */
  matchingText: string
  /** 最多输出几件，默认 20。 */
  limit?: number
}

function holderIsPresent(holder: string, characterNames: readonly string[]): boolean {
  if (!holder) return false
  return characterNames.some((name) => {
    if (!name) return false
    return holder.includes(name) || name.includes(holder)
  })
}

/**
 * 选出真正该进「本节速记」的物品。
 *
 * 相关性的两条口径（用户认可的设计）：
 * - 持有者在本章出场角色里 —— 道具跟着人走，人出场了道具就可能在用；
 * - 或道具名出现在本章任务/细纲文本里 —— 用户明确要写它。
 *
 * **`trivial`（没有意义）的道具直接剔除**：这正是分类的价值所在，
 * 一次性道具不该占提示词预算。未分类（旧快照）**不剔除**——
 * 缺字段不等于「无意义」，宁可多给也不能悄悄少给。
 */
export function selectBriefingItems(
  records: readonly ItemRecord[],
  options: SelectBriefingItemsOptions,
): ItemRecord[] {
  const { characterNames, matchingText, limit = 20 } = options

  const scored = records
    .filter((record) => record.category !== "trivial")
    .flatMap((record) => {
      const mentioned = record.name.length > 0 && matchingText.includes(record.name)
      const heldByCast = holderIsPresent(record.holder, characterNames)
      if (!mentioned && !heldByCast) return []
      // 文本里点名 = 最强信号，排在只看持有者的前面。
      const score = mentioned ? 0 : 1
      return [{ record, score }]
    })

  scored.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score
    if (left.record.lastChapterNumber !== right.record.lastChapterNumber) {
      return right.record.lastChapterNumber - left.record.lastChapterNumber
    }
    return left.record.name.localeCompare(right.record.name)
  })

  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.record)
}

/**
 * 排版成与「本节速记」其它小节一致的 Markdown 列表项。
 *
 * 只输出**有信息量**的字段：能力/限制为空时不留「能力：」这种空壳，
 * 否则提示词里会出现一堆没内容的标签，白占 token。
 */
export function formatItemBriefings(items: readonly ItemRecord[]): string[] {
  return items.map((item) => {
    const head = item.holder ? `**${item.name}** 当前持有：${item.holder}` : `**${item.name}**`
    const category = item.category ? `（${ITEM_CATEGORY_LABELS[item.category]}）` : ""
    const details: string[] = []
    if (item.abilities) details.push(`能力：${item.abilities}`)
    if (item.limitations) details.push(`限制：${item.limitations}`)
    if (item.origin) details.push(`来源：${item.origin}`)
    const tail = details.length > 0 ? `——${details.join("；")}` : ""
    return `- ${head}${category}${tail}`
  })
}
