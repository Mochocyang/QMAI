import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "sidebar-panel.tsx"), "utf8")

describe("sidebar-panel usage guide entry", () => {
  it("renders a usage guide entry above the extraction status area and opens the Feishu guide", () => {
    expect(source).toContain("USAGE_GUIDE_URL")
    expect(source).toContain("tcnk9ik08e1c.feishu.cn/wiki/FWiSwYQKoifpwBk6mSRcSlB8nrh?from=from_copylink")
    expect(source).toContain("openExternalUrl(USAGE_GUIDE_URL)")
    expect(source).toContain("<UiTestDirectoryHeader")
    expect(source).toContain("onHelp={() => void openExternalUrl(USAGE_GUIDE_URL)}")
    expect(source).toContain("UiTestDirectoryHeader")
    expect(source).toContain("onHelp")
  })
})
