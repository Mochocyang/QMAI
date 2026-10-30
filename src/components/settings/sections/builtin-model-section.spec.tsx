// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const relay = vi.hoisted(() => ({
  gatewayListModels: vi.fn(),
  gatewayProbeChat: vi.fn(),
}))

vi.mock("@/lib/builtin-models/gateway-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/builtin-models/gateway-api")>(
    "@/lib/builtin-models/gateway-api",
  )
  return { ...actual, ...relay }
})

vi.mock("@/lib/project-store", () => ({
  saveProviderConfigs: vi.fn(async () => {}),
  saveDefaultLlmModel: vi.fn(async () => {}),
  saveNovelConfig: vi.fn(async () => {}),
  saveAiChatModel: vi.fn(async () => {}),
  saveLlmConfig: vi.fn(async () => {}),
  saveActivePresetId: vi.fn(async () => {}),
}))

vi.mock("@/lib/open-external-url", () => ({ openExternalUrl: vi.fn() }))

const account = vi.hoisted(() => ({
  status: "anonymous" as string,
  session: null as null | { user: { id: number; email: string; displayName: string }; netcard?: string | null; accessToken?: string; refreshToken?: string },
  replaceSession: vi.fn(),
}))

vi.mock("@/stores/account-store", () => ({
  useAccountStore: Object.assign(
    (selector: (state: typeof account) => unknown) => selector(account),
    { getState: () => account },
  ),
}))

const { BuiltinModelSection } = await import("./builtin-model-section")
const { useWikiStore } = await import("@/stores/wiki-store")
const { BUILTIN_PLACEHOLDER_KEY } = await import("@/lib/builtin-models/provider-bridge")

const CARD = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiI5In0.signature-abcdefghijklmnop"

let container: HTMLDivElement
let root: Root

function button(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(text))
}

async function flush(times = 6) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function loggedInSession(netcard: string | null) {
  return {
    user: { id: 9, email: "a@b.c", displayName: "测试作者" },
    netcard,
    accessToken: "access",
    refreshToken: "refresh",
  }
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  account.status = "anonymous"
  account.session = null
  account.replaceSession.mockReset()
  relay.gatewayListModels.mockReset()
  relay.gatewayProbeChat.mockReset()
  useWikiStore.setState({ providerConfigs: {} })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("BuiltinModelSection（网关卡）", () => {
  it("未登录时提示先登录，不显示启用按钮", async () => {
    await act(async () => {
      root.render(<BuiltinModelSection />)
    })
    expect(container.textContent).toContain("请先登录青幕账号")
    expect(button("启用内置模型")).toBeUndefined()
    expect(relay.gatewayListModels).not.toHaveBeenCalled()
  })

  it("已登录且自带网关卡时，直接拉清单——不需要换票", async () => {
    account.status = "authenticated"
    account.session = loggedInSession(CARD)
    relay.gatewayListModels.mockResolvedValue(["qmai-standard", "qmai-long"])

    await act(async () => {
      root.render(<BuiltinModelSection />)
    })
    await flush()

    expect(container.textContent).toContain("测试作者")
    expect(relay.gatewayListModels).toHaveBeenCalledWith("https://relay.qmai.work", CARD)
    expect(container.textContent).toContain("青幕标准版")
    expect(button("启用内置模型")).toBeDefined()
    // 关键：没有"重新获取凭证"这种过期语义的按钮
    expect(button("重新获取凭证")).toBeUndefined()
  })

  it("点「启用内置模型」写入 provider 配置（配置里只放占位凭证，不放真卡）", async () => {
    account.status = "authenticated"
    account.session = loggedInSession(CARD)
    relay.gatewayListModels.mockResolvedValue(["qmai-standard", "qmai-long"])

    await act(async () => {
      root.render(<BuiltinModelSection />)
    })
    await flush()

    await act(async () => {
      button("启用内置模型")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await flush()

    const override = useWikiStore.getState().providerConfigs["qmai-builtin"]
    expect(override).toBeDefined()
    expect(override?.baseUrl).toBe("https://relay.qmai.work/v1")
    // 真卡不进配置：请求时由 auth-hook 注入
    expect(override?.apiKey).toBe(BUILTIN_PLACEHOLDER_KEY)
    expect(JSON.stringify(override)).not.toContain(CARD)
    expect(container.textContent).toContain("已启用")
  })

  it("已登录但没有卡时提示点「同步凭证」", async () => {
    account.status = "authenticated"
    account.session = loggedInSession(null)

    await act(async () => {
      root.render(<BuiltinModelSection />)
    })
    await flush()

    expect(container.textContent).toContain("尚未获取")
    expect(button("同步凭证")).toBeDefined()
    expect(relay.gatewayListModels).not.toHaveBeenCalled()
  })

  it("拉清单失败时给出中文提示而不是崩掉", async () => {
    account.status = "authenticated"
    account.session = loggedInSession(CARD)
    relay.gatewayListModels.mockRejectedValue(new Error("无法连接到内置模型服务：network down"))

    await act(async () => {
      root.render(<BuiltinModelSection />)
    })
    await flush()

    expect(container.textContent).toContain("无法连接到内置模型服务")
  })
})
