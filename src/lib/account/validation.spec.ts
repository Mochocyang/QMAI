import { describe, expect, it } from "vitest"

import {
  isSixDigitCode,
  isValidEmail,
  normalizeEmail,
  validateAccountPassword,
} from "./validation"

describe("normalizeEmail", () => {
  it("trim + 小写，非字符串回空串", () => {
    expect(normalizeEmail("  Author@Example.COM  ")).toBe("author@example.com")
    expect(normalizeEmail("")).toBe("")
    expect(normalizeEmail(null)).toBe("")
    expect(normalizeEmail(42)).toBe("")
  })
})

describe("isValidEmail", () => {
  it("接受常见邮箱", () => {
    expect(isValidEmail("a@b.com")).toBe(true)
    expect(isValidEmail("first.last+tag@mail.example.cn")).toBe(true)
    expect(isValidEmail("author_01@sub.example.com")).toBe(true)
  })

  it("拒绝空串、无 @、多个 @、无点域名", () => {
    expect(isValidEmail("")).toBe(false)
    expect(isValidEmail("author.example.com")).toBe(false)
    expect(isValidEmail("a@b@c.com")).toBe(false)
    expect(isValidEmail("a@localhost")).toBe(false)
    expect(isValidEmail("@example.com")).toBe(false)
    expect(isValidEmail("a@.com")).toBe(false)
    expect(isValidEmail("a@example.")).toBe(false)
  })

  it("拒绝超长邮箱与超长本地部分", () => {
    expect(isValidEmail(`${"a".repeat(64)}@example.com`)).toBe(true)
    expect(isValidEmail(`${"a".repeat(65)}@example.com`)).toBe(false)

    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`
    expect(isValidEmail(`a@${domain}`)).toBe(true)
    expect(isValidEmail(`${"a".repeat(64)}@${domain}`)).toBe(false)
    expect(isValidEmail(`${"a".repeat(250)}@example.com`)).toBe(false)
  })
})

describe("validateAccountPassword", () => {
  it("7 位拒绝，8 / 128 位接受，129 位拒绝", () => {
    expect(validateAccountPassword("1234567")).not.toBeNull()
    expect(validateAccountPassword("12345678")).toBeNull()
    expect(validateAccountPassword("a".repeat(128))).toBeNull()
    expect(validateAccountPassword("a".repeat(129))).not.toBeNull()
  })

  it("全空白密码拒绝，含非空白字符即可", () => {
    expect(validateAccountPassword("        ")).not.toBeNull()
    expect(validateAccountPassword("       a")).toBeNull()
    expect(validateAccountPassword("")).not.toBeNull()
  })
})

describe("isSixDigitCode", () => {
  it("只接受 6 位 ASCII 数字", () => {
    expect(isSixDigitCode("123456")).toBe(true)
    expect(isSixDigitCode("000000")).toBe(true)
    expect(isSixDigitCode("12345")).toBe(false)
    expect(isSixDigitCode("1234567")).toBe(false)
    expect(isSixDigitCode("12345a")).toBe(false)
    expect(isSixDigitCode("")).toBe(false)
    expect(isSixDigitCode(123456)).toBe(false)
  })
})
