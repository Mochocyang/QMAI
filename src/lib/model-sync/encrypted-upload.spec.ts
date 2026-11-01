import { describe, expect, it } from "vitest"

import type { ModelConfigFetchResult } from "@/lib/account/api"

import { decryptModelConfig, encryptModelConfig } from "./crypto"
import { buildPayload, emptySyncState, pullAndMerge, pushLocal, type ModelSyncIo } from "./service"
import type { ModelSyncState } from "./service"

const PASSWORD = "sync-password"

/**
 * **回归守卫：任何一次上传都必须是密文。**
 *
 * ## 事故
 *
 * 用户点「立即同步」始终失败。服务端日志显示收到的 payload 是
 * `{schema, providers, settings}` 的**明文**（9 062 字符）—— 因为
 * `pullAndMerge()` 在「本地有独有改动、需要回写云端」时，直接推了
 * `buildPayload(...)` 的结果，绕过了加密。
 *
 * 两个后果：
 *   1. 服务端拒绝（信封缺字段），同步永远失败；
 *   2. 万一服务端放行，用户所有 provider 的 apiKey 会以明文躺在云端。
 *
 * 这里对**每一条上传路径**都断言：payload 必须是加密信封，且不出现明文特征。
 */
function fakeIo(initial: {
  configs: Record<string, unknown>
  cloud?: { payload: string; version: number; updatedAt: number } | null
  state?: Partial<ModelSyncState>
}) {
  let configs = initial.configs
  let cloud = initial.cloud ?? null
  let version = cloud?.version ?? 0
  let state: ModelSyncState = { ...emptySyncState(), ...initial.state }
  const puts: Array<{ payload: string; baseVersion: number | null }> = []

  const io: ModelSyncIo = {
    now: () => 1_000_000,
    loadConfigs: async () => configs,
    saveConfigs: async (next) => {
      configs = next
    },
    loadSettings: async () => ({}),
    saveSettings: async () => {},
    loadState: async () => state,
    saveState: async (next) => {
      state = next
    },
    fetchCloud: async (): Promise<ModelConfigFetchResult> => {
      if (!cloud) return { kind: "none" }
      return { kind: "config", record: { ...cloud, deviceLabel: "" } }
    },
    putCloud: async (input) => {
      puts.push(input)
      version = Math.max(version, input.baseVersion ?? 0) + 1
      cloud = { payload: input.payload, version, updatedAt: 1_000_000 }
      return { version, updatedAt: 1_000_000 }
    },
  }
  return { io, puts }
}

/** 断言这段 payload 是加密信封，而不是明文配置。 */
async function expectEncryptedEnvelope(payload: string) {
  const parsed = JSON.parse(payload) as Record<string, unknown>
  expect(typeof parsed.ct).toBe("string")
  expect(typeof parsed.salt).toBe("string")
  expect(typeof parsed.iv).toBe("string")
  expect(typeof parsed.iter).toBe("number")
  // 明文特征绝不能出现
  expect(payload).not.toContain("sk-secret")
  expect(payload).not.toContain('"providers"')
  expect(payload).not.toContain('"schema"')
  // 而且必须真的能用同步密码解开
  const plain = await decryptModelConfig(payload, PASSWORD)
  expect(plain).toContain('"schema"')
}

describe("所有上传路径都必须加密", () => {
  const localConfigs = {
    "custom-1": { enabled: true, apiKey: "sk-secret", model: "vendor/a" },
  }

  it("pushLocal：加密上传", async () => {
    const { io, puts } = fakeIo({ configs: localConfigs })
    const result = await pushLocal(io, PASSWORD)
    expect(result.status).toBe("pushed")
    expect(puts).toHaveLength(1)
    await expectEncryptedEnvelope(puts[0].payload)
  })

  it("pullAndMerge 的「回写云端」也必须加密（本次事故点）", async () => {
    // 云端已有一份配置，本地另有一个云端没有的 provider → needsPush 为真
    const cloudPayload = await encryptModelConfig(
      buildPayload({ other: { key: "other", value: { enabled: true, model: "vendor/b" }, updatedAt: 900_000 } }),
      PASSWORD,
      { iterations: 1_000 },
    )
    const { io, puts } = fakeIo({
      configs: localConfigs,
      cloud: { payload: cloudPayload, version: 3, updatedAt: 900_000 },
      state: { version: 3 },
    })

    await pullAndMerge(io, PASSWORD)

    expect(puts.length).toBeGreaterThan(0)
    for (const put of puts) {
      // 这一条如果退回明文，服务端会拒、且 apiKey 会明文上云
      await expectEncryptedEnvelope(put.payload)
    }
  })
})
