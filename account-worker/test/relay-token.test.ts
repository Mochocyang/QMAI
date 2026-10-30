/**
 * 中转票据签发（`POST /v1/relay/token`）的回归测试。
 *
 * 这里要守住的是"签出来的票，中转站真的能验过" —— 所以测试里用 Node 内置
 * ed25519 自己验一遍签名，而不是只断言返回 200。
 */

import { generateKeyPairSync, verify, createPublicKey } from "node:crypto"
import { describe, expect, it } from "vitest"
import { RELAY_TOKEN_TTL_SECONDS, signRelayToken } from "../src/relay-token"
import type { Env } from "../src/types"

/** 生成一对 PKCS#8 私钥（base64）与配套的 raw 公钥（base64url）。 */
function makePair(): { privateB64: string; publicB64Url: string; publicRaw: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" })
  const spki = publicKey.export({ type: "spki", format: "der" })
  const raw = Buffer.from(spki.subarray(spki.length - 32))
  return {
    privateB64: Buffer.from(pkcs8).toString("base64"),
    publicB64Url: raw.toString("base64url"),
    publicRaw: raw,
  }
}

/** 把 raw 32 字节公钥包成 SPKI DER，便于用 Node 的 verify 校验。 */
function spkiFromRaw(raw: Buffer): Buffer {
  return Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw])
}

function envWith(privateB64?: string): Env {
  return { DB: {} as Env["DB"], RELAY_JWT_PRIVATE_KEY: privateB64 } as Env
}

describe("signRelayToken", () => {
  it("签出的票能被配套公钥验过，且 claims 正确", async () => {
    const pair = makePair()
    const now = 1_800_000_000
    const signed = await signRelayToken(envWith(pair.privateB64), 9, now)

    const [header, payload, signature] = signed.token.split(".")
    const jwtHeader = JSON.parse(Buffer.from(header!, "base64url").toString("utf8"))
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"))

    expect(jwtHeader).toEqual({ alg: "EdDSA", typ: "JWT" })
    expect(claims).toEqual({
      iss: "qmai-account",
      sub: "9",
      iat: now,
      exp: now + RELAY_TOKEN_TTL_SECONDS,
    })
    expect(signed.expiresAt).toBe(now + RELAY_TOKEN_TTL_SECONDS)

    const key = createPublicKey({ key: spkiFromRaw(pair.publicRaw), format: "der", type: "spki" })
    const ok = verify(null, Buffer.from(`${header}.${payload}`), key, Buffer.from(signature!, "base64url"))
    expect(ok).toBe(true)
  })

  it("30 分钟有效期写死在代码里，不被环境变量影响", async () => {
    const pair = makePair()
    const now = 1_800_000_000
    const signed = await signRelayToken(envWith(pair.privateB64), 1, now)
    expect(signed.expiresAt - now).toBe(1800)
  })

  it("不同 userId 签出不同 sub", async () => {
    const pair = makePair()
    const a = await signRelayToken(envWith(pair.privateB64), 1, 1_800_000_000)
    const b = await signRelayToken(envWith(pair.privateB64), 2, 1_800_000_000)
    const subOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).sub
    expect(subOf(a.token)).toBe("1")
    expect(subOf(b.token)).toBe("2")
  })

  it("缺私钥时抛错（由调用方转成 503，绝不下发无效票）", async () => {
    await expect(signRelayToken(envWith(undefined), 1, 1_800_000_000)).rejects.toThrow(/RELAY_JWT_PRIVATE_KEY/)
  })

  it("私钥格式错误时也抛错，不返回半成品", async () => {
    await expect(signRelayToken(envWith("not-a-valid-pkcs8"), 1, 1_800_000_000)).rejects.toThrow()
  })
})
