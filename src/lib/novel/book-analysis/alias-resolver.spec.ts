import { describe, expect, it } from "vitest"
import { buildNameAliasMap, applyCanonicalNames, matchesAnyAlias } from "./alias-resolver"

describe("alias-resolver", () => {
  it("builds map with canonical + merged aliases", () => {
    const m = buildNameAliasMap("许七安", ["大郎", "许哥", "许银锣", "大郎"])
    expect(m.canonical).toBe("许七安")
    expect(m.aliases).toEqual(expect.arrayContaining(["大郎", "许哥", "许银锣"]))
    expect(m.aliases).not.toContain("许七安")
    expect(new Set(m.aliases).size).toBe(m.aliases.length) // 去重
  })

  it("rejects self-alias (canonical repeated in aliases)", () => {
    const m = buildNameAliasMap("林动", ["林动", "小动"])
    expect(m.canonical).toBe("林动")
    expect(m.aliases).toEqual(["小动"])
  })

  it("rejects too-long aliases", () => {
    const long = "a".repeat(21) // 21 个 ASCII > 20
    const m = buildNameAliasMap("A", [long, "ok"])
    expect(m.aliases).toEqual(["ok"])
  })

  it("rejects pure-punctuation alias", () => {
    const m = buildNameAliasMap("A", ["...", "ok", "？"])
    expect(m.aliases).toEqual(["ok"])
  })

  it("trims whitespace and collapses spaces", () => {
    const m = buildNameAliasMap("A", ["  B  ", "C D", " C\tD "])
    expect(m.aliases).toEqual(["B", "CD"])
  })

  it("applyCanonicalNames replaces all aliases", () => {
    const m = buildNameAliasMap("许七安", ["大郎", "许银锣"])
    const text = "大郎走进了城门，许银锣对他说："
    const out = applyCanonicalNames(text, m)
    expect(out).toBe("许七安走进了城门，许七安对他说：")
  })

  it("matchesAnyAlias returns true for canonical or any alias", () => {
    const m = buildNameAliasMap("萧炎", ["萧哥哥", "炎儿"])
    expect(matchesAnyAlias("萧炎一拳", m)).toBe(true)
    expect(matchesAnyAlias("萧哥哥笑了", m)).toBe(true)
    expect(matchesAnyAlias("林修", m)).toBe(false)
  })
})
