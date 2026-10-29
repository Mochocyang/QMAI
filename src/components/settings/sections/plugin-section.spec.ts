// @vitest-environment jsdom
/**
 * 插件卡片的判据与渲染。
 *
 * 前半段是纯函数（「设置」入口、状态徽章、启用确认档位），不必挂载整页；
 * 后半段挂载真实的 `PluginSection`，守的是三件事：
 *   - 崩溃原因能不能被用户看到（`lastError`：有值就必须出现红色小字，
 *     没值就不许留空段落，别的状态填了原因也照样显示）；
 *   - 崩溃后能不能**不擦掉原因**就重试（「重新启用」送的权限是什么）；
 *   - 启用确认层有没有把清单申请的权限展示出来、并按同一份授予。
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
  type PluginSectionProps,
} from "./plugin-section"
/*
 * 「插件」页（`plugin-center-view.tsx`）在**本文件**里挂载真实的 `PluginSection`：
 * 这一条验的不是某个组件单独的行为，而是「那一页有没有把重复的安装入口关掉」。
 * 放在这里而不是 `plugin-center-view.spec.tsx`，是因为本文件已经备好了插件管理区
 * 需要的全套桩（同步管道、插槽索引），那边只把 `PluginSection` 换成了空桩 ——
 * 再复制四份 mock 过来只为了一处集成断言，不划算。
 */
import { PluginCenterView } from "@/components/plugins/plugin-center-view"

// React 19 需要这个标记，act(...) 才不报警告（与仓库里其它组件 spec 一致）。
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const listMock = vi.hoisted(() => vi.fn())
// 启用命令的 spy：本期两个 bug 的验收点都在「传了哪些权限给 Rust」，
// 所以要能直接断言调用参数，而不是只看界面变化。
const enableMock = vi.hoisted(() => vi.fn())
// 卸载命令的 spy：用来验证「隐藏安装入口时，卸载失败的提示条仍然看得见」。
const uninstallMock = vi.hoisted(() => vi.fn())
// 市场命令的桩：「插件」页（集成用例）一挂载就会去读索引。
const marketIndexMock = vi.hoisted(() => vi.fn())
const marketInstallMock = vi.hoisted(() => vi.fn())

// 卡片挂载时只调 `pluginsApi.list`；启停/卸载等命令这些用例不点，给了桩只是为了
// 误触时显式失败，而不是掉进真实的 Tauri invoke。
vi.mock("@/lib/plugins/api", () => ({
  pluginsApi: {
    list: listMock,
    enable: enableMock,
    disable: vi.fn(),
    uninstall: uninstallMock,
    install: vi.fn(),
    installLocal: vi.fn(),
    marketIndex: marketIndexMock,
    marketInstall: marketInstallMock,
  },
}))

/*
 * 启停后的同步管道（provider / 工具 / 钩子清单）会去打真实的 Tauri 命令，
 * 与本期要验的「权限传对了没有」无关。统一换成成功的桩，让失败只可能来自
 * 被断言的路径（否则这里抛的错会和被测行为混在一起）。保留原模块的其余导出。
 */
vi.mock("@/lib/plugins/provider-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plugins/provider-sync")>()),
  syncPluginProviders: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/plugins/tool-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plugins/tool-sync")>()),
  syncPluginTools: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/plugins/hooks/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plugins/hooks/runtime")>()),
  syncPluginHooks: vi.fn().mockResolvedValue(undefined),
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
 * 卡片级用例的公共骨架
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

/**
 * 卡片用例的公共挂载骨架。
 *
 * 「崩溃原因」与「重新启用」两组用例需要同一套东西：干净宿主、等异步
 * `plugins_list` 把卡片渲染出来、按文案找按钮。抽成一份是因为挂载方式一旦变了
 * （比如列表改成别再拉一次），漏改的那一组会静默失效 —— 测试还在跑，只是什么都验不到。
 */
function cardTestBed() {
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
    enableMock.mockReset()
    // 默认成功：只有显式要验失败的用例才让 enable 拒绝。
    enableMock.mockResolvedValue(undefined)
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

  return { renderCard }
}

/** 在 `scope` 里按**精确文案**找按钮（「停用」「重新启用」只能靠文案区分）。 */
function findButton(scope: HTMLElement, label: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  )
  expect(button, `「${label}」按钮应存在`).toBeTruthy()
  return button!
}

/** `scope` 里所有按钮的文案。断言某按钮**不存在**时用，不必让 `findButton` 抛错。 */
function buttonLabels(scope: HTMLElement): string[] {
  return [...scope.querySelectorAll("button")].map((item) => item.textContent?.trim() ?? "")
}

/**
 * 点一个按钮，并等它的异步处理链跑完。
 *
 * 用 `dispatchEvent(new MouseEvent(..., { bubbles: true }))` 而不是 `element.click()`：
 * React 19 把事件委托挂在根容器上，仓库里其它组件 spec 也是这么点的。
 * 处理函数是 async（enable → 同步管道 → refresh），一轮微任务不够，所以多放几轮。
 */
async function clickButton(button: HTMLButtonElement, rounds = 20): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    for (let index = 0; index < rounds; index += 1) await Promise.resolve()
  })
}

describe("插件卡片的 lastError", () => {
  const { renderCard } = cardTestBed()

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

/* ------------------------------------------------------------------ *
 * 崩溃卡片的「重新启用」
 *
 * 背景：插件崩溃时 Rust **有意保留 `enabled = true`**，所以卡片显示的是「停用」。
 * 修复前用户只能先停用再启用，而停用会清掉 `lastError` —— 等于"想看崩溃原因
 * 就得先把它擦掉"。这个独立入口直接再启动一次，不动后端 `enabled` 语义。
 * ------------------------------------------------------------------ */

describe("崩溃卡片的「重新启用」", () => {
  const { renderCard } = cardTestBed()

  const CRASH_REASON = "插件意外退出（exit code: 3），已停止；重新启用可再试"

  /** 真实后端行为：崩溃后 `enabled` 仍是 true，卡片显示「停用」。 */
  function crashedPlugin(overrides: Partial<PluginSummary> = {}): PluginSummary {
    return pluginSummary({
      processState: "crashed",
      enabled: true,
      lastError: CRASH_REASON,
      ...overrides,
    })
  }

  it("crashed：渲染「重新启用」，且「停用」「卸载」仍在", async () => {
    const card = await renderCard(crashedPlugin({ grantedPermissions: ["fs:project-read"] }))

    expect(buttonLabels(card)).toContain("重新启用")
    // 「停用」必须保留：用户可能就是想让它别再来，不该被新按钮挤掉。
    expect(buttonLabels(card)).toContain("停用")
    expect(buttonLabels(card)).toContain("卸载")
  })

  it("running：不渲染「重新启用」（那是正常工作的插件）", async () => {
    const card = await renderCard(pluginSummary({ processState: "running", enabled: true }))

    expect(buttonLabels(card)).toContain("停用")
    expect(buttonLabels(card)).not.toContain("重新启用")
  })

  it("stopped（未启用）：不渲染「重新启用」，主按钮是「启用」", async () => {
    const card = await renderCard(pluginSummary({ processState: "stopped", enabled: false }))

    expect(buttonLabels(card)).toContain("启用")
    expect(buttonLabels(card)).not.toContain("重新启用")
  })

  it("点「重新启用」→ 传**已授予**的权限（不是空数组）", async () => {
    const card = await renderCard(
      crashedPlugin({ grantedPermissions: ["fs:project-read", "net:https"] }),
    )

    await clickButton(findButton(card, "重新启用"))

    expect(enableMock).toHaveBeenCalledTimes(1)
    expect(enableMock.mock.calls[0][0]).toBe("crashy")
    // 传 `[]` 等于「重试一次就把权限抹了」：`plugins_enable` 是整体覆盖。
    expect(enableMock.mock.calls[0][1]).toEqual(["fs:project-read", "net:https"])
    expect(enableMock.mock.calls[0][1]).not.toEqual([])
  })

  it("已授予为空但清单有申请（老数据/首次就崩）→ 退回 declaredPermissions", async () => {
    const card = await renderCard(
      crashedPlugin({ grantedPermissions: [], declaredPermissions: ["fs:project-read"] }),
    )

    await clickButton(findButton(card, "重新启用"))

    expect(enableMock).toHaveBeenCalledTimes(1)
    expect(enableMock.mock.calls[0][1]).toEqual(["fs:project-read"])
  })

  it("重试失败：就地显示 Rust 中文错误，崩溃原因仍然可见", async () => {
    const error = "E_HOST_INCOMPATIBLE: 插件要求 QMAI ^9.0.0，当前 1.0.0"
    enableMock.mockRejectedValueOnce(error)
    const card = await renderCard(crashedPlugin({ grantedPermissions: ["fs:project-read"] }))

    await clickButton(findButton(card, "重新启用"))

    const retryError = card.querySelector<HTMLElement>("[data-plugin-retry-error]")
    expect(retryError, "失败原因要落在卡片上，不能只进 toast").toBeTruthy()
    expect(retryError!.textContent).toContain(error)
    // 崩溃原因不能被这次失败擦掉：两条信息要并排可见（上次为什么崩 / 这次为什么仍不行）。
    expect(card.querySelector("[data-plugin-crash-reason]")?.textContent).toBe(CRASH_REASON)
    // 失败后按钮要回到可点状态，不能一直转圈。
    expect(buttonLabels(card)).toContain("重新启用")
  })
})

/* ------------------------------------------------------------------ *
 * Bug 2：启用确认层展示并授予清单里申请的权限
 *
 * 修复前这里是 `const granted: string[] = []` —— 界面从不展示申请列表，也从不授予，
 * 于是 `fs:project-read` 永不生效，所有 `/host/project/*` 与 `{{chapter.*}}` 动作都是死的。
 * ------------------------------------------------------------------ */

describe("启用确认层的权限", () => {
  const { renderCard } = cardTestBed()

  /** 未启用的插件 → 卡片主按钮是「启用」，点开确认对话框。 */
  async function openEnableDialog(overrides: Partial<PluginSummary> = {}): Promise<HTMLElement> {
    const card = await renderCard(
      pluginSummary({ enabled: false, processState: "stopped", ...overrides }),
    )
    await clickButton(findButton(card, "启用"))
    // 弹窗走 portal 挂到 document.body；用 ui/dialog 的稳定 data-slot 定位，不猜 role。
    const dialog = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]')
    expect(dialog, "点「启用」后应打开确认对话框").toBeTruthy()
    expect(
      dialog!.querySelector("[data-plugin-declared-permissions]"),
      "确认层必须有一段权限说明（不是盲授）",
    ).toBeTruthy()
    return dialog!
  }

  it("列出清单里申请的权限，并映射成中文", async () => {
    const dialog = await openEnableDialog({
      declaredPermissions: ["fs:project-read", "net:https"],
    })

    expect(dialog.textContent).toContain("该插件申请以下权限")
    expect(dialog.textContent).toContain("读取项目文件")
    expect(dialog.textContent).toContain("访问网络")
    expect(dialog.textContent).not.toContain("该插件不申请任何权限")
  })

  it("没有申请任何权限时明确说出来（不能留空让用户猜）", async () => {
    const dialog = await openEnableDialog({ declaredPermissions: [] })

    expect(dialog.textContent).toContain("该插件不申请任何权限")
  })

  it("确认启用 → 授予的正是展示的那份（不再是空数组）", async () => {
    await openEnableDialog({ declaredPermissions: ["fs:project-read"] })

    await clickButton(findButton(document.body, "确认启用"))

    expect(enableMock).toHaveBeenCalledTimes(1)
    expect(enableMock.mock.calls[0][0]).toBe("crashy")
    expect(enableMock.mock.calls[0][1]).toEqual(["fs:project-read"])
    // 显式钉住 bug 本身：修复前这里恒为 []。
    expect(enableMock.mock.calls[0][1]).not.toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * 安装入口的开关（`hideInstallForm`）
 *
 * 背景：「插件」页的「已安装」tab 直接复用本组件，而那一页右上角**已经有**
 * 「手动安装」——它与本组件自带的「从 GitHub 安装 / 从本地目录安装」是同一件事。
 * 两个入口并排出现在同一块屏幕上，用户会以为是两件不同的事，所以给了一个
 * 可选的 `hideInstallForm` 把自带的收起来。
 *
 * 这里守四件事：
 *   1. 默认（不传 prop）时安装区块必须**还在** —— 设置 → 插件 的行为一字不变；
 *   2. 关掉时只关安装入口，列表 / 启用停用 / 设置 / 卸载一个都不能跟着消失；
 *   3. 失败提示条**不**跟着关（停用、卸载失败也走那条，藏了就等于静默失败）；
 *   4. 空状态文案不能还指着已经不在屏上的输入框。
 * ------------------------------------------------------------------ */

/** 面板上一个"什么都有"的插件：声明了配置，所以「设置」按钮也该出现。 */
function panelPlugin(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return pluginSummary({
    id: "panel-plugin",
    name: "面板插件",
    enabled: true,
    processState: "running",
    preview: { hasConfig: true },
    ...overrides,
  })
}

/**
 * 面板级用例的挂载骨架。
 *
 * 与 `cardTestBed` 的区别：那个只给"一张卡片"，并固定以默认参数挂载；这里要
 * 比较**传 / 不传 `hideInstallForm`** 两种挂载，还要挂整个「插件」页，
 * 所以单独一份（避免给既有骨架加参数，把几十条已绿用例的挂载方式一起动到）。
 */
function panelTestBed() {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    listMock.mockReset()
    uninstallMock.mockReset()
    marketIndexMock.mockReset()
    marketInstallMock.mockReset()
    // 市场索引给空：本组用例不验市场，只要它别把页面卡在加载态。
    marketIndexMock.mockResolvedValue({
      plugins: [],
      fromCache: false,
      fetchedAt: null,
      sourceUrl: "",
    })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  /** 等某个选择器出现（异步 `plugins_list` 要跑几轮微任务）。 */
  async function waitForSelector(selector: string): Promise<HTMLElement> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const node = host.querySelector<HTMLElement>(selector)
      if (node) return node
      await act(async () => {
        await Promise.resolve()
      })
    }
    throw new Error(`没等到 ${selector}（plugins_list 的 mock 没被消费？）`)
  }

  /** 等某段文案出现。 */
  async function waitForText(fragment: string): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if ((host.textContent ?? "").includes(fragment)) return
      await act(async () => {
        await Promise.resolve()
      })
    }
    throw new Error(`没等到文案「${fragment}」`)
  }

  /** 渲染设置页里的插件管理区；`hideInstallForm === undefined` 表示**不传**这个 prop。 */
  async function renderSection(hideInstallForm?: boolean): Promise<void> {
    listMock.mockResolvedValue([panelPlugin()])
    const props: PluginSectionProps = {}
    if (hideInstallForm !== undefined) props.hideInstallForm = hideInstallForm
    await act(async () => {
      /*
       * 显式给 `createElement` 一个类型参数：`PluginSection` 的签名带默认值
       * （`props = {}`，见组件注释），props 类型推不出来，省略时 tsc 会落到
       * 最后一个重载上并报「`hideInstallForm` 不属于 Attributes」。
       */
      root.render(createElement<PluginSectionProps>(PluginSection, props))
    })
  }

  /** 渲染完整的「插件」页（市场 + 已安装），默认停在市场 tab。 */
  async function renderPluginCenter(): Promise<void> {
    listMock.mockResolvedValue([panelPlugin()])
    await act(async () => {
      root.render(createElement(PluginCenterView))
    })
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  return { host: () => host, root: () => root, renderSection, renderPluginCenter, waitForSelector, waitForText }
}

describe("hideInstallForm：自带的安装入口可以关掉", () => {
  const { host, root, renderSection, waitForSelector } = panelTestBed()

  it("默认（不传 prop）：安装区块照旧在（设置 → 插件 行为不变）", async () => {
    await renderSection()
    const card = await waitForSelector('[data-plugin-id="panel-plugin"]')
    expect(card, "插件卡片应正常渲染").toBeTruthy()

    // 输入框、两个按钮、说明文字，一样都不能少
    expect(host().querySelector("#plugin-install-source"), "默认必须保留 GitHub 地址输入框").not.toBeNull()
    expect(buttonLabels(host())).toContain("从本地目录安装")
    expect(host().textContent).toContain(
      "用于安装你本机正在开发的插件目录。目录根下需要有 plugin.json。",
    )
  })

  it("hideInstallForm：安装区块整块消失，列表与启停/设置/卸载一个不少", async () => {
    await renderSection(true)
    const card = await waitForSelector('[data-plugin-id="panel-plugin"]')

    // ① 安装入口整块不在：输入框、两个按钮、说明文字
    expect(host().querySelector("#plugin-install-source")).toBeNull()
    expect(buttonLabels(host())).not.toContain("从本地目录安装")
    expect(host().textContent).not.toContain("从 GitHub 安装")
    expect(host().textContent).not.toContain("用于安装你本机正在开发的插件目录")

    // ② 管理功能一个都不能跟着消失（藏的是入口，不是能力）
    expect(buttonLabels(card)).toContain("设置")
    expect(buttonLabels(card)).toContain("停用")
    expect(buttonLabels(card)).toContain("卸载")
  })

  it("hideInstallForm 也不隐藏失败提示条：卸载失败的原因仍然看得见", async () => {
    // `actionError` 不只承载安装失败 —— 停用/卸载失败也写在这条上。
    // 把它跟安装表单一起藏掉，用户点了「卸载」失败后会面对一片安静。
    const message = "E_IO: 无法删除插件目录（权限不足）"
    uninstallMock.mockRejectedValueOnce(message)
    vi.stubGlobal("confirm", () => true)
    await renderSection(true)
    const card = await waitForSelector('[data-plugin-id="panel-plugin"]')

    await clickButton(findButton(card, "卸载"))

    const alert = host().querySelector<HTMLElement>('[role="alert"]')
    expect(alert, "卸载失败必须留下一条可读的错误条").toBeTruthy()
    expect(alert!.textContent).toContain(message)
  })

  it("hideInstallForm 且一个插件都没有：空状态指向页面上的「手动安装」", async () => {
    listMock.mockResolvedValue([])
    await act(async () => {
      root().render(createElement<PluginSectionProps>(PluginSection, { hideInstallForm: true }))
    })
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if ((host().textContent ?? "").includes("还没有安装插件")) break
      await act(async () => {
        await Promise.resolve()
      })
    }

    expect(host().textContent).toContain(
      "还没有安装插件。用页面上的「手动安装」粘贴 GitHub 地址，或选一个本地目录。",
    )
    // 不能还让人"粘贴一个 GitHub 仓库地址开始"：那个输入框已经不在这一屏上了。
    expect(host().textContent).not.toContain("粘贴一个 GitHub 仓库地址开始")
  })
})

/* ------------------------------------------------------------------ *
 * 集成：「插件」页的「已安装」tab 不能同时出现两个安装入口
 *
 * 这就是本任务要修的那个缺陷本身 —— 上面几条验的是组件**自己**的开关，
 * 这一条验的是那一页**真的把开关拨了**（且没有把管理功能一起拨掉）。
 *
 * 为什么用真实的 `PluginSection`：如果这里也用桩，"tab 渲染了 PluginSection"
 * 和"PluginSection 会藏表单"两件事各自为真，合起来却可能没生效（比如
 * 忘了传 prop）。只有把两者接起来挂一次，才能覆盖缺陷的真实形状。
 * ------------------------------------------------------------------ */

describe("「插件」页的「已安装」tab：真实 PluginSection，只有一个安装入口", () => {
  const { host, renderPluginCenter, waitForSelector } = panelTestBed()

  it("渲染插件列表，但不含它自带的安装输入框；安装入口只剩页头的「手动安装」", async () => {
    await renderPluginCenter()

    const tab = host().querySelector<HTMLButtonElement>('[data-plugin-tab="installed"]')
    expect(tab, "插件页应有「已安装」tab").toBeTruthy()
    await act(async () => {
      tab!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    // 管理能力在：插件卡片照常渲染
    const card = await waitForSelector('[data-plugin-id="panel-plugin"]')
    expect(buttonLabels(card)).toContain("停用")

    // 缺陷面：那一页不该再有 `PluginSection` 自带的安装表单
    expect(host().querySelector("#plugin-install-source")).toBeNull()
    expect(buttonLabels(host())).not.toContain("从本地目录安装")
    expect(host().textContent).not.toContain("从 GitHub 安装")

    // 唯一的安装入口：页头的「手动安装」
    expect(host().querySelector('[data-plugins-manual="true"]')).not.toBeNull()
  })
})

