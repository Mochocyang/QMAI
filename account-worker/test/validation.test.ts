import { describe, expect, it } from "vitest"

import {
  detectImageMime,
  displayNameFromEmail,
  isValidCode,
  isValidEmail,
  isValidPassword,
  isValidRefreshTokenFormat,
  MAX_AVATAR_BYTES,
  normalizeAvatarMime,
  normalizeDisplayName,
  normalizeEmail,
  normalizePurpose,
  normalizeRenameDisplayName,
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

describe("normalizeAvatarMime", () => {
  it("accepts the three whitelisted image types", () => {
    expect(normalizeAvatarMime("image/png")).toBe("image/png")
    expect(normalizeAvatarMime("IMAGE/PNG")).toBe("image/png")
    expect(normalizeAvatarMime("image/jpeg")).toBe("image/jpeg")
    expect(normalizeAvatarMime("image/webp")).toBe("image/webp")
  })

  it("normalizes the non-standard image/jpg alias", () => {
    expect(normalizeAvatarMime("image/jpg")).toBe("image/jpeg")
  })

  it("rejects svg, gif, html and non-strings", () => {
    expect(normalizeAvatarMime("image/svg+xml")).toBeNull()
    expect(normalizeAvatarMime("image/gif")).toBeNull()
    expect(normalizeAvatarMime("text/html")).toBeNull()
    expect(normalizeAvatarMime(undefined)).toBeNull()
    expect(normalizeAvatarMime("")).toBeNull()
  })
})

describe("detectImageMime", () => {
  function bytes(...values: number[]): Uint8Array {
    const out = new Uint8Array(16)
    out.set(values)
    return out
  }

  it("detects PNG by signature", () => {
    expect(detectImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png")
  })

  it("detects JPEG by SOI marker", () => {
    expect(detectImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg")
  })

  it("detects WebP by RIFF....WEBP", () => {
    const header = new Uint8Array(16)
    header.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
    header.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
    expect(detectImageMime(header)).toBe("image/webp")
  })

  it("rejects SVG, HTML and truncated buffers", () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>")
    expect(detectImageMime(svg)).toBeNull()

    const html = new TextEncoder().encode("<!doctype html><html></html>")
    expect(detectImageMime(html)).toBeNull()

    expect(detectImageMime(new Uint8Array(4))).toBeNull()
  })

  it("exposes a 64 KB ceiling", () => {
    expect(MAX_AVATAR_BYTES).toBe(65536)
  })
})

describe("normalizeRenameDisplayName", () => {
  it("折叠空白、去控制字符后返回昵称", () => {
    expect(normalizeRenameDisplayName("  青  幕  ")).toBe("青 幕")
    expect(normalizeRenameDisplayName("青\u0000幕")).toBe("青幕")
  })

  it("空串、非字符串、超长一律返回 null（不做兜底猜测）", () => {
    expect(normalizeRenameDisplayName("   ")).toBeNull()
    expect(normalizeRenameDisplayName(123)).toBeNull()
    expect(normalizeRenameDisplayName(undefined)).toBeNull()
    expect(normalizeRenameDisplayName("很".repeat(25))).toBeNull()
  })

  it("上限 24 个字（按字符数，emoji 不会被切坏）", () => {
    expect(normalizeRenameDisplayName("很".repeat(24))).toBe("很".repeat(24))
    expect(normalizeRenameDisplayName("🌙".repeat(24))).toBe("🌙".repeat(24))
  })
})
