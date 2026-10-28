import { describe, expect, it } from "vitest"

import {
  DEFAULT_KDF_ITERATIONS,
  SyncPasswordError,
  decryptModelConfig,
  encryptModelConfig,
  fingerprintModelConfig,
} from "./crypto"

/** 测试用小迭代次数，避免每条用例跑 60 万次 PBKDF2。 */
const TEST_ITERATIONS = 1_000
const PASSWORD = "correct horse battery staple"
const PLAINTEXT = JSON.stringify({ deepseek: { apiKey: "sk-secret", model: "deepseek-v4.1" } })

describe("模型配置加密", () => {
  it("加密后看不到任何明文，且能原样解回来", async () => {
    const envelope = await encryptModelConfig(PLAINTEXT, PASSWORD, { iterations: TEST_ITERATIONS })

    expect(envelope).not.toContain("sk-secret")
    expect(envelope).not.toContain("deepseek-v4.1")

    const parsed = JSON.parse(envelope)
    expect(Object.keys(parsed).sort()).toEqual(["ct", "iter", "iv", "kdf", "salt", "v"])
    expect(parsed.v).toBe(1)
    expect(parsed.kdf).toBe("pbkdf2-sha256")
    expect(parsed.iter).toBe(TEST_ITERATIONS)

    await expect(decryptModelConfig(envelope, PASSWORD)).resolves.toBe(PLAINTEXT)
  })

  it("默认迭代次数是 60 万，且同一份配置两次加密结果不同（随机 IV/盐）", async () => {
    expect(DEFAULT_KDF_ITERATIONS).toBe(600_000)
    const a = await encryptModelConfig(PLAINTEXT, PASSWORD, { iterations: TEST_ITERATIONS })
    const b = await encryptModelConfig(PLAINTEXT, PASSWORD, { iterations: TEST_ITERATIONS })
    expect(a).not.toBe(b)
    expect(JSON.parse(a).salt).not.toBe(JSON.parse(b).salt)
    expect(JSON.parse(a).ct).not.toBe(JSON.parse(b).ct)
  })

  it("密码错误抛出 SyncPasswordError", async () => {
    const envelope = await encryptModelConfig(PLAINTEXT, PASSWORD, { iterations: TEST_ITERATIONS })
    await expect(decryptModelConfig(envelope, "wrong password")).rejects.toBeInstanceOf(SyncPasswordError)
  })

  it("密文被篡改（改一个字符）会被 GCM 校验挡住", async () => {
    const envelope = JSON.parse(await encryptModelConfig(PLAINTEXT, PASSWORD, { iterations: TEST_ITERATIONS }))
    const tampered = envelope.ct.slice(0, -4) + (envelope.ct.endsWith("AAAA") ? "BBBB" : "AAAA")
    await expect(decryptModelConfig(JSON.stringify({ ...envelope, ct: tampered }), PASSWORD)).rejects.toBeInstanceOf(
      SyncPasswordError,
    )
  })

  it("信封格式异常抛 SyncPasswordError（而不是崩在 JSON.parse 上）", async () => {
    await expect(decryptModelConfig("not-json", PASSWORD)).rejects.toBeInstanceOf(SyncPasswordError)
    await expect(decryptModelConfig(JSON.stringify({ v: 1 }), PASSWORD)).rejects.toBeInstanceOf(SyncPasswordError)
    await expect(
      decryptModelConfig(JSON.stringify({ v: 1, kdf: "pbkdf2-sha256", iter: 10, salt: "a", iv: "b", ct: "c" }), PASSWORD),
    ).rejects.toBeInstanceOf(SyncPasswordError)
  })

  it("复用同一盐重加密：旧密文失效、新密文可用（改同步密码场景）", async () => {
    const first = await encryptModelConfig(PLAINTEXT, "old-password", { iterations: TEST_ITERATIONS })
    const salt = JSON.parse(first).salt
    const second = await encryptModelConfig(PLAINTEXT, "new-password", { iterations: TEST_ITERATIONS, salt })
    expect(JSON.parse(second).salt).toBe(salt)
    await expect(decryptModelConfig(second, "new-password")).resolves.toBe(PLAINTEXT)
    await expect(decryptModelConfig(second, "old-password")).rejects.toBeInstanceOf(SyncPasswordError)
  })
})

describe("内容指纹", () => {
  it("同一内容指纹稳定，不同内容指纹不同", async () => {
    const a = await fingerprintModelConfig(PLAINTEXT)
    const b = await fingerprintModelConfig(PLAINTEXT)
    const c = await fingerprintModelConfig(PLAINTEXT + " ")
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})
