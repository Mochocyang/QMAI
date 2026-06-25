import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(__dirname, "../../..")

describe("memory center dismantling visibility", () => {
  it("hides the dismantling memory library entry from the memory center list", () => {
    const sidebarSource = readFileSync(resolve(root, "src/components/layout/sidebar-panel.tsx"), "utf8")
    const viewSource = readFileSync(resolve(root, "src/components/novel/memory-center-view.tsx"), "utf8")

    expect(sidebarSource).toContain("dismantling-library")
    expect(sidebarSource).toContain('filter((key) => key !== "dismantling-library")')
    expect(viewSource).toContain('selectedMemoryCenterEntry === "dismantling-library"')
    expect(viewSource).toContain("setSelectedMemoryCenterEntry(null)")
  })
})
