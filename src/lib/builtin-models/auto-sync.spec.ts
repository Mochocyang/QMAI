// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const gateway = vi.hoisted(() => ({ gatewayListModels: vi.fn() }))
const bridge = vi.hoisted(() => ({ applyBuiltinModels: vi.fn() }))
const projectStore = vi.hoisted(() => ({ saveProviderConfigs: vi.fn(async () => {}) }))

vi.mock("@/lib/builtin-models/gateway-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/builtin-models/gateway-api")>(
    "@/lib/builtin-models/gateway-api",
  )
  return { ...actual, gatewayListModels: gateway.gatewayListModels }
})

vi.mock("@/lib/builtin-models/provider-bridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/builtin-models/provider-bridge")>(
    "@/lib/builtin-models/provider-bridge",
  )
  return { ...actual, applyBuiltinModels: bridge.applyBuiltinModels }
})

vi.mock("@/lib/project-store", () => projectStore)

const { syncBuiltinModels, resetBuiltinSyncState } = await import("@/lib/builtin-models/auto-sync")
const { useWikiStore } = await import("@/stores/wiki-store")
const { BUILTIN_PROVIDER_ID } = await import("@/lib/builtin-models/provider-bridge")

const CARD = "card-abcdefghijklmnopqrstuvwx"

function sessionWithCard(netcard: string | null) {
  return {
    baseUrl: "https://account.qmai.work",
    accessToken: "access",
    refreshToken: "refresh",
    netcard,
    user: { id: 9, email: "a@b.c", displayName: "Moc" },
  } as never
}

beforeEach(() => {
  resetBuiltinSyncState()
  gateway.gatewayListModels.mockReset()
  bridge.applyBuiltinModels.mockReset()
  bridge.applyBuiltinModels.mockResolvedValue({ modelKey: "qmai-builtin/a", modelCount: 2 })
  projectStore.saveProviderConfigs.mockClear()
  useWikiStore.setState({ providerConfigs: {} })
})

describe("syncBuiltinModels", () => {
  it("登录后把中转站清单登记进 provider 配置，且不抢默认模型", async () => {
    gateway.gatewayListModels.mockResolvedValue(["qmai-deepseek-v41", "qmai-glm-53"])

    const ok = await syncBuiltinModels(sessionWithCard(CARD))

    expect(ok).toBe(true)
    expect(gateway.gatewayListModels).toHaveBeenCalledWith("https://relay.qmai.work", CARD)
    expect(bridge.applyBuiltinModels).toHaveBeenCalledWith({
      session: { serverUrl: "https://relay.qmai.work" },
      modelIds: ["qmai-deepseek-v41", "qmai-glm-53"],
      // 关键：不覆盖用户已有的默认模型
      makeDefault: false,
    })
  })

  it("没有网关卡时返回 false 且不拉清单", async () => {
    const ok = await syncBuiltinModels(sessionWithCard(null))

    expect(ok).toBe(false)
    expect(gateway.gatewayListModels).not.toHaveBeenCalled()
    expect(bridge.applyBuiltinModels).not.toHaveBeenCalled()
  })

  it("没有网关卡时会移除已登记的内置模型配置（避免下拉框留死选项）", async () => {
    useWikiStore.setState({
      providerConfigs: { [BUILTIN_PROVIDER_ID]: { baseUrl: "https://relay.qmai.work/v1" } } as never,
    })

    await syncBuiltinModels(sessionWithCard(null))
    // 移除是异步的（动态 import），等一轮微任务
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useWikiStore.getState().providerConfigs[BUILTIN_PROVIDER_ID]).toBeUndefined()
  })

  it("清单为空时保留原配置，不清空", async () => {
    gateway.gatewayListModels.mockResolvedValue([])

    const ok = await syncBuiltinModels(sessionWithCard(CARD))

    expect(ok).toBe(false)
    expect(bridge.applyBuiltinModels).not.toHaveBeenCalled()
  })

  it("拉清单失败时不抛错、不清配置（下次刷新还会再试）", async () => {
    gateway.gatewayListModels.mockRejectedValue(new Error("network down"))

    const ok = await syncBuiltinModels(sessionWithCard(CARD))

    expect(ok).toBe(false)
    expect(bridge.applyBuiltinModels).not.toHaveBeenCalled()
  })

  it("卡与清单都没变时不重复写盘", async () => {
    gateway.gatewayListModels.mockResolvedValue(["qmai-deepseek-v41"])

    await syncBuiltinModels(sessionWithCard(CARD))
    await syncBuiltinModels(sessionWithCard(CARD))

    expect(bridge.applyBuiltinModels).toHaveBeenCalledTimes(1)
  })

  it("清单变化时重新写入", async () => {
    gateway.gatewayListModels.mockResolvedValue(["qmai-deepseek-v41"])
    await syncBuiltinModels(sessionWithCard(CARD))

    gateway.gatewayListModels.mockResolvedValue(["qmai-deepseek-v41", "qmai-glm-53"])
    await syncBuiltinModels(sessionWithCard(CARD))

    expect(bridge.applyBuiltinModels).toHaveBeenCalledTimes(2)
  })

  it("并发调用只拉一次清单", async () => {
    gateway.gatewayListModels.mockResolvedValue(["qmai-deepseek-v41"])

    const [a, b] = await Promise.all([
      syncBuiltinModels(sessionWithCard(CARD)),
      syncBuiltinModels(sessionWithCard(CARD)),
    ])

    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(gateway.gatewayListModels).toHaveBeenCalledTimes(1)
  })
})
