/**
 * 登录窗口打开后的「等登录完成」轮询。
 *
 * ── 它解决什么问题 ──────────────────────────────────────────────
 * 账号类插件（WorkBuddy 等）的登录是在**受控窗口内部**完成的：页面自己发起、
 * 自己跳转、自己轮询结果。宿主的模型刷新目前挂在窗口的 `CloseRequested` 上，
 * 于是出现一个很自然的死角 ——
 *
 *   用户登录成功 → 看到"登录成功"页 → 把窗口撂在那儿 → 回到 QMAI
 *   → 模型列表还是空的（因为窗口没关，刷新链一步都没走）
 *
 * 这一层不依赖"窗口有没有关"：**只要插件从"未就绪"变成"就绪"，就认为登录成了**，
 * 立刻刷新模型并同步 provider 快照。
 *
 * ── 为什么放在前端而不是后端 ────────────────────────────────────
 * 后端那条路要给 `PluginsState` 塞 `AppHandle` 并让宿主的 HTTP 端点能摸到它 ——
 * 实测那组改动会让**测试二进制**在启动时 `STATUS_ENTRYPOINT_NOT_FOUND` 崩溃。
 * 而"轮询一个已经存在的状态、再调一个已经存在的命令"完全在前端就能做，
 * 两个能力都是现成的（`plugins_providers` + `plugins_provider_refresh_models`）。
 *
 * ── 成本 ────────────────────────────────────────────────────────
 * 只在用户点过「登录」之后的几分钟里跑，每次只是一个本机 IPC；用户关窗、
 * 登录成功、或超时都会停。不做常驻轮询。
 */

import { pluginsApi } from "./api"
import { syncPluginProviders } from "./provider-sync"
import type { PluginProviderView } from "./types"

/** 轮询间隔。3 秒：登录通常十几秒完成，这个粒度对用户是"立刻"，对 CPU 是可以忽略。 */
export const LOGIN_WATCH_INTERVAL_MS = 3000

/** 最多等 5 分钟（与插件侧登录超时一致）。超时后安静停掉，不打扰用户。 */
export const LOGIN_WATCH_TIMEOUT_MS = 5 * 60 * 1000

export interface LoginWatchOptions {
  providerId: string
  /** 就绪/登录态变化时的回调（调用方用来提示用户）。 */
  onReady?: (view: PluginProviderView) => void
  /** 超时回调。 */
  onTimeout?: () => void
  intervalMs?: number
  timeoutMs?: number
  /** 测试注入：取 provider 列表。 */
  listProviders?: () => Promise<PluginProviderView[]>
  /** 测试注入：刷新模型。 */
  refresh?: (providerId: string) => Promise<unknown>
  /** 测试注入：登录完成后关掉登录窗口（生产路径调 providerCloseLogin）。 */
  closeWindow?: (providerId: string) => Promise<unknown>
  /** 测试注入：同步快照。 */
  sync?: () => Promise<unknown>
  /** 测试注入：setTimeout。 */
  schedule?: (fn: () => void, ms: number) => unknown
  /** 测试注入：clearTimeout。 */
  cancel?: (handle: unknown) => void
  now?: () => number
}

/**
 * 开始观察某个 provider 的登录完成。返回停止函数（幂等）。
 *
 * 判定"登录成了"的条件：`ready === true` **且** 有模型。
 * 只看 ready 不够 —— 有些插件 provider 起来就是 ready（只是没有凭证），
 * 而"有模型"才说明它真的拿到 token 并拉到了清单。
 */
export function watchProviderLogin(options: LoginWatchOptions): () => void {
  const {
    providerId,
    onReady,
    onTimeout,
    intervalMs = LOGIN_WATCH_INTERVAL_MS,
    timeoutMs = LOGIN_WATCH_TIMEOUT_MS,
    listProviders = () => pluginsApi.providers(),
    refresh = (id: string) => pluginsApi.refreshProviderModels(id),
    closeWindow = (id: string) => pluginsApi.providerCloseLogin(id),
    sync = () => syncPluginProviders(),
    schedule = setTimeout as unknown as (fn: () => void, ms: number) => unknown,
    cancel = clearTimeout as unknown as (handle: unknown) => void,
    now = Date.now,
  } = options

  const deadline = now() + timeoutMs
  let stopped = false
  let handle: unknown = null

  const stop = () => {
    if (stopped) return
    stopped = true
    if (handle !== null) cancel(handle)
  }

  const tick = async () => {
    if (stopped) return
    if (now() > deadline) {
      stopped = true
      onTimeout?.()
      return
    }
    try {
      const providers = await listProviders()
      const view = providers.find((item) => item.providerId === providerId)
      if (view && view.ready && view.models.length > 0) {
        /*
         * 就绪且有模型 = 登录完成了。
         *
         * 两件收尾事：
         * 1. 刷新模型（ready 可能是旧状态；刷新是幂等的）。
         * 2. **关掉登录窗口** —— 插件自己关不了它（宿主的 webview），
         *    而用户看到"登录成功"页就不管了。宿主关窗后还会再刷一次模型，
         *    双保险但不冲突（都是幂等操作）。
         */
        try {
          await refresh(providerId)
        } catch (cause) {
          console.warn(`[plugins] 登录后刷新模型失败（可在卡片上手动刷新）：${String(cause)}`)
        }
        try {
          await closeWindow(providerId)
        } catch (cause) {
          // 关窗失败（窗口已被用户手动关掉是最常见原因）：不该掩盖"登录成功"。
          console.warn(`[plugins] 登录完成后关窗失败（可能已被手动关闭）：${String(cause)}`)
        }
        try {
          await sync()
        } catch (cause) {
          console.warn("[plugins] 登录后同步 provider 失败：", cause)
        }
        stopped = true
        onReady?.(view)
        return
      }
    } catch (cause) {
      // 轮询本身出错（插件正在重启等）：继续等，不把一次抖动当成失败。
      console.warn(`[plugins] 轮询 provider ${providerId} 状态失败：${String(cause)}`)
    }
    if (stopped) return
    handle = schedule(() => void tick(), intervalMs)
  }

  // 第一拍延后一个间隔：用户点完「登录」立刻查，多半还没开始登录。
  handle = schedule(() => void tick(), intervalMs)
  return stop
}
