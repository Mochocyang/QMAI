// @vitest-environment jsdom
/**
 * 独立「插件」页面的渲染与交互测试。
 *
 * 这一页有两类风险，本文件的用例就是围着它们写的：
 *   1. **诚实的空/错误/缓存三态**：市场索引是随仓库维护的静态文件，
 *      空、读不到、只拿到缓存是三件不同的事，混成一句「暂无插件」或白屏都算缺陷；
 *   2. **别装重复的插件**：卡片的「安装」按钮必须和 `plugins_list` 交叉比对，
 *      已经装过的条目不能再给一个能点的安装按钮。
 *
 * 版面在 2026-10 重做过一次（去掉 tab、已安装改成行式卡片 + 开关）。
 * 那些断言「结构」的用例按新结构更新，但**行为**（三态、搜索、筛选、
 * 安装只调一次、已装不再显示安装）一条都没有放松。
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
const enableMock = vi.hoisted(() => vi.fn())
const disableMock = vi.hoisted(() => vi.fn())
const uninstallMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/plugins/api", () => ({
  pluginsApi: {
    marketIndex: marketIndexMock,
    marketInstall: marketInstallMock,
    list: listMock,
    install: installMock,
    installLocal: installLocalMock,
    enable: enableMock,
    disable: disableMock,
    uninstall: uninstallMock,
  },
}))

// toast 在 jsdom 里没有 Provider 时会进待发队列；这里换成 spy，好断言「装完有没有提示」。
vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccessMock, error: vi.fn(), info: vi.fn() },
}))

import { marketRepoKey, matchesMarketSearch, PluginCenterView } from "./plugin-center-view"

function entry(overrides: Partial<PluginMarketEntry> & { id: string }): PluginMarketEntry {
  return {
    name: overrides.id,
    repo: `https://github.com/owner/${overrides.id}`,
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

function summary(overrides: Partial<PluginSummary> & { id: string }): PluginSummary {
  return {
    name: overrides.id,
    version: "1.0.0",
    description: "",
    enabled: true,
    processState: "running",
    grantedPermissions: [],
    declaredPermissions: [],
    toolCount: 0,
    providerIds: [],
    sourceRepo: "",
    ...overrides,
  } as PluginSummary
}

function index(
  plugins: PluginMarketEntry[],
  extra: Partial<PluginMarketIndex> = {},
): PluginMarketIndex {
  return { plugins, fromCache: false, fetchedAt: null, sourceUrl: "", ...extra }
}

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

async function render() {
  await act(async () => {
    root.render(<PluginCenterView />)
  })
  // 首屏会并发打 plugins_list 与 market_index，等它们落地
  for (let i = 0; i < 8; i += 1) await flush()
}

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  vi.clearAllMocks()
  marketIndexMock.mockResolvedValue(index([]))
  listMock.mockResolvedValue([])
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

const text = () => host.textContent ?? ""

function buttonByText(label: string): HTMLButtonElement | null {
  const buttons = [...host.querySelectorAll("button")]
  return (
    (buttons.find((b) => (b.textContent ?? "").trim() === label) as HTMLButtonElement) ?? null
  )
}

describe("PluginCenterView：纯函数", () => {
  it("matchesMarketSearch 命中 name/description/author/tags，且大小写不敏感", () => {
    const e = entry({
      id: "a",
      name: "章节体检",
      description: "统计字数",
      author: "Mocho",
      tags: ["统计"],
    })
    expect(matchesMarketSearch(e, "")).toBe(true)
    expect(matchesMarketSearch(e, "体检")).toBe(true)
    expect(matchesMarketSearch(e, "字数")).toBe(true)
    expect(matchesMarketSearch(e, "mocho")).toBe(true)
    expect(matchesMarketSearch(e, "统计")).toBe(true)
    expect(matchesMarketSearch(e, "不存在")).toBe(false)
  })

  it("marketRepoKey 把不同写法的同一仓库归一成同一个键", () => {
    const a = marketRepoKey("https://github.com/Owner/Repo")
    expect(marketRepoKey("github.com/owner/repo")).toBe(a)
    expect(marketRepoKey("https://github.com/owner/repo.git")).toBe(a)
    expect(marketRepoKey("https://github.com/owner/repo/")).toBe(a)
  })
})

describe("PluginCenterView：市场三态", () => {
  it("索引为空时给出诚实的空状态（说清数据来自哪里、以及还能做什么）", async () => {
    await render()
    expect(text()).toContain("市场里还没有插件")
    expect(text()).toContain("plugins/index.json")
    expect(buttonByText("从本地目录安装")).not.toBeNull()
  })

  it("fromCache 时给出「本地缓存」提示，并且重试走强制刷新", async () => {
    marketIndexMock.mockResolvedValue(index([entry({ id: "a" })], { fromCache: true }))
    await render()
    expect(text()).toContain("本地缓存")

    marketIndexMock.mockClear()
    marketIndexMock.mockResolvedValue(index([entry({ id: "a" })], { fromCache: true }))
    const retry = buttonByText("重试")
    expect(retry).not.toBeNull()
    await act(async () => {
      retry?.click()
    })
    await flush()
    // 重试必须走 refresh=true（强制联网），否则永远读到同一份缓存
    expect(marketIndexMock).toHaveBeenCalledWith(true)
  })

  it("内置清单兜底时给出「离线模式」提示，且不禁用安装", async () => {
    marketIndexMock.mockResolvedValue(
      index([entry({ id: "a" })], { fromBuiltin: true }),
    )
    await render()
    expect(text()).toContain("当前离线模式")
    // 离线清单里的仓库地址仍然可装，不能禁掉
    expect(host.querySelector('[data-market-action="install"]')).not.toBeNull()
  })

  it("索引命令失败且无缓存时是错误态，但手动安装入口仍然可用", async () => {
    marketIndexMock.mockRejectedValue(new Error("网络不可用"))
    await render()
    expect(text()).toContain("无法加载插件市场")

    const manual = buttonByText("手动安装")
    expect(manual).not.toBeNull()
    await act(async () => {
      manual?.click()
    })
    await flush()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
})

describe("PluginCenterView：搜索与筛选", () => {
  beforeEach(() => {
    marketIndexMock.mockResolvedValue(
      index([
        entry({ id: "alpha", name: "章节体检", author: "张三", categories: ["写作工具"] }),
        entry({ id: "beta", name: "模型增强", author: "李四", categories: ["模型"] }),
      ]),
    )
  })

  it("搜索按 name/description/author/tags 过滤，大小写不敏感", async () => {
    await render()
    expect(text()).toContain("章节体检")
    expect(text()).toContain("模型增强")

    const input = host.querySelector('input[aria-label="搜索插件"]') as HTMLInputElement | null
    expect(input).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "体检")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await flush()
    expect(text()).toContain("章节体检")
    expect(text()).not.toContain("模型增强")
  })

  it("分类 chips 单选生效，再点一次取消筛选", async () => {
    await render()
    expect(buttonByText("模型")).not.toBeNull()

    await act(async () => {
      buttonByText("模型")?.click()
    })
    await flush()
    expect(text()).toContain("模型增强")
    expect(text()).not.toContain("章节体检")

    await act(async () => {
      buttonByText("模型")?.click()
    })
    await flush()
    expect(text()).toContain("章节体检")
    expect(text()).toContain("模型增强")
  })
})

describe("PluginCenterView：安装", () => {
  it("已安装的条目不再显示可点的「安装」按钮", async () => {
    marketIndexMock.mockResolvedValue(
      index([entry({ id: "alpha", repo: "https://github.com/owner/alpha" })]),
    )
    listMock.mockResolvedValue([
      summary({ id: "alpha", sourceRepo: "https://github.com/owner/alpha" }),
    ])
    await render()

    expect(buttonByText("安装")).toBeNull()
    expect(buttonByText("已安装")).not.toBeNull()
  })

  it("安装按钮只调一次 plugins_market_install(repo)，成功后刷新 plugins_list", async () => {
    const repo = "https://github.com/owner/alpha"
    marketIndexMock.mockResolvedValue(index([entry({ id: "alpha", name: "章节体检", repo })]))
    marketInstallMock.mockResolvedValue(summary({ id: "alpha" }))
    await render()

    const listCallsBefore = listMock.mock.calls.length
    // 按 data 钩子定位：按钮里有图标，「按文本找」在图标版式下不稳
    const install = host.querySelector('[data-market-action="install"]') as HTMLButtonElement | null
    expect(install).not.toBeNull()
    await act(async () => {
      install?.click()
    })
    for (let i = 0; i < 6; i += 1) await flush()

    expect(marketInstallMock).toHaveBeenCalledTimes(1)
    expect(marketInstallMock).toHaveBeenCalledWith(repo)
    expect(toastSuccessMock).toHaveBeenCalledTimes(1)
    expect(listMock.mock.calls.length).toBeGreaterThan(listCallsBefore)
  })
})

describe("PluginCenterView：已安装行", () => {
  it("开关反映启用状态，点击调 enable 并带上清单申请的权限", async () => {
    listMock.mockResolvedValue([
      summary({
        id: "alpha",
        enabled: false,
        processState: "stopped",
        declaredPermissions: ["fs:project-read"],
      }),
    ])
    await render()

    /*
     * 必须精确选「已安装」那一行的开关：现在插件页顶部还有「内置插件」分区，
     * 它的 4 个开关同样是 role="switch"。选第一个会选到内置的，断言就会莫名其妙地失败。
     */
    const toggle = host.querySelector(
      '[data-ui="plugin-row-switch"]',
    ) as HTMLElement | null
    expect(toggle).not.toBeNull()
    await act(async () => {
      toggle?.click()
    })
    await flush()

    expect(enableMock).toHaveBeenCalledWith("alpha", ["fs:project-read"])
    expect(disableMock).not.toHaveBeenCalled()
  })

  it("行内开关带可见尺寸的样式类（不能是隐形按钮）", async () => {
    listMock.mockResolvedValue([summary({ id: "alpha" })])
    await render()

    const toggle = host.querySelector('[role="switch"]') as HTMLElement | null
    expect(toggle).not.toBeNull()

    /*
     * 回归防线：这个开关曾经只挂 `className="model-switch"`，而那套样式定义在
     * 一个**没有全局引入**的 css 里 —— 结果它渲染出来了、能点，但零尺寸、看不见，
     * 用户截图里那一行只有「⋯」。
     * 现在样式写在组件里（Tailwind），这里断言它确实带了尺寸类。
     */
    const cls = toggle?.className ?? ""
    expect(cls).toContain("w-9")
    expect(cls).toContain("h-[21px]")
    expect(cls).not.toContain("model-switch")
  })

  it("卸载项收在「⋯」菜单里，并且是危险色（不会误点在开关旁边）", async () => {
    listMock.mockResolvedValue([summary({ id: "alpha" })])
    await render()

    // 默认不显示卸载（要先打开菜单）
    expect(host.querySelector('[data-plugin-row-action="uninstall"]')).toBeNull()

    const menuButton = host.querySelector('[data-plugin-row-menu="true"]') as HTMLButtonElement | null
    expect(menuButton).not.toBeNull()
    await act(async () => {
      menuButton?.click()
    })
    await flush()

    const uninstall = host.querySelector('[data-plugin-row-action="uninstall"]') as HTMLElement | null
    expect(uninstall).not.toBeNull()
    expect(uninstall?.className).toContain("text-destructive")
    expect(uninstall?.textContent).toContain("卸载")
  })

  it("没有能力摘要时不渲染那一行（不占位）", async () => {
    listMock.mockResolvedValue([
      summary({ id: "alpha", toolCount: 0, providerIds: [], grantedPermissions: [] }),
    ])
    await render()
    /*
     * 只在「已安装」那一行里查。整页断言会被内置插件分区的固定说明文字误伤
     * （"内置插件随软件提供…" 里就有"提供"两个字）。
     */
    const row = host.querySelector('[data-plugin-id="alpha"]') ?? host.querySelector("li")
    const rowText = row?.textContent ?? ""
    expect(rowText).not.toContain("提供")
    expect(rowText).not.toContain("已授权")
  })
})

describe("PluginCenterView：添加入口", () => {
  it("页头只有一个添加入口：没有「编辑插件」，也没有下拉里的重复安装项", async () => {
    await render()

    /*
     * 用户明确要求过：三个入口（编辑插件 / 添加插件 / 下拉里的两种安装方式）
     * 打开的是同一个对话框，属于重复。这里把它钉死，防止有人再加回来。
     */
    expect(buttonByText("编辑插件")).toBeNull()
    expect(buttonByText("安装第三方插件")).toBeNull()
    // 下拉箭头（aria-label="更多添加方式"）也不该存在
    expect(host.querySelector('[aria-label="更多添加方式"]')).toBeNull()

    // 唯一入口仍在
    expect(host.querySelector('[data-plugins-manual="true"]')).not.toBeNull()
  })

  it("点击唯一的「添加插件」打开对话框，对话框内可切换 GitHub / 本地目录", async () => {
    await render()
    const add = host.querySelector('[data-plugins-manual="true"]') as HTMLButtonElement | null
    expect(add).not.toBeNull()

    await act(async () => {
      add?.click()
    })
    await flush()

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    // 两种模式在对话框内部切换，不需要页头再给一个下拉
    expect(dialog?.textContent).toContain("GitHub")
    expect(dialog?.textContent).toContain("本地目录")
  })

  it("点击同一个入口只打开一个对话框（不会叠两个）", async () => {
    await render()
    const add = host.querySelector('[data-plugins-manual="true"]') as HTMLButtonElement | null
    await act(async () => {
      add?.click()
    })
    await flush()
    const first = document.querySelectorAll('[role="dialog"]').length
    expect(first).toBe(1)
  })

  it("「添加插件」主按钮打开同一个对话框，并保留 data-plugins-manual 标记", async () => {
    await render()
    const add = host.querySelector('[data-plugins-manual="true"]') as HTMLButtonElement | null
    expect(add).not.toBeNull()

    await act(async () => {
      add?.click()
    })
    await flush()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
})
