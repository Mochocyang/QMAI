import { describe, expect, it } from "vitest"

import {
  base64UrlEncodeString,
  bytesToBase64Url,
  JwtVerificationError,
  signAccessToken,
  verifyAccessToken,
} from "../src/crypto"

const SECRET = "test-secret-with-at-least-thirty-two-bytes"
const USER = { id: 12, email: "alice@example.com" }
const NOW = 1_793_000_000

async function makeToken(
  secret: string,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): Promise<string> {
  const data = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(
    JSON.stringify(payload),
  )}`
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))
  return `${data}.${bytesToBase64Url(new Uint8Array(signature))}`
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "qmai-account",
    sub: "12",
    email: "alice@example.com",
    iat: NOW,
    exp: NOW + 900,
    jti: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  }
}

describe("access tokens", () => {
  it("signs and verifies HS256 claims", async () => {
    const { token, expiresAt, jti, claims } = await signAccessToken(SECRET, USER, NOW)
    expect(expiresAt).toBe(NOW + 900)
    expect(jti).toMatch(/^[0-9a-f-]{36}$/)
    expect(claims).toMatchObject({
      iss: "qmai-account",
      sub: "12",
      email: "alice@example.com",
      iat: NOW,
      exp: NOW + 900,
    })

    const verified = await verifyAccessToken(SECRET, token, NOW + 1)
    expect(verified.sub).toBe("12")
    expect(verified.email).toBe("alice@example.com")
    expect(verified.jti).toBe(jti)
    expect(verified.exp).toBe(expiresAt)
  })

  it("rejects an expired token", async () => {
    const { token } = await signAccessToken(SECRET, USER, NOW)
    await expect(verifyAccessToken(SECRET, token, NOW + 900)).rejects.toMatchObject({
      reason: "expired",
    })
    await expect(verifyAccessToken(SECRET, token, NOW + 900)).rejects.toBeInstanceOf(
      JwtVerificationError,
    )
  })

  it("rejects a token signed with another secret", async () => {
    const { token } = await signAccessToken("another-secret-with-at-least-32-bytes!!", USER, NOW)
    await expect(verifyAccessToken(SECRET, token, NOW + 1)).rejects.toMatchObject({
      reason: "signature",
    })
  })

  it("rejects a payload tampered after signing", async () => {
    const { token } = await signAccessToken(SECRET, USER, NOW)
    const [header, payload, signature] = token.split(".")
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))
    decoded.sub = "99"
    const tamperedPayload = base64UrlEncodeString(JSON.stringify(decoded))
    await expect(
      verifyAccessToken(SECRET, `${header}.${tamperedPayload}.${signature}`, NOW + 1),
    ).rejects.toMatchObject({ reason: "signature" })
  })

  it("rejects a token with a different issuer", async () => {
    const token = await makeToken(SECRET, validPayload({ iss: "evil-issuer" }))
    await expect(verifyAccessToken(SECRET, token, NOW + 1)).rejects.toMatchObject({
      reason: "issuer",
    })
  })

  it("rejects a token with a different algorithm header", async () => {
    const token = await makeToken(SECRET, validPayload(), { alg: "none", typ: "JWT" })
    await expect(verifyAccessToken(SECRET, token, NOW + 1)).rejects.toMatchObject({
      reason: "malformed",
    })
  })

  it("rejects malformed tokens", async () => {
    await expect(verifyAccessToken(SECRET, "not-a-jwt", NOW)).rejects.toMatchObject({
      reason: "malformed",
    })
    await expect(verifyAccessToken(SECRET, "a.b.c.d", NOW)).rejects.toMatchObject({
      reason: "malformed",
    })
    await expect(verifyAccessToken(SECRET, "a.b", NOW)).rejects.toMatchObject({
      reason: "malformed",
    })
    await expect(verifyAccessToken(SECRET, "", NOW)).rejects.toMatchObject({
      reason: "malformed",
    })
  })
})
