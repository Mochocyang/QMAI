// @vitest-environment jsdom
/**
 * 设置页「插件 provider」运行期卡片的形状 + 交互测试（T4 / S2）。
 *
 * 两类断言，各自防一种典型回归：
 *   1. **视图 → preset**：`preset.id` / `preset.provider` 必须是 provider id
 *      （`providerConfigs` 的键、模型复合键 `providerId/modelId` 的前缀，设计 D1）；
 *      未就绪的 provider 也必须得到一张卡片（灰显 + lastError），不能从列表里消失。
 *   2. **能力位 → 按钮**：`capabilities` 缺哪个就**不渲染**哪个按钮；登录按钮的
 *      三种分支（不需要登录 / 有设置页 / 没设置页）各走各的路，不许互相冒充。
 *
 * 为什么用 `createElement` 而不是 JSX：本文件是 `.spec.ts`（与库函数测试同一份），
 * 而仓库没装 testing-library，组件测试统一走 `createRoot + act`（见
 * `cloud-sync-indicator.dismiss.spec.tsx`）。
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// 卡片只依赖两个外部面：Tauri 命令封装与 provider 快照同步。
// 都 mock 掉，测试就只验证「点击 → 调了哪个命令、界面说了什么」。
vi.mock("@/lib/plugins/api", () => ({
  pluginsApi: {
    refreshProviderModels: vi.fn(async () => []),
    providerOpenLogin: vi.fn(async () => undefined),
    providerCall: vi.fn(async () => ({})),
    submitProviderCredential: vi.fn(async () => ({ ok: true })),
    // v3：账号状态走插件的 get_account 工具（invokeTool 通道）。
    invokeTool: vi.fn(async () => ""),
  },
}))
vi.mock("@/lib/plugins/provider-sync", () => ({
  syncPluginProviders: vi.fn(async () => ({ added: [], removed: [] })),
}))
// `import-file` 的两个真实依赖（文件对话框 + 读文件）：在 jsdom 里都没有，必须打桩。
// 打桩的位置就是卡片的两个动态 import —— 用例因此可以走完「选文件 → 量大小 → 读内容
// → 提交」的整条真实路径，而不是只验证"按钮存在"。
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }))
vi.mock("@/commands/fs", () => ({
  getFileSize: vi.fn(async () => 0),
  readFile: vi.fn(async () => ""),
}))
/*
 * 测试连接/测试功能必须打桩：真实实现会走 `streamChat`（网络 + 流式解析）。
 * 这里要断言的是"调了几次、传了什么配置、结果怎么展示"，探针本身不是卡片的事。
 */
const { testLlmConnectionMock, testLlmFunctionMock } = vi.hoisted(() => ({
  testLlmConnectionMock: vi.fn<(cfg: LlmConfig) => Promise<{ ok: boolean; message: string }>>(),
  testLlmFunctionMock: vi.fn<(cfg: LlmConfig) => Promise<{ ok: boolean; message: string }>>(),
}))
vi.mock("@/lib/connection-tests", () => ({
  testLlmConnection: testLlmConnectionMock,
  testLlmFunction: testLlmFunctionMock,
}))
/*
 * ContextSizeSelector / OutputTokensSelector 内部用 react-i18next；本文件不搭 i18n
 * 实例，按仓库惯例 mock 成「key 即文案」（同 context-size-selector.spec.tsx）。
 */
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { open as openFileDialog } from "@tauri-apps/plugin-dialog"
import { getFileSize, readFile } from "@/commands/fs"
import { pluginsApi } from "@/lib/plugins/api"
import {
  getPluginProviderOverride,
  setPluginProviderOverride,
  __resetPluginProviderOverrideCacheForTests,
} from "@/lib/plugins/provider-overrides"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import {
  formatContextTokens,
  MAX_CREDENTIAL_FILE_BYTES,
  parseAccountInfo,
  PluginProviderCard,
  formatModelCost,
  parseBalance,
  parseCheckin,
  toPluginProviderPreset,
  type PluginProviderPreset,
} from "./plugin-provider-card"
import type { PluginProviderModel, PluginProviderView } from "@/lib/plugins/types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const providerOpenLogin = vi.mocked(pluginsApi.providerOpenLogin)
const providerCall = vi.mocked(pluginsApi.providerCall)
const submitProviderCredential = vi.mocked(pluginsApi.submitProviderCredential)
const openDialog = vi.mocked(openFileDialog)
const mockGetFileSize = vi.mocked(getFileSize)
const mockReadFile = vi.mocked(readFile)

function model(overrides: Partial<PluginProviderModel> = {}): PluginProviderModel {
  return {
    id: "glm-5.3",
    name: "GLM-5.3",
    maxInputTokens: 1_000_000,
    maxOutputTokens: 8192,
    supportsToolCall: true,
    supportsVision: false,
    ...overrides,
  }
}

function view(overrides: Partial<PluginProviderView> = {}): PluginProviderView {
  return {
    pluginId: "wb-plugin",
    providerId: "wb-connect",
    name: "插件样例直连",
    baseUrl: "http://127.0.0.1:43210",
    authKind: "none",
    capabilities: [],
    models: [model()],
    ready: true,
    ...overrides,
  }
}

describe("toPluginProviderPreset", () => {
  it("用 provider id 当 preset id 与 provider，并带上插件来源", () => {
    const preset = toPluginProviderPreset(view())

    expect(preset.id).toBe("wb-connect")
    expect(preset.provider).toBe("wb-connect")
    expect(preset.label).toBe("插件样例直连")
    // 卡片小字：用户必须能看出「谁在收我的数据」（设计 §7 第 3 条）。
    expect(preset.hint).toBe("来自插件 wb-plugin")
    expect(preset.pluginId).toBe("wb-plugin")
    expect(preset.ready).toBe(true)
    expect(preset.models).toHaveLength(1)
  })

  it("名字为空时退回 provider id，避免出现一张没有标题的卡片", () => {
    expect(toPluginProviderPreset(view({ name: "" })).label).toBe("wb-connect")
  })

  it("未就绪的 provider 仍然产出卡片，并带上失败原因", () => {
    const preset = toPluginProviderPreset(view({ ready: false, lastError: "健康检查超时（10s）" }))

    expect(preset.ready).toBe(false)
    expect(preset.lastError).toBe("健康检查超时（10s）")
  })

  it("能力位与设置页原样带出（按钮渲染完全靠它们，不能在这里补默认值）", () => {
    const preset = toPluginProviderPreset(
      view({ capabilities: ["models.refresh", "balance.query"], settingsPage: "/setup" }),
    )

    expect(preset.capabilities).toEqual(["models.refresh", "balance.query"])
    expect(preset.settingsPage).toBe("/setup")
  })
})

describe("第三方返回值的归一化", () => {
  it("balance 合法结构 → 逐行取出", () => {
    expect(parseBalance({ items: [{ label: "积分", value: "1,234" }, { label: "额度", value: 42 }] })).toEqual([
      { label: "积分", value: "1,234" },
      { label: "额度", value: "42" },
    ])
  })

  it("balance 空 items 仍算合法（插件确实没有余额项），与结构错区分开", () => {
    expect(parseBalance({ items: [] })).toEqual([])
  })

  it("balance 结构错 → undefined（不抛，交给界面说「无法识别」）", () => {
    expect(parseBalance({ items: "nope" })).toBeUndefined()
    expect(parseBalance({ items: [{ label: "积分" }] })).toBeUndefined()
    expect(parseBalance(null)).toBeUndefined()
    expect(parseBalance("字符串")).toBeUndefined()
  })

  it("checkin 缺 message 时兜底文案不能是空的", () => {
    expect(parseCheckin({ ok: true })).toEqual({ ok: true, message: "已签到" })
    expect(parseCheckin({ ok: false })?.message).toContain("签到失败")
    expect(parseCheckin({ ok: "yes" })).toBeUndefined()
  })

  it("成本小字的单位是每百万 token，且不带货币符号（货币由插件定义）", () => {
    expect(formatModelCost({ input: 2, output: 8 })).toBe("2/8 /1M tokens")
    expect(formatModelCost({ output: 8 })).toBe("–/8 /1M tokens")
    expect(formatModelCost({})).toBeUndefined()
    expect(formatModelCost(undefined)).toBeUndefined()
  })
})

describe("PluginProviderCard", () => {
  let host: HTMLDivElement
  let root: Root

  function renderCard(overrides: Partial<PluginProviderPreset> = {}): PluginProviderPreset {
    const preset: PluginProviderPreset = { ...toPluginProviderPreset(view()), ...overrides }
    act(() => {
      root.render(
        createElement(PluginProviderCard, {
          preset,
          expanded: true,
          onToggle: () => {},
          resolveModelConfig: resolveMock,
        }),
      )
    })
    return preset
  }

  function find(selector: string): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(selector)
  }

  async function click(element: HTMLElement) {
    await act(async () => {
      element.click()
    })
  }

  /**
   * 给受控 input 赋值。
   *
   * 必须走**原生 setter + 派发 `input` 事件**：直接 `input.value = "x"` 只改了 DOM 属性，
   * React 的 value tracker 会认为"值没变"而吞掉 onChange，`useState` 永远是空的 ——
   * 那样的用例会以"按钮一直禁用"的形式假通过（或假失败），根本测不到提交路径。
   */
  async function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    await act(async () => {
      setter?.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
  })

  /* ---- 1) 登录：authKind === "none" ---- */
  it("authKind=none：不调命令，只说「不需要登录」", async () => {
    renderCard({ authKind: "none" })

    const button = find('[data-plugin-action="login"]')!
    expect(button.disabled).toBe(false)
    await click(button)

    expect(providerOpenLogin).not.toHaveBeenCalled()
    expect(host.textContent).toContain("不需要登录")
  })

  /* ---- 2) 登录：有设置页 → 真的打开受控窗口 ---- */
  it("browser-login + 有 settingsPage：点一次只调一次 plugins_provider_open_login", async () => {
    renderCard({ authKind: "browser-login", settingsPage: "/setup" })

    await click(find('[data-plugin-action="login"]')!)

    expect(providerOpenLogin).toHaveBeenCalledTimes(1)
    expect(providerOpenLogin).toHaveBeenCalledWith("wb-connect")
    expect(host.textContent).toContain("登录窗口已打开")
  })

  it("打开期间按钮进入 loading，避免重复点击发出第二个窗口", async () => {
    let release: () => void = () => {}
    providerOpenLogin.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve()
        }),
    )
    renderCard({ authKind: "browser-login", settingsPage: "/setup" })

    const button = find('[data-plugin-action="login"]')!
    await click(button)

    expect(button.textContent).toContain("打开中")
    expect(button.disabled).toBe(true)
    await click(button)
    expect(providerOpenLogin).toHaveBeenCalledTimes(1)

    await act(async () => release())
  })

  it("打开失败：Rust 的中文原文原样展示，不吞成「操作失败」", async () => {
    providerOpenLogin.mockRejectedValueOnce("插件未声明 authDomains，已拒绝打开登录窗口")
    renderCard({ authKind: "browser-login", settingsPage: "/setup" })

    await click(find('[data-plugin-action="login"]')!)

    expect(host.textContent).toContain("插件未声明 authDomains，已拒绝打开登录窗口")
  })

  /*
   * 兼容 Rust 的两种返回时机：命令「窗口打开即 resolve」→ 说「窗口已打开」；
   * 「等关窗才 resolve」→ 那句就不成立了（窗口早关掉了），改说「登录流程已结束」。
   * 只 fake 定时器与 Date，不 fake queueMicrotask —— React 的 act 依赖真微任务。
   */
  it("命令超过 3 秒才 resolve：改报中性文案，不谎称窗口还开着", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] })
    try {
      providerOpenLogin.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 4000)
          }),
      )
      renderCard({ authKind: "browser-login", settingsPage: "/setup" })

      const button = find('[data-plugin-action="login"]')!
      await act(async () => {
        button.click()
      })
      expect(button.textContent).toContain("打开中")

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })

      expect(host.textContent).toContain("登录流程已结束")
      expect(host.textContent).not.toContain("登录窗口已打开")
    } finally {
      vi.useRealTimers()
    }
  })

  /* ---- 3) 登录：没有设置页 → 禁用 + tooltip ---- */
  it("authKind 需要登录但没声明 settingsPage：按钮禁用并给出原因", async () => {
    renderCard({ authKind: "browser-login" })

    const button = find('[data-plugin-action="login"]')!
    expect(button.disabled).toBe(true)
    expect(button.getAttribute("title")).toContain("settingsPagePath")
    await click(button)
    expect(providerOpenLogin).not.toHaveBeenCalled()
  })

  /* ---- 4) 能力位缺了就整块不渲染（「刷新模型」是例外） ---- */
  it("没有 balance.query / checkin：不渲染对应按钮（不用灰色占位骗人）", () => {
    renderCard({ capabilities: ["models.refresh"] })

    expect(find('[data-plugin-action="balance"]')).toBeNull()
    expect(find('[data-plugin-action="checkin"]')).toBeNull()
    // 拉取模型按钮照旧在：它本来就不受能力位门控（v3 起头部不再有第二个「刷新模型」入口）。
    expect(find('[data-plugin-action="pull-models"]')).toBeTruthy()
  })

  it("一个能力位都没有：余额/签到不渲染，但「刷新模型」仍然显示（宿主自己的能力）", () => {
    renderCard({ capabilities: [], models: [] })

    expect(find('[data-plugin-action="balance"]')).toBeNull()
    expect(find('[data-plugin-action="checkin"]')).toBeNull()
    // /v1/models 是 provider 契约的必需端点（设计 §3.1）：拉取不需要插件声明任何东西。
    expect(find('[data-plugin-action="pull-models"]')).toBeTruthy()
    /*
     * 模型区不能留白：没模型时要明说下一步。
     * 这个默认视图是 authKind=none（不需要登录），所以引导是"去拉取"；
     * "登录后会自动拉取模型"那句只在需要登录的插件上出现（见第 7 组用例）。
     */
    expect(host.textContent).toContain("先点「拉取模型」")
  })

  it("models.refresh 只剩向后兼容语义：写着不报错，但不再驱动任何按钮", () => {
    // 有它和没它渲染出的按钮集合必须完全一致；不一致就说明 UI 又在读这个能力位了。
    renderCard({ capabilities: [] })
    const without = [...host.querySelectorAll("[data-plugin-action]")].map((el) =>
      el.getAttribute("data-plugin-action"),
    )

    act(() => root.unmount())
    root = createRoot(host)
    renderCard({ capabilities: ["models.refresh"] })
    const withCapability = [...host.querySelectorAll("[data-plugin-action]")].map((el) =>
      el.getAttribute("data-plugin-action"),
    )

    expect(withCapability).toEqual(without)
  })

  /* ---- 5) 余额：点了调哪个端点 ---- */
  it("有 balance.query：点余额调 providerCall，端点固定为 /v1/_qmai/balance", async () => {
    providerCall.mockResolvedValueOnce({ items: [{ label: "积分", value: "1,234" }] })
    renderCard({ capabilities: ["balance.query"] })

    await click(find('[data-plugin-action="balance"]')!)

    expect(providerCall).toHaveBeenCalledTimes(1)
    expect(providerCall).toHaveBeenCalledWith("wb-connect", "/v1/_qmai/balance")
    expect(host.querySelector("[data-plugin-balance]")?.textContent).toContain("积分 1,234")
  })

  /* ---- 6) 畸形结构：显示「无法识别」而不是崩 ---- */
  it("providerCall 返回畸形结构：显示「无法识别」，界面继续可用", async () => {
    providerCall.mockResolvedValueOnce({ items: "不是数组" })
    renderCard({ capabilities: ["balance.query"] })

    await click(find('[data-plugin-action="balance"]')!)

    expect(host.querySelector("[data-plugin-balance]")?.textContent).toContain("无法识别")
    // 崩没崩：按钮还在，且能再点一次。
    expect(find('[data-plugin-action="balance"]')?.disabled).toBe(false)
  })

  it("providerCall 失败：把 Rust 的错误原文显示出来", async () => {
    providerCall.mockRejectedValueOnce("插件未实现 /v1/_qmai/balance")
    renderCard({ capabilities: ["balance.query"] })

    await click(find('[data-plugin-action="balance"]')!)

    expect(host.querySelector("[data-plugin-balance]")?.textContent).toContain("插件未实现 /v1/_qmai/balance")
  })

  it("有 checkin：点签到调 /v1/_qmai/checkin 并展示插件给的 message", async () => {
    providerCall.mockResolvedValueOnce({ ok: true, message: "首次签到 +10 积分" })
    renderCard({ capabilities: ["checkin"] })

    await click(find('[data-plugin-action="checkin"]')!)

    expect(providerCall).toHaveBeenCalledWith("wb-connect", "/v1/_qmai/checkin")
    expect(host.textContent).toContain("首次签到 +10 积分")
  })

  it("签到返回缺 ok：显示「无法识别」而不是当成成功", async () => {
    providerCall.mockResolvedValueOnce({ message: "打卡成功" })
    renderCard({ capabilities: ["checkin"] })

    await click(find('[data-plugin-action="checkin"]')!)

    expect(host.textContent).toContain("无法识别")
  })

  /* ---- 7) 模型成本与模态 ---- */
  it("模型有 cost：chip 上显示「输入/输出 /1M tokens」", () => {
    renderCard({ models: [model({ cost: { input: 2, output: 8 } })] })

    /*
     * v2.1 起模型区从「插件报的全部模型」变成「用户勾选的 chips」：没勾过 = 全选
     * （覆盖表语义），所以默认那条 models 仍会出现在 chip 上，成本小字也跟着搬过来。
     */
    expect(host.querySelector('[data-plugin-chip="glm-5.3"]')).toBeTruthy()
    const cost = host.querySelector("[data-model-cost]")
    expect(cost?.textContent).toContain("2/8")
    expect(cost?.textContent).toContain("/1M tokens")
  })

  it("模型没有 cost：什么都不显示，也不占位", () => {
    renderCard({ models: [model()] })

    expect(host.querySelector("[data-model-cost]")).toBeNull()
    expect(host.querySelector("[data-model-input-modality]")).toBeNull()
  })

  it("inputModalities 含 image：加一个「支持图片」小标记", () => {
    renderCard({ models: [model({ inputModalities: ["text", "image"] })] })

    expect(host.querySelector("[data-model-input-modality]")?.textContent).toContain("支持图片")
  })

  /* ---- 8) paste-token：输入框 + 保存 ---- */
  it('authKind=paste-token：渲染密码框与「保存」，提交时 kind 是 "paste-token"', async () => {
    renderCard({ authKind: "paste-token" })

    const input = host.querySelector<HTMLInputElement>('[data-plugin-credential-input="paste-token"]')
    expect(input, "paste-token 必须有输入框，否则用户根本没法填令牌").toBeTruthy()
    // 密码框：令牌不该以明文停在设置页上。
    expect(input!.type).toBe("password")
    // 不回填：宿主手里没有这个值，空框就是真实状态（没有"已保存的令牌"可显示）。
    expect(input!.value).toBe("")

    const button = find('[data-plugin-action="submit-credential"]')
    expect(button?.textContent).toContain("保存")
    // 凭据型 authKind 且没声明设置页：不再摆一个永远禁用的「登录/设置」。
    expect(find('[data-plugin-action="login"]')).toBeNull()

    submitProviderCredential.mockResolvedValueOnce({ ok: true, message: "登录成功" })
    await typeInto(input!, "sk-pasted-token")
    await click(button!)

    expect(submitProviderCredential).toHaveBeenCalledTimes(1)
    expect(submitProviderCredential).toHaveBeenCalledWith(
      "wb-connect",
      "paste-token",
      "sk-pasted-token",
      undefined,
    )
    // 插件给的 message 原样展示。
    expect(host.textContent).toContain("登录成功")
  })

  /* ---- 9) 提交后必须清空输入框 ---- */
  it("提交成功后输入框被清空，且没有 message 时兜底「已保存」", async () => {
    renderCard({ authKind: "paste-token" })

    const input = host.querySelector<HTMLInputElement>('[data-plugin-credential-input="paste-token"]')!
    await typeInto(input, "sk-should-not-stay")
    submitProviderCredential.mockResolvedValueOnce({ ok: true })
    await click(find('[data-plugin-action="submit-credential"]')!)

    // 凭证不该留在界面上（也不该被任何地方缓存下来）。
    expect(input.value).toBe("")
    expect(host.textContent).toContain("已保存")
  })

  /* ---- 10) 空输入不能发出请求 ---- */
  it("输入为空/全空白：保存按钮禁用，点了也不发请求", async () => {
    renderCard({ authKind: "paste-token" })

    const input = host.querySelector<HTMLInputElement>('[data-plugin-credential-input="paste-token"]')!
    const button = find('[data-plugin-action="submit-credential"]')!
    // 初始（空）就禁用：不给插件送一条空凭据。
    expect(button.disabled).toBe(true)
    await click(button)
    expect(submitProviderCredential).not.toHaveBeenCalled()

    // 只敲空格也算空 —— "有个字符"不该成为绕过校验的办法。
    await typeInto(input, "    ")
    expect(button.disabled).toBe(true)
    await click(button)
    expect(submitProviderCredential).not.toHaveBeenCalled()
  })

  /* ---- 11) import-file：选文件 → 读文本 → 提交 ---- */
  it('authKind=import-file：渲染「选择文件」，读到的内容与文件名以 kind="import-file" 提交', async () => {
    renderCard({ authKind: "import-file" })

    const button = find('[data-plugin-action="pick-credential-file"]')
    expect(button?.textContent).toContain("选择文件")
    // 这一档没有粘贴框：文件内容才是凭据。
    expect(host.querySelector("[data-plugin-credential-input]")).toBeNull()

    openDialog.mockResolvedValueOnce("C:\\keys\\token.txt")
    mockGetFileSize.mockResolvedValueOnce(64)
    mockReadFile.mockResolvedValueOnce("sk-from-file")
    submitProviderCredential.mockResolvedValueOnce({ ok: true, message: "登录成功" })

    await click(button!)

    // 先量大小、再读内容（两个都只打一次）。
    expect(mockGetFileSize).toHaveBeenCalledWith("C:\\keys\\token.txt")
    expect(mockReadFile).toHaveBeenCalledWith("C:\\keys\\token.txt")
    // filename 传的是**文件名**而不是完整路径：插件不需要知道用户的磁盘结构。
    expect(submitProviderCredential).toHaveBeenCalledWith(
      "wb-connect",
      "import-file",
      "sk-from-file",
      "token.txt",
    )
    expect(host.textContent).toContain("登录成功")
  })

  it("超过 1MB 的凭据文件：不读内容就直接报错（避免把大文件读进内存）", async () => {
    renderCard({ authKind: "import-file" })

    openDialog.mockResolvedValueOnce("D:\\big\\huge.txt")
    mockGetFileSize.mockResolvedValueOnce(MAX_CREDENTIAL_FILE_BYTES + 1)

    await click(find('[data-plugin-action="pick-credential-file"]')!)

    expect(mockReadFile).not.toHaveBeenCalled()
    expect(submitProviderCredential).not.toHaveBeenCalled()
    expect(host.textContent).toContain("超过")
  })

  it("用户取消选择文件：安静退出，不显示假错误", async () => {
    renderCard({ authKind: "import-file" })

    openDialog.mockResolvedValueOnce(null)
    await click(find('[data-plugin-action="pick-credential-file"]')!)

    expect(mockGetFileSize).not.toHaveBeenCalled()
    expect(submitProviderCredential).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain("失败")
  })

  it("提交失败：Rust 的中文原文原样展示（不吞成「操作失败」）", async () => {
    renderCard({ authKind: "paste-token" })

    const input = host.querySelector<HTMLInputElement>('[data-plugin-credential-input="paste-token"]')!
    await typeInto(input, "bad-token")
    submitProviderCredential.mockRejectedValueOnce(
      'http://127.0.0.1:43210/login/credential 返回 401：token expired',
    )
    await click(find('[data-plugin-action="submit-credential"]')!)

    expect(host.textContent).toContain("token expired")
  })

  /* ================================================================== *
   * v2.1：完整编辑器（拉取/勾选模型、测试、改窗口、保存）
   *
   * 这一组的每个用例都在防一种"编辑器"特有的回归：
   *   · 编辑直接写覆盖表（没保存就生效、半途状态留痕）
   *   · 拉取模型直接覆盖已选（用户失去选择权）
   *   · 测试不打已选清单（41 个全测，慢且烧额度）
   *   · 未登录时模型区空白（用户不知道下一步该干什么）
   * ================================================================== */

  const refreshProviderModels = vi.mocked(pluginsApi.refreshProviderModels)

  function resetOverrides() {
    __resetPluginProviderOverrideCacheForTests()
    globalThis.localStorage?.clear()
  }

  function modelsOf(ids: string[]): PluginProviderModel[] {
    return ids.map((id) => model({ id, name: id.toUpperCase(), maxInputTokens: 128_000 }))
  }

  /** 测试注入的解析器：把 `providerId/modelId` 变成一份"看起来对"的配置。 */
  const resolveMock = (modelKey: string) =>
    ({ provider: modelKey.split("/")[0], model: modelKey.split("/")[1] ?? "" }) as unknown as LlmConfig

  async function field(name: string) {
    return host.querySelector<HTMLInputElement>(`[data-plugin-field="${name}"]`)!
  }

  async function pressEnter(input: HTMLInputElement) {
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
  }

  beforeEach(() => {
    resetOverrides()
    refreshProviderModels.mockResolvedValue([])
    testLlmConnectionMock.mockResolvedValue({ ok: true, message: "Connected in 12 ms." })
    testLlmFunctionMock.mockResolvedValue({ ok: true, message: "Functional test passed." })
  })

  /* ---- 1) 渲染出完整编辑器 ---- */
  it("1) 渲染完整编辑器：配置名、模型区、三个按钮、保存按钮都在", () => {
    renderCard()

    expect(host.querySelector('[data-plugin-field="label"]')).toBeTruthy()
    expect(host.querySelector('[data-plugin-field="models"]')).toBeTruthy()
    expect(find('[data-plugin-action="pull-models"]')?.textContent).toContain("拉取模型")
    expect(find('[data-plugin-action="test-connection"]')?.textContent).toContain("测试连接")
    expect(find('[data-plugin-action="test-function"]')?.textContent).toContain("测试功能")
    expect(find('[data-plugin-action="save"]')?.textContent).toContain("保存配置")
    /*
     * v3：上下文/输出不再常驻两个滑块选择器，收成一行文字（插件上报值格式化，
     * 如 1000000 → 1.0M tokens），点击该行才展开（展开用例见 8c/8d）。
     */
    expect(host.querySelector('[data-plugin-field="max-context"] input[type="range"]')).toBeNull()
    expect(host.querySelector('[data-plugin-field="max-output"] input[type="range"]')).toBeNull()
    expect(host.querySelector('[data-plugin-field="max-context"]')?.textContent).toContain("1.0M tokens")
    // 没有任何改动 → 保存禁用（点了不该有任何事情发生）。
    expect(find('[data-plugin-action="save"]')?.disabled).toBe(true)
  })

  /* ---- 2) 改名 → 保存 → 覆盖表有 label ---- */
  it("2) 改配置名后保存：覆盖表里出现 label，并提示模型已可选", async () => {
    renderCard()

    await typeInto(await field("label"), "我的 WorkBuddy")
    // 有未保存改动 → 保存按钮亮起。
    expect(find('[data-plugin-action="save"]')?.disabled).toBe(false)

    await click(find('[data-plugin-action="save"]')!)

    expect(getPluginProviderOverride("wb-connect")?.label).toBe("我的 WorkBuddy")
    expect(host.textContent).toContain("配置已保存。1 个模型现在可以在 AI 对话里选择了。")
    // 保存后回到"无改动"状态：按钮重新禁用（否则用户会以为还有东西没存）。
    expect(find('[data-plugin-action="save"]')?.disabled).toBe(true)
  })

  /* ---- 3) 拉取模型 → 内联目录（与内置卡片一致，不是弹窗） ---- */
  it("3) 拉取模型直接展开内联目录：没有弹窗、没有搜索框，计数文案在", async () => {
    refreshProviderModels.mockResolvedValueOnce(modelsOf(["model-a", "model-b", "model-c"]))
    renderCard({ models: [] })

    await click(find('[data-plugin-action="pull-models"]')!)

    expect(refreshProviderModels).toHaveBeenCalledWith("wb-connect")
    // 内联展开：不是居中弹窗（role=dialog 不存在），也没有搜索框（内置卡片没有）。
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(host.querySelector('[data-plugin-catalog="open"]')).toBeTruthy()
    expect(host.querySelector('[data-plugin-field="catalog-search"]')).toBeNull()
    // v3：删掉「已从插件拉到 N 个模型…」提示行——目录头自己就是反馈。
    expect(host.textContent).not.toContain("已从插件拉到")
    // 计数文案（内置卡片同款）。
    expect(host.textContent).toContain("已拉取 3 个模型 · 已选择 3 个")
    // 默认全部点亮：selectedModels 没写过 = 全选语义。
    for (const id of ["model-a", "model-b", "model-c"]) {
      expect(
        host.querySelector<HTMLButtonElement>(`[data-plugin-catalog-item="${id}"]`)?.getAttribute("aria-pressed"),
      ).toBe("true")
    }
  })

  it("3b) 点目录里的模型：aria-pressed 翻转，覆盖表立刻更新（没有「确定」这一步）", async () => {
    refreshProviderModels.mockResolvedValueOnce(modelsOf(["model-a", "model-b", "model-c"]))
    renderCard({ models: [] })
    await click(find('[data-plugin-action="pull-models"]')!)

    await click(host.querySelector<HTMLButtonElement>('[data-plugin-catalog-item="model-a"]')!)

    expect(
      host.querySelector('[data-plugin-catalog-item="model-a"]')?.getAttribute("aria-pressed"),
    ).toBe("false")
    expect(
      host.querySelector('[data-plugin-catalog-item="model-b"]')?.getAttribute("aria-pressed"),
    ).toBe("true")
    expect(host.textContent).toContain("已选择 2 个")
    // 覆盖表立刻是剩下的两个（即点即写，不等保存）。
    expect(getPluginProviderOverride("wb-connect")?.selectedModels).toEqual(["model-b", "model-c"])
    /*
     * 取消勾选的模型必须从卡片上消失，即使插件快照（preset.models）是空的 ——
     * 场景：插件刚装好还没同步，目录是「拉取模型」现拿回来的。
     */
    expect(host.querySelector('[data-plugin-chip="model-a"]')).toBeNull()
    expect(host.querySelector('[data-plugin-chip="model-b"]')).toBeTruthy()

    // 再点一次 → 取消选择，回到点亮。
    await click(host.querySelector<HTMLButtonElement>('[data-plugin-catalog-item="model-a"]')!)
    expect(
      host.querySelector('[data-plugin-catalog-item="model-a"]')?.getAttribute("aria-pressed"),
    ).toBe("true")
    expect(getPluginProviderOverride("wb-connect")?.selectedModels).toEqual(["model-b", "model-c", "model-a"])
  })

  it("3c) 「清空」→ 目录全灭、模型区 0 个、覆盖表是 []；「全选」→ 恢复并回到全选语义", async () => {
    refreshProviderModels.mockResolvedValueOnce(modelsOf(["model-a", "model-b"]))
    renderCard({ models: modelsOf(["model-a", "model-b"]) })
    expect(host.querySelectorAll("[data-plugin-chip]")).toHaveLength(2)

    await click(find('[data-plugin-action="pull-models"]')!)
    await click(find('[data-plugin-action="catalog-clear"]')!)

    // 全灭 + 计数归零 + chips 清空。
    expect(
      host.querySelector('[data-plugin-catalog-item="model-a"]')?.getAttribute("aria-pressed"),
    ).toBe("false")
    expect(host.textContent).toContain("已选择 0 个")
    expect(host.querySelectorAll("[data-plugin-chip]")).toHaveLength(0)
    // 覆盖表是**显式空数组**（不是"没勾过"）：这是 applySelectedModels 新语义的落点。
    expect(getPluginProviderOverride("wb-connect")?.selectedModels).toEqual([])

    await click(find('[data-plugin-action="catalog-select-all"]')!)
    expect(
      host.querySelector('[data-plugin-catalog-item="model-a"]')?.getAttribute("aria-pressed"),
    ).toBe("true")
    expect(host.textContent).toContain("已选择 2 个")
    expect(host.querySelectorAll("[data-plugin-chip]")).toHaveLength(2)
    // 全选 = 写空（字段删除）→ 回到"没勾过 = 全选"。
    expect(getPluginProviderOverride("wb-connect")?.selectedModels).toBeUndefined()
  })

  /* ---- 4) chip 的 × 移除 ---- */
  it("4) 点 chip 的 ×：该模型从 selectedModels 移除（保存后覆盖表里没有它）", async () => {
    renderCard({ models: modelsOf(["model-a", "model-b", "model-c"]) })

    expect(host.querySelectorAll("[data-plugin-chip]")).toHaveLength(3)
    await click(host.querySelector<HTMLElement>('[data-plugin-chip-remove="model-b"]')!)
    await click(find('[data-plugin-action="save"]')!)

    expect(getPluginProviderOverride("wb-connect")?.selectedModels).toEqual(["model-a", "model-c"])
    expect(host.querySelector('[data-plugin-chip="model-b"]')).toBeNull()
  })

  it("4b) 手填插件没上报的模型：允许加，但标黄提示", async () => {
    renderCard()

    await typeInto(await field("manual-model"), "not-in-catalog")
    await pressEnter(await field("manual-model"))

    const chip = host.querySelector('[data-plugin-chip="not-in-catalog"]')
    expect(chip?.getAttribute("data-plugin-chip-unknown")).toBe("true")
    expect(chip?.getAttribute("title")).toContain("插件未上报此模型")

    await click(find('[data-plugin-action="save"]')!)
    expect(getPluginProviderOverride("wb-connect")?.selectedModels).toContain("not-in-catalog")
  })

  /* ---- 5) 测试连接：成功 / 失败 ---- */
  it("5) 测试连接全通过：显示「通过」；有失败则列出模型名与原因", async () => {
    renderCard()
    await click(find('[data-plugin-action="test-connection"]')!)

    expect(testLlmConnectionMock).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain("连接测试通过（1/1）")
    // 有未保存改动才提醒"尚未保存"；这里没改动，所以是另一句话。
    expect(host.textContent).toContain("本次测试没有修改配置")

    // 第二个模型失败：必须点名 + 说原因。
    act(() => root.unmount())
    root = createRoot(host)
    testLlmConnectionMock.mockReset()
    testLlmConnectionMock.mockImplementation(async (cfg: LlmConfig) =>
      cfg.model === "step-5-preview"
        ? { ok: false, message: "上游返回 404" }
        : { ok: true, message: "ok" },
    )
    renderCard({ models: modelsOf(["glm-5", "step-5-preview"]) })
    await click(find('[data-plugin-action="test-connection"]')!)

    expect(host.querySelector('[data-plugin-status="error"]')?.textContent).toContain(
      "step-5-preview：上游返回 404",
    )
    expect(host.querySelector('[data-plugin-status="error"]')?.textContent).toContain("1/2 通过")
    // 失败的 chip 单独标红（用户一眼能看出是哪一条）。
    expect(host.querySelector('[data-plugin-chip="step-5-preview"]')?.className).toContain("is-failed")
  })

  it("5b) 测试过程中显示「正在测试 N/M…」，并且一次只跑一个模型", async () => {
    const releases: ((value: { ok: boolean; message: string }) => void)[] = []
    testLlmConnectionMock.mockImplementation(
      () => new Promise<{ ok: boolean; message: string }>((resolve) => { releases.push(resolve) }),
    )
    renderCard({ models: modelsOf(["a", "b"]) })

    const button = find('[data-plugin-action="test-connection"]')!
    await act(async () => {
      button.click()
    })
    // 第一个在跑：显示 0/2，按钮锁住（不能连点出第二批请求）。
    expect(host.textContent).toContain("正在测试 0/2…")
    expect(button.disabled).toBe(true)
    expect(testLlmConnectionMock).toHaveBeenCalledTimes(1)

    // 放行第一个 → 进度推进到 1/2，第二个还没发出去（串行，不同时打两个请求）。
    await act(async () => releases[0]!({ ok: true, message: "ok" }))
    expect(host.querySelector('[data-plugin-status]')?.textContent).toContain("正在测试 1/2…")
    expect(testLlmConnectionMock).toHaveBeenCalledTimes(2)

    // 全部完成 → 收尾成结论，按钮解锁。
    await act(async () => releases[1]!({ ok: true, message: "ok" }))
    expect(host.textContent).toContain("连接测试通过（2/2）")
    expect(find('[data-plugin-action="test-connection"]')?.disabled).toBe(false)
  })

  /* ---- 6) 只测已选模型 ---- */
  it("6) 只测已选的模型：目录里点 3 个时 testLlmConnection 只被调 3 次（插件报了 41 个也不管）", async () => {
    const many = Array.from({ length: 41 }, (_, index) => `model-${index}`)
    refreshProviderModels.mockResolvedValueOnce(modelsOf(many))
    renderCard({ models: modelsOf(many) })

    // 走真实路径把选中集从 41 缩到 3：拉取 → 清空 → 点 3 个（内联目录即点即生效）。
    await click(find('[data-plugin-action="pull-models"]')!)
    await click(find('[data-plugin-action="catalog-clear"]')!)
    for (const id of ["model-0", "model-1", "model-2"]) {
      await click(host.querySelector<HTMLButtonElement>(`[data-plugin-catalog-item="${id}"]`)!)
    }

    await click(find('[data-plugin-action="test-connection"]')!)

    expect(testLlmConnectionMock).toHaveBeenCalledTimes(3)
    const tested = testLlmConnectionMock.mock.calls.map((call) => call[0].model)
    expect(tested).toEqual(["model-0", "model-1", "model-2"])
    // 传进去的是**解析后**的插件配置：provider = providerId，model = 该模型 id。
    // 这条保证"测试走的和聊天是同一条链路"，而不是另搭的探针。
    expect(testLlmConnectionMock.mock.calls[0]![0].provider).toBe("wb-connect")
  })

  /* ---- 7) 未登录：不空白 ---- */
  it("7) 未登录（无模型）：模型区说明「登录后会自动拉取模型」，主按钮是登录", () => {
    renderCard({ ready: false, models: [], authKind: "browser-login", settingsPage: "/login" })

    expect(host.querySelector('[data-plugin-models-empty="true"]')?.textContent).toContain(
      "登录后会自动拉取模型",
    )
    const login = find('[data-plugin-action="login-workbuddy"]')
    expect(login?.textContent).toContain("登录 WorkBuddy")
    expect(login?.getAttribute("aria-label")).toBe("登录 WorkBuddy")
  })

  it("7b) 未登录态点主按钮：真的去开登录窗口", async () => {
    renderCard({ ready: false, models: [], authKind: "browser-login", settingsPage: "/login" })

    await click(find('[data-plugin-action="login-workbuddy"]')!)

    expect(providerOpenLogin).toHaveBeenCalledWith("wb-connect")
  })

  /* ---- 8) 既有能力不丢 ---- */
  it("8) 既有能力不丢：登录按钮、启停开关、删除都还在", () => {
    renderCard({ authKind: "browser-login", settingsPage: "/setup", capabilities: ["balance.query", "checkin"] })

    expect(find('[data-plugin-action="login"]')).toBeTruthy()
    expect(find('[data-plugin-action="toggle-enabled"]')?.getAttribute("aria-checked")).toBe("true")
    expect(find('[data-plugin-action="delete"]')).toBeTruthy()
    // 余额/签到也还在（能力位在就渲染）。
    expect(find('[data-plugin-action="balance"]')).toBeTruthy()
    expect(find('[data-plugin-action="checkin"]')).toBeTruthy()
  })

  it("8b) 启停开关写覆盖表 enabled，并把「已停用」显示出来", async () => {
    renderCard()

    await click(find('[data-plugin-action="toggle-enabled"]')!)

    expect(getPluginProviderOverride("wb-connect")?.enabled).toBe(false)
    // v3：开关是内置卡片同款 model-switch（无文字）；停用态看开关的 aria-checked
    // 与标题里第二个状态小字（ModelConfigTitle：[已保存, 已启用/已停用]）。
    expect(find('[data-plugin-action="toggle-enabled"]')?.getAttribute("aria-checked")).toBe("false")
    const statuses = [...host.querySelectorAll(".model-provider-status")].map((el) => el.textContent)
    expect(statuses).toContain("已停用")
  })

  it("8c) 上下文选择器：点击文字行展开，改值直接写覆盖表并回填文字", async () => {
    renderCard()

    // v3：默认收成一行文字（插件上报 1000000 → 1.0M tokens），没有滑块。
    const area = host.querySelector('[data-plugin-field="max-context"]')!
    expect(area.querySelector('input[type="range"]')).toBeNull()
    expect(area.textContent).toContain("1.0M tokens")

    // 点击该行 → 展开 ContextSizeSelector + OutputTokensSelector（与自定义卡片同组件）。
    await click(find('[data-plugin-action="toggle-context"]')!)
    expect(area.querySelector('input[type="range"]')).toBeTruthy()
    expect(host.querySelector('[data-plugin-field="max-output"] input[type="range"]')).toBeTruthy()

    // 点预设「1M」→ onChange(1000000) → 覆盖表立刻更新（不等「保存配置」）。
    const oneMillion = Array.from(area.querySelectorAll("button")).find(
      (button) => button.textContent === "1M",
    )!
    await click(oneMillion)
    expect(getPluginProviderOverride("wb-connect")?.maxContextSize).toBe(1000000)

    // 「用插件上报值」= 写 undefined（回到插件值），按钮随之消失。
    await click(find('[data-plugin-action="reset-context"]')!)
    expect(getPluginProviderOverride("wb-connect")?.maxContextSize).toBeUndefined()
    expect(find('[data-plugin-action="reset-context"]')).toBeNull()
  })

  it("8d) 输出上限选择器：随上下文一起展开，改值直接写覆盖表", async () => {
    renderCard()

    // 输出选择器与上下文选择器共用一个折叠区（v3：点「上下文窗口」文字行展开）。
    await click(find('[data-plugin-action="toggle-context"]')!)
    const area = host.querySelector('[data-plugin-field="max-output"]')!
    expect(area.querySelector('input[type="range"]')).toBeTruthy()

    const sixtyFourK = Array.from(area.querySelectorAll("button")).find(
      (button) => button.textContent === "64K",
    )!
    await click(sixtyFourK)
    expect(getPluginProviderOverride("wb-connect")?.maxOutputTokens).toBe(65536)

    await click(find('[data-plugin-action="reset-output"]')!)
    expect(getPluginProviderOverride("wb-connect")?.maxOutputTokens).toBeUndefined()
  })

  /* ================================================================== *
   * v3：与自定义提供方卡片视觉同构
   *
   * 折叠行 / chip 小开关 / 账号状态 / 上下文文字行 / 冗余删除，
   * 每条用例都对着 docs/plugins/workbuddy-provider-卡片设计v3.html 的对齐点。
   * ================================================================== */

  it("v3-1) 折叠行与内置卡片同构：标题+状态徽标+插件淡紫徽标+同一开关，没有「来自插件」副标题", () => {
    renderCard()

    // 与 provider-custom.tsx 同一结构：model-provider-title（箭头+名称+状态）+ model-switch。
    const title = host.querySelector<HTMLButtonElement>(".model-provider-title")
    expect(title, "折叠行必须用内置同款 model-provider-title 结构").toBeTruthy()
    expect(title?.getAttribute("aria-expanded")).toBe("true")
    expect(host.querySelector(".model-provider-title .model-provider-name")?.textContent).toContain(
      "插件样例直连",
    )
    expect(host.querySelector(".model-provider-title .model-provider-status")?.textContent).toContain("已保存")
    // 插件专属淡紫徽标（v3 设计的 #e8e6f8 / #4a3f9e）。
    const pluginBadge = host.querySelector<HTMLElement>('[data-plugin-badge="plugin"]')
    expect(pluginBadge?.textContent).toBe("插件")
    expect(pluginBadge?.style.backgroundColor).toBe("rgb(232, 230, 248)")
    expect(pluginBadge?.style.color).toBe("rgb(74, 63, 158)")
    // 开关：内置同款 model-switch（role=switch / aria-checked，不再带文字）。
    const sw = find('[data-plugin-action="toggle-enabled"]')!
    expect(sw.className).toContain("model-switch")
    expect(sw.getAttribute("role")).toBe("switch")
    // 头部不再渲染副标题与模型计数（展开区才有目录），也不放一排动作按钮。
    expect(host.textContent).not.toContain("来自插件")
    expect(host.textContent).not.toContain("个模型")
    // 未就绪徽标仍在（诚实优先：未就绪的 provider 必须一眼可见）。
    renderCard({ ready: false, lastError: "健康检查超时" })
    expect(host.querySelector('[data-plugin-badge="unready"]')?.textContent).toContain("未就绪")
  })

  it("v3-2) chip 小开关：关掉变灰但保留（并从 selectedModels 移除），点 × 才移除", async () => {
    renderCard({ models: modelsOf(["model-a", "model-b"]) })

    const toggle = host.querySelector<HTMLButtonElement>('[data-plugin-chip-toggle="model-a"]')!
    expect(toggle.getAttribute("aria-pressed")).toBe("true")

    // 关：chip 保留变灰，模型从 selectedModels 移除（聊天里不再出现）。
    await click(toggle)
    expect(host.querySelector('[data-plugin-chip="model-a"]')).toBeTruthy()
    expect(
      host.querySelector<HTMLElement>('[data-plugin-chip="model-a"]')?.getAttribute("data-plugin-chip-disabled"),
    ).toBe("true")
    expect(
      host.querySelector<HTMLButtonElement>('[data-plugin-chip-toggle="model-a"]')?.getAttribute("aria-pressed"),
    ).toBe("false")
    expect(getPluginProviderOverride("wb-connect")?.selectedModels).toEqual(["model-b"])

    // 再开：写回 selectedModels，chip 恢复。
    await click(host.querySelector<HTMLButtonElement>('[data-plugin-chip-toggle="model-a"]')!)
    expect(
      host.querySelector<HTMLElement>('[data-plugin-chip="model-a"]')?.getAttribute("data-plugin-chip-disabled"),
    ).toBeNull()
    expect(getPluginProviderOverride("wb-connect")?.selectedModels).toEqual(["model-b", "model-a"])

    // × 才是移除：chip 整个消失。
    await click(host.querySelector<HTMLElement>('[data-plugin-chip-remove="model-a"]')!)
    expect(host.querySelector('[data-plugin-chip="model-a"]')).toBeNull()
    expect(getPluginProviderOverride("wb-connect")?.selectedModels).toEqual(["model-b"])
  })

  it("v3-2b) 灰 chip 在「保存配置」时被清理（不进覆盖表，重开页面无幽灵 chip）", async () => {
    renderCard({ models: modelsOf(["model-a", "model-b"]) })

    await click(host.querySelector<HTMLButtonElement>('[data-plugin-chip-toggle="model-a"]')!)
    await typeInto(await field("label"), "改名触发保存可用")
    await click(find('[data-plugin-action="save"]')!)

    expect(getPluginProviderOverride("wb-connect")?.selectedModels).toEqual(["model-b"])
    // 保存后灰 chip 清理：卡片上只剩真正选中的 model-b。
    expect(host.querySelector('[data-plugin-chip="model-a"]')).toBeNull()
    expect(host.querySelector('[data-plugin-chip="model-b"]')).toBeTruthy()
  })

  it("v3-3) 上下文窗口文字行的格式化（与内置选择器同一套规则）", () => {
    expect(formatContextTokens(1_000_000)).toBe("1.0M tokens")
    expect(formatContextTokens(128_000)).toBe("125K tokens")
    expect(formatContextTokens(512)).toBe("512 tokens")
  })

  it("v3-4) 账号状态：get_account 工具返回「账号：昵称（uid: xxx）」→ 显示「昵称 · uid」", async () => {
    const invokeTool = vi.mocked(pluginsApi.invokeTool)
    invokeTool.mockResolvedValueOnce("账号：小明（uid: uid-1）")
    renderCard({ authKind: "browser-login", settingsPage: "/login" })
    // 等异步工具调用（promise 链）落进 state。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invokeTool).toHaveBeenCalledWith("wb-plugin", "get_account", {})
    expect(host.querySelector('[data-plugin-field="account"]')?.textContent).toContain("小明 · uid-1")
  })

  it("v3-4b) 账号状态：调用失败（未登录）→「⚠️ 还没有登录」；authKind=none 不调工具", async () => {
    const invokeTool = vi.mocked(pluginsApi.invokeTool)
    invokeTool.mockRejectedValueOnce("还没有登录 WorkBuddy 账号")
    renderCard({ authKind: "browser-login", settingsPage: "/login", ready: false, models: [] })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(host.querySelector('[data-plugin-field="account"]')?.textContent).toContain("⚠️ 还没有登录")

    // authKind=none：没有账号概念，不去调 get_account。
    invokeTool.mockClear()
    act(() => root.unmount())
    root = createRoot(host)
    renderCard({ authKind: "none" })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(invokeTool).not.toHaveBeenCalled()
    expect(host.querySelector('[data-plugin-field="account"]')?.textContent).toContain("无需登录")
  })

  it("v3-5) 账号信息解析：容错「账号：昵称（uid: xxx）」格式", () => {
    expect(parseAccountInfo("账号：小明（uid: uid-1）")).toEqual({ nickname: "小明", uid: "uid-1" })
    expect(parseAccountInfo("账号：小明（uid: uid-1）")).not.toBeNull()
    expect(parseAccountInfo("账号：小明")).toEqual({ nickname: "小明", uid: undefined })
    expect(parseAccountInfo("")).toBeUndefined()
    expect(parseAccountInfo("随便一段话")).toBeUndefined()
  })

  it("v3-6) 配置名称输入框收窄（v3：max-width 420px）", () => {
    renderCard()

    expect(host.querySelector<HTMLInputElement>('[data-plugin-field="label"]')?.style.maxWidth).toBe("420px")
  })
})
