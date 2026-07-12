import { describe, expect, it } from "vitest"
import {
  hashNormalizedNovel,
  normalizeNovelForHash,
  reserveUniqueTitle,
} from "./batch-import-hash"

describe("batch import hash", () => {
  it("移除开头 BOM 并将 CRLF、CR 统一为 LF", () => {
    expect(normalizeNovelForHash("\ufeff第一章\r\n正文\r结尾")).toBe("第一章\n正文\n结尾")
  })

  it("忽略 BOM 和换行差异但比较完整正文", async () => {
    expect(await hashNormalizedNovel("\ufeff第一章\r\n正文")).toBe(
      await hashNormalizedNovel("第一章\n正文"),
    )
    expect(await hashNormalizedNovel("第一章\n正文A")).not.toBe(
      await hashNormalizedNovel("第一章\n正文B"),
    )
  })

  it("使用完整文本计算 SHA-256", async () => {
    expect(await hashNormalizedNovel("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })

  it("为同名不同内容分配稳定编号并立即保留名称", () => {
    const reserved = new Set(["长夜", "长夜（2）"])
    expect(reserveUniqueTitle("长夜", reserved)).toBe("长夜（3）")
    expect(reserved.has("长夜（3）")).toBe(true)
  })
})
