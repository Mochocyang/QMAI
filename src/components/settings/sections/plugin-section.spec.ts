// @vitest-environment jsdom
/**
 * 插件卡片的判据与渲染。
 *
 * 前半段是纯函数（「设置」入口、状态徽章、启用确认档位），不必挂载整页；
 * 后半段挂载真实的 `PluginSection`，守的是「崩溃原因能不能被用户看到」：
 *   - `crashed` + 有 `lastError` → 徽章下方必须出现那段红色小字；
 *   - `crashed` + 没有 `lastError` → 只显示徽章，不许留一个空段落；
 *   - 其它状态没有 `lastError` 时同样不许渲染（后端将来为别的状态填了原因，
 *     这一条通用渲染也要自动生效）。
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PluginSummary } from "@/lib/plugins/types"
import {
  PROCESS_STATE_BADGES,
  PluginSection,
  enableConfirmTone,
  hasPluginConfig,
  previewConfigSchema,
} from "./plugin-section"

// React 19 需要这个标记，act(...) 才不报警告（与仓库里其它组件 spec 一致）。
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const listMock = vi.hoisted(() => vi.fn())

// 卡片挂载时只调 `pluginsApi.list`；启停/卸载等命令这些用例不点，给了桩只是为了
// 误触时显式失败，而不是掉进真实的 Tauri invoke。
vi.mock("@/lib/plugins/api", () => ({
  pluginsApi: {
    list: listMock,
    enable: vi.fn(),
    disable: vi.fn(),
    uninstall: vi.fn(),
    install: vi.fn(),
    installLocal: vi.fn(),
  },
}))

// 插槽索引走真实实现会去打 Tauri 命令（jsdom 里没有宿主）：这里给一个空索引，
// 让测试只关心插件列表卡片本身，不被「插件能力」区的加载状态干扰。
vi.mock("@/lib/plugins/declarative/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plugins/declarative/api")>()
  const { emptySlotIndex } = await import("@/lib/plugins/slots")
  return {
    ...actual,
    usePluginSlotIndex: () => ({
      index: emptySlotIndex(),
      loading: false,
      degraded: false,
      reload: () => {},
    }),
  }
})

describe("hasPluginConfig", () => {
  it("preview.hasConfig === true 才显示设置入口", () => {
    expect(hasPluginConfig({ preview: { hasConfig: true } })).toBe(true)
  })

  it("没有 preview / 形状不认识 / 非布尔真值 → 不显示", () => {
    expect(hasPluginConfig({ preview: undefined })).toBe(false)
    expect(hasPluginConfig({ preview: null })).toBe(false)
    expect(hasPluginConfig({ preview: [] })).toBe(false)
    expect(hasPluginConfig({ preview: "hasConfig" })).toBe(false)
    expect(hasPluginConfig({ preview: {} })).toBe(false)
    expect(hasPluginConfig({ preview: { hasConfig: "true" } })).toBe(false)
    expect(hasPluginConfig({ preview: { hasConfig: false } })).toBe(false)
  })
})

describe("previewConfigSchema", () => {
  it("取出 preview.configSchema", () => {
    const schema = { type: "object", properties: { apiKey: { type: "string" } } }
    expect(previewConfigSchema({ preview: { hasConfig: true, configSchema: schema } })).toBe(schema)
  })

  it("缺失或 preview 不是对象时返回 undefined（ConfigForm 会显示「没有可配置项」）", () => {
    expect(previewConfigSchema({ preview: undefined })).toBeUndefined()
    expect(previewConfigSchema({ preview: {} })).toBeUndefined()
    expect(previewConfigSchema({ preview: [1, 2] })).toBeUndefined()
  })
})

/**
 * `declarative`（Rust `1310f37a` 起）必须有一枚**自己的**徽章。
 *
 * 这条测试守的是那个已经踩过的坑：缺键时 `?? stopped` 兜底不崩，界面照渲染，
 * 只是把"不需要进程"错报成"已停止" —— 用户会以为启用失败。所以断言的重点不是
 * "有标签"，而是"颜色不能与停止态相同"。
 */
describe("PROCESS_STATE_BADGES.declarative", () => {
  it("有独立标签，且不会被误读成停止", () => {
    const badge = PROCESS_STATE_BADGES.declarative
    expect(badge).toBeDefined()
    expect(badge.label.trim()).not.toBe("")
    expect(badge.label).not.toBe(PROCESS_STATE_BADGES.stopped.label)
  })

  it("配色与 stopped 不同，也不是纯灰底（灰 = 没跑起来的语义）", () => {
    expect(PROCESS_STATE_BADGES.declarative.className).not.toBe(
      PROCESS_STATE_BADGES.stopped.className,
    )
    // 停止态用 bg-muted / text-muted-foreground；声明式一档不许复用它们。
    expect(PROCESS_STATE_BADGES.declarative.className).not.toContain("bg-muted")
    expect(PROCESS_STATE_BADGES.declarative.className).not.toContain("text-muted-foreground")
  })

  it("六个进程态都还在，union 加了 declarative 也没顺手删旧的", () => {
    expect(Object.keys(PROCESS_STATE_BADGES).sort()).toEqual(
      ["crashed", "declarative", "disabled_by_crash", "failed", "running", "starting", "stopped"].sort(),
    )
  })
})

/**
 * 启用确认层的三档：provider（最高危）> default（有工具）> declarative（纯声明）。
 * 档位判据只读 `plugins_list` 的字段，缺字段按"没有该项能力"处理。
 */
describe("enableConfirmTone", () => {
  it("声明了 provider → provider 档（哪怕同时有工具）", () => {
    expect(enableConfirmTone({ providerIds: ["wb-connect"], toolCount: 3 })).toBe("provider")
    expect(enableConfirmTone({ providerIds: ["wb-connect"], toolCount: 0 })).toBe("provider")
  })

  it("没有 provider 但有工具 → default 档", () => {
    expect(enableConfirmTone({ providerIds: [], toolCount: 2 })).toBe("default")
    expect(enableConfirmTone({ providerIds: undefined, toolCount: 1 })).toBe("default")
  })

  it("既没有 provider 也没有工具 → 最轻的 declarative 档", () => {
    expect(enableConfirmTone({ providerIds: [], toolCount: 0 })).toBe("declarative")
    expect(enableConfirmTone({ providerIds: undefined, toolCount: 0 })).toBe("declarative")
    // 空数组与缺失同义：Rust 侧两种都可能出现，不能一个走 default 一个走 declarative。
    expect(enableConfirmTone({ providerIds: undefined, toolCount: 0 })).toBe(
      enableConfirmTone({ providerIds: [], toolCount: 0 }),
    )
  })
})

/* ------------------------------------------------------------------ *
 * 崩溃原因（`lastError`）在卡片上的呈现
 * ------------------------------------------------------------------ */

/** 一条最小的 `plugins_list` 返回项；各用例只覆盖自己关心的字段。 */
function pluginSummary(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: "crashy",
    name: "崩溃插件",
    version: "1.0.0",
    description: "",
    enabled: true,
    processState: "stopped",
    grantedPermissions: [],
    toolCount: 0,
    sourceRepo: "https://github.com/owner/repo",
    sourceCommit: "main",
    ...overrides,
  }
}

describe("插件卡片的 lastError", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    listMock.mockReset()
  })

  /** 挂载整页（只给一个插件），等异步 `plugins_list` 把卡片渲染出来。 */
  async function renderCard(plugin: PluginSummary): Promise<HTMLElement> {
    listMock.mockResolvedValue([plugin])
    await act(async () => {
      root.render(createElement(PluginSection))
    })
    // `list()` 是异步的：effect 里的 promise 链跑完卡片才会出现，多放几轮微任务。
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const card = host.querySelector<HTMLElement>(`[data-plugin-id="${plugin.id}"]`)
      if (card) return card
      await act(async () => {
        await Promise.resolve()
      })
    }
    throw new Error("插件卡片没有渲染出来（plugins_list 的 mock 没被消费？）")
  }

  function findButton(card: HTMLElement, label: string): HTMLButtonElement {
    const button = [...card.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === label,
    )
    expect(button, `卡片上应有「${label}」按钮`).toBeTruthy()
    return button!
  }

  it("crashed 且有 lastError：徽章下方渲染退出原因", async () => {
    const reason = "插件意外退出（exit code: 3），已停止；重新启用可再试"
    // 真实后端行为：崩溃后 enabled 仍是 true（Rust 有意不改），所以卡片显示「停用」。
    const card = await renderCard(
      pluginSummary({ processState: "crashed", enabled: true, lastError: reason }),
    )

    expect(card.textContent).toContain("异常退出")
    const reasonNode = card.querySelector<HTMLElement>("[data-plugin-crash-reason]")
    expect(reasonNode, "crashed 时必须渲染 data-plugin-crash-reason").toBeTruthy()
    expect(reasonNode!.textContent).toBe(reason)
    // 红色小字：与「运行中」的正向颜色区分开
    expect(reasonNode!.className).toContain("text-destructive")
  })

  it("crashed 但没有 lastError：只显示徽章，不渲染空段落", async () => {
    const card = await renderCard(
      pluginSummary({ processState: "crashed", enabled: true, lastError: null }),
    )

    expect(card.textContent).toContain("异常退出")
    expect(card.querySelector("[data-plugin-crash-reason]")).toBeNull()
    // 「没有值」不能退化成一个空 <p>：卡片上会多出一段无意义的留白。
    const paragraphs = [...card.querySelectorAll("p")]
    expect(paragraphs.every((p) => (p.textContent ?? "").trim() !== "")).toBe(true)
  })

  it("running 且没有 lastError：不渲染原因", async () => {
    const card = await renderCard(
      pluginSummary({ processState: "running", enabled: true, lastError: undefined }),
    )

    expect(card.textContent).toContain("运行中")
    expect(card.querySelector("[data-plugin-crash-reason]")).toBeNull()
  })

  it("非 crashed 状态只要后端给了 lastError 也照样显示（通用渲染）", async () => {
    // 后端目前只在 crashed 时填这个字段，但界面不该把渲染锁死在崩溃分支：
    // 将来为 failed 等状态补原因时，这条卡片不用再改一次。
    const card = await renderCard(
      pluginSummary({
        processState: "failed",
        enabled: false,
        lastError: "启动失败：缺少 runtime.entry 指向的文件",
      }),
    )

    expect(card.querySelector("[data-plugin-crash-reason]")?.textContent).toBe(
      "启动失败：缺少 runtime.entry 指向的文件",
    )
  })

  it("「启用」按钮带重试提示（崩溃后先停再启用时也看得到）", async () => {
    const card = await renderCard(pluginSummary({ processState: "stopped", enabled: false }))
    // 崩溃后 `lastError` 会被下一次停用清掉，因此这句提示不能绑在 lastError 上。
    expect(findButton(card, "启用").title).toContain("重新启用会再试一次")
  })
})

