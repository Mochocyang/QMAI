// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BuiltinModelSection } from "./builtin-model-section"
import { BUILTIN_SESSION_STORAGE_KEY } from "@/lib/builtin-models/session"

vi.mock("@/lib/project-store", () => ({
  saveProviderConfigs: vi.fn(async () => {}),
  saveDefaultLlmModel: vi.fn(async () => {}),
  saveNovelConfig: vi.fn(async () => {}),
  saveAiChatModel: vi.fn(async () => {}),
}))

let container: HTMLDivElement
let root: Root

function button(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(text))
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("BuiltinModelSection", () => {
  it("未登录时同时给出账号登录和测试密钥两条路", async () => {
    await act(async () => { root.render(<BuiltinModelSection />) })

    expect(container.querySelector('[data-ui="builtin-models"]')).not.toBeNull()
    expect(container.textContent).toContain("青幕内置模型")
    expect(button("登录")).toBeDefined()
    expect(button("注册新账号")).toBeDefined()
    expect(container.querySelector('input[aria-label="内置模型测试密钥"]')).not.toBeNull()
    expect(container.querySelector('input[aria-label="内置模型网关地址"]')).not.toBeNull()
  })

  it("切到注册页签后按钮文案跟着变，空表单点提交给出中文校验提示", async () => {
    await act(async () => { root.render(<BuiltinModelSection />) })

    const registerTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((item) => item.textContent?.includes("注册新账号"))
    await act(async () => { registerTab!.dispatchEvent(new MouseEvent("click", { bubbles: true })) })

    const submit = button("注册并开通内置模型")
    expect(submit).toBeDefined()
    await act(async () => { submit!.dispatchEvent(new MouseEvent("click", { bubbles: true })) })

    expect(container.textContent).toContain("请填写要注册的账号和密码")
  })

  it("存有登录态时显示账号、余额和已启用的模型数", async () => {
    localStorage.setItem(BUILTIN_SESSION_STORAGE_KEY, JSON.stringify({
      serverUrl: "http://localhost:3000",
      accessToken: "jwt",
      accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      userId: 2,
      username: "qmai_test",
      displayName: "测试作者",
      group: "default",
      quota: 500000,
      usedQuota: 1000,
      quotaPerUnit: 500000,
      usdExchangeRate: 7.3,
      tokenId: 4,
      tokenKey: "sk-abcdefghijklmnop",
      updatedAt: Date.now(),
    }))

    await act(async () => { root.render(<BuiltinModelSection />) })

    expect(container.textContent).toContain("测试作者")
    expect(container.textContent).toContain("$1.00")
    expect(container.textContent).toContain("sk-abcd")
    expect(button("刷新余额")).toBeDefined()
    expect(button("退出登录")).toBeDefined()
  })
})
