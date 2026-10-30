import { memoryIssueKey, type MemoryCleanupIssue, type MemoryCleanupRecord } from "./memory-cleanup"

export interface MemoryCleanupRuleOptions {
  /** 章节号 ≤ 0 的大纲快照，编号形如 -1。 */
  dropNonPositiveChapters: boolean
  /** 比最新正文章节至少落后这么多章。0 表示不按新旧清理。 */
  staleChapterGap: number
  /** 人物状态或认知的最后一次正文章节，比最新正文章节至少落后这么多章。0 表示不启用。 */
  unupdatedChapterGap: number
}

/** 长篇里，落后最新章节 150 章以上的来源、大纲快照，以及出场后再隔 30 章仍未更新的人物。 */
export const RECOMMENDED_MEMORY_CLEANUP_RULES: MemoryCleanupRuleOptions = {
  dropNonPositiveChapters: true,
  staleChapterGap: 150,
  unupdatedChapterGap: 30,
}

export interface MemoryCleanupRuleCounts {
  nonPositive: number
  unupdated: number
  stale: number
  total: number
}

export interface MemoryCleanupRulePlan {
  issues: MemoryCleanupIssue[]
  counts: MemoryCleanupRuleCounts
}

function chapterGap(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 100000) throw new Error(`${label}必须是 0 到 100000 的整数`)
  return value
}

export function normalizeMemoryCleanupRules(options: MemoryCleanupRuleOptions): MemoryCleanupRuleOptions {
  return {
    dropNonPositiveChapters: options.dropNonPositiveChapters === true,
    staleChapterGap: chapterGap(options.staleChapterGap, "落后章数"),
    unupdatedChapterGap: chapterGap(options.unupdatedChapterGap, "未更新章数"),
  }
}

/** 从一条人物状态或认知里取出人物。认知必须写出“知道 / 不知道”，否则不当成出场记录。 */
export function memoryAppearanceSubject(text: string, field: MemoryCleanupRecord["field"]): string {
  const normalized = text.normalize("NFKC").trim()
  if (field === "knowledgeChanges") {
    const matched = normalized.match(/^(.{1,40}?)(?:知道|不知道)/u)
    return matched?.[1]?.trim() ?? ""
  }
  if (field !== "characterStateChanges") return ""
  const head = normalized.split(/[:：]/u)[0]?.trim() ?? ""
  if (!head || head.length > 40 || /^(?:推进|新增|回收)/u.test(head)) return ""
  return head
}

function noiseIssue(removeIds: string[], reason: string): MemoryCleanupIssue {
  const issue: MemoryCleanupIssue = { id: "", kind: "noise", removeIds, reason, confidence: "high" }
  issue.id = memoryIssueKey(issue)
  return issue
}

/**
 * 规则直接命中，不调用模型。同一条只归入第一条命中的规则：
 * 大纲快照，其次出场后超过间隔仍未更新，最后过旧章节。
 * 未更新看的是该人物状态和认知的最后一次正文章节，不是“只出现过一章”。
 */
export function planMemoryCleanupRules(records: readonly MemoryCleanupRecord[], input: MemoryCleanupRuleOptions): MemoryCleanupRulePlan {
  const options = normalizeMemoryCleanupRules(input)
  const latestChapter = records.reduce((max, record) => record.chapterNumber > max ? record.chapterNumber : max, 0)
  const lastUpdate = new Map<string, number>()
  if (options.unupdatedChapterGap >= 1) {
    for (const record of records) {
      if (record.chapterNumber <= 0 || (record.field !== "characterStateChanges" && record.field !== "knowledgeChanges")) continue
      const subject = memoryAppearanceSubject(record.text, record.field)
      if (!subject) continue
      const previous = lastUpdate.get(subject) ?? 0
      if (record.chapterNumber > previous) lastUpdate.set(subject, record.chapterNumber)
    }
  }
  const unupdatedSubjects = new Set([...lastUpdate].filter(([, chapter]) => latestChapter - chapter >= options.unupdatedChapterGap).map(([subject]) => subject))
  const nonPositive: string[] = []
  const unupdated: string[] = []
  const stale: string[] = []
  for (const record of records) {
    if (options.dropNonPositiveChapters && record.chapterNumber <= 0) { nonPositive.push(record.id); continue }
    if (options.unupdatedChapterGap >= 1 && (record.field === "characterStateChanges" || record.field === "knowledgeChanges")) {
      const subject = memoryAppearanceSubject(record.text, record.field)
      if (subject && unupdatedSubjects.has(subject)) { unupdated.push(record.id); continue }
    }
    if (options.staleChapterGap >= 1 && record.chapterNumber > 0 && latestChapter - record.chapterNumber >= options.staleChapterGap) stale.push(record.id)
  }
  const issues = [
    nonPositive.length ? noiseIssue(nonPositive, "章节号小于等于 0，属于大纲快照，不作为正文记忆保留。") : null,
    unupdated.length ? noiseIssue(unupdated, `该人物的状态或认知距离最新正文章节已至少 ${options.unupdatedChapterGap} 章没有更新。`) : null,
    stale.length ? noiseIssue(stale, `来源章节比最新正文章节至少落后 ${options.staleChapterGap} 章。`) : null,
  ].filter((issue): issue is MemoryCleanupIssue => !!issue)
  return { issues, counts: { nonPositive: nonPositive.length, unupdated: unupdated.length, stale: stale.length, total: nonPositive.length + unupdated.length + stale.length } }
}
