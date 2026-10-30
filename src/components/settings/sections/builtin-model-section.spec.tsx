// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const relay = vi.hoisted(() => ({
  fetchRelayTicket: vi.fn(),
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
  session: null as null | { user: { id: number; email: string; displayName: string } },
}))

vi.mock("@/stores/account-store", () => ({
  useAccountStore: (selector: (state: typeof account) => unknown) => selector(account),
}))

const { BuiltinModelSection } = await import("./builtin-model-section")
const { useWikiStore } = await import("@/stores/wiki-store")

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

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  account.status = "anonymous"
  account.session = null
  relay.fetchRelayTicket.mockReset()
  relay.gatewayListModels.mockReset()
  relay.gatewayProbeChat.mockReset()
  useWikiStore.setState({ providerConfigs: {} })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("BuiltinModelSection", () => {
  it("未登录时提示先登录，不显示启用按钮", async () => {
    await act(async () => {
      root.render(<BuiltinModelSection />)
    })

    expect(container.textContent).toContain("请先登录青幕账号")
    expect(button("启用内置模型")).toBeUndefined()
    // 未登录不应该去换票
    expect(relay.fetchRelayTicket).not.toHaveBeenCalled()
  })

  it("已登录时自动换票并拉出模型清单", async () => {
    account.status = "authenticated"
    account.session = { user: { id: 7, email: "a@b.c", displayName: "测试作者" } }
    relay.fetchRelayTicket.mockResolvedValue({ token: "ticket-abc", expiresAt: Math.floor(Date.now() / 1000) + 1800 })
    relay.gatewayListModels.mockResolvedValue(["qmai-standard", "qmai-long"])

    await act(async () => {
      root.render(<BuiltinModelSection />)
    })
    await flush()

    expect(container.textContent).toContain("测试作者")
    expect(relay.fetchRelayTicket).toHaveBeenCalledTimes(1)
    expect(relay.gatewayListModels).toHaveBeenCalledWith("https://relay.qmai.work", "ticket-abc")
    expect(container.textContent).toContain("青幕标准版")
    expect(container.textContent).toContain("青幕长文版")
    expect(button("启用内置模型")).toBeDefined()
  })

  it("点「启用内置模型」把勾选结果写入 provider 配置", async () => {
    account.status = "authenticated"
    account.session = { user: { id: 7, email: "a@b.c", displayName: "测试作者" } }
    relay.fetchRelayTicket.mockResolvedValue({ token: "ticket-abc", expiresAt: Math.floor(Date.now() / 1000) + 1800 })
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
    expect(override?.apiKey).toBe("ticket-abc")
    expect(container.textContent).toContain("已启用")
  })

  it("换票失败时给出中文提示而不是崩掉", async () => {
    account.status = "authenticated"
    account.session = { user: { id: 7, email: "a@b.c", displayName: "测试作者" } }
    // 模拟真实的网络失败：GatewayError 会带一句人话
    relay.fetchRelayTicket.mockRejectedValue(new Error("无法连接到内置模型服务：network down"))

    await act(async () => {
      root.render(<BuiltinModelSection />)
    })
    await flush()

    expect(container.textContent).toContain("无法连接到内置模型服务")
    expect(button("重新获取凭证")).toBeDefined()
  })
})
