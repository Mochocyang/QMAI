import {
  APP_AUTO_UPDATE_UNSUPPORTED_MESSAGE,
  isAppAutoUpdateSupported,
} from "@/lib/app-update-support"
import { isTauri } from "@/lib/platform"
import { formatUpdateErrorMessage } from "@/lib/update-error-message"
import type { DownloadEvent } from "@tauri-apps/plugin-updater"

/**
 * 更新日志页会在切换设置分类时卸载。检查结果和已下载的安装包放在这里，
 * 离开页面再回来仍然可以安装；安装失败也不会丢掉这次下载。
 * 进程退出后这份会话消失，下次打开需要重新下载。
 */
export type ChangelogUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "error"

export type ChangelogUpdateSnapshot = {
  status: ChangelogUpdateStatus
  latestVersion: string
  updateNotes: string
  errorMessage: string
  downloadProgress: number
  /**
   * 正在用哪条下载源（"官网直链" / "加速通道 A" / "直连" …）。
   *
   * 国内各条线路速度差异大，明确告诉用户"正在从官网直链下载"比一个
   * 光转的进度条更有说服力——他至少知道东西在动、走的是哪条路。
   */
  downloadSource: string
  /** 已下载字节，界面显示 "12.4 / 142.9 MB"。 */
  downloadBytes: number
  /** 总字节。0 表示还不知道。 */
  downloadTotalBytes: number
}

export type ChangelogUpdatePackage = {
  version: string
  body?: string | null
  download: (onEvent?: (event: DownloadEvent) => void) => Promise<void>
  install: () => Promise<void>
  close: () => Promise<void>
  /**
   * 安装包是否在「检查更新」阶段就已经下好了（走我们自己的多源分段下载）。
   *
   * 为什么需要这个标记：那种情况下 `download()` 立刻返回，`trackDownload`
   * 收不到任何真实进度 —— 进度条会从 0 直接跳到 100，用户在这 50 多秒里
   * 看到的是一个不动的界面，以为"点了没反应"（真实投诉）。
   */
  preDownloaded?: boolean
}

type ChangelogUpdateChecker = () => Promise<ChangelogUpdatePackage | null>

const NORMAL_EXIT_KEYWORDS = ["process exited", "disconnected", "closed"]

function createIdleSnapshot(): ChangelogUpdateSnapshot {
  return {
    status: "idle",
    latestVersion: "",
    updateNotes: "",
    errorMessage: "",
    downloadProgress: 0,
    downloadSource: "",
    downloadBytes: 0,
    downloadTotalBytes: 0,
  }
}

let snapshot = createIdleSnapshot()
let currentPackage: ChangelogUpdatePackage | null = null
let busy = false
let checkerOverride: ChangelogUpdateChecker | null = null
const listeners = new Set<() => void>()

export function subscribeChangelogUpdateSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getChangelogUpdateSnapshot(): ChangelogUpdateSnapshot {
  return snapshot
}

export function __setChangelogUpdateCheckerForTest(checker: ChangelogUpdateChecker | null): void {
  checkerOverride = checker
}

export function resetChangelogUpdateSessionForTests(): void {
  checkerOverride = null
  currentPackage = null
  busy = false
  snapshot = createIdleSnapshot()
  for (const listener of listeners) listener()
}

function publish(next: ChangelogUpdateSnapshot) {
  if (
    next.status === snapshot.status
    && next.latestVersion === snapshot.latestVersion
    && next.updateNotes === snapshot.updateNotes
    && next.errorMessage === snapshot.errorMessage
    && next.downloadProgress === snapshot.downloadProgress
    // 漏掉这三个会让"进度百分比不变但字节在涨"的时刻不刷新界面。
    && next.downloadSource === snapshot.downloadSource
    && next.downloadBytes === snapshot.downloadBytes
    && next.downloadTotalBytes === snapshot.downloadTotalBytes
  ) {
    return
  }
  snapshot = next
  for (const listener of listeners) listener()
}

function updateSnapshot(patch: Partial<ChangelogUpdateSnapshot>) {
  publish({ ...snapshot, ...patch })
}

function formatActionError(action: string, error: unknown): string {
  return formatUpdateErrorMessage(error).replace(/^检查更新失败/, `${action}失败`)
}

function isExpectedUpdaterExit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return NORMAL_EXIT_KEYWORDS.some((keyword) => message.toLowerCase().includes(keyword.toLowerCase()))
}

async function closePackage(pkg: ChangelogUpdatePackage) {
  try {
    await pkg.close()
  } catch {
    // 释放更新资源失败时，不阻断当前这次检查、下载或安装。
  }
}

/**
 * 读出用户配好的代理地址（没启用或地址非法时返回 undefined）。
 *
 * 用户就卡在「点检查更新毫无反应 20 秒」上，而 plugin-updater 自带的
 * http 客户端**不读**环境变量里的 HTTP_PROXY —— 不显式传进去，
 * 用户开了代理也等于没开（实测发现）。插件 2.11 起支持 check({ proxy, timeout })。
 */
async function resolveProxyForCheck(): Promise<string | undefined> {
  try {
    const { useWikiStore } = await import("@/stores/wiki-store")
    const proxy = useWikiStore.getState().proxyConfig
    if (!proxy?.enabled) return undefined
    const url = proxy.url?.trim() ?? ""
    if (!url.startsWith("http://") && !url.startsWith("https://")) return undefined
    return url
  } catch {
    return undefined
  }
}

/** 检查更新必须有上限：20 秒无响应是用户最不能接受的那种"点了没用"。 */
const CHECK_TIMEOUT_MS = 10_000

/**
 * 检查更新：**只调一次**，由 Rust 决定用哪条通道。
 *
 * `updater_check` 走 `ChannelTable::effective()`（内置表 + 远程覆盖），
 * 逐个试端点、失败换下一个。这样：
 *   · 不再是"烧死在编译期的单一端点"，某个镜像挂了改仓库里的 JSON 即可；
 *   · 也不再有"先自建问一遍、再让插件问一遍"的重复请求。
 *
 * 拿到的只是一个"有新版本"的结论 + 安装包地址；真正下载与安装由调用方
 * 走 `updater_download_bytes`（带代理、带白名单）+ 插件的 `install(bytes)`。
 */
/**
 * 下载进度事件的负载（Rust 侧 `updater://download-progress`）。
 *
 * 带 `source` 是为了让用户知道"正在用哪条源"——国内网速差异极大，
 * 一句"正在从官网直链下载"比一个光转的进度条有说服力得多。
 */
interface DownloadProgressPayload {
  downloaded: number
  total: number
  source: string
}

/** 当前下载源，供界面显示。 */
let activeSource = ""

async function loadUpdate(): Promise<ChangelogUpdatePackage | null> {
  if (checkerOverride) return checkerOverride()
  const { invoke } = await import("@tauri-apps/api/core")
  const { check } = await import("@tauri-apps/plugin-updater")

  const info = await invoke<{
    version: string | null
    notes: string | null
    downloadUrl: string | null
  }>("updater_check")
  if (!info?.version) return null

  /*
   * 安装包用我们自己的多源分段下载：
   *   官网直链（Azure+Cloudflare，实测 2.7 MB/s）→ 各反代 → 直连兜底，
   *   每个源内部再拆 8 段并发。
   * 插件自带的 `update.download()` 是单连接 + 写死的 GitHub 直连地址，
   * 国内实测 58 KB/s（142.9 MB 要 42 分钟），所以不用它。
   */
  /*
   * **检查阶段只问结论，不下包。**
   *
   * 曾经在这里就把 143 MB 装包下完了 —— 后果是用户点「检查更新」后
   * 要干等 50 多秒，界面还只是"正在检查"，完全不知道在下东西；
   * 等他真点了「下载」，包已下完，进度条只会从 0 跳到 100（真实投诉）。
   * 现在下载交给 `downloadChangelogUpdate`，那里才有真实进度。
   */
  // 检查这一步也要走用户代理：插件自己的 http 客户端不读环境变量。
  const proxy = await resolveProxyForCheck()
  const releaseUrl = info.downloadUrl
  const wantedVersion = info.version

  // 句柄还是要插件的：install 依赖它自己的资源与签名校验。
  const update = await check({ proxy, timeout: CHECK_TIMEOUT_MS })
  if (!update) return null

  return {
    version: update.version,
    body: update.body,
    download: async (onEvent) => {
      /*
       * 优先用我们自己的多源分段下载（官网直链 → 反代 → 直连，各源内 8 段并发）。
       * 真实进度由 `updater://download-progress` 实时推送；这里**先订阅再下载**。
       */
      if (releaseUrl) {
        let unsubscribe: (() => void) | null = null
        try {
          unsubscribe = await subscribeDownloadProgress()
          await invoke<string>("updater_download_package", {
            releaseUrl,
            version: wantedVersion,
          })
          // 让 trackDownload 收尾置 100（真实百分比已经由事件推过了）。
          onEvent?.({ event: "Started", data: { contentLength: 1 } } as never)
          onEvent?.({ event: "Finished", data: {} } as never)
          return
        } catch (error) {
          console.warn("[updater] 多源分段下载失败，退回插件自带下载：", error)
        } finally {
          unsubscribe?.()
        }
      }
      // 兜底：插件自己的单连接下载（慢，但能下）。
      await update.download(onEvent)
    },
    install: () => update.install(),
    close: () => update.close(),
    preDownloaded: false,
  }
}

/**
 * 订阅下载进度并折算成百分比。
 *
 * 返回取消订阅函数；调用方在下载结束后必须调用，否则监听器会累积。
 */
export async function subscribeDownloadProgress(): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event")
  const unlisten = await listen<DownloadProgressPayload>(
    "updater://download-progress",
    (event) => {
      const { downloaded, total, source } = event.payload
      activeSource = source
      if (total > 0) {
        updateSnapshot({
          downloadProgress: Math.min(Math.round((downloaded / total) * 100), 99),
          downloadSource: source,
          downloadBytes: downloaded,
          downloadTotalBytes: total,
        })
      }
    },
  )
  return unlisten
}

/** 当前正在用哪条下载源（空字符串表示还没开始）。 */
export function currentDownloadSource(): string {
  return activeSource
}

async function trackDownload(pkg: ChangelogUpdatePackage) {
  let totalSize = 0
  let downloaded = 0
  await pkg.download((event) => {
    if (event.event === "Started" && event.data.contentLength) {
      totalSize = event.data.contentLength
      downloaded = 0
      return
    }
    if (event.event === "Progress" && event.data.chunkLength) {
      downloaded += event.data.chunkLength
      if (totalSize > 0) {
        updateSnapshot({
          downloadProgress: Math.min(Math.round((downloaded / totalSize) * 100), 99),
        })
      } else {
        updateSnapshot({
          downloadProgress: Math.min(snapshot.downloadProgress + 1, 99),
        })
      }
      return
    }
    if (event.event === "Finished") {
      updateSnapshot({ downloadProgress: 100 })
    }
  })
}

function restoreReadyPackage(pkg: ChangelogUpdatePackage, errorMessage = "") {
  currentPackage = pkg
  updateSnapshot({
    status: "ready",
    latestVersion: pkg.version,
    updateNotes: pkg.body?.trim() ?? "",
    downloadProgress: 100,
    errorMessage,
  })
}

export async function checkForChangelogUpdate(): Promise<void> {
  if (busy || snapshot.status === "checking" || snapshot.status === "downloading") return
  if (!isTauri()) {
    updateSnapshot({
      status: "error",
      errorMessage: "仅桌面版支持自动更新检测",
      downloadProgress: 0,
    })
    return
  }
  if (!isAppAutoUpdateSupported()) {
    updateSnapshot({
      status: "error",
      errorMessage: APP_AUTO_UPDATE_UNSUPPORTED_MESSAGE,
      downloadProgress: 0,
    })
    return
  }

  const previous = currentPackage
  const hadDownloadedPackage = snapshot.status === "ready" && previous !== null
  busy = true
  updateSnapshot({
    status: "checking",
    errorMessage: "",
    ...(hadDownloadedPackage ? {} : { downloadProgress: 0 }),
  })
  try {
    const update = await loadUpdate()
    if (!update) {
      if (hadDownloadedPackage && previous) {
        restoreReadyPackage(previous)
        return
      }
      if (previous) await closePackage(previous)
      currentPackage = null
      updateSnapshot({
        status: "up-to-date",
        latestVersion: "",
        updateNotes: "",
        errorMessage: "",
        downloadProgress: 0,
      })
      return
    }

    if (hadDownloadedPackage && previous && update.version === previous.version) {
      await closePackage(update)
      restoreReadyPackage(previous)
      return
    }

    if (previous) await closePackage(previous)
    currentPackage = update
    updateSnapshot({
      status: "available",
      latestVersion: update.version,
      updateNotes: update.body?.trim() ?? "",
      errorMessage: "",
      downloadProgress: 0,
    })
  } catch (error) {
    if (hadDownloadedPackage && previous) {
      restoreReadyPackage(previous, formatUpdateErrorMessage(error))
      return
    }
    updateSnapshot({
      status: "error",
      errorMessage: formatUpdateErrorMessage(error),
      downloadProgress: 0,
    })
  } finally {
    busy = false
  }
}

export async function downloadChangelogUpdate(): Promise<void> {
  if (busy || !currentPackage || snapshot.status !== "available") return
  const pkg = currentPackage
  busy = true
  updateSnapshot({ status: "downloading", downloadProgress: 0, errorMessage: "" })
  /*
   * 下载进度来自 Rust 的 `updater://download-progress`（8 段并发各自累加）。
   * 必须在开始前订阅、结束后**一定**退订，否则切几次面板就会叠一堆监听器。
   */
  try {
    await trackDownload(pkg)
    updateSnapshot({ status: "ready", downloadProgress: 100, errorMessage: "" })
  } catch (error) {
    updateSnapshot({
      status: "error",
      errorMessage: formatUpdateErrorMessage(error),
      downloadProgress: 0,
    })
  } finally {
    busy = false
  }
}

export async function installChangelogUpdate(): Promise<void> {
  if (busy || snapshot.status !== "ready" || !currentPackage) return
  const pkg = currentPackage
  busy = true
  updateSnapshot({ errorMessage: "" })
  try {
    await pkg.install()
  } catch (error) {
    if (isExpectedUpdaterExit(error)) return
    updateSnapshot({
      status: "ready",
      errorMessage: formatActionError("安装", error),
      downloadProgress: 100,
    })
  } finally {
    busy = false
  }
}

export async function redownloadChangelogUpdate(): Promise<void> {
  if (busy || snapshot.status !== "ready" || !currentPackage) return
  const previous = currentPackage
  busy = true
  updateSnapshot({ status: "downloading", downloadProgress: 0, errorMessage: "" })
  let nextPackage: ChangelogUpdatePackage | null = null
  let downloaded = false
  try {
    const update = await loadUpdate()
    if (!update) {
      restoreReadyPackage(previous, "重新下载失败：没有从更新服务器拿到新版本。")
      return
    }
    nextPackage = update
    await trackDownload(update)
    downloaded = true
    await closePackage(previous)
    currentPackage = update
    updateSnapshot({
      status: "ready",
      latestVersion: update.version,
      updateNotes: update.body?.trim() ?? "",
      downloadProgress: 100,
      errorMessage: "",
    })
  } catch (error) {
    if (nextPackage && !downloaded) await closePackage(nextPackage)
    restoreReadyPackage(previous, formatActionError("重新下载", error))
  } finally {
    busy = false
  }
}
