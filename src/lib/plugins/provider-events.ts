/**
 * 插件 provider 的 Tauri 事件订阅（受控登录窗口的两个后端事件）。
 *
 * 为什么需要这一层：
 *
 * 1. **关窗后自动刷新** —— 受控登录窗口关闭时，Rust 侧会自己重探活 + 重抓模型
 *    （`src-tauri/src/plugins/login_window.rs`），然后 emit `plugin-provider-models-refreshed`。
 *    刷新完全发生在后端，前端内存里的 `providerConfigs` 还是关窗前的旧快照。
 *    不接这个事件，用户看到的就是「登录完模型没变」，只能再点一次「刷新模型」——
 *    而那正是自动刷新想省掉的那一步。
 *
 * 2. **白名单拦截提示** —— 窗口用 `on_navigation` 拦下白名单外的域名后，
 *    WebView 什么都不加载：用户只看到「窗口停在原页面、点链接没反应」，
 *    完全不知道那是安全拦截。Rust 侧不会为了能提示而放松白名单，
 *    所以补给用户的这条可读提示只能由宿主侧（这里）给出。
 *
 * 为什么 `listen` 的导入放在这个文件、而不是 `provider-sync.ts`：
 * `provider-sync.ts` 有纯逻辑单测（`provider-sync.spec.ts`）在 Node 环境里跑，
 * 一旦它 import 了 `@tauri-apps/api/event`，那些测试就得跟着打桩 Tauri。
 * 订阅与同步是两件事：这里只负责「把事件搬进前端」，同步语义留在 `provider-sync.ts`。
 */
import { listen } from "@tauri-apps/api/event"

/** 事件名常量，避免字符串散落。与 Rust 侧 `app.emit(...)` 的字面量必须一字不差。 */
export const PROVIDER_MODELS_REFRESHED_EVENT = "plugin-provider-models-refreshed"
export const PROVIDER_NAVIGATION_BLOCKED_EVENT = "plugin-provider-navigation-blocked"

/**
 * `plugin-provider-models-refreshed` 的 payload。
 *
 * 键名与 Rust 侧 `login_window.rs` 里 `serde_json::json!({...})` 一致：
 * `pluginId` / `providerId` / `ok` / `modelCount` / `error`。
 * 注意 `error` 在成功时是**空字符串**（Rust 侧用 `unwrap_or_default()`），
 * 所以这里按「可能为空」处理，不要用「有 error 就是失败」来判断。
 */
export interface ProviderModelsRefreshedPayload {
  pluginId: string
  providerId: string
  ok: boolean
  /** 本次抓到的模型数；失败时为 0。 */
  modelCount?: number
  /** 失败原因；成功时为空字符串。 */
  error?: string
}

/**
 * `plugin-provider-navigation-blocked` 的 payload。
 *
 * 键名与 Rust 侧 `on_navigation` 里 emit 的一致：`pluginId` / `providerId` / `host`。
 * `host` 来自 `url.host_str().unwrap_or("")` —— 取不到主机名时是空串。
 */
export interface ProviderNavigationBlockedPayload {
  pluginId: string
  providerId: string
  /** 被拦下的目标域名（不含协议与端口）。空串 = Rust 侧没能解析出主机名。 */
  host: string
}

/** 注册失败的兜底：调用方不必判空，直接当 unlisten 用。 */
const noopUnlisten = (): void => {}

/**
 * 订阅「关窗后自动刷新模型」的结果事件，返回 unlisten。
 *
 * 注册失败（不在 Tauri 环境、事件能力不可用、命令缺失）只 `console.warn`，
 * **不抛给调用方**：这是启动路径上的附加能力，插件系统不可用不该挡住应用启动。
 */
export async function subscribeProviderModelsRefreshed(
  onRefreshed: (payload: ProviderModelsRefreshedPayload) => void,
): Promise<() => void> {
  try {
    return await listen<ProviderModelsRefreshedPayload>(PROVIDER_MODELS_REFRESHED_EVENT, (event) => {
      onRefreshed(event.payload)
    })
  } catch (error) {
    console.warn("[plugins] 订阅 provider 模型刷新事件失败，登录后将不会自动更新模型列表：", error)
    return noopUnlisten
  }
}

/** 同一个域名在这段时间内只提示一次（用户连点链接时会连发多个事件）。 */
const NAVIGATION_NOTICE_THROTTLE_MS = 3000

/** host → 上次提示的时间戳。模块级：跨窗口生命周期，节流才对得上。 */
const lastNavigationNoticeAt = new Map<string, number>()

/** 仅供测试：清掉节流状态，让每个用例从干净状态开始。 */
export function resetNavigationBlockedThrottle(): void {
  lastNavigationNoticeAt.clear()
}

/**
 * 拦截提示的文案（单一来源：控制台日志与用户可见提示用同一句话）。
 *
 * 必须写明「这是安全拦截，不是坏了」：否则用户会以为登录窗口本身出故障了，
 * 转头去卸载重装插件，而真正的原因是目标域名没在清单的 `authDomains` 里声明。
 */
export function describeNavigationBlocked(payload: ProviderNavigationBlockedPayload): string {
  const host = payload.host.trim() || "（未知域名）"
  return `登录窗口拦下了一次跳转：${host} 不在该插件声明的域名白名单里。如果你确实需要在这个窗口里打开它，请联系插件作者在 authDomains 里声明。`
}

export interface NavigationBlockedSubscribeOptions {
  /** 节流窗口，默认 3 秒；测试可传 0 关掉。 */
  throttleMs?: number
  /** 取当前时间，默认 `Date.now`；测试注入固定时钟用。 */
  now?: () => number
}

/**
 * 订阅「登录窗口拦下跳转」事件，返回 unlisten。
 *
 * 同一 `host` 在节流窗口内只回调一次：用户会连点几次链接，刷屏没有信息量。
 * 注册失败同样只 warn + 返回 no-op unlisten（与模型刷新事件同一容错口径）。
 */
export async function subscribeProviderNavigationBlocked(
  onBlocked: (payload: ProviderNavigationBlockedPayload) => void,
  options: NavigationBlockedSubscribeOptions = {},
): Promise<() => void> {
  const throttleMs = options.throttleMs ?? NAVIGATION_NOTICE_THROTTLE_MS
  const now = options.now ?? Date.now
  try {
    return await listen<ProviderNavigationBlockedPayload>(PROVIDER_NAVIGATION_BLOCKED_EVENT, (event) => {
      const payload = event.payload
      const key = payload.host ?? ""
      const at = now()
      const previous = lastNavigationNoticeAt.get(key)
      if (previous !== undefined && at - previous < throttleMs) return
      lastNavigationNoticeAt.set(key, at)
      // 先记日志再交给调用方：提示位置将来变了（或用户不在设置页），
      // 排查时至少还能在控制台看到同一句话。
      console.warn(`[plugins] ${describeNavigationBlocked(payload)}`)
      onBlocked(payload)
    })
  } catch (error) {
    console.warn("[plugins] 订阅登录窗口跳转拦截事件失败，被拦的跳转将不会有任何提示：", error)
    return noopUnlisten
  }
}
