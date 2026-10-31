/**
 * 网关卡签发的测试。
 *
 * 重点守两件事：
 *   1. 签出来的卡能被配套公钥验过（否则中转站会全 401）；
 *   2. claims 里必须有 sid —— 那是吊销的唯一抓手。
 */

import { generateKeyPairSync, verify, createPublicKey } from "node:crypto"
import { describe, expect, it } from "vitest"
import { signNetCard } from "../src/netcard"
import type { Env } from "../src/types"

function makePair(): { privateB64: string; publicRaw: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" })
  const spki = publicKey.export({ type: "spki", format: "der" })
  return {
    privateB64: Buffer.from(pkcs8).toString("base64"),
    publicRaw: Buffer.from(spki.subarray(spki.length - 32)),
  }
}

function spkiFromRaw(raw: Buffer): Buffer {
  return Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw])
}

function envWith(privateB64?: string): Env {
  return { DB: {} as Env["DB"], NETCARD_PRIVATE_KEY: privateB64 } as Env
}

function decodeClaims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"))
}

describe("signNetCard", () => {
  it("签出的卡能被配套公钥验过", async () => {
    const pair = makePair()
    const { token } = await signNetCard(envWith(pair.privateB64), 9, "session-uuid-1", 1_800_000_000)

    const [header, payload, signature] = token.split(".")
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "EdDSA", typ: "JWT" })

    const key = createPublicKey({ key: spkiFromRaw(pair.publicRaw), format: "der", type: "spki" })
    const ok = verify(null, Buffer.from(`${header}.${payload}`), key, Buffer.from(signature!, "base64url"))
    expect(ok).toBe(true)
  })

  it("claims 里带 sid，供中转站做吊销检查", async () => {
    const pair = makePair()
    const { token } = await signNetCard(envWith(pair.privateB64), 9, "session-uuid-1", 1_800_000_000)
    const claims = decodeClaims(token)
    expect(claims.iss).toBe("qmai-account")
    expect(claims.sub).toBe("9")
    expect(claims.sid).toBe("session-uuid-1")
    expect(claims.iat).toBe(1_800_000_000)
  })

  it("不设短过期：exp 至少在十年以后（不是有效期机制）", async () => {
    const pair = makePair()
    const now = 1_800_000_000
    const { token } = await signNetCard(envWith(pair.privateB64), 1, "sid", now)
    const claims = decodeClaims(token)
    expect(Number(claims.exp)).toBeGreaterThan(now + 9 * 365 * 24 * 3600)
  })

  it("不同 session 签出的 sid 不同（换设备互不影响）", async () => {
    const pair = makePair()
    const a = await signNetCard(envWith(pair.privateB64), 1, "sid-a", 1_800_000_000)
    const b = await signNetCard(envWith(pair.privateB64), 1, "sid-b", 1_800_000_000)
    expect(decodeClaims(a.token).sid).toBe("sid-a")
    expect(decodeClaims(b.token).sid).toBe("sid-b")
  })

  it("缺私钥时抛错（由调用方决定是否降级为 null）", async () => {
    await expect(signNetCard(envWith(undefined), 1, "sid", 1_800_000_000)).rejects.toThrow(/NETCARD_PRIVATE_KEY/)
  })

  it("私钥格式错误时也抛错，不返回半成品", async () => {
    await expect(signNetCard(envWith("not-a-valid-pkcs8"), 1, "sid", 1_800_000_000)).rejects.toThrow()
  })
})
