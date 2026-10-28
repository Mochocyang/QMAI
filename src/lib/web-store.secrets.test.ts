// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const platform = vi.hoisted(() => ({ isTauri: vi.fn(() => true) }))
const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/platform", () => platform)
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

import {
  ENCRYPTED_STATE_KEYS,
  decryptStateValue,
  encryptStateEntries,
} from "./web-store"

beforeEach(() => {
  platform.isTauri.mockReturnValue(true)
  invoke.mockReset()
})

describe("app-state 敏感字段加密", () => {
  it("敏感键被换成密文包装，非敏感键保持原样", async () => {
    invoke.mockResolvedValue("CIPHER")

    const result = await encryptStateEntries({
      llmConfig: { apiKey: "sk-secret" },
      searchApiConfig: { providerConfigs: { tavily: { apiKey: "tvly-1" } } },
      "sync.webdav": { endpoints: [{ password: "p@ss" }] },
      uiFontSizeScale: 1,
      lastProject: { id: "p1" },
    })

    expect(result.llmConfig).toEqual({ __qmaiEnc: "CIPHER" })
    expect(result.searchApiConfig).toEqual({ __qmaiEnc: "CIPHER" })
    expect(result["sync.webdav"]).toEqual({ __qmaiEnc: "CIPHER" })
    expect(result.uiFontSizeScale).toBe(1)
    expect(result.lastProject).toEqual({ id: "p1" })
    // 明文不得进入待写入数据
    expect(JSON.stringify(result)).not.toContain("sk-secret")
    expect(JSON.stringify(result)).not.toContain("tvly-1")
  })

  it("已经是密文的键原样写回，不会套娃加密", async () => {
    invoke.mockResolvedValue("NEW")

    const result = await encryptStateEntries({ llmConfig: { __qmaiEnc: "OLD" } })

    expect(result.llmConfig).toEqual({ __qmaiEnc: "OLD" })
    expect(invoke).not.toHaveBeenCalled()
  })

  it("加密失败时回退为明文，不阻断整次保存", async () => {
    invoke.mockRejectedValue(new Error("dpapi down"))

    const result = await encryptStateEntries({ llmConfig: { apiKey: "sk-x" } })

    expect(result.llmConfig).toEqual({ apiKey: "sk-x" })
  })

  it("非 Tauri 环境原样返回", async () => {
    platform.isTauri.mockReturnValue(false)
    const entries = { llmConfig: { apiKey: "sk-x" } }
    await expect(encryptStateEntries(entries)).resolves.toBe(entries)
    expect(invoke).not.toHaveBeenCalled()
  })

  it("读取时解密回对象；明值原样返回", async () => {
    invoke.mockResolvedValue(JSON.stringify({ apiKey: "sk-secret" }))

    await expect(decryptStateValue({ __qmaiEnc: "CIPHER" })).resolves.toEqual({
      apiKey: "sk-secret",
    })
    await expect(decryptStateValue({ apiKey: "plain" })).resolves.toEqual({ apiKey: "plain" })
  })

  it("解不开时按「未配置」处理（不抛错、不把密文当对象返回）", async () => {
    invoke.mockResolvedValue(null)
    await expect(decryptStateValue({ __qmaiEnc: "CIPHER" })).resolves.toBeUndefined()

    invoke.mockRejectedValue(new Error("boom"))
    await expect(decryptStateValue({ __qmaiEnc: "CIPHER" })).resolves.toBeUndefined()
  })

  it("键清单覆盖模型 / 搜索 / 网盘三类凭据", () => {
    expect([...ENCRYPTED_STATE_KEYS].sort()).toEqual(
      [
        "embeddingConfig",
        "llmConfig",
        "multimodalConfig",
        "projectRerankConfigs",
        "rerankConfig",
        "searchApiConfig",
        "sync.webdav",
      ].sort(),
    )
  })
})
