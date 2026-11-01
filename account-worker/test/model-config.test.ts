import { describe, expect, it } from "vitest"

import { isModelConfigEnvelope, parsePutBody } from "../src/model-config"

/** 造一个客户端真实上传形状的信封 JSON 字符串。 */
function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    kdf: "pbkdf2-sha256",
    iter: 600000,
    salt: "c2FsdHNhbHRzYWx0c2FsdA==",
    iv: "aXZpdml2aXZpdg==",
    ct: "x".repeat(200),
    ...overrides,
  })
}

describe("isModelConfigEnvelope", () => {
  it("接受合法信封", () => {
    expect(isModelConfigEnvelope(JSON.parse(envelope()))).toBe(true)
  })

  it("接受缺 v/kdf 的早期信封（这两个字段服务端不解析）", () => {
    const legacy = JSON.parse(envelope({ v: undefined, kdf: undefined }))
    delete legacy.v
    delete legacy.kdf
    expect(isModelConfigEnvelope(legacy)).toBe(true)
  })

  it("拒绝缺字段、类型不对、空对象", () => {
    expect(isModelConfigEnvelope(null)).toBe(false)
    expect(isModelConfigEnvelope([])).toBe(false)
    expect(isModelConfigEnvelope({})).toBe(false)
    expect(isModelConfigEnvelope(JSON.parse(envelope({ ct: 123 })))).toBe(false)
    expect(isModelConfigEnvelope(JSON.parse(envelope({ iter: 0 })))).toBe(false)
    // v / kdf 现在是可选的形状标记（服务端用不到），只有服务端真正依赖的字段才必填
    expect(isModelConfigEnvelope(JSON.parse(envelope({ salt: "" })))).toBe(false)
    expect(isModelConfigEnvelope(JSON.parse(envelope({ ct: "" })))).toBe(false)
    expect(isModelConfigEnvelope(JSON.parse(envelope({ iv: "" })))).toBe(false)
  })
})

describe("parsePutBody", () => {
  it("合法请求：payload 原样带出，baseVersion 缺省为 null", () => {
    const payload = envelope()
    const parsed = parsePutBody({ payload })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.payload).toBe(payload)
    expect(parsed.baseVersion).toBeNull()
    expect(parsed.deviceLabel).toBe("")
  })

  it("带 baseVersion 与设备名：设备名去空格并截断", () => {
    const parsed = parsePutBody({
      payload: envelope(),
      baseVersion: 7,
      deviceLabel: `  ${"长".repeat(60)}  `,
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.baseVersion).toBe(7)
    expect(parsed.deviceLabel).toHaveLength(48)
  })

  it("payload 不是字符串 / 太短 / 不是 JSON / 形状不对 一律拒绝", () => {
    expect(parsePutBody({ payload: 123 }).ok).toBe(false)
    expect(parsePutBody({ payload: "short" }).ok).toBe(false)
    expect(parsePutBody({ payload: "not-json-".repeat(10) }).ok).toBe(false)
    expect(parsePutBody({ payload: JSON.stringify({ v: 1 }) }).ok).toBe(false)
  })

  it("payload 过大拒绝（超过 60k 字符）", () => {
    const huge = envelope({ ct: "x".repeat(61_000) })
    expect(parsePutBody({ payload: huge }).ok).toBe(false)
  })

  it("baseVersion 必须是 ≥0 的整数", () => {
    expect(parsePutBody({ payload: envelope(), baseVersion: -1 }).ok).toBe(false)
    expect(parsePutBody({ payload: envelope(), baseVersion: 1.5 }).ok).toBe(false)
    expect(parsePutBody({ payload: envelope(), baseVersion: "3" }).ok).toBe(false)
    expect(parsePutBody({ payload: envelope(), baseVersion: 0 }).ok).toBe(true)
  })
})
