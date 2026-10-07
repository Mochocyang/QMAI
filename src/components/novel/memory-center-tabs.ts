import {
  BookText,
  Brain,
  Clock3,
  FileText,
  GitBranchPlus,
  Layers,
  Sparkles,
  Users,
} from "lucide-react"
import type {
  MemoryCenterData,
  MemoryCenterFilePreview,
  MemoryCenterSnapshotCard,
} from "@/lib/novel/memory-center"

/**
 * 记忆中心的标签清单与计数解析。
 *
 * 这里是**纯配置与纯计算**，不含 React —— 标签清单、文案键、图标、
 * 以及「某个标签该显示多少条」全在这一个地方定义。
 * 视图只负责渲染，不再自己推导这些。
 *
 * 为什么单独成文件：原实现把这些散落在 sidebar-panel.tsx（列表）与
 * memory-center-view.tsx（渲染）两处，双栏结构一拆就会不一致。
 * 单页后「左边列什么、右边显示什么」的握手消失了，清单必须只有一份。
 */

/** 6 个 markdown 记忆文件的 key（与 lib/novel/memory-center.ts 的 MEMORY_FILE_CONFIGS 对应）。 */
export type MemoryFileKey =
  | "character-states"
  | "character-cognition"
  | "foreshadowing-tracker"
  | "timeline"
  | "canon-facts"
  | "conflicts"

/** 标签 key：两类快照 + 6 个记忆文件。 */
export type MemoryTabKey = "snapshots" | "outline-snapshots" | MemoryFileKey

export const MEMORY_FILE_KEYS: readonly MemoryFileKey[] = [
  "character-states",
  "character-cognition",
  "foreshadowing-tracker",
  "timeline",
  "canon-facts",
  "conflicts",
]

/**
 * 8 个标签的固定顺序：两类快照在前，6 个记忆文件在后。
 *
 * 这里**故意不含** `dismantling-library`（拆文库）与 `plot-framework`（剧情框架）：
 * 前者是产品决策上不得出现在记忆中心，后者在改造前就已不可达。
 * 原侧栏靠 `filter` 把 dismantling-library 剔除，单页后清单本身就不含它，
 * 防线从"运行时过滤"前移成"清单不含"。
 */
export const MEMORY_TAB_KEYS: readonly MemoryTabKey[] = [
  "snapshots",
  "outline-snapshots",
  ...MEMORY_FILE_KEYS,
]

export const MEMORY_TAB_LABEL_KEYS: Record<MemoryTabKey, string> = {
  snapshots: "novel.memoryCenter.tabs.chapterSnapshots",
  "outline-snapshots": "novel.memoryCenter.tabs.outlineSnapshots",
  "character-states": "novel.memoryCenter.sections.characterStates",
  "character-cognition": "novel.memoryCenter.sections.cognition",
  "foreshadowing-tracker": "novel.memoryCenter.sections.foreshadowing",
  timeline: "novel.memoryCenter.sections.timeline",
  "canon-facts": "novel.memoryCenter.sections.canonFacts",
  conflicts: "novel.memoryCenter.sections.conflicts",
}

export const MEMORY_TAB_ICONS: Record<MemoryTabKey, typeof Users> = {
  snapshots: FileText,
  "outline-snapshots": Layers,
  "character-states": Users,
  "character-cognition": Brain,
  "foreshadowing-tracker": Sparkles,
  timeline: Clock3,
  "canon-facts": BookText,
  conflicts: GitBranchPlus,
}

/** 某个标签是否是 markdown 记忆文件（而不是快照流）。 */
export function isMemoryFileTab(key: MemoryTabKey): key is MemoryFileKey {
  return (MEMORY_FILE_KEYS as readonly string[]).includes(key)
}

/**
 * 一个记忆文件的「条目数」= 各 section 的 items 与 groups 之和。
 * 与改造前 sidebar-panel.tsx 里的同名函数保持一致的计算口径，避免计数换算法后突变。
 */
export function countMemoryFileEntries(
  file: MemoryCenterFilePreview | null | undefined,
): number {
  if (!file) return 0
  return file.sections.reduce(
    (sum, section) => sum + section.items.length + section.groups.length,
    0,
  )
}

/** 标签右侧的计数。数据未加载时一律 0，绝不抛错。 */
export function resolveMemoryTabCount(key: MemoryTabKey, data: MemoryCenterData | null): number {
  if (!data) return 0
  if (key === "snapshots") return selectChapterSnapshotCards(data).length
  if (key === "outline-snapshots") return selectOutlineSnapshotCards(data).length
  return countMemoryFileEntries(data.files.find((file) => file.key === key))
}

/**
 * 章节快照卡片：只取正数（章节），按章号降序。
 * `filter` 会返回新数组，所以其后的 `sort` 不会改动调用方的数据。
 */
export function selectChapterSnapshotCards(
  data: MemoryCenterData | null,
): MemoryCenterSnapshotCard[] {
  if (!data) return []
  return data.snapshots
    .filter((card) => card.chapterNumber > 0)
    .sort((a, b) => b.chapterNumber - a.chapterNumber)
}

/**
 * 大纲快照卡片：只取负数（大纲）。
 *
 * **按标题排序，不是按编号。** 大纲编号是文件名的哈希
 * （chapter-ingest.ts 的 `-(Math.abs(hash % 999) + 1)`，可到 -817），
 * 按它排序等于随机顺序，与用户的直觉无关。标题就是大纲文件名。
 */
export function selectOutlineSnapshotCards(
  data: MemoryCenterData | null,
): MemoryCenterSnapshotCard[] {
  if (!data) return []
  return data.snapshots
    .filter((card) => card.chapterNumber < 0)
    .sort((a, b) => {
      const byTitle = (a.chapterTitle ?? "").localeCompare(b.chapterTitle ?? "", "zh")
      // 标题相同或都缺失时，用编号兜底，保证顺序稳定可复现。
      return byTitle !== 0 ? byTitle : b.chapterNumber - a.chapterNumber
    })
}

/**
 * 大纲卡片的标题。缺标题时回退为「大纲快照 N」——
 * N 取编号绝对值，避免露出 `大纲快照(-817)` 这种带负号的写法。
 */
export function outlineSnapshotTitle(
  card: MemoryCenterSnapshotCard,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (card.chapterTitle) return card.chapterTitle
  return t("novel.memoryCenter.snapshots.outlineFallback", {
    number: Math.abs(card.chapterNumber),
  })
}
