import { describe, expect, it } from "vitest"
import { currentVersionChangelog } from "./changelog"

describe("currentVersionChangelog", () => {
  it("只返回当前软件版本的更新日志", () => {
    const entries = currentVersionChangelog("0.4.10")

    expect(entries).toHaveLength(1)
    expect(entries[0]?.version).toBe("0.4.10")
  })
})
