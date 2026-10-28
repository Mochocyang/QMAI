// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 「账号同步」面板的渲染契约（用户 2026-10-28 定的新版）：
 * - 默认**折叠**：只留一行 = 标题 + 上次同步时间 + 立即同步 + 开关；
 * - 「修改同步密码」只在展开后出现；
 * - 开关就是同步开关：开 = 同步、关 = 停止同步（保留密码与云端配置）；
 * - 「关闭同步并清空云端配置」是独立链接，放在展开后「上次同步」那一行的右端。
 *
 * 这里只验渲染与交互接线，加解密/合并逻辑在 lib/model-sync 的单测里覆盖。
 */

const state = vi.hoisted(() => ({
  enabled: false,
  passwordReady: false,
  busy: false,
  status: "idle" as "idle" | "pulling" | "pushing" | "error",
  message: "",
  pendingConflicts: [] as Array<{ key: string; localValue: unknown; cloudValue: unknown; chosen: "local" | "cloud" }>,
  lastSyncAt: null as number | null,
  init: vi.fn(async () => undefined),
  enable: vi.fn(async () => undefined),
  setEnabled: vi.fn(async () => undefined),
  disable: vi.fn(async () => undefined),
  syncNow: vi.fn(async () => undefined),
  restoreFromCloud: vi.fn(async () => undefined),
  changePassword: vi.fn(async () => undefined),
  resolveConflict: vi.fn(async () => undefined),
}))

const account = vi.hoisted(() => ({ session: null as null | { baseUrl: string } }))

vi.mock("@/stores/model-sync-store", () => ({
  useModelSyncStore: (selector: (value: typeof state) => unknown) => selector(state),
  MIN_SYNC_PASSWORD_LENGTH: 8,
}))
vi.mock("@/stores/account-store", () => ({
  useAccountStore: (selector: (value: typeof account) => unknown) => selector(account),
}))

const confirmMock = vi.hoisted(() => ({ confirmModelAction: vi.fn(async () => true) }))
vi.mock("@/components/uitest/models/model-confirm", () => confirmMock)

import { ModelSyncPanel } from "./model-sync-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root.render(<ModelSyncPanel />)
  })
}

function button(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  )
}

function toggleButton(): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
}

function switchButton(): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>('[data-ui="model-sync-switch"]')!
}

const LOGGED_IN = { baseUrl: "https://qmai-account.qmai.workers.dev" }

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  Object.assign(state, {
    enabled: false,
    passwordReady: false,
    busy: false,
    status: "idle",
    message: "",
    pendingConflicts: [],
    lastSyncAt: null,
  })
  account.session = null
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

describe("账号同步面板", () => {
  it("未登录：提示先登录，开关禁用", () => {
    render()
    expect(host.textContent).toContain("账号同步")
    expect(host.textContent).toContain("请先在「账号」里登录")
    expect(switchButton().disabled).toBe(true)
  })

  it("默认折叠：只有标题 + 开关，没有「修改同步密码」", () => {
    account.session = LOGGED_IN
    Object.assign(state, { enabled: true, lastSyncAt: Date.now() })
    render()
    expect(toggleButton().getAttribute("aria-expanded")).toBe("false")
    expect(button("修改同步密码")).toBeUndefined()
    // 折叠时仍给出上次同步时间（放在「立即同步」左侧）
    expect(host.textContent).toContain("上次同步：")
    expect(button("立即同步")).toBeTruthy()
  })

  it("展开后才出现「修改同步密码」与清空云端配置入口", () => {
    account.session = LOGGED_IN
    Object.assign(state, { enabled: true, lastSyncAt: Date.now() })
    render()
    act(() => toggleButton().click())
    expect(toggleButton().getAttribute("aria-expanded")).toBe("true")
    expect(button("修改同步密码")).toBeTruthy()
    expect(host.textContent).toContain("关闭同步并清空云端配置（不可恢复）")
  })

  it("开关即同步开关：点一下关闭只调 setEnabled(false)，不碰 disable（不清云端）", () => {
    account.session = LOGGED_IN
    Object.assign(state, { enabled: true, passwordReady: true })
    render()
    act(() => switchButton().click())
    expect(state.setEnabled).toHaveBeenCalledWith(false)
    expect(state.disable).not.toHaveBeenCalled()
  })

  it("已关闭且本机有密码：再点开关直接恢复同步，不再要求输密码", () => {
    account.session = LOGGED_IN
    Object.assign(state, { enabled: false, passwordReady: true })
    render()
    act(() => switchButton().click())
    expect(state.setEnabled).toHaveBeenCalledWith(true)
    expect(button("开启并上传")).toBeUndefined()
  })

  it("本机没有密码时打开开关：就地展开密码表单（一次性引导）", () => {
    account.session = LOGGED_IN
    Object.assign(state, { enabled: false, passwordReady: false })
    render()
    act(() => switchButton().click())
    expect(toggleButton().getAttribute("aria-expanded")).toBe("true")
    expect(host.querySelector('[data-ui="model-sync-password-form"]')).toBeTruthy()
    expect(state.setEnabled).not.toHaveBeenCalled()
  })

  it("「从云端下载」：确认后调用 restoreFromCloud（取消则不动）", async () => {
    account.session = LOGGED_IN
    Object.assign(state, { enabled: true, passwordReady: true, lastSyncAt: Date.now() })
    render()
    act(() => toggleButton().click())

    const download = button("从云端下载")
    expect(download).toBeTruthy()

    confirmMock.confirmModelAction.mockResolvedValueOnce(false)
    await act(async () => download!.click())
    expect(state.restoreFromCloud).not.toHaveBeenCalled()

    confirmMock.confirmModelAction.mockResolvedValueOnce(true)
    await act(async () => download!.click())
    expect(state.restoreFromCloud).toHaveBeenCalledTimes(1)
  })

  it("冲突时逐条给出两份可选，点击即按选中的那份解决", () => {
    account.session = LOGGED_IN
    Object.assign(state, {
      enabled: true,
      pendingConflicts: [{ key: "deepseek", localValue: { m: 1 }, cloudValue: { m: 2 }, chosen: "cloud" }],
    })
    render()
    act(() => toggleButton().click())

    expect(host.textContent).toContain("deepseek")
    const localButton = button("用本地这份")
    expect(localButton).toBeTruthy()

    act(() => localButton!.click())
    expect(state.resolveConflict).toHaveBeenCalledWith("deepseek", "local")
  })

  it("折叠时同步失败仍要看得到报错（否则点「立即同步」像没反应）", () => {
    account.session = LOGGED_IN
    Object.assign(state, { enabled: true, status: "error", message: "网络不可用" })
    render()
    expect(host.textContent).toContain("网络不可用")
  })
})
