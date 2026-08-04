import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(__dirname, "../../..")

describe("book analysis routing", () => {
  it("keeps the book analysis routing connected", () => {
    const storeSource = readFileSync(resolve(root, "src/stores/wiki-store.ts"), "utf8")
    const sidebarSource = readFileSync(resolve(root, "src/components/layout/icon-sidebar.tsx"), "utf8")
    const contentSource = readFileSync(resolve(root, "src/components/layout/content-area.tsx"), "utf8")

    expect(storeSource).toContain('"bookAnalysis"')
    expect(sidebarSource).toContain('view: "bookAnalysis"')
    expect(sidebarSource).toContain("novel.nav.dismantling")
    expect(contentSource).toContain("BookAnalysisView")
    expect(contentSource).toContain("@/components/novel/book-analysis-view")
  })
})
