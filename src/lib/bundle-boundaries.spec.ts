import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8").replace(/\r\n/g, "\n")

describe("frontend bundle boundaries", () => {
  it("uses focused vendor chunks instead of one forced book-analysis chunk", () => {
    const viteConfig = read("../../vite.config.ts")

    expect(viteConfig).toContain('return "opencc-vendor"')
    expect(viteConfig).toContain('return "pinyin-vendor"')
    expect(viteConfig).toContain('return "yaml-vendor"')
    expect(viteConfig).not.toContain('return "book-analysis-vendor"')
  })

  it("matches sigma packages before the broad React vendor rule", () => {
    const viteConfig = read("../../vite.config.ts")
    const sigmaRule = viteConfig.indexOf('id.includes("@react-sigma")')
    const reactRule = viteConfig.indexOf('id.includes("react") || id.includes("scheduler")')

    expect(sigmaRule).toBeGreaterThan(-1)
    expect(reactRule).toBeGreaterThan(-1)
    expect(sigmaRule).toBeLessThan(reactRule)
  })

  it("keeps character-aura matching out of the initial context graph", () => {
    const characterAura = read("./novel/character-aura.ts")
    const contextEngine = read("./novel/context-engine.ts")
    const reviewAdapter = read("./novel/review-adapter.ts")

    expect(characterAura).toContain('from "opencc-js/t2cn"')
    expect(characterAura).not.toContain('from "opencc-js"')
    expect(contextEngine).not.toContain('from "./character-aura"')
    expect(contextEngine).toContain('await import("./character-aura")')
    expect(reviewAdapter).not.toContain('from "./character-aura"')
    expect(reviewAdapter).toContain('await import("./character-aura")')
  })

  it("loads optional search, skill, soul, and book-analysis views on demand", () => {
    const contentArea = read("../components/layout/content-area.tsx")
    const sidebarPanel = read("../components/layout/sidebar-panel.tsx")

    expect(contentArea).not.toContain('import { SearchView } from')
    expect(contentArea).not.toContain('import { UnifiedSkillLibraryView } from')
    expect(contentArea).toContain('await import("@/components/search/search-view")')
    expect(contentArea).toContain('await import("@/components/skill-library/unified-skill-library-view")')
    expect(sidebarPanel).not.toContain('import { SoulSidebarPanel } from')
    expect(sidebarPanel).not.toContain('import { BookAnalysisSidebarPanel } from')
    expect(sidebarPanel).not.toContain('import { UnifiedSkillLibrarySidebarPanel } from')
    expect(sidebarPanel).toContain('await import("./soul-sidebar-panel")')
    expect(sidebarPanel).toContain('await import("./book-analysis-sidebar-panel")')
    expect(sidebarPanel).toContain('await import("@/components/skill-library/unified-skill-library-view")')
  })

  it("keeps the lazy-loading fallback user-facing text in Chinese", () => {
    const contentArea = read("../components/layout/content-area.tsx")

    expect(contentArea).toContain("加载中...")
    expect(contentArea).not.toContain("Loading...")
  })
})
