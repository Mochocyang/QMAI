import { describe, it, expect } from "vitest"
import {
  User,
  Lightbulb,
  HelpCircle,
  FileText,
  Target,
  TrendingUp,
  BookOpen,
  Calendar,
  Hash,
} from "lucide-react"
import {
  getWikiTypeStyle,
  WIKI_TYPE_STYLES,
  FALLBACK_TYPE_STYLE,
} from "./wiki-type-style"

/**
 * NOTE (equivalent rewrite): commit 01aab5f
 * ("refactor(cleanup): 收口测试专用旧模块和未使用导出") removed the `export`
 * keyword from `WIKI_TYPE_STYLES` and `FALLBACK_TYPE_STYLE`. The style tables
 * themselves were never deleted and `getWikiTypeStyle` is byte-for-byte
 * unchanged. Those two exports have been restored so this file keeps pinning
 * the **real** tables rather than a copy — if production changes a label or a
 * Tailwind class, the explicit literals below still fail the test.
 */
const EXPECTED_ENTITY = {
  label: "Entity",
  icon: User,
  chipClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  dotClass: "bg-blue-500",
}

const EXPECTED_CONCEPT = {
  label: "Concept",
  icon: Lightbulb,
  chipClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  dotClass: "bg-emerald-500",
}

const EXPECTED_QUERY = {
  label: "Query",
  icon: HelpCircle,
  chipClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  dotClass: "bg-amber-500",
}

describe("getWikiTypeStyle", () => {
  it("returns the entity style for 'entity'", () => {
    const style = getWikiTypeStyle("entity")
    expect(style).toEqual(EXPECTED_ENTITY)
    expect(style.label).toBe("Entity")
    expect(style.icon).toBe(User)
    expect(style.chipClass).toBe("bg-blue-500/15 text-blue-700 dark:text-blue-300")
    expect(style.dotClass).toBe("bg-blue-500")
  })

  it("is case-insensitive", () => {
    expect(getWikiTypeStyle("ENTITY")).toEqual(EXPECTED_ENTITY)
    expect(getWikiTypeStyle("Concept")).toEqual(EXPECTED_CONCEPT)
    // Normalisation must land on the very same style object, not a copy.
    expect(getWikiTypeStyle("ENTITY")).toBe(getWikiTypeStyle("entity"))
    expect(getWikiTypeStyle("Concept")).toBe(getWikiTypeStyle("concept"))
  })

  it("trims surrounding whitespace", () => {
    expect(getWikiTypeStyle("  query  ")).toEqual(EXPECTED_QUERY)
    expect(getWikiTypeStyle("  query  ")).toBe(getWikiTypeStyle("query"))
  })

  it("returns fallback for null", () => {
    expect(getWikiTypeStyle(null)).toEqual(FALLBACK_TYPE_STYLE)
  })

  it("returns fallback for undefined", () => {
    expect(getWikiTypeStyle(undefined)).toEqual(FALLBACK_TYPE_STYLE)
  })

  it("returns fallback for empty string", () => {
    expect(getWikiTypeStyle("")).toEqual(FALLBACK_TYPE_STYLE)
  })

  it("returns fallback for an unknown type", () => {
    expect(getWikiTypeStyle("zorbax")).toEqual(FALLBACK_TYPE_STYLE)
  })

  it("reuses one shared fallback instance for every missing or unknown type", () => {
    expect(getWikiTypeStyle(null)).toBe(getWikiTypeStyle(undefined))
    expect(getWikiTypeStyle("")).toBe(getWikiTypeStyle("zorbax"))
    expect(getWikiTypeStyle(null)).toBe(getWikiTypeStyle("zorbax"))
  })

  it("covers every documented page type", () => {
    const expected = [
      "entity", "concept", "query", "source",
      "thesis", "finding", "event", "overview",
    ]
    for (const t of expected) {
      const style = getWikiTypeStyle(t)
      expect(style).not.toEqual(FALLBACK_TYPE_STYLE)
      expect(style.label).toBe(t.charAt(0).toUpperCase() + t.slice(1))
      expect(style.label.length).toBeGreaterThan(0)
      expect(style.chipClass).toContain("bg-")
      expect(style.dotClass).toContain("bg-")
    }
  })
})

// Pins the production tables themselves. Without importing them, a change to
// `WIKI_TYPE_STYLES` would only be caught for the three types asserted above.
describe("style tables (production source of truth)", () => {
  it("matches the documented literals for the asserted types", () => {
    expect(WIKI_TYPE_STYLES.entity).toEqual(EXPECTED_ENTITY)
    expect(WIKI_TYPE_STYLES.concept).toEqual(EXPECTED_CONCEPT)
    expect(WIKI_TYPE_STYLES.query).toEqual(EXPECTED_QUERY)
  })

  it("exposes the documented fallback literal", () => {
    expect(FALLBACK_TYPE_STYLE).toEqual({
      label: "Page",
      icon: Hash,
      chipClass: "bg-muted text-muted-foreground",
      dotClass: "bg-muted-foreground/60",
    })
  })

  it("gives every entry a non-empty label and Tailwind bg- classes", () => {
    const entries = Object.entries(WIKI_TYPE_STYLES)
    expect(entries.length).toBeGreaterThan(0)
    for (const [key, style] of entries) {
      expect(key).toBe(key.trim().toLowerCase())
      expect(style.label.length).toBeGreaterThan(0)
      expect(style.chipClass).toContain("bg-")
      expect(style.dotClass).toContain("bg-")
      expect(style.icon).toBeTruthy()
    }
  })

  it("keeps the fallback out of the type table", () => {
    for (const style of Object.values(WIKI_TYPE_STYLES)) {
      expect(style).not.toBe(FALLBACK_TYPE_STYLE)
    }
  })
})

// Unused-icon guard: every documented type keeps a distinct lucide icon, so a
// regression that drops icons down to one shared glyph is caught here.
describe("documented type icons", () => {
  it("maps each documented type to its own icon", () => {
    const pairs: Array<[string, unknown]> = [
      ["source", FileText],
      ["thesis", Target],
      ["finding", TrendingUp],
      ["overview", BookOpen],
      ["event", Calendar],
    ]
    const seen = new Set<unknown>([User, Lightbulb, HelpCircle])
    for (const [type, icon] of pairs) {
      expect(getWikiTypeStyle(type).icon).toBe(icon)
      expect(seen.has(icon)).toBe(false)
      seen.add(icon)
    }
  })
})
