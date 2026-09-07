import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "content-area.tsx"), "utf8")
const zh = readFileSync(resolve(__dirname, "../../i18n/zh.json"), "utf8")
const en = readFileSync(resolve(__dirname, "../../i18n/en.json"), "utf8")

describe("content-area novel lint slot", () => {
  it("routes the novel-mode lint slot to MemoryCenterView", () => {
    expect(source).toContain("const novelMode = useWikiStore((s) => s.novelMode)")
    expect(source).toContain("const MemoryCenterView = lazy")
    expect(source).toContain("novelMode ? <MemoryCenterView /> : <LintView />")
  })

  it("renames the novel nav label from continuity check to memory center", () => {
    expect(zh).toContain('"lint": "记忆中心"')
    expect(en).toContain('"lint": "Memory Center"')
  })

  it("renames dashboard navigation labels away from English in Chinese locale", () => {
    expect(zh).toContain('"reviewCenter": "审查中心"')
    expect(zh).toContain('"soul": "灵魂"')
  })
})
