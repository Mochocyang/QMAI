import { describe, expect, it } from "vitest"

import { canonicalJson, fingerprint } from "./canonical"
import { decryptModelConfig, encryptModelConfig } from "./crypto"
import { buildLocalEntries, buildPayload, emptySyncState, restoreFromCloud, slimProviderValue } from "./service"
import type { ModelSyncIo, ModelSyncState } from "./service"

const PASSWORD = "sync-password"

/**
 * B 方案（精简同步内容）与「回填不乱覆盖」的验收。
 *
 * 背景：点「立即同步」曾返回 VALIDATION（界面「请检查填写的内容」），
 * 根因是载荷里塞了整份 providerConfigs（含每个 provider 的 savedModels 全量），
 * 明文超过 ~44 KB 后密文就顶到服务端 60 000 字符上限。
 */
describe("同步载荷精简（B 方案）", () => {
  it("丢掉说明性/派生字段，保留连接信息", () => {
    const slim = slimProviderValue({
      enabled: true,
      apiKey: "sk-secret",
      baseUrl: "https://api.example.com/v1",
      model: "vendor/model-v4.1",
      note: "随便写的备注",
      description: "说明",
      hint: "提示",
      tags: ["a", "b"],
      lastUsedAt: 123,
      savedModels: [
        { id: "m1", name: "模型一", model: "vendor/a", contextSize: 204800, createdAt: 1793000000, note: "备注" },
      ],
    }) as Record<string, unknown>

    // 连接信息必须原样保留
    expect(slim.apiKey).toBe("sk-secret")
    expect(slim.baseUrl).toBe("https://api.example.com/v1")
    expect(slim.model).toBe("vendor/model-v4.1")

    // 说明性字段被丢掉
    expect(slim.note).toBeUndefined()
    expect(slim.description).toBeUndefined()
    expect(slim.hint).toBeUndefined()
    expect(slim.tags).toBeUndefined()
    expect(slim.lastUsedAt).toBeUndefined()

    // 模型清单保留「能用」的字段，丢掉 createdAt / note
    const models = slim.savedModels as Array<Record<string, unknown>>
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ id: "m1", name: "模型一", model: "vendor/a", contextSize: 204800 })
    expect(models[0].createdAt).toBeUndefined()
    expect(models[0].note).toBeUndefined()
  })

  it("未知结构原样保留（不把用户自定义字段清空）", () => {
    const custom = { weirdField: { deep: [1, 2, 3] } }
    expect(slimProviderValue(custom)).toEqual(custom)
    expect(slimProviderValue([1, 2, 3])).toEqual([1, 2, 3])
    expect(slimProviderValue(null)).toBeNull()
  })

  it("重配置（10 provider × 40 模型）压缩后密文远低于 60 000 字符上限", async () => {
    // 造一份与真实规模相当的载荷：精简 + 压缩双管齐下
    const configs: Record<string, unknown> = {}
    for (let p = 0; p < 10; p += 1) {
      configs[`provider-${p}`] = {
        enabled: true,
        apiKey: "sk-" + "x".repeat(48),
        baseUrl: "https://api.example.com/v1",
        model: "vendor/model-0",
        note: "写给自己看的备注".repeat(3),
        savedModels: Array.from({ length: 40 }, (_, k) => ({
          id: `m${k}`,
          name: `模型名称-${k}`,
          model: `vendor/model-${k}-v4.1-flash`,
          contextSize: 204800,
          createdAt: 1793000000,
        })),
      }
    }
    const entries = buildLocalEntries(configs, emptySyncState(), 1_000_000)
    const payload = buildPayload(entries)
    const envelope = await encryptModelConfig(payload, PASSWORD, { iterations: 1_000 })

    // 明文本身已经比「不精简」小一截；压缩后更小
    // 实测（10 provider × 40 模型）：精简后明文 46 510 字符，
    // 压缩加密后密文仅 1 463 字符 —— 比原来不压缩的 61 586 小 42 倍。
    expect(payload.length).toBeLessThan(60_000)
    expect(envelope.length).toBeLessThan(20_000)
    // 仍能完整解回
    await expect(decryptModelConfig(envelope, PASSWORD)).resolves.toBe(payload)
  })
})

/** 回填不能把本地才有的字段冲掉——否则一次同步就等于删掉用户的备注。 */
describe("从云端回填时保留本地字段", () => {
  function io(
    local: Record<string, unknown>,
    cloudPayload: Record<string, unknown>,
    initial: Partial<ModelSyncState> = {},
  ) {
    let configs = local
    let state: ModelSyncState = { ...emptySyncState(), version: 2, ...initial }
    const cloud = cloudPayload
    const handle: ModelSyncIo = {
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
      fetchCloud: async () => ({
        kind: "config" as const,
        record: {
          payload: await encryptModelConfig(
            buildPayload(
              Object.fromEntries(
                Object.entries(cloud).map(([key, value]) => [key, { key, value, updatedAt: 900_000 }]),
              ),
            ),
            PASSWORD,
            { iterations: 1_000 },
          ),
          version: 3,
          updatedAt: 900_000,
          deviceLabel: "",
        },
      }),
      putCloud: async () => ({ version: 4, updatedAt: 1_000_000 }),
    }
    return { io: handle, configs: () => configs }
  }

  it("本地的 note 与 savedModels.createdAt 在回填后仍在", async () => {
    const local = {
      deepseek: {
        enabled: true,
        apiKey: "sk-local",
        model: "vendor/a",
        note: "本地备注",
        savedModels: [{ id: "m1", name: "旧名", model: "vendor/a", createdAt: 1793000000 }],
      },
    }
    // 云端是精简值：没有 note，模型也没有 createdAt
    const cloud = {
      deepseek: {
        enabled: true,
        apiKey: "sk-cloud",
        model: "vendor/b",
        savedModels: [{ id: "m1", name: "新名", model: "vendor/b", contextSize: 204800 }],
      },
    }
    /*
     * 合并按 updatedAt 取较新的一份。要让「云端那份」胜出，本地的快照必须与当前
     * 内容一致（否则本地会按「刚改过」拿 now），且 updatedAt 早于云端。
     */
    const harness = io(local, cloud)
    // 「从云端下载」= 无条件用云端内容回填本地，最能暴露「整份覆盖冲掉本地字段」的问题
    await restoreFromCloud(harness.io, PASSWORD)

    const next = harness.configs().deepseek as Record<string, unknown>
    // 云端说了算的字段被更新
    expect(next.apiKey).toBe("sk-cloud")
    expect(next.model).toBe("vendor/b")
    // 本地独有的字段被保住
    expect(next.note).toBe("本地备注")
    const models = next.savedModels as Array<Record<string, unknown>>
    expect(models[0]).toMatchObject({ id: "m1", name: "新名", model: "vendor/b", contextSize: 204800 })
    expect(models[0].createdAt).toBe(1793000000)
  })
})
