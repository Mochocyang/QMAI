// content-fingerprint.spec.ts
// 内容指纹模块测试（feature/book-analysis-reuse）
import { describe, it, expect } from "vitest"
import { fingerprintText, fingerprintFileSample } from "./content-fingerprint"

describe("content-fingerprint", () => {
  it("fingerprintText 对相同输入稳定", () => {
    expect(fingerprintText("hello world")).toBe(fingerprintText("hello world"))
  })
  it("fingerprintText 对不同输入差异", () => {
    expect(fingerprintText("hello world")).not.toBe(fingerprintText("hello WORLD"))
  })
  it("fingerprintText 接受空字符串", () => {
    expect(fingerprintText("")).toMatch(/^[0-9a-f]{16}$/)
  })
  it("fingerprintFileSample 同时考虑 size + head + tail", () => {
    const a = "1234567890".repeat(200)
    const b = a + "x" // 改一个字符
    expect(fingerprintFileSample(a)).not.toBe(fingerprintFileSample(b))
  })
  it("fingerprintFileSample 返回 16 位 hex", () => {
    expect(fingerprintFileSample("abc")).toMatch(/^[0-9a-f]{16}$/)
  })
})
