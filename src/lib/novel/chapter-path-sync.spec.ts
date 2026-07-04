import { describe, expect, it } from "vitest"
import {
  chapterContentMatchesPath,
  getDraftChapterPath,
  isDraftChapterPath,
  resolveChapterFlushMarkdown,
  shouldSkipEmptyChapterFlush,
  shouldSyncChapterOnLeave,
} from "@/lib/novel/chapter-path-sync"

const CH45 = `---
type: chapter
chapter_number: 45
chapter_status: draft
title: "第45章-空情之眼"
---

# 第45章 空情之眼

第四十五章正文。`

const CH46 = `---
type: chapter
chapter_number: 46
chapter_status: draft
title: "第46章-逆火第一轮"
---

# 第46章 逆火第一轮

第四十六章正文。`

describe("isDraftChapterPath", () => {
  it("detects AI draft chapter filenames", () => {
    expect(isDraftChapterPath("/proj/wiki/chapters/chapter-046.md")).toBe(true)
    expect(isDraftChapterPath("/proj/wiki/chapters/第46章-逆火第一轮.md")).toBe(false)
  })
})

describe("chapterContentMatchesPath", () => {
  it("rejects syncing chapter 46 content onto chapter 45 path", () => {
    expect(chapterContentMatchesPath("/proj/wiki/chapters/第45章-空情之眼.md", CH46)).toBe(false)
    expect(chapterContentMatchesPath("/proj/wiki/chapters/chapter-046.md", CH46)).toBe(true)
  })
})

describe("resolveChapterFlushMarkdown", () => {
  it("falls back to per-path snapshot instead of unrelated store content", () => {
    const snapshots = new Map([
      ["/proj/wiki/chapters/第45章-空情之眼.md", CH45],
      ["/proj/wiki/chapters/chapter-046.md", CH46],
    ])
    expect(resolveChapterFlushMarkdown("/proj/wiki/chapters/第45章-空情之眼.md", "", snapshots)).toBe(CH45)
  })
})

describe("shouldSyncChapterOnLeave", () => {
  it("skips empty flush when the path still has loaded content", () => {
    expect(shouldSyncChapterOnLeave("/proj/wiki/chapters/第45章-空情之眼.md", "", CH45)).toBe(false)
  })

  it("skips cross-chapter contamination", () => {
    expect(shouldSyncChapterOnLeave("/proj/wiki/chapters/第45章-空情之眼.md", CH46, CH45)).toBe(false)
  })

  it("allows unchanged content skip", () => {
    expect(shouldSyncChapterOnLeave("/proj/wiki/chapters/chapter-046.md", CH46, CH46)).toBe(false)
  })
})

describe("shouldSkipEmptyChapterFlush", () => {
  it("skips flushing empty markdown when disk snapshot still has content", () => {
    expect(shouldSkipEmptyChapterFlush("", CH45)).toBe(true)
  })

  it("allows flushing intentional empty edits when nothing was loaded", () => {
    expect(shouldSkipEmptyChapterFlush("", "")).toBe(false)
  })
})

describe("getDraftChapterPath", () => {
  it("builds the draft alias path for cleanup", () => {
    expect(getDraftChapterPath("/proj/wiki/chapters", 46)).toBe("/proj/wiki/chapters/chapter-046.md")
  })
})
