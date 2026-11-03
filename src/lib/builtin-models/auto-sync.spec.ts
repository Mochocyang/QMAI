// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const gateway = vi.hoisted(() => ({ gatewayListModelCatalog: vi.fn() }))
const bridge = vi.hoisted(() => ({ applyBuiltinModels: vi.fn() }))
const projectStore = vi.hoisted(() => ({ saveProviderConfigs: vi.fn(async () => {}) }))

vi.mock("@/lib/builtin-models/gateway-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/builtin-models/gateway-api")>(
    "@/lib/builtin-models/gateway-api",
  )
  return { ...actual, gatewayListModelCatalog: gateway.gatewayListModelCatalog }
})

vi.mock("@/lib/builtin-models/provider-bridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/builtin-models/provider-bridge")>(
    "@/lib/builtin-models/provider-bridge",
  )
  return { ...actual, applyBuiltinModels: bridge.applyBuiltinModels }
})

vi.mock("@/lib/project-store", () => projectStore)

const { syncBuiltinModels, refreshBuiltinModels, resetBuiltinSyncState } = await import("@/lib/builtin-models/auto-sync")
const { useWikiStore } = await import("@/stores/wiki-store")
const { BUILTIN_PROVIDER_ID } = await import("@/lib/builtin-models/provider-bridge")

const CARD = "card-abcdefghijklmnopqrstuvwx"

/** 网关返回的是完整对象数组（倍率就在这里），只关心 id 的用例用这个helper 造数据。 */
function catalog(ids: string[], ratio = 1) {
  return ids.map((id) => ({ id, ratio }))
}

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
  gateway.gatewayListModelCatalog.mockReset()
  bridge.applyBuiltinModels.mockReset()
  bridge.applyBuiltinModels.mockResolvedValue({ modelKey: "qmai-builtin/a", modelCount: 2 })
  projectStore.saveProviderConfigs.mockClear()
  useWikiStore.setState({ providerConfigs: {} })
})

describe("syncBuiltinModels", () => {
  it("登录后把中转站清单登记进 provider 配置，且不抢默认模型", async () => {
    gateway.gatewayListModelCatalog.mockResolvedValue(catalog(["qmai-deepseek-v41", "qmai-glm-53"]))

    const ok = await syncBuiltinModels(sessionWithCard(CARD))

    expect(ok).toBe(true)
    expect(gateway.gatewayListModelCatalog).toHaveBeenCalledWith("https://relay.qmai.work", CARD)
    expect(bridge.applyBuiltinModels).toHaveBeenCalledWith({
      session: { serverUrl: "https://relay.qmai.work" },
      modelIds: ["qmai-deepseek-v41", "qmai-glm-53"],
      // 倍率等元数据必须一起带下去，否则下拉框没有倍率可显示
      catalog: [
        { id: "qmai-deepseek-v41", ratio: 1 },
        { id: "qmai-glm-53", ratio: 1 },
      ],
      // 关键：不覆盖用户已有的默认模型
      makeDefault: false,
    })
  })

  it("没有网关卡时先尝试补签，补签失败才返回 false", async () => {
    // 补签走真实 HTTP；测试环境没有账号服务，必然失败 → 走 false 分支
    const ok = await syncBuiltinModels(sessionWithCard(null))

    expect(ok).toBe(false)
    expect(bridge.applyBuiltinModels).not.toHaveBeenCalled()
  })

  /*
   * 「有会话但没有卡」= 故障态（签发失败 / 请求抖动），**不能删配置**。
   *
   * 曾经的实现无条件 delete，于是用户只要遇到一次签卡失败，内置模型就被
   * 永久从配置里删掉，表现为「内置模型突然没了」，且无法自愈（下次登录时
   * 服务端若仍不签卡也回不来）。这条用例锁住「故障时保留配置」。
   */
  it("有会话但没有网关卡时：保留已登记的内置模型配置，只标记不可用", async () => {
    useWikiStore.setState({
      providerConfigs: { [BUILTIN_PROVIDER_ID]: { baseUrl: "https://relay.qmai.work/v1" } } as never,
    })

    await syncBuiltinModels(sessionWithCard(null))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 配置必须还在：删了用户就要重新配置，而这不是他能控制的。
    expect(useWikiStore.getState().providerConfigs[BUILTIN_PROVIDER_ID]).toBeDefined()
  })

  /*
   * 「确认没有会话」= 用户退出登录 / 注销账号，**才该删配置**。
   * 这两种语义必须分开，否则故障和退出无法区分。
   */
  it("确认没有会话（退出登录）时才移除内置模型配置", async () => {
    useWikiStore.setState({
      providerConfigs: { [BUILTIN_PROVIDER_ID]: { baseUrl: "https://relay.qmai.work/v1" } } as never,
    })

    // 显式 null = 确认无会话
    await syncBuiltinModels(null)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useWikiStore.getState().providerConfigs[BUILTIN_PROVIDER_ID]).toBeUndefined()
  })

  it("清单为空时保留原配置，不清空", async () => {
    gateway.gatewayListModelCatalog.mockResolvedValue(catalog([]))

    const ok = await syncBuiltinModels(sessionWithCard(CARD))

    expect(ok).toBe(false)
    expect(bridge.applyBuiltinModels).not.toHaveBeenCalled()
  })

  it("拉清单失败时不抛错、不清配置（下次刷新还会再试）", async () => {
    gateway.gatewayListModelCatalog.mockRejectedValue(new Error("network down"))

    const ok = await syncBuiltinModels(sessionWithCard(CARD))

    expect(ok).toBe(false)
    expect(bridge.applyBuiltinModels).not.toHaveBeenCalled()
  })

  it("卡与清单都没变时不重复写盘", async () => {
    gateway.gatewayListModelCatalog.mockResolvedValue(catalog(["qmai-deepseek-v41"]))

    await syncBuiltinModels(sessionWithCard(CARD))
    await syncBuiltinModels(sessionWithCard(CARD))

    expect(bridge.applyBuiltinModels).toHaveBeenCalledTimes(1)
  })

  it("清单变化时重新写入", async () => {
    gateway.gatewayListModelCatalog.mockResolvedValue(catalog(["qmai-deepseek-v41"]))
    await syncBuiltinModels(sessionWithCard(CARD))

    gateway.gatewayListModelCatalog.mockResolvedValue(catalog(["qmai-deepseek-v41", "qmai-glm-53"]))
    await syncBuiltinModels(sessionWithCard(CARD))

    expect(bridge.applyBuiltinModels).toHaveBeenCalledTimes(2)
  })

  it("并发调用只拉一次清单", async () => {
    gateway.gatewayListModelCatalog.mockResolvedValue(catalog(["qmai-deepseek-v41"]))

    const [a, b] = await Promise.all([
      syncBuiltinModels(sessionWithCard(CARD)),
      syncBuiltinModels(sessionWithCard(CARD)),
    ])

    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(gateway.gatewayListModelCatalog).toHaveBeenCalledTimes(1)
  })
})

describe("refreshBuiltinModels", () => {
  it("下拉框打开时按需刷新倍率", async () => {
    gateway.gatewayListModelCatalog.mockResolvedValue(catalog(["qmai-standard"], 0.08))

    await refreshBuiltinModels(sessionWithCard(CARD), 0)

    expect(gateway.gatewayListModelCatalog).toHaveBeenCalledTimes(1)
  })

  it("30 秒内重复调用只拉一次（防连点请求风暴）", async () => {
    gateway.gatewayListModelCatalog.mockResolvedValue(catalog(["qmai-standard"], 0.08))

    await refreshBuiltinModels(sessionWithCard(CARD), 30_000)
    await refreshBuiltinModels(sessionWithCard(CARD), 30_000)

    expect(gateway.gatewayListModelCatalog).toHaveBeenCalledTimes(1)
  })

  it("没有登录态时不做任何事（不能因为开了下拉框就删掉内置模型配置）", async () => {
    useWikiStore.setState({
      providerConfigs: { [BUILTIN_PROVIDER_ID]: { baseUrl: "https://relay.qmai.work/v1" } } as never,
    })

    await refreshBuiltinModels(null, 0)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(gateway.gatewayListModelCatalog).not.toHaveBeenCalled()
    expect(useWikiStore.getState().providerConfigs[BUILTIN_PROVIDER_ID]).toBeDefined()
  })

  it("控制台只改了倍率时也会重新写入配置（否则用户永远看不到新倍率）", async () => {
    gateway.gatewayListModelCatalog.mockResolvedValue(catalog(["qmai-standard"], 0.08))
    await syncBuiltinModels(sessionWithCard(CARD))

    gateway.gatewayListModelCatalog.mockResolvedValue(catalog(["qmai-standard"], 0.05))
    await syncBuiltinModels(sessionWithCard(CARD))

    expect(bridge.applyBuiltinModels).toHaveBeenCalledTimes(2)
  })
})
