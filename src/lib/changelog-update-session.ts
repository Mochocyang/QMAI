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
}

export type ChangelogUpdatePackage = {
  version: string
  body?: string | null
  download: (onEvent?: (event: DownloadEvent) => void) => Promise<void>
  install: () => Promise<void>
  close: () => Promise<void>
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
   * 拿到"有新版本"之后要安装包字节，这里走我们自己的通道（带代理 + 域名白名单）。
   * 插件自带的 `update.download()` 只能下它自己那条端点上的地址，
   * 而那个地址是 latest.json 里写死的 GitHub 直连 —— 国内实测 12 秒超时。
   */
  const proxy = await resolveProxyForCheck()
  let bytes: Uint8Array | null = null
  if (info.downloadUrl) {
    try {
      bytes = await invoke<number[] | Uint8Array>("updater_download_bytes", {
        url: info.downloadUrl,
      }).then((data) => new Uint8Array(data as ArrayLike<number>))
    } catch (error) {
      console.warn("[updater] 加速通道下载失败，退回插件自带下载：", error)
      bytes = null
    }
  }

  // 无论字节从哪来，句柄还是插件的（安装要靠它自己的资源）。
  const update = await check({ proxy, timeout: CHECK_TIMEOUT_MS })
  if (!update) return null

  return {
    version: update.version,
    body: update.body,
    download: async (onEvent) => {
      if (bytes) {
        // 字节已经下好了：直接汇报开始/完成，进度条照样能走完。
        onEvent?.({ event: "Started", data: { contentLength: bytes.byteLength } } as never)
        onEvent?.({ event: "Finished", data: {} } as never)
        return
      }
      await update.download(onEvent)
    },
    install: () => update.install(),
    close: () => update.close(),
  }
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
