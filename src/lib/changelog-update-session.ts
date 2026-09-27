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

async function loadUpdate(): Promise<ChangelogUpdatePackage | null> {
  if (checkerOverride) return checkerOverride()
  const { check } = await import("@tauri-apps/plugin-updater")
  const update = await check()
  if (!update) return null
  return {
    version: update.version,
    body: update.body,
    download: (onEvent) => update.download(onEvent),
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
