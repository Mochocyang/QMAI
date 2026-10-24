/**
 * 设置 › 云同步。
 *
 * 与设置页其它分区不同：本分区没有「保存」页脚，所有改动即时落盘
 * （云同步是后台服务，不能等用户点保存才生效）。
 *
 * 关键行为：
 * - 开关打开后立刻出现登录门；未登录是稳定态，不是错误。
 * - 取消登录不回滚开关；关闭开关不解除绑定、不删凭据。
 * - 换网盘 = 换账号：切换 provider 会清掉 connected 与账号显示。
 */

import { useState } from "react"
import { Check, Cloud, FolderOpen, Loader2, LogOut, RefreshCw, Server } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { resolveNotice } from "@/lib/cloud-sync/notice"
import { CLOUD_PROVIDERS, type CloudProviderMeta } from "@/lib/cloud-sync/providers"
import { formatSyncAge } from "@/lib/cloud-sync/status"
import { enabledTargets, type CloudProviderId } from "@/lib/cloud-sync/types"
import { isTauri } from "@/lib/platform"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"
import { useTranslation } from "react-i18next"

import { CloudSyncLoginDialog } from "./cloud-sync-login-dialog"

const PROVIDER_ICONS: Record<CloudProviderId, typeof Cloud> = {
  baidu: Cloud,
  webdav: Server,
  folder: FolderOpen,
}

function ProviderCard({
  provider,
  selected,
  enabled,
  connected,
  accountLabel,
  onSelect,
  onToggle,
}: {
  provider: CloudProviderMeta
  /** 是不是「正在配置的这个」：点卡片主体切换。 */
  selected: boolean
  /** 是不是参与同步：右上角勾选框控制。 */
  enabled: boolean
  connected: boolean
  accountLabel?: string
  onSelect: () => void
  onToggle: () => void
}) {
  const Icon = PROVIDER_ICONS[provider.id]
  const available = provider.available !== false
  // 这一版不可用的网盘（百度）：主体点不动、也不能新勾选。
  // 但如果它之前已经被勾上了，仍然允许取消 —— 别让用户被旧配置困住。
  const canToggle = available || enabled
  const subtitle = !available
    ? provider.unavailableHint ?? "后续版本开放"
    : enabled && connected
      ? accountLabel ?? "已连接"
      : provider.hint
  return (
    <div
      data-ui="cloud-sync-provider-card"
      data-provider-card={provider.id}
      data-target-enabled={enabled}
      data-provider-available={available ? "true" : "false"}
      className={`flex items-start gap-1 rounded-lg border p-2.5 text-sm transition-colors ${
        selected ? "border-primary bg-primary/5" : available ? "hover:bg-accent/40" : ""
      } ${available ? "" : "opacity-60"}`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-disabled={!available}
        disabled={!available}
        data-ui="cloud-sync-provider"
        data-provider={provider.id}
        onClick={onSelect}
        className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
          available ? "" : "cursor-not-allowed"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{provider.label}</span>
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>
      </button>
      <button
        type="button"
        aria-pressed={enabled}
        aria-label={`${provider.label}：参与同步`}
        title={
          !canToggle
            ? provider.unavailableHint ?? "后续版本开放"
            : enabled
              ? "取消勾选后不再同步到这个网盘（账号会保留）"
              : "勾选后一起同步到这个网盘"
        }
        aria-disabled={!canToggle}
        disabled={!canToggle}
        data-ui="cloud-sync-target-toggle"
        data-target-toggle={provider.id}
        onClick={onToggle}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
          enabled ? "border-primary bg-primary text-primary-foreground" : "border-input"
        } ${canToggle ? "" : "cursor-not-allowed"}`}
      >
        {enabled ? <Check className="h-3.5 w-3.5" /> : null}
      </button>
    </div>
  )
}

function WebdavForm() {
  const connectWebdav = useCloudSyncStore((state) => state.connectWebdav)
  const [url, setUrl] = useState("https://dav.jianguoyun.com/dav/")
  const [user, setUser] = useState("")
  const [password, setPassword] = useState("")
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setConnecting(true)
    setError(null)
    try {
      const result = await connectWebdav({ url: url.trim(), user: user.trim(), password })
      if (!result.ok) setError(resolveNotice(result.errorCode).message)
      else {
        setPassword("")
      }
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="cloud-sync-webdav-url">地址</Label>
        <Input
          id="cloud-sync-webdav-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://dav.jianguoyun.com/dav/"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cloud-sync-webdav-user">用户名</Label>
          <Input id="cloud-sync-webdav-user" value={user} onChange={(event) => setUser(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cloud-sync-webdav-password">应用密码</Label>
          <Input
            id="cloud-sync-webdav-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="坚果云请填应用密码，不是登录密码"
          />
        </div>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button onClick={() => void submit()} disabled={connecting || !url.trim() || !user.trim() || !password}>
        {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        测试并连接
      </Button>
    </div>
  )
}

function FolderPicker() {
  const connectFolder = useCloudSyncStore((state) => state.connectFolder)
  const folderPath = useCloudSyncStore((state) => state.config.folderPath)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick() {
    if (!isTauri()) {
      setError("需要在桌面应用里选择目录")
      return
    }
    const { open } = await import("@tauri-apps/plugin-dialog")
    const picked = await open({ directory: true, multiple: false })
    if (typeof picked !== "string") return
    setConnecting(true)
    setError(null)
    try {
      const result = await connectFolder(picked)
      if (!result.ok) setError(resolveNotice(result.errorCode).message)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={() => void pick()} disabled={connecting}>
        {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
        选择同步目录
      </Button>
      {folderPath ? <p className="break-all text-xs text-muted-foreground">{folderPath}</p> : null}
      <p className="text-xs text-muted-foreground">
        选网盘客户端在你电脑上的同步目录（例如坚果云的同步文件夹、百度网盘的「同步空间」）。
        上传下载由网盘客户端完成，应用只负责往这个目录里读写。
      </p>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function CloudSyncSection() {
  const { t } = useTranslation()
  const config = useCloudSyncStore((state) => state.config)
  const runtime = useCloudSyncStore((state) => state.runtime)
  const saving = useCloudSyncStore((state) => state.saving)
  const setEnabled = useCloudSyncStore((state) => state.setEnabled)
  const setProvider = useCloudSyncStore((state) => state.setProvider)
  const toggleTarget = useCloudSyncStore((state) => state.toggleTarget)
  const setScope = useCloudSyncStore((state) => state.setScope)
  const setIncludeSnapshots = useCloudSyncStore((state) => state.setIncludeSnapshots)
  const beginLogin = useCloudSyncStore((state) => state.beginLogin)
  const logout = useCloudSyncStore((state) => state.logout)
  const runNowFromRegistry = useCloudSyncStore((state) => state.runNowFromRegistry)

  // 兼容：老数据/测试构造的 config 可能没有 targets，用扁平字段折算。
  const targets = enabledTargets(config)
  const connectedCount = targets.filter((entry) => entry.connected).length
  const provider = CLOUD_PROVIDERS.find((item) => item.id === config.provider) ?? null
  const lastSyncAge = formatSyncAge(config.lastSyncAt, Date.now())

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.cloudSync.title", { defaultValue: "云同步" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.cloudSync.description", {
            defaultValue: "把小说备份到你自己的网盘，换设备可以接着写。",
          })}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-medium">
              {t("settings.sections.cloudSync.switchLabel", { defaultValue: "云同步" })}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {config.enabled
                ? t("settings.sections.cloudSync.switchHintOn", {
                    defaultValue: "已打开：改动会自动同步到你选的网盘",
                  })
                : t("settings.sections.cloudSync.switchHintOff", {
                    defaultValue: "打开后可以把书籍同步到你自己的网盘",
                  })}
            </p>
          </div>
          <Switch
            checked={config.enabled}
            disabled={saving}
            onChange={(next) => void setEnabled(next)}
            label={t("settings.sections.cloudSync.switchLabel", { defaultValue: "云同步" })}
            data-ui="cloud-sync-switch"
          />
        </div>
      </div>

      {config.enabled ? (
        <>
          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-1">
              <h3 className="font-medium">
                {t("settings.sections.cloudSync.pickProvider", { defaultValue: "选择网盘" })}
              </h3>
              <p className="text-xs text-muted-foreground">
                可以同时勾选多个网盘：勾上的每个都会各同步一份（各自独立记录，互不影响）。
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="选择网盘">
              {CLOUD_PROVIDERS.map((item) => {
                const target = targets.find((entry) => entry.provider === item.id)
                return (
                  <ProviderCard
                    key={item.id}
                    provider={item}
                    selected={config.provider === item.id}
                    enabled={Boolean(target)}
                    connected={target?.connected === true}
                    accountLabel={target?.accountLabel}
                    onSelect={() => void setProvider(item.id)}
                    onToggle={() => void toggleTarget(item.id)}
                  />
                )
              })}
            </div>

            {connectedCount === 0 ? (
              <p className="text-sm text-[var(--ui-warning)]" role="status">
                {targets.length === 0
                  ? "先勾选一个网盘，再登录账号。"
                  : "勾选的网盘还需要登录，登录后才能开始同步。"}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                已勾选 {targets.length} 个网盘，其中 {connectedCount} 个已连接，会各同步一份。
              </p>
            )}

            {provider ? (
              <div className="space-y-3 border-t pt-3">
                {provider.available === false && !config.connected ? (
                  <p className="text-sm text-muted-foreground">
                    百度网盘会在后续版本开放。这一版可以先用 WebDAV（坚果云、NAS）或网盘本地文件夹。
                  </p>
                ) : config.connected ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm">
                      {t("settings.sections.cloudSync.connectedAs", {
                        defaultValue: `已连接：${config.accountLabel ?? provider.label}`,
                        account: config.accountLabel ?? provider.label,
                      })}
                    </p>
                    <Button variant="outline" size="sm" onClick={() => void logout()}>
                      <LogOut className="mr-2 h-4 w-4" />
                      {t("settings.sections.cloudSync.logout", { defaultValue: "退出登录" })}
                    </Button>
                  </div>
                ) : (
                  <>
                    {provider.login === "oauth-browser" ? (
                      <div className="space-y-2">
                        <Button onClick={() => void beginLogin()}>
                          登录百度账号
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          {t("settings.sections.cloudSync.baiduHint", {
                            defaultValue: "百度授权 30 天后会过期，届时会提示你重新登录一次。",
                          })}
                        </p>
                      </div>
                    ) : provider.login === "form" ? (
                      <WebdavForm />
                    ) : (
                      <FolderPicker />
                    )}
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("settings.sections.cloudSync.pickProviderHint", { defaultValue: "先选一个网盘，再登录账号。" })}
              </p>
            )}
          </div>

          {connectedCount > 0 ? (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {lastSyncAge
                    ? t("settings.sections.cloudSync.lastSync", { defaultValue: `上次同步：${lastSyncAge}` })
                    : t("settings.sections.cloudSync.neverSynced", { defaultValue: "还没有同步过" })}
                </p>
                <Button
                  size="sm"
                  disabled={runtime.running || connectedCount === 0}
                  onClick={() => void runNowFromRegistry("manual")}
                >
                  {runtime.running ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {runtime.running
                    ? (runtime.total ?? 0) > 0
                      ? t("settings.sections.cloudSync.syncingProgress", {
                          defaultValue: `同步中 ${runtime.done}/${runtime.total}`,
                          done: runtime.done,
                          total: runtime.total,
                        })
                      : t("settings.sections.cloudSync.syncing", { defaultValue: "同步中…" })
                    : t("settings.sections.cloudSync.runNow", { defaultValue: "立即同步" })}
                </Button>
              </div>
              {runtime.failureCount ? (
                <p className="text-sm text-destructive">
                  有 {runtime.failureCount} 项同步失败，点击右上角云图标查看详情。
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="font-medium">
              {t("settings.sections.cloudSync.scopeTitle", { defaultValue: "同步范围" })}
            </h3>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="同步范围">
              <button
                type="button"
                role="radio"
                aria-checked={config.scope === "all"}
                data-ui="cloud-sync-scope"
                data-scope="all"
                onClick={() => void setScope("all")}
                className={`rounded-lg border p-2.5 text-left text-sm ${
                  config.scope === "all" ? "border-primary bg-primary/5" : "hover:bg-accent/40"
                }`}
              >
                {t("settings.sections.cloudSync.scopeAll", { defaultValue: "全部书籍" })}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={config.scope === "current"}
                data-ui="cloud-sync-scope"
                data-scope="current"
                onClick={() => void setScope("current")}
                className={`rounded-lg border p-2.5 text-left text-sm ${
                  config.scope === "current" ? "border-primary bg-primary/5" : "hover:bg-accent/40"
                }`}
              >
                {t("settings.sections.cloudSync.scopeCurrent", { defaultValue: "仅当前书籍" })}
              </button>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="font-medium">{t("settings.sections.cloudSync.advancedTitle", { defaultValue: "高级" })}</h3>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm">
                  {t("settings.sections.cloudSync.includeSnapshots", { defaultValue: "同时同步章节快照" })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.sections.cloudSync.includeSnapshotsHint", {
                    defaultValue: "快照用于恢复历史版本，文件较多时可以关掉。",
                  })}
                </p>
              </div>
              <Switch
                checked={config.includeSnapshots}
                disabled={saving}
                onChange={(next) => void setIncludeSnapshots(next)}
                label={t("settings.sections.cloudSync.includeSnapshots", { defaultValue: "同时同步章节快照" })}
                data-ui="cloud-sync-include-snapshots"
              />
            </div>
          </div>
        </>
      ) : null}

      <CloudSyncLoginDialog />
    </div>
  )
}
