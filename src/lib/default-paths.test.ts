import { describe, expect, it } from "vitest"

import { buildDefaultNovelDir } from "@/lib/default-paths"

describe("default paths", () => {
  it("uses the install drive for the default novel directory", () => {
    expect(buildDefaultNovelDir(`D:\\QMaiWrite`)).toBe("D:\\QM-BOOK")
    expect(buildDefaultNovelDir(`e:\\QMaiWrite\\resources`)).toBe("E:\\QM-BOOK")
  })

  it("falls back to D drive when a Windows drive cannot be inferred", () => {
    expect(buildDefaultNovelDir("QMaiWrite")).toBe("D:\\QM-BOOK")
  })
})