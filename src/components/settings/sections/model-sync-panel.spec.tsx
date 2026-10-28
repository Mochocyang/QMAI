// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 「账号同步」面板的渲染契约：
 * - 未登录：给出提示，且开启按钮禁用；
 * - 未开启但已登录：显示「开启同步」；
 * - 已开启：显示三个操作按钮 + 上次同步时间；
 * - 冲突：逐条给出「用本地这份 / 用云端这份」。
 *
 * 这里只验渲染与交互接线，加解密/合并逻辑在 lib/model-sync 的单测里覆盖。
 */

const state = vi.hoisted(() => ({
  enabled: false,
  passwordReady: false,
  busy: false,
  status: "idle" as const,
  message: "",
  pendingConflicts: [] as Array<{ key: string; localValue: unknown; cloudValue: unknown; chosen: "local" | "cloud" }>,
  lastSyncAt: null as number | null,
  init: vi.fn(async () => undefined),
  enable: vi.fn(async () => undefined),
  disable: vi.fn(async () => undefined),
  syncNow: vi.fn(async () => undefined),
  changePassword: vi.fn(async () => undefined),
  resolveConflict: vi.fn(async () => undefined),
}))

const account = vi.hoisted(() => ({ session: null as null | { baseUrl: string } }))

vi.mock("@/stores/model-sync-store", () => ({
  useModelSyncStore: (selector: (value: typeof state) => unknown) => selector(state),
}))
vi.mock("@/stores/account-store", () => ({
  useAccountStore: (selector: (value: typeof account) => unknown) => selector(account),
}))

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

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  Object.assign(state, {
    enabled: false,
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
  it("未登录：提示先登录，开启按钮禁用", () => {
    render()
    expect(host.textContent).toContain("账号同步")
    expect(host.textContent).toContain("请先在「账号」里登录")
    expect(button("开启同步")?.disabled).toBe(true)
  })

  it("已登录未开启：可直接开启同步", () => {
    account.session = { baseUrl: "https://qmai-account.qmai.workers.dev" }
    render()
    expect(button("开启同步")?.disabled).toBe(false)
  })

  it("已开启：展示立即同步 / 修改同步密码 / 关闭同步", () => {
    account.session = { baseUrl: "https://qmai-account.qmai.workers.dev" }
    Object.assign(state, { enabled: true, lastSyncAt: Date.now() })
    render()
    expect(button("立即同步")).toBeTruthy()
    expect(button("修改同步密码")).toBeTruthy()
    expect(button("关闭同步")).toBeTruthy()
    expect(host.textContent).toContain("上次同步：")
  })

  it("冲突时逐条给出两份可选，点击即按选中的那份解决", () => {
    account.session = { baseUrl: "https://qmai-account.qmai.workers.dev" }
    Object.assign(state, {
      enabled: true,
      pendingConflicts: [{ key: "deepseek", localValue: { m: 1 }, cloudValue: { m: 2 }, chosen: "cloud" }],
    })
    render()

    expect(host.textContent).toContain("deepseek")
    const localButton = button("用本地这份")
    expect(localButton).toBeTruthy()

    act(() => localButton!.click())
    expect(state.resolveConflict).toHaveBeenCalledWith("deepseek", "local")
  })
})
