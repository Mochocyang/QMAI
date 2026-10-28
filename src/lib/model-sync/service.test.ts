import { describe, expect, it, vi } from "vitest"

import type { ModelConfigFetchResult } from "@/lib/account/api"

import { decryptModelConfig, encryptModelConfig } from "./crypto"
import { canonicalJson, fingerprint } from "./canonical"
import {
  buildLocalEntries,
  buildPayload,
  emptySyncState,
  hasPendingDeletion,
  parsePayload,
  pullAndMerge,
  pushLocal,
  restoreFromCloud,
  type ModelSyncIo,
  type ModelSyncState,
} from "./service"

const PASSWORD = "sync-password"

function fakeIo(initial: {
  configs?: Record<string, unknown>
  settings?: Record<string, unknown>
  state?: Partial<ModelSyncState>
  cloud?: { payload: string; version: number; updatedAt: number } | null
}) {
  let configs = initial.configs ?? {}
  let settings = initial.settings ?? {}
  let state: ModelSyncState = { ...emptySyncState(), ...initial.state }
  let cloud = initial.cloud ?? null
  let version = cloud?.version ?? 0

  const io: ModelSyncIo & {
    putCalls: Array<{ payload: string; baseVersion: number | null }>
    savedConfigs: () => Record<string, unknown>
    savedSettings: () => Record<string, unknown>
    currentState: () => ModelSyncState
  } = {
    putCalls: [],
    now: () => 1_000_000,
    loadConfigs: async () => configs,
    saveConfigs: async (next) => {
      configs = next
    },
    loadSettings: async () => settings,
    saveSettings: async (next) => {
      settings = next
    },
    loadState: async () => state,
    saveState: async (next) => {
      state = next
    },
    fetchCloud: async (ifNoneMatch?: string): Promise<ModelConfigFetchResult> => {
      if (!cloud) return { kind: "none" }
      if (ifNoneMatch && ifNoneMatch.replace(/"/g, "") === String(cloud.version)) {
        return { kind: "unchanged" }
      }
      return { kind: "config", record: { ...cloud, deviceLabel: "" } }
    },
    putCloud: async (input) => {
      io.putCalls.push(input)
      // 模拟服务端：以 baseVersion 为当前版本，写入后 +1
      version = Math.max(version, input.baseVersion ?? 0) + 1
      cloud = { payload: input.payload, version, updatedAt: 1_000_000 }
      return { version, updatedAt: 1_000_000 }
    },
    savedConfigs: () => configs,
    savedSettings: () => settings,
    currentState: () => state,
  }
  return io
}

async function encryptedCloud(
  providers: Record<string, { value: unknown; updatedAt: number }>,
  settings: Record<string, { value: unknown; updatedAt: number }> = {},
) {
  const wrap = (source: Record<string, { value: unknown; updatedAt: number }>) =>
    Object.fromEntries(
      Object.entries(source).map(([key, item]) => [key, { key, value: item.value, updatedAt: item.updatedAt }]),
    )
  return {
    payload: await encryptModelConfig(buildPayload(wrap(providers), wrap(settings)), PASSWORD, {
      iterations: 1_000,
    }),
    version: 3,
    updatedAt: 900_000,
  }
}

describe("buildLocalEntries / payload", () => {
  it("快照一致时沿用旧时间戳，不一致时用当前时间", () => {
    const state = {
      ...emptySyncState(),
      updatedAt: { a: 100 },
      snapshot: { a: fingerprint(canonicalJson({ m: 1 })) },
    }
    const entries = buildLocalEntries({ a: { m: 1 }, b: { m: 2 } }, state, 500)
    expect(entries.a.updatedAt).toBe(100)
    expect(entries.b.updatedAt).toBe(500)
  })

  it("快照里存的是指纹，不含任何配置明文", async () => {
    const io = fakeIo({ configs: { p: { apiKey: "sk-must-not-leak" } } })
    await pushLocal(io, PASSWORD)
    const snapshot = io.currentState().snapshot.p
    expect(snapshot).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.stringify(io.currentState())).not.toContain("sk-must-not-leak")
  })

  it("payload 往返后条目不变（provider 与 settings 分开存）", () => {
    const entries = { a: { key: "a", value: { x: 1 }, updatedAt: 7 } }
    expect(parsePayload(buildPayload(entries)).providers).toEqual(entries)

    const settings = { rerank: { key: "rerank", value: { model: "bge" }, updatedAt: 9 } }
    const roundTrip = parsePayload(buildPayload(entries, settings))
    expect(roundTrip.providers).toEqual(entries)
    expect(roundTrip.settings).toEqual(settings)
  })

  it("schema 1 的老载荷没有 settings：按空处理，不报错", () => {
    const legacy = JSON.stringify({ schema: 1, providers: { a: { value: { x: 1 }, updatedAt: 1 } } })
    const parsed = parsePayload(legacy)
    expect(Object.keys(parsed.providers)).toEqual(["a"])
    expect(parsed.settings).toEqual({})
  })

  it("结构不对的 payload 抛错", () => {
    expect(() => parsePayload(JSON.stringify({ schema: 1 }))).toThrow()
    expect(() => parsePayload("not json")).toThrow()
  })
})

describe("pullAndMerge", () => {
  it("云端没有配置：什么都不做，只记录拉取时间", async () => {
    const io = fakeIo({ configs: { local: { m: 1 } } })
    const result = await pullAndMerge(io, PASSWORD)
    expect(result).toEqual({ status: "none", pushed: false, version: 0 })
    expect(io.putCalls).toHaveLength(0)
    expect(io.currentState().lastPullAt).toBe(1_000_000)
  })

  it("304 未变化：不重复下载也不推送", async () => {
    const cloud = await encryptedCloud({})
    const io = fakeIo({ state: { version: 3 }, cloud })
    const result = await pullAndMerge(io, PASSWORD)
    expect(result.status).toBe("unchanged")
    expect(io.putCalls).toHaveLength(0)
  })

  it("云端有、本地没有：拉到本地", async () => {
    const cloud = await encryptedCloud({ cloudOnly: { value: { m: "cloud" }, updatedAt: 10 } })
    const io = fakeIo({ cloud })
    const result = await pullAndMerge(io, PASSWORD)
    expect(result.status).toBe("merged")
    expect(io.savedConfigs()).toEqual({ cloudOnly: { m: "cloud" } })
    expect(result.outcome?.addedToLocal).toEqual(["cloudOnly"])
    expect(io.putCalls).toHaveLength(0)
  })

  it("本地有、云端没有：合并后自动推回云端（并集）", async () => {
    const cloud = await encryptedCloud({ cloudOnly: { value: { m: "cloud" }, updatedAt: 10 } })
    const io = fakeIo({ configs: { localOnly: { m: "local" } }, cloud })
    const result = await pullAndMerge(io, PASSWORD)

    expect(result.outcome?.addedToCloud).toEqual(["localOnly"])
    expect(result.pushed).toBe(true)
    expect(io.putCalls).toHaveLength(1)
    expect(io.putCalls[0].baseVersion).toBe(3)
    // 本地与云端条目都在
    expect(Object.keys(io.savedConfigs()).sort()).toEqual(["cloudOnly", "localOnly"])
  })

  it("同键内容不同且本地更新：保留本地并推回云端", async () => {
    const cloud = await encryptedCloud({ p: { value: { m: "old" }, updatedAt: 10 } })
    const io = fakeIo({
      configs: { p: { m: "new" } },
      cloud,
      state: { snapshot: { p: canonicalJson({ m: "old" }) }, updatedAt: { p: 20 } },
    })
    const result = await pullAndMerge(io, PASSWORD)

    expect(result.outcome?.conflicts).toEqual(["p"])
    expect(io.savedConfigs()).toEqual({ p: { m: "new" } })
    expect(io.putCalls).toHaveLength(1)
  })
})

describe("pushLocal", () => {
  it("没有改动且云端已有版本：不写库", async () => {
    const io = fakeIo({
      configs: { a: { m: 1 } },
      state: { version: 5, snapshot: { a: canonicalJson({ m: 1 }) } },
    })
    const result = await pushLocal(io, PASSWORD)
    expect(result.status).toBe("unchanged")
    expect(io.putCalls).toHaveLength(0)
  })

  it("有改动：带 baseVersion 推送并更新本地状态", async () => {
    const io = fakeIo({ configs: { a: { m: 1 } }, state: { version: 5 } })
    const result = await pushLocal(io, PASSWORD)

    expect(result.status).toBe("pushed")
    expect(io.putCalls[0].baseVersion).toBe(5)
    expect(result.version).toBe(6)
    expect(io.currentState().version).toBe(6)
    expect(io.currentState().lastPushAt).toBe(1_000_000)
  })

  it("云端版本冲突：返回 conflict，不写本地状态", async () => {
    const io = fakeIo({ configs: { a: { m: 1 } }, state: { version: 5 } })
    io.putCloud = async () => {
      const error = new Error("conflict") as Error & { code: string }
      error.code = "CONFLICT"
      throw error
    }
    const result = await pushLocal(io, PASSWORD)
    expect(result.status).toBe("conflict")
    expect(io.currentState().version).toBe(5)
  })
})

describe("重排 / 向量配置一起同步（settings）", () => {
  it("推送时把 settings 加密带上云", async () => {
    const io = fakeIo({
      settings: {
        rerank: { provider: "siliconflow", model: "bge-reranker-v2-m3" },
        embedding: { provider: "siliconflow", model: "bge-m3" },
      },
    })
    const result = await pushLocal(io, PASSWORD)
    expect(result.status).toBe("pushed")

    const plain = parsePayload(await decryptModelConfig(io.putCalls[0].payload, PASSWORD))
    expect(Object.keys(plain.settings).sort()).toEqual(["embedding", "rerank"])
    expect(Object.keys(plain.providers)).toEqual([])
  })

  it("云端有重排/向量、本地没有：拉进本地（键名不带内部前缀）", async () => {
    const cloud = await encryptedCloud({}, { rerank: { value: { model: "bge-rerank" }, updatedAt: 10 } })
    const io = fakeIo({ cloud })

    const result = await pullAndMerge(io, PASSWORD)
    expect(result.status).toBe("merged")
    expect(result.settingsChanged).toBe(true)
    expect(io.savedSettings()).toEqual({ rerank: { model: "bge-rerank" } })
  })

  it("settings 也进快照，且键带前缀不与会同名的 provider 打架", async () => {
    const cloud = await encryptedCloud(
      { rerank: { value: { providerId: "real-provider" }, updatedAt: 10 } },
      { rerank: { value: { model: "bge-rerank" }, updatedAt: 10 } },
    )
    const io = fakeIo({ cloud })
    await pullAndMerge(io, PASSWORD)

    const state = io.currentState()
    expect(Object.keys(state.snapshot).sort()).toEqual(["rerank", "settings:rerank"])
    expect(io.savedConfigs()).toEqual({ rerank: { providerId: "real-provider" } })
    expect(io.savedSettings()).toEqual({ rerank: { model: "bge-rerank" } })
  })
})

describe("restoreFromCloud（从云端下载）", () => {
  it("云端同名项覆盖本地，本地独有的保留", async () => {
    const cloud = await encryptedCloud(
      { p: { value: { m: "cloud" }, updatedAt: 10 } },
      { embedding: { value: { model: "cloud-embed" }, updatedAt: 10 } },
    )
    const io = fakeIo({ configs: { p: { m: "local" }, onlyLocal: { m: "keep" } }, cloud })

    const result = await restoreFromCloud(io, PASSWORD)

    expect(result.status).toBe("restored")
    expect(result.providers).toBe(1)
    expect(result.settings).toBe(1)
    expect(io.savedConfigs()).toEqual({ p: { m: "cloud" }, onlyLocal: { m: "keep" } })
    expect(io.savedSettings()).toEqual({ embedding: { model: "cloud-embed" } })
  })

  it("恢复后把版本与快照对齐云端（下一拍不会把本机旧值又推上去）", async () => {
    const cloud = await encryptedCloud({ p: { value: { m: "cloud" }, updatedAt: 10 } })
    const io = fakeIo({ configs: { p: { m: "local" } }, cloud, state: { version: 7 } })

    const result = await restoreFromCloud(io, PASSWORD)
    expect(result.version).toBe(3)
    expect(io.currentState().version).toBe(3)
    expect(io.currentState().snapshot.p).toBe(fingerprint(canonicalJson({ m: "cloud" })))
  })

  it("云端没有配置：返回 none，本地不动", async () => {
    const io = fakeIo({ configs: { p: { m: "local" } } })
    const result = await restoreFromCloud(io, PASSWORD)
    expect(result.status).toBe("none")
    expect(io.savedConfigs()).toEqual({ p: { m: "local" } })
  })
})

describe("hasPendingDeletion（本机删过同步项）", () => {
  it("快照里有、本机已经没有的键 → true", async () => {
    const io = fakeIo({
      configs: { keep: { m: 1 } },
      state: { snapshot: { keep: fingerprint(canonicalJson({ m: 1 })), gone: "deadbeefdeadbeef" } },
    })
    expect(await hasPendingDeletion(io)).toBe(true)
  })

  it("重排/向量被删也算（前缀键要比对得上）", async () => {
    const io = fakeIo({
      settings: {},
      state: { snapshot: { "settings:rerank": fingerprint(canonicalJson({ m: 1 })) } },
    })
    expect(await hasPendingDeletion(io)).toBe(true)
  })

  it("没有删除 → false", async () => {
    const io = fakeIo({
      configs: { a: { m: 1 } },
      state: { snapshot: { a: fingerprint(canonicalJson({ m: 1 })) } },
    })
    expect(await hasPendingDeletion(io)).toBe(false)
  })
})
