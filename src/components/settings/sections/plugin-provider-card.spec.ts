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

import { open as openFileDialog } from "@tauri-apps/plugin-dialog"
import { getFileSize, readFile } from "@/commands/fs"
import { pluginsApi } from "@/lib/plugins/api"
import {
  MAX_CREDENTIAL_FILE_BYTES,
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
      root.render(createElement(PluginProviderCard, { preset, expanded: true, onToggle: () => {} }))
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
    // 刷新模型按钮照旧在：它本来就不受能力位门控。
    expect(find('[data-plugin-action="refresh"]')).toBeTruthy()
  })

  it("一个能力位都没有：余额/签到不渲染，但「刷新模型」仍然显示（宿主自己的能力）", () => {
    renderCard({ capabilities: [], models: [] })

    expect(find('[data-plugin-action="balance"]')).toBeNull()
    expect(find('[data-plugin-action="checkin"]')).toBeNull()
    // /v1/models 是 provider 契约的必需端点（设计 §3.1）：刷新不需要插件声明任何东西。
    expect(find('[data-plugin-action="refresh"]')).toBeTruthy()
    expect(host.textContent).toContain("先点「刷新模型」")
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
  it("模型有 cost：显示「输入/输出 /1M tokens」", () => {
    renderCard({ models: [model({ cost: { input: 2, output: 8 } })] })

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
})
