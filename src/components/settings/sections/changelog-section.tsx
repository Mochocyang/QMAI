import { useState, useRef } from "react"
import { useTranslation } from "react-i18next"
import { RefreshCw, Download, CheckCircle, AlertCircle } from "lucide-react"
import { allChangelog } from "@/lib/changelog"
import { isTauri } from "@/lib/platform"
import { formatUpdateErrorMessage } from "@/lib/update-error-message"

type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error"
const COLLAPSED_CHANGELOG_ITEM_COUNT = 5

export function ChangelogSection() {
  const { t, i18n } = useTranslation()
  const lang: "en" | "zh" = i18n.language?.startsWith("zh") ? "zh" : "en"
  const entries = allChangelog()
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(() => new Set())
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle")
  const [latestVersion, setLatestVersion] = useState("")
  const [updateNotes, setUpdateNotes] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [downloadProgress, setDownloadProgress] = useState(0)
  const updateHandleRef = useRef<unknown>(null)

  async function handleCheckUpdate() {
    if (!isTauri()) {
      setUpdateStatus("error")
      setErrorMessage("仅桌面版支持自动更新检测")
      return
    }
    setUpdateStatus("checking")
    setErrorMessage("")
    setDownloadProgress(0)
    try {
      const { check } = await import("@tauri-apps/plugin-updater")
      const update = await check()
      if (!update) {
        setUpdateStatus("up-to-date")
      } else {
        setUpdateStatus("available")
        setLatestVersion(update.version)
        setUpdateNotes(update.body?.trim() ?? "")
        updateHandleRef.current = update
      }
    } catch (err) {
      setUpdateStatus("error")
      setErrorMessage(formatUpdateErrorMessage(err))
    }
  }

  async function handleDownloadUpdate() {
    if (!updateHandleRef.current) return
    setUpdateStatus("downloading")
    setDownloadProgress(0)
    try {
      const update = updateHandleRef.current as {
        download: (onEvent?: (event: { event: string; data: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>
        install: () => Promise<void>
      }
      let totalSize = 0
      let downloaded = 0
      await update.download((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalSize = event.data.contentLength
          downloaded = 0
        } else if (event.event === "Progress" && event.data.chunkLength) {
          downloaded += event.data.chunkLength
          if (totalSize > 0) {
            setDownloadProgress(Math.min(Math.round((downloaded / totalSize) * 100), 99))
          } else {
            setDownloadProgress((prev) => Math.min(prev + 1, 99))
          }
        } else if (event.event === "Finished") {
          setDownloadProgress(100)
        }
      })
      // 下载完成，不自动安装，等待用户确认
      setUpdateStatus("ready")
      setDownloadProgress(100)
    } catch (err) {
      setUpdateStatus("error")
      setErrorMessage(formatUpdateErrorMessage(err))
    }
  }

  async function handleInstallNow() {
    if (!updateHandleRef.current) return
    try {
      const update = updateHandleRef.current as { install: () => Promise<void> }
      await update.install()
    } catch {
      // Expected: app restarts during install
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.changelog.title", { defaultValue: "软件更新日志" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          当前版本：v{__APP_VERSION__}
        </p>
      </div>

      {/* 检查更新区域 */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCheckUpdate()}
            disabled={updateStatus === "checking" || updateStatus === "downloading"}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${updateStatus === "checking" ? "animate-spin" : ""}`} />
            {updateStatus === "checking" ? "正在检查..." : "检查更新"}
          </button>

          {updateStatus === "up-to-date" ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-4 w-4" />
              当前已是最新版本
            </span>
          ) : null}

          {updateStatus === "error" ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4" />
              {errorMessage || "检查更新失败"}
            </span>
          ) : null}
        </div>

        {updateStatus === "available" ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  发现新版本：v{latestVersion}
                </p>
                {updateNotes ? (
                  <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{updateNotes}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void handleDownloadUpdate()}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                <Download className="h-3.5 w-3.5" />
                下载更新
              </button>
            </div>
          </div>
        ) : null}

        {updateStatus === "downloading" ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">正在下载更新...</span>
              <span className="font-medium">{downloadProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          </div>
        ) : null}

        {updateStatus === "ready" ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/40">
            <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
              ✅ 更新已下载完成！安装时会关闭当前软件，请确保已保存编辑内容。
            </p>
            <button
              type="button"
              onClick={() => void handleInstallNow()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <Download className="h-4 w-4" />
              立即安装
            </button>
          </div>
        ) : null}
      </div>

      {/* 完整版本历史 */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">版本历史</h3>
        {entries.map((entry) => {
          const lines = entry.highlights[lang]
          const isExpanded = expandedVersions.has(entry.version)
          const hiddenCount = Math.max(0, lines.length - COLLAPSED_CHANGELOG_ITEM_COUNT)
          const visibleLines = isExpanded ? lines : lines.slice(0, COLLAPSED_CHANGELOG_ITEM_COUNT)
          return (
            <div
              key={entry.version}
              data-changelog-version={entry.version}
              className="rounded-lg border border-border/60 bg-muted/20 p-4"
            >
              <div className="flex items-baseline gap-3">
                <span className={`rounded px-2 py-0.5 text-sm font-semibold ${
                  entry.version === __APP_VERSION__
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}>
                  v{entry.version}
                </span>
                <span className="text-xs text-muted-foreground">{entry.date}</span>
                {entry.version === __APP_VERSION__ ? (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">\u2190 当前版本</span>
                ) : null}
              </div>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
                {visibleLines.map((line, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setExpandedVersions((current) => {
                      const next = new Set(current)
                      if (next.has(entry.version)) {
                        next.delete(entry.version)
                      } else {
                        next.add(entry.version)
                      }
                      return next
                    })
                  }}
                  className="mt-3 text-xs font-medium text-primary hover:underline"
                >
                  {isExpanded ? "收起" : `查看更多 ${hiddenCount} 条`}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
