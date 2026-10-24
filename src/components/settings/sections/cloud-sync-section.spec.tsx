// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CloudSyncSection } from "./cloud-sync-section"
import { DEFAULT_CLOUD_SYNC_CONFIG } from "@/lib/cloud-sync/types"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"

// React 19 需要这个标记，act(...) 才不报警告（跟仓库里其它组件 spec 一致）。
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const clientMocks = vi.hoisted(() => ({
  getCloudSyncConfig: vi.fn(),
  setCloudSyncConfig: vi.fn(),
  getCloudSyncStatus: vi.fn(),
  beginCloudSyncLogin: vi.fn(),
  cancelCloudSyncLogin: vi.fn(),
  connectCloudSyncWebdav: vi.fn(),
  connectCloudSyncFolder: vi.fn(),
  stopCloudSync: vi.fn(),
  logoutCloudSync: vi.fn(),
  runCloudSyncNow: vi.fn(),
  retryCloudSyncEntries: vi.fn(),
  readCloudSyncHistory: vi.fn(),
  clearCloudSyncHistory: vi.fn(),
  revealCloudSyncRemote: vi.fn(),
  subscribeCloudSync: vi.fn(),
}))

const projects = [
  { id: "b1", name: "长夜", path: "C:/书/长夜" },
  { id: "b2", name: "归墟", path: "C:/书/归墟" },
]

vi.mock("@/lib/cloud-sync/client", () => ({
  CLOUD_SYNC_OPEN_SETTINGS_EVENT: "qmai:cloud-sync-open-settings",
  ...clientMocks,
}))

vi.mock("@/lib/platform", () => ({ isTauri: () => false, isMacOS: () => false }))
vi.mock("@/lib/project-store", () => ({ loadRegisteredProjects: async () => projects }))

let host: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root.render(<CloudSyncSection />)
  })
}

function switchButton(label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
    (item) => item.getAttribute("aria-label") === label,
  )
  expect(button, label).toBeTruthy()
  return button!
}

function textButton(label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  )
  expect(button, label).toBeTruthy()
  return button!
}

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)

  // 后端是「合并 patch 后返回整份配置」，mock 必须照着合并当前值，
  // 否则 enabled 之类的字段会被悄悄重置，测试就测不出真实行为。
  clientMocks.setCloudSyncConfig.mockImplementation(async (patch: Record<string, unknown>) => ({
    ...useCloudSyncStore.getState().config,
    ...patch,
  }))
  clientMocks.beginCloudSyncLogin.mockResolvedValue({ authUrl: "" })
  clientMocks.readCloudSyncHistory.mockResolvedValue({ batches: [], entries: [] })
  clientMocks.getCloudSyncStatus.mockResolvedValue({
    config: { ...DEFAULT_CLOUD_SYNC_CONFIG },
    running: false,
    done: 0,
    total: 0,
    failureCount: 0,
    authExpired: false,
  })

  useCloudSyncStore.setState({
    config: { ...DEFAULT_CLOUD_SYNC_CONFIG },
    runtime: { running: false },
    notice: null,
    login: null,
    loaded: true,
    saving: false,
    batches: [],
    entries: [],
    detailOpen: false,
  })
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe("CloudSyncSection", () => {
  it("默认关闭：只有开关与说明，不展示网盘选择", () => {
    render()
    expect(host.textContent).toContain("云同步")
    expect(host.textContent).toContain("打开后可以把书籍同步到你自己的网盘")
    expect(host.querySelector('[data-ui="cloud-sync-provider"]')).toBeNull()
    expect(switchButton("云同步").getAttribute("aria-checked")).toBe("false")
  })

  it("打开开关立刻落盘配置并把开关置为开启", async () => {
    render()
    await act(async () => switchButton("云同步").click())
    expect(clientMocks.setCloudSyncConfig).toHaveBeenCalledWith({ enabled: true })
    expect(useCloudSyncStore.getState().config.enabled).toBe(true)
    expect(switchButton("云同步").getAttribute("aria-checked")).toBe("true")
  })

  it("打开后进入登录门：给出提示，且不触发同步", async () => {
    render()
    await act(async () => switchButton("云同步").click())
    expect(host.querySelectorAll('[data-ui="cloud-sync-provider"]').length).toBe(3)
    // 还没勾选任何网盘：提示先去勾一个，而不是笼统说「需要登录」。
    expect(host.textContent).toContain("先勾选一个网盘")
    expect(clientMocks.runCloudSyncNow).not.toHaveBeenCalled()
  })

  it("百度网盘不开登录入口：这一版只在卡片上说明后续开放", async () => {
    render()
    await act(async () => switchButton("云同步").click())
    // 卡片主体 disabled，点不动也就不存在「登录百度账号」按钮。
    const body = host.querySelector<HTMLButtonElement>('[data-provider="baidu"]')!
    expect(body.disabled).toBe(true)
    await act(async () => body.click())
    expect(host.textContent).not.toContain("登录百度账号")
    expect(clientMocks.beginCloudSyncLogin).not.toHaveBeenCalled()
  })

  it("百度网盘这一版点不动，卡片上写明后续版本开放", async () => {
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: null, connected: false },
    })
    render()

    const card = host.querySelector<HTMLElement>('[data-provider-card="baidu"]')!
    expect(card.getAttribute("data-provider-available")).toBe("false")
    expect(card.textContent).toContain("后续版本开放")

    // 主体与勾选框都是 disabled：点了不会有任何命令发出去。
    const body = card.querySelector<HTMLButtonElement>('[data-ui="cloud-sync-provider"]')!
    const toggle = card.querySelector<HTMLButtonElement>('[data-target-toggle="baidu"]')!
    expect(body.disabled).toBe(true)
    expect(toggle.disabled).toBe(true)
    await act(async () => {
      body.click()
      toggle.click()
    })
    expect(clientMocks.setCloudSyncConfig).not.toHaveBeenCalled()
  })

  it("「本地文件夹」改名为「网盘本地文件夹」", async () => {
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: null, connected: false },
    })
    render()
    const folderCard = host.querySelector<HTMLElement>('[data-provider-card="folder"]')!
    expect(folderCard.textContent).toContain("网盘本地文件夹")
  })

  it("store 层也拒绝勾选不可用的网盘（防止绕过界面）", async () => {
    const before = { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true }
    useCloudSyncStore.setState({ config: before })
    await act(async () => {
      await useCloudSyncStore.getState().toggleTarget("baidu")
      await useCloudSyncStore.getState().setProvider("baidu")
    })
    expect(clientMocks.setCloudSyncConfig).not.toHaveBeenCalled()
    expect(useCloudSyncStore.getState().config.provider).toBeNull()
  })

  it("勾选第二个网盘后目标列表里有两个，取消勾选只移除它", async () => {
    useCloudSyncStore.setState({
      config: {
        ...DEFAULT_CLOUD_SYNC_CONFIG,
        enabled: true,
        provider: "webdav",
        connected: true,
        accountLabel: "me@example.com",
        targets: [{ provider: "webdav", connected: true, accountLabel: "me@example.com" }],
      },
    })
    render()

    // 勾上「本地文件夹」：只追加，不动已有的 webdav。
    await act(async () =>
      host.querySelector<HTMLElement>('[data-target-toggle="folder"]')!.click(),
    )
    expect(clientMocks.setCloudSyncConfig).toHaveBeenCalledWith({
      targets: [
        { provider: "webdav", connected: true, accountLabel: "me@example.com" },
        { provider: "folder", connected: false },
      ],
    })

    // 再取消勾选 webdav：只剩 folder。
    clientMocks.setCloudSyncConfig.mockClear()
    await act(async () =>
      host.querySelector<HTMLElement>('[data-target-toggle="webdav"]')!.click(),
    )
    expect(clientMocks.setCloudSyncConfig).toHaveBeenCalledWith({
      targets: [{ provider: "folder", connected: false }],
    })
  })

  it("多个网盘时只要有一个已连接就能同步", async () => {
    useCloudSyncStore.setState({
      config: {
        ...DEFAULT_CLOUD_SYNC_CONFIG,
        enabled: true,
        provider: "baidu", // 激活的是没连上的百度
        connected: false,
        targets: [
          { provider: "baidu", connected: false },
          { provider: "folder", connected: true, accountLabel: "同步盘" },
        ],
      },
    })
    render()
    // 同步按钮不该因为「激活目标没连上」被藏起来。
    await act(async () => textButton("立即同步").click())
    await vi.waitFor(() => expect(clientMocks.runCloudSyncNow).toHaveBeenCalledWith(projects, "manual"))
  })

  it("切换网盘只换 provider，连接态交给后端按已存凭据重算", async () => {
    // 曾经这里会把 connected 一起清成 false，后果是「切到百度再切回 WebDAV 就得重输密码」，
    // 而凭据一直躺在磁盘上。现在只发 provider，后端 set_config 会自己恢复。
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: "webdav", connected: true, accountLabel: "me@example.com" },
    })
    render()
    await act(async () => host.querySelector<HTMLElement>('[data-provider="folder"]')!.click())
    expect(clientMocks.setCloudSyncConfig).toHaveBeenCalledWith({ provider: "folder" })
  })

  it("已连接时展示账号与「立即同步」，点它按范围取书单", async () => {
    useCloudSyncStore.setState({
      config: {
        ...DEFAULT_CLOUD_SYNC_CONFIG,
        enabled: true,
        provider: "folder",
        connected: true,
        accountLabel: "本地文件夹",
      },
    })
    render()
    expect(host.textContent).toContain("已连接：本地文件夹")
    await act(async () => textButton("立即同步").click())
    // 书单是动态 import 项目登记表拿到的，断言前要等这轮异步走完。
    await vi.waitFor(() => expect(clientMocks.runCloudSyncNow).toHaveBeenCalledWith(projects, "manual"))
  })

  it("关闭开关会停掉引擎并保留连接态（下次打开不用重登）", async () => {
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: "folder", connected: true },
    })
    render()
    await act(async () => switchButton("云同步").click())
    expect(clientMocks.setCloudSyncConfig).toHaveBeenCalledWith({ enabled: false })
    expect(clientMocks.stopCloudSync).toHaveBeenCalled()
    expect(useCloudSyncStore.getState().config.connected).toBe(true)
  })

  it("同步范围与快照开关都能落盘", async () => {
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: "folder", connected: true },
    })
    render()
    await act(async () => host.querySelector<HTMLElement>('[data-scope="current"]')!.click())
    expect(clientMocks.setCloudSyncConfig).toHaveBeenCalledWith({ scope: "current" })
    await act(async () => switchButton("同时同步章节快照").click())
    expect(clientMocks.setCloudSyncConfig).toHaveBeenCalledWith({ includeSnapshots: false })
  })
})
