import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(__dirname, "../../..")

describe("dismantling library visibility", () => {
  it("shows the dismantling library navigation entry after 6-dimensional skill rollout", () => {
    const storeSource = readFileSync(resolve(root, "src/stores/wiki-store.ts"), "utf8")
    const sidebarSource = readFileSync(resolve(root, "src/components/layout/icon-sidebar.tsx"), "utf8")
    const contentSource = readFileSync(resolve(root, "src/components/layout/content-area.tsx"), "utf8")

    expect(storeSource).toContain('"dismantling"')
    expect(sidebarSource).toContain('view: "dismantling"')
    expect(sidebarSource).toContain("novel.nav.dismantling")
    expect(contentSource).toContain("DismantlingView")
    expect(contentSource).toContain("@/components/novel/dismantling-view")
  })

  it("keeps the hidden dismantling sidebar disconnected from the visible workspace", () => {
    const viewSource = readFileSync(resolve(root, "src/components/novel/dismantling-view.tsx"), "utf8")
    const sidebarSource = readFileSync(resolve(root, "src/components/layout/sidebar-panel.tsx"), "utf8")

    expect(sidebarSource).not.toContain('activeView === "dismantling"')
    expect(sidebarSource).toContain("DismantlingSidebarPanel")
    expect(viewSource).toContain("拆文结果")
  })

  it("keeps the underlying dismantling implementation intact for later re-enable", () => {
    const sidebarSource = readFileSync(resolve(root, "src/components/layout/sidebar-panel.tsx"), "utf8")

    expect(sidebarSource).toContain("正在提取章节")
    expect(sidebarSource).toContain("已存在相同拆文作品")
    expect(sidebarSource).toContain("normalizeDismantlingProjectTitle")
  })
})
