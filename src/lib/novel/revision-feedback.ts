import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import i18n from "@/i18n"
import type { LintResult } from "@/lib/lint"
import type { NovelReviewResult } from "./review-adapter"

export interface NovelRevisionFeedback {
  mustFix: string[]
  shouldImprove: string[]
  carryToNextChapter: string[]
}

export interface RevisionFeedbackWindowConfig {
  currentChapterIncludeShouldImprove: boolean
  previousChapterCarryEnabled: boolean
  lookbackChapterCount: number
  lookbackIncludeMustFixOnly: boolean
}

export const DEFAULT_REVISION_FEEDBACK_WINDOW_CONFIG: RevisionFeedbackWindowConfig = {
  currentChapterIncludeShouldImprove: true,
  previousChapterCarryEnabled: true,
  lookbackChapterCount: 2,
  lookbackIncludeMustFixOnly: true,
}

export type RevisionFeedbackSource = "review" | "lint"

interface ChapterRevisionFeedbackBuckets {
  fromReview: NovelRevisionFeedback
  fromLint: NovelRevisionFeedback
}

interface PersistedRevisionFeedbackByChapter {
  chapters: Record<string, ChapterRevisionFeedbackBuckets>
}

const REVISION_FEEDBACK_DIRNAME = ".novel"
const REVISION_FEEDBACK_FILENAME = "revision-feedback.json"

let currentRevisionFeedback: NovelRevisionFeedback = createEmptyRevisionFeedback()

export function createEmptyRevisionFeedback(): NovelRevisionFeedback {
  return {
    mustFix: [],
    shouldImprove: [],
    carryToNextChapter: [],
  }
}

export function pickRevisionFeedbackFromReviewResults(results: NovelReviewResult[]): NovelRevisionFeedback {
  const feedback = createEmptyRevisionFeedback()

  for (const result of results) {
    const normalized = normalizeRevisionEntry(result.message, result.suggestion)
    if (!normalized) continue

    if (result.severity === "error") {
      feedback.mustFix.push(normalized)
    } else {
      feedback.shouldImprove.push(normalized)
    }

    if (/下一章|继续承接|承接|继续推进|回收/i.test(`${result.message} ${result.suggestion}`)) {
      feedback.carryToNextChapter.push(normalized)
    }
  }

  return dedupeRevisionFeedback(feedback)
}

export function pickRevisionFeedbackFromLintResults(results: LintResult[]): NovelRevisionFeedback {
  const feedback = createEmptyRevisionFeedback()

  for (const result of results) {
    if (result.type !== "semantic") continue
    const detail = result.detail.trim()
    if (!detail) continue

    if (detail.includes("[contradiction]") || detail.includes("[stale]")) {
      feedback.mustFix.push(detail)
    } else if (detail.includes("[suggestion]")) {
      feedback.shouldImprove.push(detail)
    }

    if (/下一章|继续承接|承接|回收|铺设/i.test(detail)) {
      feedback.carryToNextChapter.push(detail)
    }
  }

  return dedupeRevisionFeedback(feedback)
}

export function mergeRevisionFeedback(
  current: NovelRevisionFeedback,
  incoming: NovelRevisionFeedback,
): NovelRevisionFeedback {
  return dedupeRevisionFeedback({
    mustFix: [...current.mustFix, ...incoming.mustFix],
    shouldImprove: [...current.shouldImprove, ...incoming.shouldImprove],
    carryToNextChapter: [...current.carryToNextChapter, ...incoming.carryToNextChapter],
  })
}

export function buildRevisionDirectives(feedback: NovelRevisionFeedback): string {
  const sections: string[] = []

  if (feedback.mustFix.length > 0) {
    sections.push(i18n.t("novel.revisionFeedback.mustFix"))
    feedback.mustFix.forEach((item) => sections.push(`  - ${item}`))
  }

  if (feedback.shouldImprove.length > 0) {
    sections.push(i18n.t("novel.revisionFeedback.shouldImprove"))
    feedback.shouldImprove.forEach((item) => sections.push(`  - ${item}`))
  }

  if (feedback.carryToNextChapter.length > 0) {
    sections.push(i18n.t("novel.revisionFeedback.carryToNextChapter"))
    feedback.carryToNextChapter.forEach((item) => sections.push(`  - ${item}`))
  }

  return sections.join("\n")
}

export function getRevisionDirectives(): string {
  return buildRevisionDirectives(currentRevisionFeedback)
}

export function storeRevisionFeedback(feedback: NovelRevisionFeedback): void {
  currentRevisionFeedback = mergeRevisionFeedback(currentRevisionFeedback, feedback)
}

export async function persistRevisionFeedbackForProject(
  projectPath: string,
  feedback: NovelRevisionFeedback,
): Promise<void> {
  const next = dedupeRevisionFeedback(feedback)
  currentRevisionFeedback = next

  const dir = `${projectPath}/${REVISION_FEEDBACK_DIRNAME}`
  const filePath = getRevisionFeedbackFilePath(projectPath)

  await createDirectory(dir)
  await writeFile(filePath, JSON.stringify(next, null, 2))
}

export async function persistRevisionFeedbackForChapter(
  projectPath: string,
  chapterNumber: number,
  source: RevisionFeedbackSource,
  feedback: NovelRevisionFeedback,
): Promise<void> {
  const persisted = await loadPersistedRevisionFeedback(projectPath)
  const key = String(chapterNumber)
  const chapterBuckets = persisted.chapters[key] ?? createEmptyChapterRevisionFeedbackBuckets()

  if (source === "review") {
    chapterBuckets.fromReview = dedupeRevisionFeedback(feedback)
  } else {
    chapterBuckets.fromLint = dedupeRevisionFeedback(feedback)
  }

  persisted.chapters[key] = chapterBuckets
  currentRevisionFeedback = mergeRevisionFeedback(chapterBuckets.fromReview, chapterBuckets.fromLint)

  await persistRevisionFeedbackDocument(projectPath, persisted)
}

export async function loadRevisionFeedbackForProject(projectPath: string): Promise<NovelRevisionFeedback> {
  const filePath = getRevisionFeedbackFilePath(projectPath)
  const exists = await fileExists(filePath)
  if (!exists) {
    currentRevisionFeedback = createEmptyRevisionFeedback()
    return currentRevisionFeedback
  }

  try {
    const raw = await readFile(filePath)
    const parsed = JSON.parse(raw) as Partial<NovelRevisionFeedback> | Partial<PersistedRevisionFeedbackByChapter>
    const legacy = parseLegacyRevisionFeedback(parsed)
    if (legacy) {
      currentRevisionFeedback = legacy
      return currentRevisionFeedback
    }

    const persisted = normalizePersistedRevisionFeedback(parsed)
    currentRevisionFeedback = flattenPersistedRevisionFeedback(persisted)
    return currentRevisionFeedback
  } catch {
    currentRevisionFeedback = createEmptyRevisionFeedback()
    return currentRevisionFeedback
  }
}

export async function loadRevisionFeedbackForContext(
  projectPath: string,
  chapterNumber?: number,
  config: RevisionFeedbackWindowConfig = DEFAULT_REVISION_FEEDBACK_WINDOW_CONFIG,
): Promise<NovelRevisionFeedback> {
  if (!chapterNumber || chapterNumber <= 0) {
    return loadRevisionFeedbackForProject(projectPath)
  }

  const persisted = await loadPersistedRevisionFeedback(projectPath)
  const current = persisted.chapters[String(chapterNumber)] ?? createEmptyChapterRevisionFeedbackBuckets()

  let merged = dedupeRevisionFeedback({
    mustFix: [...current.fromReview.mustFix, ...current.fromLint.mustFix],
    shouldImprove: config.currentChapterIncludeShouldImprove
      ? [...current.fromReview.shouldImprove, ...current.fromLint.shouldImprove]
      : [],
    carryToNextChapter: [...current.fromReview.carryToNextChapter, ...current.fromLint.carryToNextChapter],
  })

  if (config.previousChapterCarryEnabled) {
    const previous = persisted.chapters[String(chapterNumber - 1)] ?? createEmptyChapterRevisionFeedbackBuckets()
    merged = mergeRevisionFeedback(merged, {
      mustFix: [],
      shouldImprove: [],
      carryToNextChapter: [
        ...previous.fromReview.carryToNextChapter,
        ...previous.fromLint.carryToNextChapter,
      ],
    })
  }

  for (let offset = 1; offset <= Math.max(0, config.lookbackChapterCount); offset += 1) {
    const lookbackChapterNumber = chapterNumber - offset
    if (lookbackChapterNumber <= 0) break
    const chapter = persisted.chapters[String(lookbackChapterNumber)]
    if (!chapter) continue

    merged = mergeRevisionFeedback(merged, {
      mustFix: [...chapter.fromReview.mustFix, ...chapter.fromLint.mustFix],
      shouldImprove: config.lookbackIncludeMustFixOnly
        ? []
        : [...chapter.fromReview.shouldImprove, ...chapter.fromLint.shouldImprove],
      carryToNextChapter: [],
    })
  }

  currentRevisionFeedback = merged
  return currentRevisionFeedback
}

export function clearRevisionFeedback(): void {
  currentRevisionFeedback = createEmptyRevisionFeedback()
}

export function setRevisionFeedbackForTesting(feedback: NovelRevisionFeedback): void {
  currentRevisionFeedback = dedupeRevisionFeedback(feedback)
}

function getRevisionFeedbackFilePath(projectPath: string): string {
  return `${projectPath}/${REVISION_FEEDBACK_DIRNAME}/${REVISION_FEEDBACK_FILENAME}`
}

function dedupeRevisionFeedback(feedback: NovelRevisionFeedback): NovelRevisionFeedback {
  return {
    mustFix: uniqueNonEmpty(feedback.mustFix),
    shouldImprove: uniqueNonEmpty(feedback.shouldImprove),
    carryToNextChapter: uniqueNonEmpty(feedback.carryToNextChapter),
  }
}

function uniqueNonEmpty(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

function normalizeRevisionEntry(message: string, suggestion: string): string {
  const parts = [message.trim(), suggestion.trim()].filter(Boolean)
  return Array.from(new Set(parts)).join("；")
}

function createEmptyChapterRevisionFeedbackBuckets(): ChapterRevisionFeedbackBuckets {
  return {
    fromReview: createEmptyRevisionFeedback(),
    fromLint: createEmptyRevisionFeedback(),
  }
}

function parseLegacyRevisionFeedback(value: unknown): NovelRevisionFeedback | null {
  if (!value || typeof value !== "object") return null
  const parsed = value as Partial<NovelRevisionFeedback>
  const hasLegacyKeys = [parsed.mustFix, parsed.shouldImprove, parsed.carryToNextChapter].some(Array.isArray)
  if (!hasLegacyKeys) return null

  return dedupeRevisionFeedback({
    mustFix: Array.isArray(parsed.mustFix) ? parsed.mustFix : [],
    shouldImprove: Array.isArray(parsed.shouldImprove) ? parsed.shouldImprove : [],
    carryToNextChapter: Array.isArray(parsed.carryToNextChapter) ? parsed.carryToNextChapter : [],
  })
}

function normalizePersistedRevisionFeedback(value: unknown): PersistedRevisionFeedbackByChapter {
  if (!value || typeof value !== "object") {
    return { chapters: {} }
  }

  const parsed = value as Partial<PersistedRevisionFeedbackByChapter>
  const chapters = parsed.chapters
  if (!chapters || typeof chapters !== "object") {
    return { chapters: {} }
  }

  const normalizedEntries = Object.entries(chapters).map(([chapterNumber, bucketValue]) => {
    const bucketRecord = bucketValue as Partial<ChapterRevisionFeedbackBuckets> | undefined
    return [chapterNumber, {
      fromReview: parseLegacyRevisionFeedback(bucketRecord?.fromReview) ?? createEmptyRevisionFeedback(),
      fromLint: parseLegacyRevisionFeedback(bucketRecord?.fromLint) ?? createEmptyRevisionFeedback(),
    }] as const
  })

  return {
    chapters: Object.fromEntries(normalizedEntries),
  }
}

async function loadPersistedRevisionFeedback(projectPath: string): Promise<PersistedRevisionFeedbackByChapter> {
  const filePath = getRevisionFeedbackFilePath(projectPath)
  const exists = await fileExists(filePath)
  if (!exists) {
    return { chapters: {} }
  }

  try {
    const raw = await readFile(filePath)
    const parsed = JSON.parse(raw) as Partial<NovelRevisionFeedback> | Partial<PersistedRevisionFeedbackByChapter>
    const legacy = parseLegacyRevisionFeedback(parsed)
    if (legacy) {
      currentRevisionFeedback = legacy
      return { chapters: {} }
    }
    return normalizePersistedRevisionFeedback(parsed)
  } catch {
    return { chapters: {} }
  }
}

async function persistRevisionFeedbackDocument(
  projectPath: string,
  persisted: PersistedRevisionFeedbackByChapter,
): Promise<void> {
  const dir = `${projectPath}/${REVISION_FEEDBACK_DIRNAME}`
  const filePath = getRevisionFeedbackFilePath(projectPath)

  await createDirectory(dir)
  await writeFile(filePath, JSON.stringify(persisted, null, 2))
}

function flattenPersistedRevisionFeedback(persisted: PersistedRevisionFeedbackByChapter): NovelRevisionFeedback {
  let merged = createEmptyRevisionFeedback()

  for (const chapter of Object.values(persisted.chapters)) {
    merged = mergeRevisionFeedback(merged, chapter.fromReview)
    merged = mergeRevisionFeedback(merged, chapter.fromLint)
  }

  return merged
}
