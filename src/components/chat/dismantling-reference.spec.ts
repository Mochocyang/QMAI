import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(__dirname, "../../..")

describe("chat dismantling reference", () => {
  it("disables dismantling structure injection while the feature is hidden", () => {
    const chatSource = readFileSync(resolve(root, "src/components/chat/chat-panel.tsx"), "utf8")

    expect(chatSource).not.toContain("loadEnabledDismantlingDirective")
    expect(chatSource).not.toContain("buildDismantlingReferenceDirective")
    expect(chatSource).not.toContain("loadDismantlingLibrary")
  })
})
