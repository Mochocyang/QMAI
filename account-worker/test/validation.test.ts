import { describe, expect, it } from "vitest"

import {
  displayNameFromEmail,
  isValidCode,
  isValidEmail,
  isValidPassword,
  isValidRefreshTokenFormat,
  normalizeDisplayName,
  normalizeEmail,
  normalizePurpose,
} from "../src/validation"

describe("normalizeEmail", () => {
  it("trims and lowercases ASCII email", () => {
    expect(normalizeEmail("  Alice@Example.COM  ")).toBe("alice@example.com")
  })

  it("returns empty string for non-string input", () => {
    expect(normalizeEmail(undefined)).toBe("")
    expect(normalizeEmail(123)).toBe("")
  })
})

describe("isValidEmail", () => {
  it("accepts common email shapes", () => {
    expect(isValidEmail("a@b.com")).toBe(true)
    expect(isValidEmail("first.last+tag@sub.example.co")).toBe(true)
    expect(isValidEmail("a_b-c@example.io")).toBe(true)
  })

  it("rejects malformed email", () => {
    expect(isValidEmail("")).toBe(false)
    expect(isValidEmail("a")).toBe(false)
    expect(isValidEmail("a@b")).toBe(false)
    expect(isValidEmail("a b@example.com")).toBe(false)
    expect(isValidEmail("a@@example.com")).toBe(false)
    expect(isValidEmail("@example.com")).toBe(false)
    expect(isValidEmail("a@.com")).toBe(false)
  })

  it("rejects email longer than 254 characters", () => {
    const email = `${"a".repeat(64)}@${"b".repeat(190)}.com`
    expect(email.length).toBeGreaterThan(254)
    expect(isValidEmail(email)).toBe(false)
  })
})

describe("isValidPassword", () => {
  it("accepts 8 to 128 characters", () => {
    expect(isValidPassword("12345678")).toBe(true)
    expect(isValidPassword("密".repeat(8))).toBe(true)
    expect(isValidPassword("a".repeat(128))).toBe(true)
  })

  it("rejects too short, too long, non-string and blank passwords", () => {
    expect(isValidPassword("1234567")).toBe(false)
    expect(isValidPassword("a".repeat(129))).toBe(false)
    expect(isValidPassword(null)).toBe(false)
    expect(isValidPassword("        ")).toBe(false)
  })
})

describe("isValidCode", () => {
  it("accepts exactly six ASCII digits", () => {
    expect(isValidCode("000000")).toBe(true)
    expect(isValidCode("123456")).toBe(true)
  })

  it("rejects wrong length, letters and full-width digits", () => {
    expect(isValidCode("12345")).toBe(false)
    expect(isValidCode("1234567")).toBe(false)
    expect(isValidCode("12a456")).toBe(false)
    expect(isValidCode("１２３４５６")).toBe(false)
    expect(isValidCode(123456)).toBe(false)
  })
})

describe("normalizePurpose", () => {
  it("accepts register and reset", () => {
    expect(normalizePurpose("register")).toBe("register")
    expect(normalizePurpose(" reset ")).toBe("reset")
  })

  it("rejects other purposes", () => {
    expect(normalizePurpose("login")).toBeNull()
    expect(normalizePurpose(undefined)).toBeNull()
  })
})

describe("display name helpers", () => {
  it("derives display name from email local part", () => {
    expect(displayNameFromEmail("alice@example.com")).toBe("alice")
  })

  it("trims provided display name and falls back when blank", () => {
    expect(normalizeDisplayName("  小明  ", "alice@example.com")).toBe("小明")
    expect(normalizeDisplayName("   ", "alice@example.com")).toBe("alice")
    expect(normalizeDisplayName(undefined, "alice@example.com")).toBe("alice")
  })

  it("strips control characters and caps length", () => {
    expect(normalizeDisplayName("a\u0000b\nc", "a@b.com")).toBe("abc")
    expect(normalizeDisplayName("名".repeat(80), "a@b.com").length).toBe(48)
  })
})

describe("isValidRefreshTokenFormat", () => {
  it("accepts 43-char base64url tokens", () => {
    expect(isValidRefreshTokenFormat("A".repeat(43))).toBe(true)
    expect(isValidRefreshTokenFormat("abcDEF0123456789_-abcDEF0123456789_-abcDEF0")).toBe(true)
  })

  it("rejects wrong length or non-base64url characters", () => {
    expect(isValidRefreshTokenFormat("A".repeat(42))).toBe(false)
    expect(isValidRefreshTokenFormat("A".repeat(44))).toBe(false)
    expect(isValidRefreshTokenFormat(`${"A".repeat(42)}=`)).toBe(false)
    expect(isValidRefreshTokenFormat(`${"A".repeat(42)}+`)).toBe(false)
    expect(isValidRefreshTokenFormat("")).toBe(false)
    expect(isValidRefreshTokenFormat(null)).toBe(false)
  })
})
