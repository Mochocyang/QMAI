import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "soul-doc-editor.tsx"), "utf8")

describe("SoulDocEditor source", () => {
  it("uses the structured project soul style store instead of editing only soul.md directly", () => {
    expect(source).toContain("loadProjectSoulStyleStore")
    expect(source).toContain("saveProjectSoulStyleStore")
    expect(source).toContain("createEmptyProjectSoulStyle")
  })

  it("renders multiple style items with a single enabled switch", () => {
    expect(source).toContain("styles.map")
    expect(source).toContain("handleEnableStyle")
    expect(source).toContain('aria-label={`启用写作风格：${style.name}`}')
    expect(source).toContain("新增写作风格")
  })

  it("describes project soul as project rules rather than only writing style", () => {
    expect(source).toContain("核心气质、创作边界、叙事原则和长期写作总则")
    expect(source).not.toContain("定义整个写作 AI 的气质、叙事节奏和语言风格")
  })

  it("uses the full soul workspace width instead of a narrow centered editor", () => {
    expect(source).toContain("w-full max-w-none")
    expect(source).not.toContain("max-w-5xl")
  })
})
