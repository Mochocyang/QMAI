import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 回归：网关请求必须带设备标识与请求签名。
 *
 * ── 这个 bug 是怎么来的 ──
 *
 * 网关卡签发时绑定了设备指纹（claims 里的 `dev`）。网关侧约定得很明确：
 *
 *   「网关校验时必须与请求头 X-Device-Id 一致，否则 403。」
 *
 * 但客户端拉取模型清单时只传了 Authorization，没带 X-Device-Id，也没做请求签名。
 * 后果是**新登录签发的卡必然 403**（新卡一定带 dev），拉不到清单 → 内置模型被移除。
 *
 * 而老会话的卡没有 dev 字段，网关按「首次校验时补绑」放行 —— 于是现象变成：
 *   · 开发者自己的机器（老会话）能正常显示内置模型；
 *   · 别人新装的机器（新卡）什么都没有；
 *   · 而且对方「重新登录」之后更糟，因为重登必然拿到带 dev 的新卡。
 *
 * 这组用例锁的是「请求头里真的有设备标识和签名」，
 * 而不是「函数被调用了」——后者在 bug 存在时也是通过的。
 */

type Call = { url: string; init: RequestInit }

function fakeFetch(payload: unknown): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const DEVICE_ID = "0123456789abcdef0123456789abcdef"

describe("网关鉴权头", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("拉取模型清单时带上 X-Device-Id 与请求签名", async () => {
    vi.doMock("@/lib/account/device", () => ({
      getDeviceFingerprint: vi.fn(async () => DEVICE_ID),
    }))
    vi.doMock("@/lib/account/request-sign", () => ({
      signRequestHeaders: vi.fn(async () => ({ "X-Request-Ts": "1700000000", "X-Request-Sig": "sig-value" })),
    }))

    const { fetchImpl, calls } = fakeFetch({ data: [{ id: "m1" }] })
    const { gatewayListModelCatalog } = await import("./gateway-api")

    await gatewayListModelCatalog("https://relay.example.com", "card-token", fetchImpl)

    expect(calls).toHaveLength(1)
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer card-token")
    // 这两条是修复的核心：缺任何一个，新卡都过不了网关。
    expect(headers["X-Device-Id"]).toBe(DEVICE_ID)
    expect(headers["X-Request-Sig"]).toBe("sig-value")
    expect(headers["X-Request-Ts"]).toBe("1700000000")
  })

  it("取不到设备指纹时不发这个头，而不是瞎填一个值", async () => {
    vi.doMock("@/lib/account/device", () => ({
      getDeviceFingerprint: vi.fn(async () => null),
    }))
    vi.doMock("@/lib/account/request-sign", () => ({
      signRequestHeaders: vi.fn(async () => null),
    }))

    const { fetchImpl, calls } = fakeFetch({ data: [{ id: "m1" }] })
    const { gatewayListModelCatalog } = await import("./gateway-api")

    await gatewayListModelCatalog("https://relay.example.com", "card-token", fetchImpl)

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer card-token")
    // 浏览器环境取不到指纹，网关对无指纹的卡按「首次校验补绑」处理。
    expect(headers["X-Device-Id"]).toBeUndefined()
    expect(headers["X-Request-Sig"]).toBeUndefined()
  })

  it("探活请求的签名覆盖真实 body", async () => {
    const signRequestHeaders = vi.fn(async () => ({ "X-Request-Sig": "probe-sig" }))
    vi.doMock("@/lib/account/device", () => ({
      getDeviceFingerprint: vi.fn(async () => DEVICE_ID),
    }))
    vi.doMock("@/lib/account/request-sign", () => ({ signRequestHeaders }))

    const { fetchImpl, calls } = fakeFetch({
      choices: [{ message: { content: "你好" } }],
    })
    const { gatewayProbeChat } = await import("./gateway-api")

    await gatewayProbeChat("https://relay.example.com", "card-token", "m1", fetchImpl)

    // 签名必须拿到真实 body：POST 的 bodyHash 对不上，网关一定验签失败。
    const signedBody = signRequestHeaders.mock.calls[0]?.[2]
    expect(signedBody).toBe(calls[0].init.body)
    expect(String(signedBody)).toContain("m1")
    expect((calls[0].init.headers as Record<string, string>)["X-Device-Id"]).toBe(DEVICE_ID)
  })
})
