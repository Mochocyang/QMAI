import { describe, expect, it } from "vitest"
import { hasUnsavedLocalEdits, shouldApplyDiskToEditor } from "@/lib/editor-disk-sync"

const DISK_V1 = "disk version one"
const DISK_V2 = "disk version two"
const EDITOR_V1 = "editor version one"

describe("editor-disk-sync", () => {
  it("detects unsaved local edits", () => {
    expect(hasUnsavedLocalEdits({
      lastLoaded: DISK_V1,
      editorContent: EDITOR_V1,
    })).toBe(true)
  })

  it("treats pending autosave as unsaved local edits", () => {
    expect(hasUnsavedLocalEdits({
      lastLoaded: DISK_V1,
      editorContent: DISK_V1,
      hasPendingSave: true,
    })).toBe(true)
  })

  it("applies disk when externally changed and editor matches last loaded", () => {
    expect(shouldApplyDiskToEditor({
      lastLoaded: DISK_V1,
      editorContent: DISK_V1,
      diskContent: DISK_V2,
    })).toBe(true)
  })

  it("skips disk apply when editor has local edits", () => {
    expect(shouldApplyDiskToEditor({
      lastLoaded: DISK_V1,
      editorContent: EDITOR_V1,
      diskContent: DISK_V2,
    })).toBe(false)
  })

  it("skips disk apply when disk unchanged", () => {
    expect(shouldApplyDiskToEditor({
      lastLoaded: DISK_V1,
      editorContent: DISK_V1,
      diskContent: DISK_V1,
    })).toBe(false)
  })

  it("ignores formatting-only drift when normalize matches", () => {
    const normalize = (content: string) => content.trim()
    expect(hasUnsavedLocalEdits({
      lastLoaded: "hello",
      editorContent: " hello ",
      normalize,
    })).toBe(false)
    expect(shouldApplyDiskToEditor({
      lastLoaded: "hello",
      editorContent: " hello ",
      diskContent: "world",
      normalize,
    })).toBe(true)
  })
})
