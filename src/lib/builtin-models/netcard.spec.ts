import { describe, expect, it } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { StoredAccountSession } from "@/lib/account/types"
import { DEFAULT_RELAY_URL, isBuiltinRelayEndpoint, netcardFromAuthPayload, netcardOf } from "./netcard"
import { withBuiltinAuth } from "./auth-hook"

const CARD = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiI5In0.sig"

function config(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: "custom",
    apiKey: "",
    model: "qmai-standard",
    ollamaUrl: "",
    customEndpoint: `${DEFAULT_RELAY_URL}/v1`,
    maxContextSize: 204800,
    ...overrides,
  } as LlmConfig
}

function session(netcard: string | null | undefined): StoredAccountSession {
  return {
    baseUrl: "https://qmai-account.qmai.workers.dev",
    accessToken: "access",
    accessExpiresAt: 0,
    refreshToken: "refresh",
    refreshExpiresAt: 0,
    user: { id: 9, email: "a@b.c", displayName: "Moc", createdAt: 0, avatarUpdatedAt: null },
    savedAt: 0,
    netcard,
  }
}

describe("netcardFromAuthPayload", () => {
  it("从登录返回里取出网关卡", () => {
    expect(netcardFromAuthPayload({ success: true, data: { netcard: CARD } })).toBe(CARD)
  })

  it("后端没配私钥（netcard=null）时返回 null，不抛错", () => {
    expect(netcardFromAuthPayload({ success: true, data: { netcard: null } })).toBeNull()
  })

  it("结构不对时返回 null", () => {
    expect(netcardFromAuthPayload(null)).toBeNull()
    expect(netcardFromAuthPayload({})).toBeNull()
    expect(netcardFromAuthPayload({ data: { netcard: "" } })).toBeNull()
  })
})

describe("netcardOf", () => {
  it("有卡返回卡，没卡返回 null", () => {
    expect(netcardOf(session(CARD))).toBe(CARD)
    expect(netcardOf(session(null))).toBeNull()
    expect(netcardOf(session(undefined))).toBeNull()
    expect(netcardOf(null)).toBeNull()
  })
})

describe("isBuiltinRelayEndpoint", () => {
  it("只有指向 relay 域名的才算内置模型", () => {
    expect(isBuiltinRelayEndpoint(`${DEFAULT_RELAY_URL}/v1`)).toBe(true)
    expect(isBuiltinRelayEndpoint("https://api.siliconflow.cn/v1")).toBe(false)
    expect(isBuiltinRelayEndpoint("")).toBe(false)
    expect(isBuiltinRelayEndpoint(undefined)).toBe(false)
  })
})

describe("withBuiltinAuth", () => {
  it("指向内置中转站且有卡时，把卡注入成 apiKey", () => {
    const result = withBuiltinAuth(config(), session(CARD))
    expect(result.injected).toBe(true)
    expect(result.config.apiKey).toBe(CARD)
    // 其它字段不动
    expect(result.config.model).toBe("qmai-standard")
    expect(result.config.customEndpoint).toBe(`${DEFAULT_RELAY_URL}/v1`)
  })

  it("换账号后取到的是新卡（不是配置里那个旧值）", () => {
    const first = withBuiltinAuth(config({ apiKey: "old-card" }), session("card-a"))
    expect(first.config.apiKey).toBe("card-a")
    const second = withBuiltinAuth(config({ apiKey: "old-card" }), session("card-b"))
    expect(second.config.apiKey).toBe("card-b")
  })

  it("没登录（无卡）时不注入，让网关返回 401 由上层提示登录", () => {
    const result = withBuiltinAuth(config({ apiKey: "stale-card" }), null)
    expect(result.injected).toBe(false)
    // 不覆盖：保留原样，交给上层处理
    expect(result.config.apiKey).toBe("stale-card")
  })

  it("指向第三方接口时完全不干预", () => {
    const thirdParty = config({ customEndpoint: "https://api.siliconflow.cn/v1", apiKey: "sk-user" })
    const result = withBuiltinAuth(thirdParty, session(CARD))
    expect(result.injected).toBe(false)
    expect(result.config.apiKey).toBe("sk-user")
  })
})
