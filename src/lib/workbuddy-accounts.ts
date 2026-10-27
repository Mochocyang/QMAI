/**
 * WorkBuddy 账号登录的前端封装（IPC 层，不含业务判断）。
 *
 * 命令面与后端 `src-tauri/src/workbuddy/commands.rs` 一一对应。这里只做三件事：
 *   1. 统一 `invoke` 的调用名与参数形状（后端参数是 snake/camel 混排，集中一处）；
 *   2. 把 `login_wait` 的三态（pending / ready / failed|canceled）收敛成一个
 *      类型化的联合，界面不用自己认字符串；
 *   3. 提供 `waitForLogin`：按固定间隔轮询直到终态，支持取消与超时。
 *
 * ⚠️ 后端**不会**返回 accessToken / refreshToken。任何试图在这里拿凭证的写法
 * 都是错的 —— 凭证只在 Rust 侧用于给上游发请求。
 */

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/platform"

/** 界面上展示的账号（后端 `public_view` 的形状）。 */
export interface WorkbuddyAccount {
  id: string
  provider: string
  /** 昵称；没有昵称时后端已经退化成 uid 尾号 */
  nickname: string
  /** uid 只给尾 6 位 */
  uidTail: string
  /** `cn` / `intl` */
  edition: string
  editionLabel: string
  /** 毫秒时间戳；0 表示上游没给 */
  expiresAt: number
  enabled: boolean
  addedAt: number
}

export interface WorkbuddyAccountsView {
  accounts: WorkbuddyAccount[]
  count: number
}

export interface WorkbuddyModel {
  id: string
  name: string
  maxInputTokens: number
  maxOutputTokens: number
  supportsToolCall: boolean
  supportsReasoning: boolean
  isDefault: boolean
}

export interface WorkbuddyLoginStart {
  state: string
  authUrl: string
  provider: string
  edition: string
  mode: "embedded" | "external"
}

export type WorkbuddyLoginStatus =
  | { status: "pending" }
  | { status: "ready"; account: { uidTail: string; nickname: string }; accounts: WorkbuddyAccountsView }
  | { status: "failed"; error: string }
  | { status: "canceled" }
  | { status: "expired" }

export interface WorkbuddyImportResult {
  account: {
    id: string
    nickname: string
    uidTail: string
    edition: string
    editionLabel: string
  }
  accounts: WorkbuddyAccountsView
}

const NOT_DESKTOP = "WorkBuddy 账号登录仅桌面端可用。"

function requireDesktop(): void {
  if (!isTauri()) throw new Error(NOT_DESKTOP)
}

/** 开始一次网页登录（内嵌窗口 / 系统浏览器）。 */
export async function startWorkbuddyLogin(options: {
  provider?: string
  mode?: "embedded" | "external"
} = {}): Promise<WorkbuddyLoginStart> {
  requireDesktop()
  return invoke<WorkbuddyLoginStart>("workbuddy_login_start", {
    provider: options.provider ?? "workbuddy",
    mode: options.mode ?? "embedded",
  })
}

/** 问一次登录状态。 */
export async function pollWorkbuddyLogin(state: string): Promise<WorkbuddyLoginStatus> {
  requireDesktop()
  return invoke<WorkbuddyLoginStatus>("workbuddy_login_wait", { loginState: state })
}

/** 取消一次登录（用户点「取消等待」）。 */
export async function cancelWorkbuddyLogin(state: string): Promise<boolean> {
  requireDesktop()
  return invoke<boolean>("workbuddy_login_cancel", { loginState: state })
}

export interface WaitForLoginOptions {
  /** 轮询间隔，默认 2 秒（与后端壳侧同一节拍） */
  intervalMs?: number
  /** 总超时，默认 5 分钟（后端 LOGIN_TIMEOUT 同值） */
  timeoutMs?: number
  /** 每次轮询后的回调（界面用来刷新文案） */
  onTick?: (elapsedMs: number) => void
  /** 外部取消信号 */
  signal?: AbortSignal
}

/**
 * 轮询直到终态。
 *
 * 返回 `ready` 或抛错：`failed` 抛后端文案、`canceled` 抛「登录已取消」、
 * 超时抛「等待超时」。界面只需要 try/catch 一次。
 */
export async function waitForLogin(
  state: string,
  options: WaitForLoginOptions = {},
): Promise<Extract<WorkbuddyLoginStatus, { status: "ready" }>> {
  const interval = options.intervalMs ?? 2000
  const timeout = options.timeoutMs ?? 5 * 60 * 1000
  const startedAt = Date.now()

  for (;;) {
    if (options.signal?.aborted) {
      throw new Error("登录已取消")
    }
    const status = await pollWorkbuddyLogin(state)
    switch (status.status) {
      case "ready":
        return status
      case "failed":
        throw new Error(status.error)
      case "canceled":
        throw new Error("登录已取消")
      case "expired":
        throw new Error("登录任务已过期，请重新发起")
      case "pending":
        break
    }
    if (Date.now() - startedAt >= timeout) {
      throw new Error("登录等待超时（5 分钟），请重新发起")
    }
    options.onTick?.(Date.now() - startedAt)
    await sleep(interval, options.signal)
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new Error("登录已取消"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** 当前账号列表。 */
export async function listWorkbuddyAccounts(): Promise<WorkbuddyAccountsView> {
  requireDesktop()
  return invoke<WorkbuddyAccountsView>("workbuddy_accounts_list")
}

export async function removeWorkbuddyAccount(id: string): Promise<WorkbuddyAccountsView> {
  requireDesktop()
  return invoke<WorkbuddyAccountsView>("workbuddy_account_remove", { id })
}

export async function refreshWorkbuddyAccount(id: string): Promise<WorkbuddyAccountsView> {
  requireDesktop()
  return invoke<WorkbuddyAccountsView>("workbuddy_account_refresh", { id })
}

/** 导入一份凭证文件（内容由调用方用 FileReader 读成文本）。 */
export async function importWorkbuddyCredential(
  content: string,
  provider = "workbuddy",
): Promise<WorkbuddyImportResult> {
  requireDesktop()
  return invoke<WorkbuddyImportResult>("workbuddy_import_file", { content, provider })
}

/** 从官方客户端目录导入当前登录态。 */
export async function importWorkbuddyDesktop(provider = "workbuddy"): Promise<WorkbuddyImportResult> {
  requireDesktop()
  return invoke<WorkbuddyImportResult>("workbuddy_import_desktop", { provider })
}

/**
 * 只读探测：本机官方客户端的登录态能不能被读成明文凭证。
 *
 * 新版客户端把 token 存成 `$wbEncrypted`（WorkBuddy 自己的 at-rest 密钥保护），
 * 那种形态结构性读不出来。探测结果用来在界面上**提前**说明，而不是等用户点了
 * 才看到一段底层报错。目录不存在 / 文件缺失同样算不可用 —— 那两种情况用户
 * 一样得走网页登录。
 */
export async function probeWorkbuddyDesktopAvailable(provider = "workbuddy"): Promise<boolean> {
  requireDesktop()
  try {
    const result = await invoke<{ available: boolean; reason?: string }>(
      "workbuddy_desktop_available",
      { provider },
    )
    return result?.available === true
  } catch {
    return false
  }
}

/** 重新拉一次模型目录。 */
export async function refreshWorkbuddyModels(): Promise<{
  models: WorkbuddyModel[]
  count: number
  fetchedAt: number
}> {
  requireDesktop()
  return invoke("workbuddy_models_refresh")
}

/** 读本地缓存的目录（不联网）。 */
export async function readCachedWorkbuddyModels(): Promise<{
  models: Array<{ id: string; name: string }>
  fetchedAt: number
  isRemote: boolean
}> {
  requireDesktop()
  return invoke("workbuddy_models_cached")
}
