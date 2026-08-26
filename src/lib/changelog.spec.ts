import { describe, expect, it } from "vitest"
import { allChangelog, currentVersionChangelog } from "./changelog"

describe("changelog", () => {
  it("shows current releases first and keeps intentionally retained history", () => {
    const entries = allChangelog()
    const versions = entries.map((entry) => entry.version)

    expect(versions.slice(0, 3)).toEqual(["3.2.9", "3.2.8", "3.2.7"])
    expect(versions).toContain("3.0.9")
    expect(versions).toContain("2.2.37")
    expect(versions).toContain("2.1.0")
    expect(versions).toContain("2.0.0")
    expect(new Set(versions).size).toBe(versions.length)

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

    const release328 = currentVersionChangelog("3.2.8")[0]
    expect(release328.version).toBe("3.2.8")
    expect(release328.highlights.zh.join("\n")).toContain("拆书并行分析")
    expect(release328.highlights.zh.join("\n")).toContain("故事导图历史全保留")
    expect(release328.highlights.zh.join("\n")).toContain("模型设置融合")
    expect(release328.highlights.zh.join("\n")).toContain("界面精简")
    expect(release328.highlights.en.join("\n")).toContain("Parallel Book Analysis")

    const release329 = currentVersionChangelog("3.2.9")[0]
    expect(release329.version).toBe("3.2.9")
    expect(release329.highlights.zh.join("\n")).toContain("修复提取章节遗漏最后一章")
    expect(release329.highlights.zh.join("\n")).toContain("故事导图更完整")
    expect(release329.highlights.zh.join("\n")).toContain("生成内容可删除可恢复")
    expect(release329.highlights.en.join("\n")).toContain("Chapter Extraction Fix")

    const release = currentVersionChangelog("2.0.0")[0]
    expect(release.highlights.en.join("\n")).toContain("Major release")
    expect(release.highlights.en.join("\n")).toContain("Review Center")
    expect(release.highlights.en.join("\n")).toContain("AI Rewrite")
  })

  it("returns the 2.2.36 reliability release notes", () => {
    const release = currentVersionChangelog("2.2.36")[0]
    const zh = release.highlights.zh.join("\n")

    expect(release.version).toBe("2.2.36")
    expect(zh).toContain("确认计划")
    expect(zh).toContain("严格审稿")
    expect(zh).toContain("草稿")
    expect(zh).toContain("并发保存")
  })

  it("returns the 2.2.37 cache usage release notes", () => {
    const release = currentVersionChangelog("2.2.37")[0]
    const zh = release.highlights.zh.join("\n")

    expect(release.version).toBe("2.2.37")
    expect(zh).toContain("供应商真实缓存")
    expect(zh).toContain("Agent")
    expect(zh).toContain("上下文压缩")
    expect(zh).toContain("稳定核心")
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
