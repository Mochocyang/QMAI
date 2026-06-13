import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildCurrentReleaseNotes } from "./release-notes.mjs"

describe("release notes for updater manifest", () => {
  it("uses the full Chinese changelog for the current package version", async () => {
    const notes = await buildCurrentReleaseNotes()

    expect(notes).not.toMatch(/^QMAI [\d.]+ 发布版本$/)
    expect(notes).toContain("1. ")
    expect(notes).toContain("Issue #10")
    expect(notes).toContain("frontmatter")
    expect(notes).toContain("Issue #8")
    expect(notes).toContain("单章目标字数")
    expect(notes.split("\n")).toHaveLength(5)
    expect(notes).not.toContain(".codex-temp")
  })

  it("can write release notes directly to a UTF-8 file for CI scripts", () => {
    const outDir = mkdtempSync(join(tmpdir(), "qmai-release-notes-"))
    const outPath = join(outDir, "release-notes.txt")

    execFileSync(process.execPath, ["scripts/release-notes.mjs", "2.1.0", "--out", outPath], {
      cwd: process.cwd(),
      stdio: "pipe",
    })

    const notes = readFileSync(outPath, "utf8")
    expect(notes).toContain("黄金三章")
    expect(notes).toContain("AI 审查")
    expect(notes.split("\n")).toHaveLength(18)
  })
})
