// @vitest-environment jsdom
/**
 * 独立「插件」页面（市场 + 已安装 + 手动安装）的渲染与交互测试。
 *
 * 这一页有两类风险，本文件的用例就是围着它们写的：
 *   1. **诚实的空/错误/缓存三态**：市场索引是随仓库维护的静态文件，
 *      空、读不到、只拿到缓存是三件不同的事，混成一句「暂无插件」或白屏都算缺陷；
 *   2. **别装重复的插件**：卡片的「安装」按钮必须和 `plugins_list` 交叉比对，
 *      已经装过的条目不能再给一个能点的安装按钮。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PluginMarketEntry, PluginMarketIndex } from "@/lib/plugins/api"
import type { PluginSummary } from "@/lib/plugins/types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const marketIndexMock = vi.hoisted(() => vi.fn())
const marketInstallMock = vi.hoisted(() => vi.fn())
const listMock = vi.hoisted(() => vi.fn())
const installMock = vi.hoisted(() => vi.fn())
const installLocalMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/plugins/api", () => ({
  pluginsApi: {
    marketIndex: marketIndexMock,
    marketInstall: marketInstallMock,
    list: listMock,
    install: installMock,
    installLocal: installLocalMock,
  },
}))

// toast 在 jsdom 里没有 Provider 时会进待发队列；这里换成 spy，好断言「装完有没有提示」。
vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccessMock, error: vi.fn(), info: vi.fn() },
}))

/*
 * 「已安装」tab 直接渲染设置页里的 `PluginSection`（本任务明确要求复用，不重写）。
 * 它有自己的一整套 Tauri 依赖（provider / 工具 / 钩子同步），与本次要验的
 * 「市场页 + tab 切换」无关，所以换成一个可识别的桩。
 * 复用本身由 `plugin-center-view.wiring` 的源码断言守（见同目录 nav 接线 spec）。
 */
vi.mock("@/components/settings/sections/plugin-section", () => ({
  PluginSection: () => <div data-testid="stub-plugin-section" />,
}))

import { marketRepoKey, matchesMarketSearch, PluginCenterView } from "./plugin-center-view"

function entry(overrides: Partial<PluginMarketEntry> & { id: string }): PluginMarketEntry {
  return {
    name: overrides.id,
    repo: `owner/${overrides.id}`,
    description: "",
    author: "",
    categories: [],
    tags: [],
    kind: [],
    permissions: [],
    version: null,
    ...overrides,
  }
}

function indexOf(plugins: PluginMarketEntry[], overrides: Partial<PluginMarketIndex> = {}): PluginMarketIndex {
  return {
    plugins,
    fromCache: false,
    fetchedAt: 1_760_000_000,
    sourceUrl: "https://raw.githubusercontent.com/owner/qmai/main/plugins/index.json",
    ...overrides,
  }
}

/** 一个最小可用的 `PluginSummary`（交叉比对只读 id / name / version / sourceRepo）。 */
function installedSummary(overrides: Partial<PluginSummary> & { id: string }): PluginSummary {
  return {
    name: overrides.id,
    version: "1.0.0",
    description: "",
    enabled: false,
    processState: "stopped",
    grantedPermissions: [],
    toolCount: 0,
    sourceRepo: "",
    sourceCommit: "",
    ...overrides,
  }
}

const alpha = entry({
  id: "alpha",
  name: "大纲补全",
  repo: "someone/qmai-outline-helper",
  description: "为大纲自动补人物与场景",
  author: "某甲",
  categories: ["写作辅助"],
  tags: ["大纲", "人物"],
  kind: ["declarative"],
})
const beta = entry({
  id: "beta",
  name: "灵感生成器",
  repo: "owner/inspiration",
  description: "按标签批量出灵感",
  author: "某乙",
  categories: ["灵感"],
  tags: ["脑洞"],
  kind: ["tools", "providers"],
  permissions: ["fs:project-read", "net:https"],
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  marketIndexMock.mockReset()
  marketInstallMock.mockReset()
  listMock.mockReset()
  installMock.mockReset()
  installLocalMock.mockReset()
  toastSuccessMock.mockReset()
  marketIndexMock.mockResolvedValue(indexOf([alpha, beta]))
  marketInstallMock.mockResolvedValue(installedSummary({ id: "alpha", name: "大纲补全" }))
  listMock.mockResolvedValue([])
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

/** 把挂起的 promise 链（invoke → setState → 再渲染）跑干净。 */
async function flush(times = 6) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function render() {
  await act(async () => {
    root.render(<PluginCenterView />)
  })
  await flush()
}

function cards(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("[data-market-card]")]
}

function cardIds(): string[] {
  return cards().map((node) => node.getAttribute("data-market-card") ?? "")
}

function card(id: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[data-market-card="${id}"]`)
  if (!found) throw new Error(`没有找到卡片 ${id}`)
  return found
}

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("PluginCenterView：市场 tab", () => {
  it("索引为空时给出诚实的空状态（说清数据来自哪里、以及还能做什么）", async () => {
    marketIndexMock.mockResolvedValue(indexOf([]))
    await render()

    expect(host.querySelector('[data-plugins-market="empty"]')).not.toBeNull()
    expect(host.textContent).toContain("市场里还没有插件")
    expect(host.textContent).toContain("plugins/index.json")
    expect(host.textContent).toContain("你仍然可以在右侧「手动安装」里粘贴任意 GitHub 地址。")
    // 空 ≠ 错误：不许出现错误态的红色块
    expect(host.querySelector('[data-plugins-market="error"]')).toBeNull()
    expect(cards()).toHaveLength(0)
  })

  it("索引里有 2 条时渲染 2 张卡", async () => {
    await render()

    expect(cardIds()).toEqual(["alpha", "beta"])
    expect(card("alpha").textContent).toContain("大纲补全")
    expect(card("alpha").textContent).toContain("某甲")
    // kind 徽章是中文，不是原始标识符
    expect(card("beta").textContent).toContain("工具")
    expect(card("beta").textContent).toContain("模型")
    // 分类与标签都要出现在卡片上
    expect(card("alpha").textContent).toContain("写作辅助")
    expect(card("alpha").textContent).toContain("大纲")
  })

  it("搜索按 name/description/author/tags 过滤，大小写不敏感", async () => {
    await render()
    const search = host.querySelector<HTMLInputElement>('[data-market-search="true"]')!

    setInput(search, "灵感")
    expect(cardIds()).toEqual(["beta"])

    // 描述命中
    setInput(search, "自动补人物")
    expect(cardIds()).toEqual(["alpha"])

    // 作者命中
    setInput(search, "某乙")
    expect(cardIds()).toEqual(["beta"])

    // 标签命中
    setInput(search, "脑洞")
    expect(cardIds()).toEqual(["beta"])

    // 清空恢复全部
    setInput(search, "")
    expect(cardIds()).toEqual(["alpha", "beta"])
  })

  it("分类 chips 单选生效，再点一次取消筛选", async () => {
    await render()
    const chip = host.querySelector<HTMLButtonElement>('[data-market-category="写作辅助"]')!

    act(() => chip.click())
    expect(cardIds()).toEqual(["alpha"])
    expect(chip.getAttribute("aria-pressed")).toBe("true")

    act(() => chip.click())
    expect(cardIds()).toEqual(["alpha", "beta"])
    expect(chip.getAttribute("aria-pressed")).toBe("false")
  })

  it("已安装的条目不再显示可点的「安装」按钮", async () => {
    listMock.mockResolvedValue([installedSummary({ id: "alpha", name: "大纲补全", version: "2.1.0" })])
    await render()

    const installedCard = card("alpha")
    expect(installedCard.querySelector('[data-market-action="install"]')).toBeNull()
    const doneButton = installedCard.querySelector<HTMLButtonElement>('[data-market-action="installed"]')
    expect(doneButton).not.toBeNull()
    expect(doneButton!.disabled).toBe(true)
    expect(doneButton!.textContent).toContain("已安装")
    // 已装的那张要带版本号
    expect(installedCard.textContent).toContain("v2.1.0")

    // 另一条没装，按钮照旧
    expect(card("beta").querySelector('[data-market-action="install"]')).not.toBeNull()
  })

  it("安装按钮只调一次 plugins_market_install(repo)，成功后刷新 plugins_list", async () => {
    await render()
    const button = card("alpha").querySelector<HTMLButtonElement>('[data-market-action="install"]')!

    await act(async () => button.click())
    await flush()

    expect(marketInstallMock).toHaveBeenCalledTimes(1)
    expect(marketInstallMock).toHaveBeenCalledWith("someone/qmai-outline-helper")
    expect(toastSuccessMock).toHaveBeenCalledTimes(1)
    // 首屏一次 + 安装成功后一次
    expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it("fromCache 时给出「本地缓存」琥珀提示，并且可以重试", async () => {
    marketIndexMock.mockResolvedValue(indexOf([alpha, beta], { fromCache: true }))
    await render()

    const banner = host.querySelector('[data-plugins-market="cache"]')
    expect(banner).not.toBeNull()
    expect(banner!.textContent).toContain("当前显示的是本地缓存（网络不可用），可能不是最新")
    const retry = [...banner!.querySelectorAll("button")].find((b) => b.textContent === "重试")!
    expect(retry).toBeDefined()

    // 重试必须是「强制联网」那一档：refresh=true
    await act(async () => retry.click())
    await flush()
    expect(marketIndexMock).toHaveBeenLastCalledWith(true)
  })

  it("索引命令失败且无缓存时是错误态，但手动安装入口仍然可用", async () => {
    marketIndexMock.mockRejectedValue(
      "无法读取插件市场索引：plugins_market_index 命令尚未就绪",
    )
    await render()

    const error = host.querySelector('[data-plugins-market="error"]')
    expect(error).not.toBeNull()
    expect(error!.textContent).toContain("读取插件市场失败")
    expect(error!.textContent).toContain("plugins_market_index 命令尚未就绪")
    expect(cards()).toHaveLength(0)

    // 页面骨架还在：手动安装按钮必须能点（这是错误态下唯一的出口）
    const manual = host.querySelector<HTMLButtonElement>('[data-plugins-manual="true"]')!
    expect(manual).not.toBeNull()
    expect(manual.disabled).toBe(false)

    await act(async () => manual.click())
    await flush()

    // 弹窗打开，且能真的发起一次 GitHub 安装
    const urlInput = document.querySelector<HTMLInputElement>('[data-plugins-manual-url="true"]')
    expect(urlInput).not.toBeNull()
    setInput(urlInput!, "https://github.com/owner/mine")
    const submit = document.querySelector<HTMLButtonElement>('[data-plugins-manual-submit="true"]')!
    await act(async () => submit.click())
    await flush()
    expect(installMock).toHaveBeenCalledWith("https://github.com/owner/mine")
  })
})

describe("PluginCenterView：已安装 tab", () => {
  it("默认停在市场 tab；切到已安装时渲染既有 PluginSection 并说明同一份数据", async () => {
    await render()

    expect(host.querySelector('[data-plugin-tab="market"]')!.getAttribute("aria-selected")).toBe("true")
    expect(host.querySelector('[data-testid="stub-plugin-section"]')).toBeNull()

    await act(async () => host.querySelector<HTMLButtonElement>('[data-plugin-tab="installed"]')!.click())
    await flush()

    expect(host.querySelector('[data-plugin-tab="installed"]')!.getAttribute("aria-selected")).toBe("true")
    expect(host.querySelector('[data-testid="stub-plugin-section"]')).not.toBeNull()
    expect(host.textContent).toContain("这里和 设置 → 插件 是同一份数据")
  })
})

describe("PluginCenterView：市场条目与已安装插件的比对规则", () => {
  it("marketRepoKey 抹平协议、大小写、.git 与尾斜杠", () => {
    expect(marketRepoKey("https://github.com/Owner/Repo.git")).toBe("owner/repo")
    expect(marketRepoKey("owner/repo/")).toBe("owner/repo")
    expect(marketRepoKey("git@github.com:owner/repo")).toBe("git@github.com:owner/repo")
  })

  it("matchesMarketSearch 命中 name/description/author/tags，空查询一律放行", () => {
    expect(matchesMarketSearch(alpha, "  ")).toBe(true)
    expect(matchesMarketSearch(alpha, "大纲补全")).toBe(true)
    expect(matchesMarketSearch(alpha, "自动补人物")).toBe(true)
    expect(matchesMarketSearch(alpha, "某甲")).toBe(true)
    expect(matchesMarketSearch(alpha, "人物")).toBe(true)
    expect(matchesMarketSearch(alpha, "灵感")).toBe(false)
  })
})
