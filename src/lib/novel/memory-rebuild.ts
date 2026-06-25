import type { ChapterSnapshot } from "./chapter-ingest"

const UNCERTAIN_RE = /(可能|也许|似乎|疑似|或许|大概|推测|猜测|尚不确定|未证实)/u
const PUNCTUATION_RE = /[，。；：？！“”‘’（）《》【】<>]/u
const GENERIC_SUBJECT_RE = /^(?:\d+号.+|短发女人|长发女人|老太太|老头|老人|守卫|村民|灰白制服(?:人员|男人|女人)|两名灰白制服人员)$/u
const EVENT_VERB_RE = /(发现|确认|试图|听见|引发|整理|逐步浮现|否定|建立|失踪|审问|追捕|偷听|回收|转送|封存)/u

export interface StructuredMemoryDocuments {
  "chapter-snapshots.md": string
  "character-cognition.md": string
  "character-states.md": string
  "foreshadowing-tracker.md": string
  "timeline.md": string
  "canon-facts.md": string
  "conflicts.md": string
}

export function isValidMemorySnapshot(snapshot: ChapterSnapshot | null, actualChapterNumbers: number[]): snapshot is ChapterSnapshot {
  if (!snapshot || !Number.isFinite(snapshot.chapterNumber)) return false
  if (snapshot.chapterNumber <= 0) return false
  if (actualChapterNumbers.length === 0) return true
  const maxActual = Math.max(...actualChapterNumbers)
  return snapshot.chapterNumber <= maxActual + 5
}

export function looksLikeStableNovelEntityLabel(kind: "character" | "location" | "organization" | "item" | "event", label: string): boolean {
  const trimmed = label.trim()
  if (!trimmed) return false
  if (PUNCTUATION_RE.test(trimmed)) return false
  if (trimmed.length > 32) return false
  if (kind === "event") {
    if (trimmed.length > 18) return false
    if (EVENT_VERB_RE.test(trimmed)) return false
  }
  return true
}

function chapterLabel(chapterNumber: number): string {
  return `第${chapterNumber}章`
}

function joinChapterLabels(chapters: Iterable<number>): string {
  return Array.from(new Set([...chapters]))
    .sort((a, b) => a - b)
    .map(chapterLabel)
    .join("、")
}

function pageHeader(memoryType: string, title: string): string[] {
  return [
    "---",
    "type: structured-memory",
    `memory_type: ${memoryType}`,
    `title: "${title}"`,
    "---",
    "",
    `# ${title}`,
    "",
  ]
}

function appendCandidateSection(lines: string[], candidates: string[]): void {
  lines.push("## 候选区", "")
  if (candidates.length === 0) {
    lines.push("暂无候选内容。", "")
    return
  }
  for (const item of candidates) {
    lines.push(`- ${item}`)
  }
  lines.push("")
}

function normalizeForeshadowingName(text: string): { name: string; description: string } {
  const cleaned = text
    .trim()
    .replace(/^(新增伏笔|推进伏笔|回收伏笔|新增|推进|回收)[：:\s-]*/u, "")
    .trim()

  const quoted = cleaned.match(/[“"']([^“”"']{1,24})[”"']/u)
  if (quoted?.[1]) {
    const name = quoted[1].trim().slice(0, 18)
    const description = cleaned.replace(quoted[0], "").replace(/^[，。；：:、\-\s]+/u, "").trim() || text.trim()
    return { name, description }
  }

  const keywordSplit = cleaned.split(/为何|并非|不仅是|存在|成为|将成|将|会|正在|开始|继续|揭示|预示|说明|意味着|指向|却能|不承认/u)
    .map((item) => item.trim())
    .filter(Boolean)
  if (keywordSplit.length >= 2) {
    return { name: keywordSplit[0].slice(0, 18), description: cleaned }
  }

  const punctuationSplit = cleaned.split(/[，。；：:？！]/u).map((item) => item.trim()).filter(Boolean)
  if (punctuationSplit.length >= 2) {
    return { name: punctuationSplit[0].slice(0, 18), description: cleaned }
  }

  return { name: cleaned.slice(0, 18), description: cleaned }
}

function parseSubjectChange(text: string): { subject: string; detail: string } | null {
  const normalized = text.replace(/[：:]/u, ":")
  const index = normalized.indexOf(":")
  if (index <= 0) return null
  return {
    subject: normalized.slice(0, index).trim(),
    detail: normalized.slice(index + 1).trim(),
  }
}

function isImportantSubject(subject: string): boolean {
  const trimmed = subject.trim()
  if (!trimmed) return false
  if (PUNCTUATION_RE.test(trimmed)) return false
  if (GENERIC_SUBJECT_RE.test(trimmed)) return false
  if (/^(读者|角色|旁白)$/u.test(trimmed)) return false
  if (/(通过|补充|借助|利用|经由)/u.test(trimmed)) return false
  if (/^\d+号/u.test(trimmed)) return false
  return trimmed.length <= 12
}

function pickStableSubject(text: string, snapshot: ChapterSnapshot): string | null {
  const parsed = parseSubjectChange(text)
  if (parsed) {
    return isImportantSubject(parsed.subject) ? parsed.subject : null
  }
  const matched = snapshot.characters.find((name) => text.includes(name) && isImportantSubject(name))
  return matched ?? null
}

function buildChapterSnapshotsDocument(snapshots: ChapterSnapshot[]): string {
  const lines = pageHeader("chapter-snapshots", "章节快照记忆")
  for (const snapshot of snapshots) {
    lines.push(`## ${chapterLabel(snapshot.chapterNumber)}`, "")
    lines.push("### 摘要", snapshot.summary || "无", "")
    lines.push("### 人物状态变化", ...(snapshot.characterStateChanges.length > 0 ? snapshot.characterStateChanges.map((item) => `- ${item}`) : ["- 无"]), "")
    lines.push("### 角色认知变化", ...(snapshot.knowledgeChanges.length > 0 ? snapshot.knowledgeChanges.map((item) => `- ${item}`) : ["- 无"]), "")
    lines.push("### 伏笔变化", ...(snapshot.foreshadowingChanges.length > 0 ? snapshot.foreshadowingChanges.map((item) => `- ${item}`) : ["- 无"]), "")
    lines.push("### 时间线事件", ...(snapshot.timelineEvents.length > 0 ? snapshot.timelineEvents.map((item) => `- ${item}`) : ["- 无"]), "")
    lines.push("### 结尾钩子", snapshot.endingHook || "无", "")
  }
  return `${lines.join("\n").trimEnd()}\n`
}

function buildCharacterCognitionDocument(snapshots: ChapterSnapshot[]): string {
  const state = new Map<string, { knows: Map<string, Set<number>>; unknowns: Map<string, Set<number>> }>()
  const candidates: string[] = []

  for (const snapshot of snapshots) {
    for (const raw of snapshot.knowledgeChanges) {
      const text = raw.trim()
      if (!text) continue
      if (UNCERTAIN_RE.test(text)) {
        candidates.push(`${chapterLabel(snapshot.chapterNumber)}：${text}`)
        continue
      }
      const unknownMatch = text.match(/^(.+?)不知道(.+)$/u)
      if (unknownMatch?.[1] && unknownMatch?.[2]) {
        const subject = unknownMatch[1].trim()
        if (!isImportantSubject(subject)) continue
        const entry = state.get(subject) ?? { knows: new Map(), unknowns: new Map() }
        if (!state.has(subject)) state.set(subject, entry)
        const detail = unknownMatch[2].trim()
        const chapters = entry.unknowns.get(detail) ?? new Set<number>()
        chapters.add(snapshot.chapterNumber)
        entry.unknowns.set(detail, chapters)
        continue
      }
      const knowMatch = text.match(/^(.+?)(知道|得知|察觉到|意识到)(.+)$/u)
      if (knowMatch?.[1] && knowMatch?.[3]) {
        const subject = knowMatch[1].trim()
        if (!isImportantSubject(subject)) continue
        const entry = state.get(subject) ?? { knows: new Map(), unknowns: new Map() }
        if (!state.has(subject)) state.set(subject, entry)
        const detail = knowMatch[3].trim()
        const chapters = entry.knows.get(detail) ?? new Set<number>()
        chapters.add(snapshot.chapterNumber)
        entry.knows.set(detail, chapters)
      }
    }
  }

  const lines = pageHeader("character-cognition", "角色认知记忆")
  lines.push("## 当前正式认知", "")
  const entries = [...state.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"))
  if (entries.length === 0) {
    lines.push("暂无正式认知记录。", "")
  } else {
    for (const [subject, entry] of entries) {
      lines.push(`### ${subject}`)
      for (const [detail, chapters] of entry.knows) {
        lines.push(`- 已知：${detail}（来源：${joinChapterLabels(chapters)}）`)
      }
      for (const [detail, chapters] of entry.unknowns) {
        lines.push(`- 未知：${detail}（来源：${joinChapterLabels(chapters)}）`)
      }
      lines.push("")
    }
  }
  appendCandidateSection(lines, candidates)
  return `${lines.join("\n").trimEnd()}\n`
}

function buildCharacterStatesDocument(snapshots: ChapterSnapshot[]): string {
  const latest = new Map<string, { detail: string; chapter: number }>()
  const candidates: string[] = []

  for (const snapshot of snapshots) {
    for (const raw of snapshot.characterStateChanges) {
      const text = raw.trim()
      if (!text) continue
      if (UNCERTAIN_RE.test(text)) {
        candidates.push(`${chapterLabel(snapshot.chapterNumber)}：${text}`)
        continue
      }
      const subject = pickStableSubject(text, snapshot)
      if (!subject) continue
      const parsed = parseSubjectChange(text)
      latest.set(subject, {
        detail: parsed?.detail || text,
        chapter: snapshot.chapterNumber,
      })
    }
  }

  const lines = pageHeader("character-states", "人物状态记忆")
  lines.push("## 当前正式状态", "")
  const entries = [...latest.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"))
  if (entries.length === 0) {
    lines.push("暂无正式状态记录。", "")
  } else {
    for (const [subject, value] of entries) {
      lines.push(`### ${subject}`)
      lines.push(`- 当前状态：${value.detail}`)
      lines.push(`- 最近更新：${chapterLabel(value.chapter)}`)
      lines.push("")
    }
  }
  appendCandidateSection(lines, candidates)
  return `${lines.join("\n").trimEnd()}\n`
}

function buildForeshadowingDocument(snapshots: ChapterSnapshot[]): string {
  const tracker = new Map<string, { name: string; description: string; planted: number; advanced: Set<number>; resolved?: number; sources: Set<number>; status: "planted" | "advanced" | "resolved" }>()
  const candidates: string[] = []

  for (const snapshot of snapshots) {
    for (const raw of snapshot.foreshadowingChanges) {
      const text = raw.trim()
      if (!text) continue
      if (UNCERTAIN_RE.test(text)) {
        candidates.push(`${chapterLabel(snapshot.chapterNumber)}：${text}`)
        continue
      }
      const normalized = normalizeForeshadowingName(text)
      if (!normalized.name) continue
      const existing = tracker.get(normalized.name) ?? {
        name: normalized.name,
        description: normalized.description,
        planted: snapshot.chapterNumber,
        advanced: new Set<number>(),
        sources: new Set<number>(),
        status: "planted" as const,
      }
      existing.description = existing.description.length >= normalized.description.length ? existing.description : normalized.description
      existing.planted = Math.min(existing.planted, snapshot.chapterNumber)
      existing.sources.add(snapshot.chapterNumber)
      if (/^(回收伏笔|回收)/u.test(text)) {
        existing.status = "resolved"
        existing.resolved = snapshot.chapterNumber
      } else if (/^(推进伏笔|推进)/u.test(text)) {
        if (existing.status !== "resolved") existing.status = "advanced"
        existing.advanced.add(snapshot.chapterNumber)
      }
      tracker.set(normalized.name, existing)
    }
  }

  const official = [...tracker.values()].sort((a, b) => a.planted - b.planted || a.name.localeCompare(b.name, "zh-CN"))
  const lines = pageHeader("foreshadowing-tracker", "伏笔追踪记忆")
  lines.push("## 进行中", "")
  const active = official.filter((item) => item.status !== "resolved")
  if (active.length === 0) {
    lines.push("暂无进行中的正式伏笔。", "")
  } else {
    for (const item of active) {
      lines.push(`### ${item.name}`)
      lines.push(`- 状态：${item.status === "advanced" ? "推进中" : "待推进"}`)
      lines.push(`- 说明：${item.description}`)
      lines.push(`- 初次出现：${chapterLabel(item.planted)}`)
      lines.push(`- 来源回查：${joinChapterLabels(item.sources)}`)
      lines.push("")
    }
  }
  lines.push("## 已完成", "")
  const resolved = official.filter((item) => item.status === "resolved")
  if (resolved.length === 0) {
    lines.push("暂无已完成伏笔。", "")
  } else {
    for (const item of resolved) {
      lines.push(`### ${item.name}`)
      lines.push("- 状态：已完成")
      lines.push(`- 说明：${item.description}`)
      lines.push(`- 初次出现：${chapterLabel(item.planted)}`)
      if (item.resolved) {
        lines.push(`- 完成章节：${chapterLabel(item.resolved)}`)
      }
      lines.push(`- 来源回查：${joinChapterLabels(item.sources)}`)
      lines.push("")
    }
  }
  appendCandidateSection(lines, candidates)
  return `${lines.join("\n").trimEnd()}\n`
}

function buildSimpleFactDocument(
  snapshots: ChapterSnapshot[],
  options: {
    memoryType: string
    title: string
    sectionTitle: string
    pick: (snapshot: ChapterSnapshot) => string[]
    keep?: (item: string) => boolean
  },
): string {
  const official = new Map<string, Set<number>>()
  const candidates: string[] = []
  for (const snapshot of snapshots) {
    for (const raw of options.pick(snapshot)) {
      const text = raw.trim()
      if (!text) continue
      if (UNCERTAIN_RE.test(text)) {
        candidates.push(`${chapterLabel(snapshot.chapterNumber)}：${text}`)
        continue
      }
      if (options.keep && !options.keep(text)) {
        continue
      }
      const chapters = official.get(text) ?? new Set<number>()
      chapters.add(snapshot.chapterNumber)
      official.set(text, chapters)
    }
  }

  const lines = pageHeader(options.memoryType, options.title)
  lines.push(`## ${options.sectionTitle}`, "")
  if (official.size === 0) {
    lines.push("暂无正式记录。", "")
  } else {
    for (const [text, chapters] of official) {
      lines.push(`- ${text}（来源：${joinChapterLabels(chapters)}）`)
    }
    lines.push("")
  }
  appendCandidateSection(lines, candidates)
  return `${lines.join("\n").trimEnd()}\n`
}

export function buildStructuredMemoryDocuments(snapshots: ChapterSnapshot[]): StructuredMemoryDocuments {
  const sortedSnapshots = [...snapshots].sort((a, b) => a.chapterNumber - b.chapterNumber)
  return {
    "chapter-snapshots.md": buildChapterSnapshotsDocument(sortedSnapshots),
    "character-cognition.md": buildCharacterCognitionDocument(sortedSnapshots),
    "character-states.md": buildCharacterStatesDocument(sortedSnapshots),
    "foreshadowing-tracker.md": buildForeshadowingDocument(sortedSnapshots),
    "timeline.md": buildSimpleFactDocument(sortedSnapshots, {
      memoryType: "timeline",
      title: "时间线记忆",
      sectionTitle: "已发生事件",
      pick: (snapshot) => snapshot.timelineEvents,
      keep: (item) => item.length <= 80,
    }),
    "canon-facts.md": buildSimpleFactDocument(sortedSnapshots, {
      memoryType: "canon-facts",
      title: "正式设定记忆",
      sectionTitle: "正式事实",
      pick: (snapshot) => snapshot.newCanonFacts,
      keep: (item) => item.length <= 100,
    }),
    "conflicts.md": buildSimpleFactDocument(sortedSnapshots, {
      memoryType: "conflicts",
      title: "冲突追踪记忆",
      sectionTitle: "当前冲突",
      pick: (snapshot) => snapshot.conflicts,
      keep: (item) => item.length <= 100,
    }),
  }
}
