import { describe, expect, it } from "vitest"
import { buildSourceHash } from "./chapter-ingest"

describe("chapter ingest retrieval hash", () => {
  it("builds source hash from chapter body content instead of chapter number", () => {
    const first = buildSourceHash("第一章正文内容")
    const second = buildSourceHash("第一章正文内容 已修改")

    expect(first).not.toBe("1")
    expect(first).not.toBe(second)
    expect(buildSourceHash("第一章正文内容")).toBe(first)
  })
})
