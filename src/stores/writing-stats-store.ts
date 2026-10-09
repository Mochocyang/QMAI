import { create } from "zustand"
import {
  applyDeltaToDaily,
  applyWritingChange,
  decodeWritingSources,
  encodeWritingSources,
  emptyWritingDelta,
  normalizeCountableText,
  rebaselineProvenance,
  writingTextHash,
  type WritingProvenance,
  type WritingSource,
} from "@/lib/writing-stats"
import {
  clampDailyTargetChars,
  countProjectChapterWords,
  DEFAULT_DAILY_TARGET_CHARS,
  emptyWritingStatsFile,
  loadWritingStats,
  localDayKey,
  pruneWritingStatsDays,
  saveWritingStats,
  writingStatsChapterKey,
  type WritingStatsChapterEntry,
  type WritingStatsDay,
  type WritingStatsFile,
} from "@/lib/writing-stats-persistence"
import { normalizeComparablePath, isChapterPath } from "@/lib/path-utils"

/** 落盘节流：打字时每一下都写盘是不可接受的，但崩溃也不能丢掉整天的数字。 */
const FLUSH_DEBOUNCE_MS = 2500

interface WritingStatsState {
  projectPath: string | null
  /** 今日的本地日期键；跨天时计数自动归零并把昨天归档。 */
  dayKey: string
  humanChars: number
  aiChars: number
  dailyTargetChars: number
  /** 全书正文字数；`null` 表示还没算出来（界面显示占位而不是 0）。 */
  totalChars: number | null
  /** 历史日期（不含今日，今日在 flush 时并入）。 */
  days: Record<string, WritingStatsDay>
  /** 落盘用的逐章摘要。 */
  chapters: Record<string, WritingStatsChapterEntry>
  /** 本会话内逐章归属账本（不落盘正文，只落盘摘要）。 */
  provenance: Record<string, WritingProvenance>
  hydrated: boolean

  initializeProject(path: string): Promise<void>
  setTotalChars(value: number | null): void
  /**
   * 重算全书正文字数。
   *
   * 此前 `App.tsx`（窗口标题）和 `knowledge-tree.tsx`（目录里的字数）各读了一遍
   * 全部章节，再加底部状态栏就是第三遍。这里把口径收进 store，界面只订一个数字。
   */
  refreshTotalChars(): Promise<void>
  setDailyTarget(value: number): void
  /**
   * 章节打开时打基线：**只建立「从这一刻起的归属起点」，绝不计账**。
   * 不先打基线的话，用户敲下的第一个字会把整章（可能几万字的 AI 旧稿）
   * 都算成今天手写的。
   */
  primeChapter(chapterPath: string, markdown: string): void
  /** 记账的唯一入口：编辑器改动、AI 写盘、外部同步都从这里过。 */
  recordChapter(
    chapterPath: string,
    markdown: string,
    source: WritingSource,
    /**
     * 这次写入**覆盖掉的旧正文**（调用方读盘时手上就有的话，一定要传）。
     *
     * 不传的后果很严重：一份「已经存在、被 AI 整章重写」的正文，在内存里没有
     * 账本、落盘摘要又因内容变了而校验不过时，应用就无从知道旧文有多长，
     * 只能退化成「整章都是今天 AI 新写的」——批量去 AI 味 30 章会把「今日 AI
     * 生成」直接顶到九万字（目标 3000 → 完成率 3000%）。
     *
     * 传了就能精确差分：旧正文按 `unknown` 打基线（来路本来就不可知），
     * 只有模型真正换掉的那些字才算今天的 AI 产出。
     */
    previousMarkdown?: string,
  ): void
  /**
   * 章节改名 / 归位到规范路径时把归属账本一起搬过去。
   *
   * 不做这一步的话，`第1章.md` → `chapter-001.md` 之后旧键就成了孤儿，
   * 新路径又要从零打基线，用户此前手写的归属会凭空消失。
   */
  transferChapter(fromPath: string, toPath: string): void
  flush(): Promise<void>
  reset(): void
}

const flushTimers = new Map<string, ReturnType<typeof setTimeout>>()
const flushKeysInFlight = new Set<string>()

function emptyStatsState() {
  return {
    projectPath: null as string | null,
    dayKey: localDayKey(),
    humanChars: 0,
    aiChars: 0,
    dailyTargetChars: DEFAULT_DAILY_TARGET_CHARS,
    totalChars: null as number | null,
    days: {} as Record<string, WritingStatsDay>,
    chapters: {} as Record<string, WritingStatsChapterEntry>,
    provenance: {} as Record<string, WritingProvenance>,
    hydrated: false,
  }
}

/**
 * 从落盘摘要恢复一章的归属账本。
 *
 * 只有当磁盘上的正文与当初记账的那份**逐字符一致**（长度 + 哈希都对）才认账；
 * 否则返回 `null`，调用方重打基线并放弃本次记账。这是「宁可少算，也不造假」
 * 的落点：带外修改（另一个编辑器、外部同步）本来就无法归因。
 */
function restoreProvenance(
  entry: WritingStatsChapterEntry | undefined,
  markdown: string,
): WritingProvenance | null {
  if (!entry) return null
  const text = normalizeCountableText(markdown)
  if (text.length !== entry.len) return null
  if (writingTextHash(text) !== entry.hash) return null
  const sources = decodeWritingSources(entry.rle, text.length)
  if (!sources) return null
  return { text, sources }
}

function chapterEntryOf(provenance: WritingProvenance): WritingStatsChapterEntry {
  return {
    len: provenance.text.length,
    hash: writingTextHash(provenance.text),
    rle: encodeWritingSources(provenance.sources),
  }
}

function scheduleFlush(projectPath: string, flush: () => Promise<void>) {
  const key = normalizeComparablePath(projectPath)
  const existing = flushTimers.get(key)
  if (existing) clearTimeout(existing)
  flushTimers.set(key, setTimeout(() => {
    flushTimers.delete(key)
    void flush()
  }, FLUSH_DEBOUNCE_MS))
}

export const useWritingStatsStore = create<WritingStatsState>((set, get) => ({
  ...emptyStatsState(),

  async initializeProject(rawPath) {
    const path = normalizeComparablePath(rawPath)
    if (get().projectPath === path && get().hydrated) return
    set({ ...emptyStatsState(), projectPath: path })
    const file = await loadWritingStats(path)
    if (get().projectPath !== path) return
    const dayKey = localDayKey()
    const today = file.days[dayKey]
    const days = { ...file.days }
    delete days[dayKey]
    set({
      dayKey,
      humanChars: today?.humanChars ?? 0,
      aiChars: today?.aiChars ?? 0,
      dailyTargetChars: clampDailyTargetChars(file.dailyTargetChars),
      days,
      chapters: file.chapters,
      hydrated: true,
      // provenance 故意留空：按需从 chapters 摘要恢复，避免为一个几千章的项目
      // 一进来就解码所有游程。
      provenance: {},
    })
  },

  setTotalChars(value) {
    set({ totalChars: value })
  },

  async refreshTotalChars() {
    const path = get().projectPath
    if (!path) {
      set({ totalChars: null })
      return
    }
    const total = await countProjectChapterWords(path)
    // 算的过程中用户可能切了项目，晚到的结果不能覆盖新项目。
    if (get().projectPath === path) set({ totalChars: total })
  },

  setDailyTarget(value) {
    set({ dailyTargetChars: clampDailyTargetChars(value) })
    const path = get().projectPath
    if (path) scheduleFlush(path, () => get().flush())
  },

  primeChapter(chapterPath, markdown) {
    const path = get().projectPath
    if (!path || !isChapterPath(chapterPath)) return
    const key = writingStatsChapterKey(path, chapterPath)
    const restored = restoreProvenance(get().chapters[key], markdown)
    set((state) => ({
      provenance: {
        ...state.provenance,
        // 恢复不出来就按「来源不可知」打基线：这些字不是今天写的，不能算进今日。
        [key]: restored ?? rebaselineProvenance(markdown, "unknown"),
      },
    }))
  },

  recordChapter(chapterPath, markdown, source, previousMarkdown) {
    const state = get()
    const path = state.projectPath
    // 只统计章节正文（用户选定的口径）。大纲、设定、笔记写得再多也不进这个账。
    if (!path || !isChapterPath(chapterPath)) return
    const key = writingStatsChapterKey(path, chapterPath)

    // 跨天：先把昨天归档，再把今日计数归零。
    const dayKey = localDayKey()
    let humanChars = state.humanChars
    let aiChars = state.aiChars
    let days = state.days
    if (dayKey !== state.dayKey) {
      days = pruneWritingStatsDays({
        ...days,
        [state.dayKey]: { humanChars: state.humanChars, aiChars: state.aiChars },
      })
      humanChars = 0
      aiChars = 0
    }

    const commit = (provenance: WritingProvenance, delta = emptyWritingDelta()) => {
      set({
        dayKey,
        days,
        provenance: { ...state.provenance, [key]: provenance },
        chapters: { ...state.chapters, [key]: chapterEntryOf(provenance) },
        ...applyDeltaToDaily({ humanChars, aiChars }, delta),
      })
      scheduleFlush(path, () => get().flush())
    }

    let provenance = state.provenance[key]
    if (!provenance) {
      const restored = restoreProvenance(state.chapters[key], markdown)
      if (restored) {
        provenance = restored
      } else if (previousMarkdown !== undefined) {
        // 调用方把被覆盖掉的旧正文交上来了 —— 精确差分。
        // 旧正文在打基线时一律记 `unknown`：它是什么时候、由谁写的，这里
        // 无从知道，但**长度**能确定，所以「模型换掉了多少字」可以算准。
        provenance = rebaselineProvenance(previousMarkdown, "unknown")
      } else if (source === "ai") {
        // 明确的「这一整份就是 AI 刚写出来的」——例如聊天里生成并保存的新章。
        // 这种情况必须从零开始记账，否则 AI 生成的字数永远是 0。
        //
        // 注意这条分支**必须**是「无从得知旧正文」时的最后手段：一旦用错，
        // 一份早已存在的几万字旧稿会被整份算成今天 AI 新写的。会覆盖已有
        // 正文的调用方有义务把 `previousMarkdown` 传进来。
        const fresh = rebaselineProvenance(markdown, "ai")
        commit(fresh, { ...emptyWritingDelta(), aiAdded: fresh.text.length })
        return
      } else {
        // 没有账本、也不是 AI 写入：这是「首次见到」。只打基线，不计账——
        // 打开一本老书不等于今天手写了几十万字。
        commit(rebaselineProvenance(markdown, "unknown"))
        return
      }
    }

    const result = applyWritingChange(provenance, markdown, source)
    commit(result.provenance, result.delta)
  },

  transferChapter(fromPath, toPath) {
    const path = get().projectPath
    if (!path || !isChapterPath(fromPath) || !isChapterPath(toPath)) return
    const fromKey = writingStatsChapterKey(path, fromPath)
    const toKey = writingStatsChapterKey(path, toPath)
    if (fromKey === toKey) return
    set((state) => {
      const provenance = { ...state.provenance }
      const chapters = { ...state.chapters }
      const movedProvenance = provenance[fromKey]
      if (movedProvenance) {
        provenance[toKey] = movedProvenance
        delete provenance[fromKey]
      }
      const movedEntry = chapters[fromKey]
      if (movedEntry) {
        chapters[toKey] = movedEntry
        delete chapters[fromKey]
      }
      return { provenance, chapters }
    })
  },

  async flush() {
    const state = get()
    const path = state.projectPath
    if (!path || !state.hydrated) return
    const key = normalizeComparablePath(path)
    if (flushKeysInFlight.has(key)) return
    flushKeysInFlight.add(key)
    try {
      const file: WritingStatsFile = {
        ...emptyWritingStatsFile(),
        dailyTargetChars: state.dailyTargetChars,
        days: pruneWritingStatsDays({
          ...state.days,
          [state.dayKey]: { humanChars: state.humanChars, aiChars: state.aiChars },
        }),
        chapters: state.chapters,
      }
      await saveWritingStats(path, file)
    } catch {
      // 统计写盘失败不打扰用户：下一次 flush 会重试，最坏情况只丢一段历史。
    } finally {
      flushKeysInFlight.delete(key)
    }
  },

  reset() {
    for (const timer of flushTimers.values()) clearTimeout(timer)
    flushTimers.clear()
    set({ ...emptyStatsState() })
  },
}))

/** 今日合计（手写 + AI），用于完成率与「今日共写」展示。 */
export function writingDayTotal(day: { humanChars: number; aiChars: number } | undefined): number {
  if (!day) return 0
  return day.humanChars + day.aiChars
}
