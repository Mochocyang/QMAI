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
  // 退出登录会拿返回值当新的 config；不设默认值的话 store 会 set 成 undefined，
  // 下一次渲染就 "Cannot read properties of undefined (reading 'targets')"。
  clientMocks.logoutCloudSync.mockImplementation(async () => useCloudSyncStore.getState().config)
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
    // 现在是三张：坚果云（WebDAV）、GitHub、网盘本地文件夹。百度这一版隐藏了。
    expect(host.querySelectorAll('[data-ui="cloud-sync-provider"]').length).toBe(3)
    // 还没勾选任何网盘：提示先去勾一个，而不是笼统说「需要登录」。
    expect(host.textContent).toContain("先勾选一个网盘")
    expect(clientMocks.runCloudSyncNow).not.toHaveBeenCalled()
  })

  it("百度网盘这一版不出卡片", async () => {
    render()
    await act(async () => switchButton("云同步").click())
    // 列表里没有百度：卡片、勾选框都不存在，界面上也不提它。
    expect(host.querySelector('[data-provider-card="baidu"]')).toBeNull()
    expect(host.querySelector('[data-provider="baidu"]')).toBeNull()
    expect(host.querySelector('[data-target-toggle="baidu"]')).toBeNull()
    expect(host.textContent).not.toContain("百度")
    expect(host.textContent).not.toContain("后续版本开放")
  })

  it("WebDAV 卡片文案是「坚果云」", async () => {
    useCloudSyncStore.setState({
      config: { ...DEFAULT_CLOUD_SYNC_CONFIG, enabled: true, provider: null, connected: false },
    })
    render()
    const webdavCard = host.querySelector<HTMLElement>('[data-provider-card="webdav"]')!
    expect(webdavCard.textContent).toContain("坚果云")
  })

  it("退出登录只退自己那一行，不连坐别的网盘", async () => {
    /*
     * 真实投诉：在坚果云那行点退出登录，退掉的却是 GitHub。
     * 根因是 logout() 读的是"当前激活的网盘"，而用户上一个点过的卡片是 GitHub。
     * 修好后按钮会把**自己那一行**的 provider 传下去。
     */
    useCloudSyncStore.setState({
      config: {
        ...DEFAULT_CLOUD_SYNC_CONFIG,
        enabled: true,
        provider: "github",
        connected: true,
        accountLabel: "me/repo",
        targets: [
          {
            provider: "webdav",
            connected: true,
            accountLabel: "me@example.com",
            webdavUrl: "https://dav.jianguoyun.com/dav/",
          },
          { provider: "github", connected: true, accountLabel: "me/repo" },
        ],
      },
    })
    render()
    await act(async () => {})

    // 界面上只有焦点那一行显示账号操作区，所以只会有一个退出登录按钮；
    // 关键是它携带的 provider 必须是**它自己那一行**的，而不是"上一个点过的那个"。
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-ui="cloud-sync-logout"]')]
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      expect(button.getAttribute("data-provider")).toBe("github")
    }
    await act(async () => buttons[0].click())
    expect(clientMocks.logoutCloudSync).toHaveBeenCalledWith("github")
    // 绝不能出现"点了这一行、退的却是别的盘"
    expect(clientMocks.logoutCloudSync).not.toHaveBeenCalledWith("webdav")
  })

  it("点网盘卡片主体只是切焦点，不改变它的勾选状态", async () => {
    // 真实投诉：取消勾选坚果云后，点一下它的卡片看一眼，又变回勾选。
    // 根因是卡片主体走 setProvider → 后端 target_mut 是 upsert。
    useCloudSyncStore.setState({
      config: {
        ...DEFAULT_CLOUD_SYNC_CONFIG,
        enabled: true,
        provider: "github",
        connected: true,
        targets: [{ provider: "github", connected: true, accountLabel: "me/repo" }],
      },
    })
    render()
    await act(async () => {})

    const webdavCard = host.querySelector<HTMLElement>('[data-provider-card="webdav"]')!
    expect(webdavCard.getAttribute("data-target-enabled")).toBe("false")

    const body = webdavCard.querySelector<HTMLButtonElement>('[data-ui="cloud-sync-provider"]')!
    await act(async () => body.click())

    // focusProvider 是纯本地的：一个 IPC 都不该发，更不该碰 targets。
    expect(clientMocks.setCloudSyncConfig).not.toHaveBeenCalled()
    expect(useCloudSyncStore.getState().config.targets).toHaveLength(1)
    expect(useCloudSyncStore.getState().config.targets?.[0].provider).toBe("github")
  })

  it("勾了但没登录的网盘要说清「已勾选，还需登录」", async () => {
    // 用户会以为"登录了就在同步"。勾了但还没登录时必须能看出来。
    useCloudSyncStore.setState({
      config: {
        ...DEFAULT_CLOUD_SYNC_CONFIG,
        enabled: true,
        provider: "webdav",
        connected: false,
        targets: [{ provider: "webdav", connected: false }],
      },
    })
    render()
    await act(async () => {})

    const card = host.querySelector<HTMLElement>('[data-provider-card="webdav"]')!
    expect(card.getAttribute("data-target-enabled")).toBe("true")
    expect(card.getAttribute("data-target-connected")).toBe("false")
    expect(card.textContent).toContain("已勾选，还需登录")
  })

  it("「打开远端内容」和「退出登录」挨在一起，中间不夹别的元素", async () => {
    useCloudSyncStore.setState({
      config: {
        ...DEFAULT_CLOUD_SYNC_CONFIG,
        enabled: true,
        provider: "github",
        connected: true,
        accountLabel: "someone/repo",
        targets: [
          {
            provider: "github",
            connected: true,
            accountLabel: "someone/repo",
            githubOwner: "someone",
            githubRepo: "repo",
            githubBranch: "main",
          },
        ],
      },
    })
    render()

    const reveal = host.querySelector<HTMLButtonElement>('[data-ui="cloud-sync-reveal-remote"]')!
    expect(reveal).toBeTruthy()
    const logout = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("退出登录"),
    )!
    expect(logout).toBeTruthy()

    // 两个按钮必须是同一个容器的直接子级 —— 否则 justify-between 会把它们分开。
    expect(reveal.parentElement).toBe(logout.parentElement)
    const group = reveal.parentElement!
    expect(group.className).toContain("gap-2")
    // 小组里只有这两个按钮，不许夹别的东西。
    expect([...group.children].filter((child) => child.tagName === "BUTTON")).toHaveLength(2)
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

  it("点网盘卡片主体只切「正在看哪个」，不落盘、也不动它的连接态", async () => {
    /*
     * 曾经点卡片 = 发 patchConfig({ provider })，后端 merge_patch 会 upsert target，
     * 于是"点一下没勾选的网盘"等于"把它勾上"（用户投诉）。
     * 现在这是纯本地的界面状态：不发 IPC、不改 targets、也不碰 connected。
     */
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
    await act(async () => host.querySelector<HTMLElement>('[data-provider="folder"]')!.click())
    expect(clientMocks.setCloudSyncConfig).not.toHaveBeenCalled()
    expect(useCloudSyncStore.getState().config.provider).toBe("folder")
    // 勾选状态完全没变：还是只有 webdav 一个目标。
    expect(useCloudSyncStore.getState().config.targets).toHaveLength(1)
    expect(useCloudSyncStore.getState().config.targets?.[0].provider).toBe("webdav")
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
