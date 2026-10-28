/**
 * 设置页里的「插件 provider」运行期卡片（T4，S2 补齐登录/余额/签到/成本）。
 *
 * 为什么是运行期 preset 而不是往 `LLM_PRESETS` 里加内容：
 * `LLM_PRESETS` 是静态数组（内置 11 个 provider 的策划目录），插件 provider 是
 * 装/卸/启/停都会变的运行期对象。把它转成与 preset 同形状的对象再追加到渲染列表，
 * 既能复用卡片的排版与品牌位，又不会让静态目录随插件状态漂移。
 *
 * v2.0 的边界（设计 §5 / 计划第 5.2 节）：
 *   - `登录/设置` 只处理「插件声明了 `settingsPagePath`」的情形，走 Rust 的受控窗口
 *     命令 `plugins_provider_open_login`；**页面 URL、导航白名单、临时数据目录都在
 *     Rust 侧**，这里只传 providerId（设计 §5.2：白名单不能由前端说了算）。
 *   - 插件没声明设置页时按钮**禁用 + 说明原因**，这里**不伪造**登录界面 ——
 *     假 UI 会让用户以为凭据已经交给了软件。
 *   - `刷新模型` 只走 Rust 命令 `plugins_provider_refresh_models`，
 *     不能复用 `settings-model-list.buildModelsUrl`：那条路会去读 `apiKey`
 *     并抛「令牌尚未获取」（插件 token 只在 Rust 内存里）。
 *   - `余额` / `每日签到` 完全由 `capabilities` 驱动（设计 §4.3）：能力位是插件对
 *     「我实现了这个端点」的声明，**没声明就说明端点不存在**。所以缺 capability 时
 *     连按钮都不渲染 —— 渲染一个灰色占位会骗用户去点，点完只能得到一个
 *     「插件不支持该端点」的 404，那是把插件的诚实宣言变成宿主的假承诺。
 *   - 但 `刷新模型` **例外**：`/v1/models` 是 provider 契约里的必需端点（设计 §3.1），
 *     刷新是宿主自己的能力，所以它不受任何能力位门控（理由见按钮处的注释）。
 */
import { useState } from "react"
import { AlertTriangle, CalendarCheck, Image as ImageIcon, Loader2, RefreshCw, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { pluginsApi } from "@/lib/plugins/api"
import { syncPluginProviders } from "@/lib/plugins/provider-sync"
import type { PluginProviderModel, PluginProviderView } from "@/lib/plugins/types"
import type { LlmPreset } from "../llm-presets"

/**
 * 插件 provider 的 preset 形状。
 *
 * 额外字段只用于卡片展示与按钮分支，不参与模型解析 —— 模型解析读的是
 * `providerConfigs[providerId]`（同步写进去的），两条数据源名字相同、含义不同：
 * 这里的是「Rust 刚报上来的状态」，那里的是「界面与请求层实际在用的配置」。
 */
export interface PluginProviderPreset extends LlmPreset {
  pluginId: string
  authKind: PluginProviderView["authKind"]
  ready: boolean
  lastError?: string
  /**
   * 插件声明的能力位（设计 §4.3）。**只决定余额/签到按钮是否出现**，不改变协议。
   *
   * 缺省按「没有能力」处理：插件没写就等于没实现端点，宿主不能替它假设。
   * `models.refresh` 虽然在这一栏里，但不驱动 UI（见文件头与按钮处注释）。
   */
  capabilities: string[]
  /** 插件的登录/设置页路径（清单里的 `settingsPagePath`）。空 = 没声明页面。 */
  settingsPage?: string
  /** 运行期模型（带上下文窗口，卡片上显示；未就绪时可能为空）。 */
  models: PluginProviderModel[]
}

/**
 * 卡片认得的能力位（设计 §4.2 白名单里只有这三个）。
 *
 * **没有 `models.refresh` 常量**：它虽然仍被清单接受（写着不报错，向后兼容），
 * 但不驱动任何 UI，理由见「刷新模型」按钮处的注释 —— 留一个没人读的常量只会
 * 让人以为它还有语义。
 */
const CAP_BALANCE = "balance.query"
const CAP_CHECKIN = "checkin"

/**
 * 登录命令「快速返回」的判定阈值。
 *
 * 为什么要判时长：`plugins_provider_open_login` 目前约定「窗口打开即 resolve」，
 * 但 Rust 侧也可能实现成「等用户关窗才 resolve」。两种实现下「窗口已打开」这句话
 * 只有前者成立，后者要等到关窗才说得通。用耗时把两种情况区分开，**兼容两种实现**；
 * 等 Rust 侧时机定型后这个分支可以删掉，只留一句话。
 */
const LOGIN_QUICK_RESOLVE_MS = 3000

/** 插件没声明设置页时的说明（同时用作按钮 tooltip 与 aria 描述）。 */
const NO_SETTINGS_PAGE_HINT = "该插件没有声明设置页（settingsPagePath），宿主无法打开登录窗口"

function maxOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((max, value) => (value > max ? value : max), values[0])
}

export function toPluginProviderPreset(view: PluginProviderView): PluginProviderPreset {
  return {
    // preset.id 必须等于 provider id：它同时是 `providerConfigs` 的键，也是
    // 模型复合键 `providerId/modelId` 的前缀（设计 D1）。三者错位就会选到别人的模型。
    id: view.providerId,
    label: view.name || view.providerId,
    hint: `来自插件 ${view.pluginId}`,
    provider: view.providerId,
    defaultModel: view.models[0]?.id,
    suggestedContextSize: maxOf(view.models.map((model) => model.maxInputTokens)),
    suggestedMaxOutputTokens: maxOf(view.models.map((model) => model.maxOutputTokens)),
    pluginId: view.pluginId,
    authKind: view.authKind,
    ready: view.ready,
    lastError: view.lastError,
    // 能力位与设置页原样带出：卡片靠它们决定按钮渲染，不能在这里「补齐默认值」。
    capabilities: view.capabilities ?? [],
    settingsPage: view.settingsPage,
    models: view.models,
  }
}

/** 读 Tauri 命令失败原因（与插件管理页同一套约定：字符串优先）。 */
function describeError(cause: unknown): string {
  if (typeof cause === "string" && cause.trim()) return cause
  if (cause instanceof Error && cause.message.trim()) return cause.message
  return "操作失败，请重试。"
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/* ------------------------------------------------------------------ *
 * 第三方返回值的归一化（插件是第三方，脏数据必须在入口处收住）
 * ------------------------------------------------------------------ */

/** 余额里的一行。`value` 一律转成字符串：插件可能报数字，也可能报 "1,234 积分"。 */
export interface PluginProviderBalanceItem {
  label: string
  value: string
}

/**
 * 解析 `POST /v1/_qmai/balance` 的返回（设计 §4.4：`{items:[{label,value}]}`）。
 *
 * 结构不符返回 `undefined`（由调用方显示「格式无法识别」），**不抛异常**：
 * 一个插件的余额格式写错，不该把整个设置页打白屏。
 * 空数组算**合法**（插件确实没有余额项），与「结构错」区分开。
 */
export function parseBalance(payload: unknown): PluginProviderBalanceItem[] | undefined {
  const record = asRecord(payload)
  if (!record || !Array.isArray(record.items)) return undefined
  const items: PluginProviderBalanceItem[] = []
  for (const raw of record.items) {
    const item = asRecord(raw)
    if (!item) return undefined
    const label = typeof item.label === "string" ? item.label.trim() : ""
    const value =
      typeof item.value === "string"
        ? item.value.trim()
        : typeof item.value === "number" && Number.isFinite(item.value)
          ? String(item.value)
          : ""
    // 缺 label 或 value 的行无法渲染成「小字」；这种情况下整份结构按不可识别处理，
    // 免得界面上出现「 · 1234」这种半截内容骗用户。
    if (!label || !value) return undefined
    items.push({ label, value })
  }
  return items
}

/** 签到结果。`ok=false` 也是**结构合法**的结果（插件明确说了失败），必须如实展示。 */
export interface PluginProviderCheckinResult {
  ok: boolean
  message: string
}

/**
 * 解析 `POST /v1/_qmai/checkin` 的返回（设计 §4.4：`{ok, message}`）。
 *
 * `message` 缺省时用「已签到」/「签到失败」兜底：按钮点下去必须有反馈，
 * 不能出现「点了没反应」的空白。
 */
export function parseCheckin(payload: unknown): PluginProviderCheckinResult | undefined {
  const record = asRecord(payload)
  if (!record || typeof record.ok !== "boolean") return undefined
  const message = typeof record.message === "string" ? record.message.trim() : ""
  if (message) return { ok: record.ok, message }
  return { ok: record.ok, message: record.ok ? "已签到" : "签到失败，插件没有给出原因。" }
}

/**
 * 模型成本小字。
 *
 * **单位：每百万 token**（与 `PluginProviderModel.cost` 的约定一致）。
 * 不写货币符号：`cost` 由插件申报，货币单位也由插件定义，宿主不替它假设 ¥/$ ——
 * 标错货币比不标更糟（用户会照着算钱）。
 */
export function formatModelCost(cost: PluginProviderModel["cost"]): string | undefined {
  if (!cost) return undefined
  const { input, output } = cost
  if (input === undefined && output === undefined) return undefined
  const show = (value: number | undefined) => (value === undefined ? "–" : String(value))
  return `${show(input)}/${show(output)} /1M tokens`
}

/* ------------------------------------------------------------------ *
 * 卡片
 * ------------------------------------------------------------------ */

/** 同一时刻只做一件事：避免用户把「刷新模型」「签到」连点成一堆并发命令。 */
type PendingAction = "refresh" | "login" | "balance" | "checkin"

type BalanceState =
  | { kind: "loading" }
  | { kind: "items"; items: PluginProviderBalanceItem[] }
  | { kind: "malformed" }
  | { kind: "error"; text: string }

export function PluginProviderCard({
  preset,
  expanded,
  onToggle,
}: {
  preset: PluginProviderPreset
  expanded: boolean
  onToggle: () => void
}) {
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null)
  const [balance, setBalance] = useState<BalanceState | null>(null)

  // 「刷新模型」不受 capabilities 门控：/v1/models 是 provider 契约的必需端点（设计 §3.1），
  // 刷新是宿主自己的能力。models.refresh 这个 capability 因此没有 UI 语义，仅为向后兼容保留。
  const capabilities = preset.capabilities
  const canQueryBalance = capabilities.includes(CAP_BALANCE)
  const canCheckin = capabilities.includes(CAP_CHECKIN)

  const needsLogin = preset.authKind !== "none"
  const settingsPage = preset.settingsPage?.trim() ?? ""
  // 有登录需求但没声明页面 → 宿主无窗口可开。按钮禁用而不是「点了才报错」：
  // 用户一眼就知道这条能力缺在哪（tooltip 里写着缺的是 settingsPagePath）。
  const loginBlocked = needsLogin && settingsPage === ""

  async function refreshModels() {
    if (pending) return
    setPending("refresh")
    setStatus(null)
    try {
      // 只走 Rust 命令：它知道怎么带着 token 打插件的 /v1/models。
      await pluginsApi.refreshProviderModels(preset.id)
      // 抓完模型再同步一次，`providerConfigs` 与界面才会一起更新。
      await syncPluginProviders()
      setStatus({ error: false, text: "模型列表已刷新。" })
    } catch (cause) {
      setStatus({ error: true, text: `刷新失败：${describeError(cause)}` })
    } finally {
      setPending(null)
    }
  }

  async function openSettings() {
    // `authKind === "none"`：这个插件压根没有登录这回事（例如本地推理端点），
    // 不发命令、只把话说清楚 —— 点了说「不需要登录」比按钮消失更好理解。
    if (!needsLogin) {
      setStatus({ error: false, text: "该插件不需要登录。" })
      return
    }
    if (!settingsPage || pending) return
    setPending("login")
    setStatus(null)
    // 计时是为了兼容 Rust 的两种返回时机，见 LOGIN_QUICK_RESOLVE_MS 的注释。
    const startedAt = Date.now()
    try {
      // 受控窗口由 Rust 打开；关窗后 Rust 会自己重探活 + 重抓模型。
      await pluginsApi.providerOpenLogin(preset.id)
      const elapsed = Date.now() - startedAt
      setStatus({
        error: false,
        text:
          elapsed >= LOGIN_QUICK_RESOLVE_MS
            ? // 耗时过长 → 命令很可能是在「等关窗才 resolve」，此时窗口早就不在了，
              // 再说「窗口已打开」会误导用户去找一个已经关闭的窗口。
              "登录流程已结束，模型会自动刷新。"
            : "登录窗口已打开，完成后模型会自动刷新。",
      })
      // 再同步一次快照：Rust 重抓完模型后，卡片的就绪状态/模型数要立刻跟上。
      // 失败只 warn —— 它不该把上面那句成功提示改写成错误。
      void syncPluginProviders().catch((cause: unknown) => {
        console.warn("[plugins] 登录后同步 provider 失败：", cause)
      })
    } catch (cause) {
      // 原文展示：Rust 的中文原因（白名单拒绝、settingsPage 非法…）比「操作失败」有用得多。
      setStatus({ error: true, text: `打开登录窗口失败：${describeError(cause)}` })
    } finally {
      setPending(null)
    }
  }

  async function queryBalance() {
    if (pending) return
    setPending("balance")
    setBalance({ kind: "loading" })
    try {
      const payload = await pluginsApi.providerCall(preset.id, "/v1/_qmai/balance")
      const items = parseBalance(payload)
      setBalance(items ? { kind: "items", items } : { kind: "malformed" })
    } catch (cause) {
      setBalance({ kind: "error", text: describeError(cause) })
    } finally {
      setPending(null)
    }
  }

  async function runCheckin() {
    if (pending) return
    setPending("checkin")
    setStatus(null)
    try {
      const payload = await pluginsApi.providerCall(preset.id, "/v1/_qmai/checkin")
      const result = parseCheckin(payload)
      if (!result) {
        setStatus({ error: true, text: "插件返回的签到结果无法识别" })
      } else {
        // 插件主动说 `ok:false` 属于「有结果但失败」：照样展示它给的 message。
        setStatus({ error: !result.ok, text: result.message })
      }
    } catch (cause) {
      setStatus({ error: true, text: `签到失败：${describeError(cause)}` })
    } finally {
      setPending(null)
    }
  }

  return (
    <div
      className={`model-preset-card ${preset.ready ? "" : "opacity-60"}`}
      data-model-provider={preset.id}
      data-plugin-provider="true"
      data-ready={preset.ready ? "true" : "false"}
    >
      <div className="model-provider-head">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onToggle}
          aria-expanded={expanded}
          title={expanded ? "收起" : "展开"}
        >
          <span className="flex flex-wrap items-center gap-2">
            <strong className="break-words">{preset.label}</strong>
            {preset.ready ? null : (
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[0.6875rem] text-destructive">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                未就绪
              </span>
            )}
          </span>
          <small className="mt-0.5 block text-xs text-muted-foreground">
            来自插件 {preset.pluginId}
            {preset.models.length > 0 ? ` · ${preset.models.length} 个模型` : ""}
          </small>
        </button>
        <div className="flex shrink-0 flex-wrap gap-2">
          {/* 余额/签到各绑自己的能力位：没有该能力就整块不渲染（见文件头）。 */}
          {canQueryBalance ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-plugin-action="balance"
              disabled={pending !== null}
              onClick={() => void queryBalance()}
            >
              {pending === "balance" ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wallet className="mr-1 h-3.5 w-3.5" />
              )}
              {pending === "balance" ? "查询中…" : "余额"}
            </Button>
          ) : null}
          {canCheckin ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-plugin-action="checkin"
              disabled={pending !== null}
              onClick={() => void runCheckin()}
            >
              {pending === "checkin" ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CalendarCheck className="mr-1 h-3.5 w-3.5" />
              )}
              {pending === "checkin" ? "签到中…" : "每日签到"}
            </Button>
          ) : null}
          {/*
            「刷新模型」**不带任何能力位判断**，始终显示。
            刷新是宿主自己的能力：/v1/models 是 provider 契约的必需端点（设计 §3.1），
            宿主随时可以打它。把它藏在 `models.refresh` 后面，等于对没写这个字段的
            插件说「你的模型列表更新不了」——既不是事实，也纯属摩擦。
          */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-plugin-action="refresh"
            disabled={pending !== null}
            onClick={() => void refreshModels()}
          >
            {pending === "refresh" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            {pending === "refresh" ? "刷新中…" : "刷新模型"}
          </Button>
          {/*
            「登录/设置」始终出现（它是用户找登录入口的地方，点掉比藏起来好），
            但只有「需要登录 + 声明了设置页」时才真的能打开窗口。
            tooltip 用原生 `title`：按钮 disabled 后指针事件被吞，包一层 Tooltip
            反而点不出内容，原生 title 在禁用态仍然会显示。
          */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-plugin-action="login"
            disabled={loginBlocked || pending === "login"}
            title={loginBlocked ? NO_SETTINGS_PAGE_HINT : undefined}
            onClick={() => void openSettings()}
          >
            {pending === "login" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            {pending === "login" ? "打开中…" : "登录/设置"}
          </Button>
        </div>
      </div>

      {/* 余额是「一张小字」而不是一块面板：它是一眼确认，不该抢走模型列表的位置。 */}
      {balance ? (
        <p
          className={`px-1 pb-2 text-xs leading-relaxed ${
            balance.kind === "error" || balance.kind === "malformed"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
          data-plugin-balance={balance.kind}
          role="status"
          aria-live="polite"
        >
          {balance.kind === "loading"
            ? "正在查询余额…"
            : balance.kind === "malformed"
              ? "插件返回的余额格式无法识别"
              : balance.kind === "error"
                ? `余额查询失败：${balance.text}`
                : balance.items.length === 0
                  ? "插件没有报告余额项。"
                  : balance.items.map((item) => `${item.label} ${item.value}`).join(" · ")}
        </p>
      ) : null}

      {preset.ready ? null : (
        <p className="px-1 pb-2 text-xs leading-relaxed text-destructive" role="status">
          {preset.lastError?.trim() || "插件没有通过健康检查，模型暂不可用。"}
        </p>
      )}

      {expanded ? (
        <div className="model-preset-body space-y-2 border-t bg-background/50 p-3">
          {preset.models.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              插件还没有报告任何模型。先点「刷新模型」；仍为空的话，这个插件可能还没准备好。
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {preset.models.map((model) => {
                const cost = formatModelCost(model.cost)
                const supportsImage = model.inputModalities?.includes("image") === true
                return (
                  <span
                    key={model.id}
                    className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.6875rem]"
                    title={`上下文 ${model.maxInputTokens.toLocaleString()} tokens · 输出上限 ${model.maxOutputTokens.toLocaleString()} tokens`}
                  >
                    {model.name || model.id}
                    {/*
                      成本与模态都是「有就加、没有就什么都不加」：不占位、不留「—」。
                      一个空白占位会让用户以为宿主没读到数据，而事实是插件没申报。
                    */}
                    {cost ? (
                      <span
                        className="ml-1 text-muted-foreground"
                        data-model-cost={model.id}
                        title={`每百万 token 成本：输入 ${model.cost?.input ?? "未申报"}、输出 ${model.cost?.output ?? "未申报"}（货币单位由插件定义）`}
                      >
                        {cost}
                      </span>
                    ) : null}
                    {supportsImage ? (
                      <span
                        className="ml-1 inline-flex items-center gap-0.5 text-muted-foreground"
                        data-model-input-modality="image"
                        title="该模型支持图片输入"
                      >
                        <ImageIcon className="h-3 w-3" aria-hidden="true" />
                        支持图片
                      </span>
                    ) : null}
                  </span>
                )
              })}
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            模型由插件通过 <code>/v1/models</code> 提供，不能在这里手工增删；插件的模型变了就点「刷新模型」。
            停用或卸载插件后，这些模型会从选择器里消失。
          </p>
        </div>
      ) : null}

      {status ? (
        <p
          className={`px-1 pb-2 text-xs ${status.error ? "text-destructive" : "text-muted-foreground"}`}
          role="status"
          aria-live="polite"
        >
          {status.text}
        </p>
      ) : null}
    </div>
  )
}
