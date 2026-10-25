import { describe, expect, it } from "vitest"

import {
  bytesToBase64Url,
  generateNumericCode,
  generateRefreshToken,
  hashEmailCode,
  hashIp,
  hashPassword,
  hashRefreshToken,
  sha256Hex,
  timingSafeEqualHex,
  verifyPassword,
} from "../src/crypto"

describe("sha256Hex", () => {
  it("matches the known SHA-256 of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })

  it("is stable for the same input and differs for different input", async () => {
    expect(await sha256Hex("青幕")).toBe(await sha256Hex("青幕"))
    expect(await sha256Hex("青幕")).not.toBe(await sha256Hex("青幕 "))
  })
})

describe("hashEmailCode", () => {
  it("is stable for identical pepper/email/purpose/code", async () => {
    const first = await hashEmailCode("pepper", "a@b.com", "register", "123456")
    const second = await hashEmailCode("pepper", "a@b.com", "register", "123456")
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it("changes when pepper, email, purpose or code changes", async () => {
    const base = await hashEmailCode("pepper", "a@b.com", "register", "123456")
    expect(await hashEmailCode("other", "a@b.com", "register", "123456")).not.toBe(base)
    expect(await hashEmailCode("pepper", "c@d.com", "register", "123456")).not.toBe(base)
    expect(await hashEmailCode("pepper", "a@b.com", "reset", "123456")).not.toBe(base)
    expect(await hashEmailCode("pepper", "a@b.com", "register", "654321")).not.toBe(base)
  })
})

describe("generateNumericCode", () => {
  it("always returns six ASCII digits", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateNumericCode()).toMatch(/^[0-9]{6}$/)
    }
  })
})

describe("refresh tokens", () => {
  it("generates 43-char base64url tokens from 32 random bytes", () => {
    const token = generateRefreshToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(token).not.toBe(generateRefreshToken())
  })

  it("hashes tokens as stable SHA-256 hex", async () => {
    const token = generateRefreshToken()
    expect(await hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashRefreshToken(token)).toBe(await hashRefreshToken(token))
  })
})

describe("hashIp", () => {
  it("is stable and pepper-dependent", async () => {
    const first = await hashIp("pepper", "203.0.113.7")
    expect(first).toBe(await hashIp("pepper", "203.0.113.7"))
    expect(first).not.toBe(await hashIp("other", "203.0.113.7"))
    expect(first).not.toBe(await hashIp("pepper", "203.0.113.8"))
  })
})

describe("password hashing", () => {
  it("writes iterations into a verifiable pbkdf2 string", async () => {
    const stored = await hashPassword("correct horse battery", 1000)
    expect(stored).toMatch(/^pbkdf2\$1000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/)
    expect(await verifyPassword("correct horse battery", stored)).toBe(true)
    expect(await verifyPassword("wrong password", stored)).toBe(false)
  })

  it("uses a fresh random salt for every hash", async () => {
    const first = await hashPassword("same-password", 1000)
    const second = await hashPassword("same-password", 1000)
    expect(first).not.toBe(second)
    expect(await verifyPassword("same-password", first)).toBe(true)
    expect(await verifyPassword("same-password", second)).toBe(true)
  })

  it("verifies with the iterations stored in the hash, not the current env", async () => {
    const stored = await hashPassword("password123", 5000)
    expect(stored.startsWith("pbkdf2$5000$")).toBe(true)
    expect(await verifyPassword("password123", stored)).toBe(true)
  })

  it("rejects malformed or unsupported stored hashes", async () => {
    expect(await verifyPassword("password123", "")).toBe(false)
    expect(await verifyPassword("password123", "plaintext")).toBe(false)
    expect(await verifyPassword("password123", "bcrypt$1000$salt$hash")).toBe(false)
    expect(await verifyPassword("password123", "pbkdf2$abc$salt$hash")).toBe(false)
    expect(await verifyPassword("password123", "pbkdf2$1000$***$hash")).toBe(false)
  })
})

describe("timingSafeEqualHex", () => {
  it("compares equal and unequal hex strings", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true)
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false)
    expect(timingSafeEqualHex("abcd", "abcde")).toBe(false)
    expect(timingSafeEqualHex("", "")).toBe(true)
  })
})

describe("bytesToBase64Url", () => {
  it("encodes without padding and without +/", () => {
    const encoded = bytesToBase64Url(new Uint8Array([0xfb, 0xff, 0xfe]))
    expect(encoded).not.toContain("=")
    expect(encoded).not.toContain("+")
    expect(encoded).not.toContain("/")
  })
})
