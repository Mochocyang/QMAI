import { describe, expect, it } from "vitest"
import { allChangelog, currentVersionChangelog } from "./changelog"

describe("changelog", () => {
  it("shows the latest visible 2.2 releases before earlier releases", () => {
    const entries = allChangelog()
    const versions = entries.map((entry) => entry.version)

    expect(versions.slice(0, 27)).toEqual([
      "2.2.33",
      "2.2.32",
      "2.2.31",
      "2.2.30",
      "2.2.29",
      "2.2.27",
      "2.2.26",
      "2.2.25",
      "2.2.24",
      "2.2.23",
      "2.2.22",
      "2.2.21",
      "2.2.20",
      "2.2.19",
      "2.2.18",
      "2.2.17",
      "2.2.16",
      "2.2.14",
      "2.2.13",
      "2.2.12",
      "2.2.11",
      "2.2.10",
      "2.2.9",
      "2.2.8",
      "2.2.7",
      "2.2.0",
      "2.1.0",
    ])
    expect(versions[27]).toBe("2.0.0")

    for (let patch = 1; patch <= 6; patch += 1) {
      expect(versions).not.toContain(`2.2.${patch}`)
      expect(currentVersionChangelog(`2.2.${patch}`)).toEqual([])
    }
    expect(versions).not.toContain("2.2.28")
    expect(currentVersionChangelog("2.2.28")).toEqual([])
    for (let patch = 1; patch <= 10; patch += 1) {
      expect(versions).not.toContain(`2.1.${patch}`)
      expect(currentVersionChangelog(`2.1.${patch}`)).toEqual([])
    }
    for (let patch = 1; patch <= 12; patch += 1) {
      expect(versions).not.toContain(`2.0.${patch}`)
      expect(currentVersionChangelog(`2.0.${patch}`)).toEqual([])
    }

    expect(versions).toContain("1.0.7")
    for (let patch = 8; patch <= 32; patch += 1) {
      expect(versions).not.toContain(`1.0.${patch}`)
    }

    const release = currentVersionChangelog("2.0.0")[0]
    expect(release.highlights.en.join("\n")).toContain("Major release")
    expect(release.highlights.en.join("\n")).toContain("Review Center")
    expect(release.highlights.en.join("\n")).toContain("AI Rewrite")
  })

  it("returns the 2.2.0 changelog entry", () => {
    const release = currentVersionChangelog("2.2.0")[0]
    const zh = release.highlights.zh.join("\n")
    const en = release.highlights.en.join("\n")

    expect(release.version).toBe("2.2.0")
    expect(en).toContain("Continue Next Chapter")
    expect(en).toContain("target chapter number")
    expect(en).toContain("Character Soul")
    expect(en).toContain("2,200-3,200")
    expect(en).toContain("network errors")
    expect(zh).not.toContain("鑱旂郴鏂瑰紡")
  })

  it("returns the 2.2.7 changelog entry for the hidden dismantling library and resume recovery", () => {
    const release = currentVersionChangelog("2.2.7")[0]
    const en = release.highlights.en.join("\n")

    expect(release.version).toBe("2.2.7")
    expect(en).toContain("Hidden the Dismantling Library UI")
    expect(en).toContain("Removed the 2.2.6 to 2.2.1 release notes")
    expect(en).toContain("saved stage checkpoint")
    expect(en).toContain("Switching models")
    expect(en).toContain("newly inserted paragraph")
  })
  it("returns the 2.2.8 changelog entry for review fixes and deep chapter length control", () => {
    const release = currentVersionChangelog("2.2.8")[0]
    const en = release.highlights.en.join("\n")

    expect(release.version).toBe("2.2.8")
    expect(en).toContain("local-environment LLM defaults")
    expect(en).toContain("selected chapter file names")
    expect(en).toContain("different projects no longer share retrieval graphs")
    expect(en).toContain("3,500-character cap")
    expect(en).toContain("6,000 characters")
  })

  it("returns the 2.2.9 changelog entry for the outline crash fix", () => {
    const release = currentVersionChangelog("2.2.9")[0]
    const zh = release.highlights.zh.join("\n")
    const en = release.highlights.en.join("\n")

    expect(release.version).toBe("2.2.9")
    expect(en).toContain("undefined length/trim errors")
    expect(zh).toContain("length / trim")
    expect(zh).toContain("大纲上下文或对话字段缺失")
  })

  it("returns the 2.2.11 changelog entry for toolbar, de-ai, and local cli fixes", () => {
    const release = currentVersionChangelog("2.2.11")[0]
    const zh = release.highlights.zh.join("\n")
    const en = release.highlights.en.join("\n")

    expect(release.version).toBe("2.2.11")
    expect(en).toContain("full right-side chapter toolbar")
    expect(en).toContain("2,200-3,200")
    expect(en).toContain("Claude Code CLI")
    expect(zh).toContain("保存到章节库")
    expect(zh).toContain("2200-3200")
    expect(zh).toContain("本地 Claude Code CLI / Codex CLI")
  })
})
