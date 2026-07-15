/**
 * Runtime translation-key coverage check for both bundles.
 *
 * The bundles still contain different sets of unused legacy keys, so this
 * test checks every static reference that does not provide an explicit
 * runtime fallback instead of requiring destructive full-file parity cleanup.
 *
 * This test is deliberately string-based rather than going through
 * i18next's runtime — it should fail on the FILE contents before
 * anyone notices in the UI.
 */
import { describe, it, expect } from "vitest"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync, readdirSync, statSync } from "node:fs"
import en from "./en.json"
import zh from "./zh.json"

/** Flattens a nested translation object to "a.b.c" dot-path keys. */
function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return []
  const out: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === "object") {
      out.push(...flattenKeys(v, path))
    } else {
      out.push(path)
    }
  }
  return out
}

function collectReferencedI18nKeys(): string[] {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..")
  const files: string[] = []

  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        visit(full)
        continue
      }
      if (full.endsWith(".ts") || full.endsWith(".tsx")) {
        files.push(full)
      }
    }
  }

  visit(rootDir)

  const keys = new Set<string>()
  const patterns = [/\bt\(\s*["'`]([^"'`]+)["'`]/g, /i18n\.t\(\s*["'`]([^"'`]+)["'`]/g]

  files.forEach((file) => {
    const text = readFileSync(file, "utf8")
    patterns.forEach((pattern) => {
      for (const match of text.matchAll(pattern)) {
        const key = match[1]
        const snippet = text.slice(match.index ?? 0, (match.index ?? 0) + 240)
        const hasExplicitFallback = snippet.includes("defaultValue")
        if (key.includes(".") && !key.includes("${") && !hasExplicitFallback) {
          keys.add(key)
        }
      }
    })
  })

  return [...keys].sort()
}

function collectDynamicKeyWhitelist(): string[] {
  return [
    "novel.outline.type.story",
    "novel.outline.type.volume",
    "novel.outline.type.chapter",
    "novel.outlineGenerator.genres.fantasy",
    "novel.outlineGenerator.genres.xianxia",
    "novel.outlineGenerator.genres.scifi",
    "novel.outlineGenerator.genres.mystery",
    "novel.outlineGenerator.genres.romance",
    "novel.outlineGenerator.genres.historical",
    "novel.outlineGenerator.genres.military",
    "novel.outlineGenerator.genres.urban",
    "novel.outlineGenerator.genres.general",
    "novel.outlineGenerator.scales.short",
    "novel.outlineGenerator.scales.medium",
    "novel.outlineGenerator.scales.long",
    "novel.outlineGenerator.scales.epic",
    "novel.search.keyword",
    "novel.search.vector",
    "novel.search.graph",
    "novel.search.recentChapters",
    "novel.search.canon",
    "settings.sections.sourceWatch.groups.documents",
    "settings.sections.sourceWatch.groups.presentations",
    "settings.sections.sourceWatch.groups.spreadsheets",
    "settings.sections.sourceWatch.groups.web",
    "settings.sections.sourceWatch.groups.images",
    "settings.sections.sourceWatch.groups.media",
    "settings.sections.sourceWatch.groups.code",
    "settings.sections.sourceWatch.groups.data",
    "review.results.severity.error",
    "review.results.severity.warning",
    "review.results.severity.info",
    "review.results.dimension.character_consistency",
    "review.results.dimension.timeline",
    "review.results.dimension.foreshadowing",
    "review.results.dimension.setting",
    "review.results.dimension.plot",
    "review.results.dimension.style",
  ]
}

function collectScopedOrphanCandidates(): string[] {
  return [
    "review.notifications.created",
    "review.fallbacks.stripActionPrefixes",
    "review.fallbacks.openActionLabel",
    "review.results.type.character_consistency",
    "review.results.type.timeline",
    "review.results.type.foreshadowing",
    "review.results.type.setting",
    "review.results.type.plot",
    "review.results.type.style",
    "novel.outlineGenerator.success",
    "novel.outlineGenerator.ingestSuccess",
  ]
}

describe("i18n referenced-key coverage (en.json and zh.json)", () => {
  const i18nDir = dirname(fileURLToPath(import.meta.url))
  const enKeys = new Set(flattenKeys(en))
  const zhKeys = new Set(flattenKeys(zh))
  const referencedKeys = collectReferencedI18nKeys()
  const dynamicKeyWhitelist = collectDynamicKeyWhitelist()
  const scopedOrphanCandidates = collectScopedOrphanCandidates()

  it("does not contain duplicate top-level JSON keys", () => {
    const findDuplicates = (fileName: string) => {
      const text = readFileSync(join(i18nDir, fileName), "utf8")
      const seen = new Set<string>()
      const duplicates = new Set<string>()
      for (const match of text.matchAll(/^  "([^"]+)":/gm)) {
        const key = match[1]
        if (seen.has(key)) duplicates.add(key)
        seen.add(key)
      }
      return [...duplicates].sort()
    }

    expect(findDuplicates("en.json"), "duplicate top-level keys in en.json").toEqual([])
    expect(findDuplicates("zh.json"), "duplicate top-level keys in zh.json").toEqual([])
  })

  it("every referenced key without an explicit fallback exists in en.json", () => {
    const missing = referencedKeys.filter((k) => !enKeys.has(k))
    expect(
      missing,
      `Referenced keys missing from en.json:\n  ${missing.join("\n  ")}`,
    ).toEqual([])
  })

  it("every referenced key without an explicit fallback exists in zh.json", () => {
    const missing = referencedKeys.filter((k) => !zhKeys.has(k))
    expect(
      missing,
      `Referenced keys missing from zh.json:\n  ${missing.join("\n  ")}`,
    ).toEqual([])
  })

  it("keeps B5 novel copy keys for context, review, and adjacent feedback UI", () => {
    const requiredKeys = [
      "novel.contextPack.title",
      "novel.contextPack.currentTask",
      "novel.contextPack.recentRevisionDirectives",
      "novel.contextPack.mustDo.previousChapterEnding",
      "novel.contextPack.mustAvoid.canonRules",
      "novel.contextPack.nextChapterAdvice.searchResults",
      "novel.contextPack.foreshadowing.repeatedUnresolved",
      "novel.revisionFeedback.mustFix",
      "novel.revisionFeedback.shouldImprove",
      "novel.revisionFeedback.carryToNextChapter",
      "novel.reviewPrompt.reviewChapterInstruction",
      "novel.reviewPrompt.specialChecksTitle",
      "review.notifications.savedToWiki",
      "review.notifications.saveFailed",
      "review.notifications.deleted",
      "review.notifications.deleteFailed",
      "review.notifications.createdPage",
      "review.notifications.openedPage",
      "review.notifications.createFailed",
      "review.fallbacks.savedQueryTitle",
      "review.fallbacks.untitled",
      "review.fallbacks.stripTitlePrefixes",
      "review.fallbacks.genericActionLabel",
      "review.results.severity.error",
      "review.results.severity.warning",
      "review.results.severity.info",
      "review.results.dimension.character_consistency",
      "review.results.dimension.timeline",
      "review.results.dimension.foreshadowing",
      "review.results.dimension.setting",
      "review.results.dimension.plot",
      "review.results.dimension.style",
      "lint.reviewFallbacks.skipActionLabel",
      "lint.reviewFallbacks.semanticTitleFallback",
      "lint.messages.fixQueuedForReview",
      "lint.messages.semanticQueuedForReview",
      "lint.messages.openedFromLint",
      "lint.messages.deletedFromLint",
      "lint.messages.fixFailed",
      "lint.messages.deleteFailed",
      "lint.messages.unableToLoad",
    ]

    requiredKeys.forEach((key) => {
      expect(enKeys.has(key), `missing en key: ${key}`).toBe(true)
      expect(zhKeys.has(key), `missing zh key: ${key}`).toBe(true)
    })
  })

  it("keeps the approved dynamic-key whitelist present in both bundles", () => {
    dynamicKeyWhitelist.forEach((key) => {
      expect(enKeys.has(key), `missing en dynamic key: ${key}`).toBe(true)
      expect(zhKeys.has(key), `missing zh dynamic key: ${key}`).toBe(true)
    })
  })

  it("has no scoped orphan keys in the confirmed cleanup set", () => {
    const allowedReferencedKeys = new Set([...referencedKeys, ...dynamicKeyWhitelist])
    const orphanEnKeys = scopedOrphanCandidates.filter((key) => enKeys.has(key) && !allowedReferencedKeys.has(key))
    const orphanZhKeys = scopedOrphanCandidates.filter((key) => zhKeys.has(key) && !allowedReferencedKeys.has(key))

    expect(
      orphanEnKeys,
      `Scoped orphan keys in en.json:\n  ${orphanEnKeys.join("\n  ")}`,
    ).toEqual([])
    expect(
      orphanZhKeys,
      `Scoped orphan keys in zh.json:\n  ${orphanZhKeys.join("\n  ")}`,
    ).toEqual([])
  })

  it("keeps novel extract model copy explicit and distinct from embedding model", () => {
    expect(enKeys.has("novel.settings.extractModelHint"), "missing en extract model hint").toBe(true)
    expect(zhKeys.has("novel.settings.extractModelHint"), "missing zh extract model hint").toBe(true)
    expect(zh.novel.settings.extractModel).toContain("非嵌入模型")
    expect(zh.novel.settings.extractModelHint).toContain("大纲")
    expect(zh.novel.settings.extractModelHint).toContain("章节")
    expect(zh.novel.settings.extractModelHint).toContain("不是向量嵌入模型")
  })

  it("every leaf value is a non-empty string (no null / empty / placeholder slips)", () => {
    const check = (bundle: unknown, label: string) => {
      const keys = flattenKeys(bundle)
      for (const path of keys) {
        let ref: unknown = bundle
        for (const part of path.split(".")) {
          ref = (ref as Record<string, unknown>)[part]
        }
        expect(typeof ref, `${label}: ${path} is not a string`).toBe("string")
        expect((ref as string).length, `${label}: ${path} is empty`).toBeGreaterThan(0)
      }
    }
    check(en, "en.json")
    check(zh, "zh.json")
  })

  it("pluralization keys come in pairs: every foo_plural has a matching foo", () => {
    const check = (bundle: unknown, label: string) => {
      const keys = new Set(flattenKeys(bundle))
      for (const k of keys) {
        if (k.endsWith("_plural")) {
          const singular = k.slice(0, -"_plural".length)
          expect(
            keys.has(singular),
            `${label}: found ${k} but no matching ${singular} (i18next will fall back to the raw key for count=1)`,
          ).toBe(true)
        }
      }
    }
    check(en, "en.json")
    check(zh, "zh.json")
  })
})
