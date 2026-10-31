import { getStore } from "@/lib/web-store"

/**
 * 「有更新时自动提醒」开关 + 更新日志红点 + 后台预下载状态。
 *
 * 用户要的效果：
 *   · 默认照旧：打开软件时发现新版本就弹窗问要不要下载安装；
 *   · 关掉开关后：不再弹窗、不再打扰，但设置 →「更新日志」上亮一个红点，
 *     点进去能看到新版本与更新说明；
 *   · 无论开关开没开，后台都会把新版本预先下好（新版本覆盖旧版本），
 *     用户点「安装」时立刻开始装，不用再干等下载。
 *
 * 红点判断刻意要求「开关关闭」：开关开着时启动已经弹过窗了，
 * 此时再亮红点只是重复提醒。
 */

const APP_UPDATE_AUTO_PROMPT_KEY = "appUpdateAutoPrompt"

export type AppUpdatePrefetchStatus = "idle" | "downloading" | "ready" | "error"

export type AppUpdatePrefetchState = {
  status: AppUpdatePrefetchStatus
  /** 这个状态属于哪个版本；空字符串表示还没有任何版本。 */
  version: string
  /** 预下载好的安装包路径（仅 ready 时有值）。 */
  path: string
}

export type AppUpdateNoticeSnapshot = {
  /** 是否在有更新时弹窗提醒。默认 true。 */
  autoPrompt: boolean
  /** 检查到的新版本号；空字符串表示当前没有待更新版本。 */
  pendingVersion: string
  prefetch: AppUpdatePrefetchState
}

const listeners = new Set<() => void>()

let autoPrompt = true
let pendingVersion = ""
let prefetch: AppUpdatePrefetchState = { status: "idle", version: "", path: "" }
let snapshot: AppUpdateNoticeSnapshot = buildSnapshot()

function buildSnapshot(): AppUpdateNoticeSnapshot {
  return { autoPrompt, pendingVersion, prefetch }
}

function publish() {
  const next = buildSnapshot()
  if (
    next.autoPrompt === snapshot.autoPrompt
    && next.pendingVersion === snapshot.pendingVersion
    && next.prefetch.status === snapshot.prefetch.status
    && next.prefetch.version === snapshot.prefetch.version
    && next.prefetch.path === snapshot.prefetch.path
  ) {
    return
  }
  snapshot = next
  for (const listener of listeners) listener()
}

export function subscribeAppUpdateNotice(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getAppUpdateNoticeSnapshot(): AppUpdateNoticeSnapshot {
  return snapshot
}

/** 同步读取开关（启动分流要用它，不能等异步 IO）。 */
export function getAppUpdateAutoPrompt(): boolean {
  return autoPrompt
}

/**
 * 从 app-state.json 读出开关。
 *
 * 缺省视为开启：老版本没有这个开关，那时打开软件本来就会提示更新，
 * 不能因为升级而把用户的提醒行为悄悄改掉。
 */
export async function loadAppUpdateAutoPrompt(): Promise<boolean> {
  try {
    const store = await getStore()
    const saved = await store.get<boolean>(APP_UPDATE_AUTO_PROMPT_KEY)
    autoPrompt = saved !== false
  } catch (error) {
    console.warn("[updater] 读取更新提醒开关失败，按默认开启处理：", error)
    autoPrompt = true
  }
  publish()
  return autoPrompt
}

/**
 * 打开 / 关闭「有更新时自动提醒」。
 *
 * 先改内存再落盘：开关必须立即响应点击，不能等磁盘。
 * 落盘失败时把界面回滚成用户上一次的选择，避免"看着关了其实没存上"。
 */
export async function setAppUpdateAutoPrompt(next: boolean): Promise<void> {
  const previous = autoPrompt
  autoPrompt = next
  publish()
  try {
    const store = await getStore()
    await store.set(APP_UPDATE_AUTO_PROMPT_KEY, next)
    await store.save()
  } catch (error) {
    console.warn("[updater] 保存更新提醒开关失败：", error)
    autoPrompt = previous
    publish()
    throw error
  }
}

/** 检查到（或清掉）待更新版本号。 */
export function setPendingUpdateVersion(version: string | null) {
  const next = version?.trim() ?? ""
  if (next === pendingVersion) return
  pendingVersion = next
  publish()
}

export function getPendingUpdateVersion(): string {
  return pendingVersion
}

/**
 * 更新日志处是否显示红点。
 *
 * 必须「有新版本」且「已关闭自动提醒」：开着提醒时启动已经弹过窗。
 * 这个判断会被设置页侧栏订阅，所以只做纯计算、不触发任何 IO。
 */
export function hasPendingUpdate(): boolean {
  return pendingVersion !== "" && !autoPrompt
}

export function markPrefetchDownloading(version: string) {
  prefetch = { status: "downloading", version, path: "" }
  publish()
}

export function markPrefetchReady(version: string, path: string) {
  prefetch = { status: "ready", version, path }
  publish()
}

/**
 * 预下载失败：只记状态，界面不弹任何东西（用户没要求更新，别打扰他）。
 */
export function markPrefetchFailed(version: string) {
  prefetch = { status: "error", version, path: "" }
  publish()
}

/** 这个版本是否还需要下载：同版本正在下或已下好都不再重复。 */
export function shouldPrefetch(version: string): boolean {
  const wanted = version.trim()
  if (!wanted) return false
  if (prefetch.version !== wanted) return true
  return prefetch.status !== "downloading" && prefetch.status !== "ready"
}

/** 预下载好的安装包路径；没有就返回 null。 */
export function getPendingUpdatePath(): string | null {
  return prefetch.status === "ready" && prefetch.path ? prefetch.path : null
}

/** 预下载好的包对应的版本号；没有就返回空字符串。 */
export function getPendingUpdateReadyVersion(): string {
  return prefetch.status === "ready" ? prefetch.version : ""
}

export function resetAppUpdateNoticeForTests(): void {
  autoPrompt = true
  pendingVersion = ""
  prefetch = { status: "idle", version: "", path: "" }
  snapshot = buildSnapshot()
  for (const listener of listeners) listener()
}
