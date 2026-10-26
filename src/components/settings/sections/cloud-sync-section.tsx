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

import { useCallback, useEffect, useState } from "react"
import { Check, Cloud, ExternalLink, FolderOpen, GitBranch, Loader2, LogOut, RefreshCw, Server } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { resolveNotice } from "@/lib/cloud-sync/notice"
import { describeFailures, groupFailuresByProvider } from "@/lib/cloud-sync/failure-summary"
import { CLOUD_PROVIDERS, type CloudProviderMeta } from "@/lib/cloud-sync/providers"
import { formatSyncAge } from "@/lib/cloud-sync/status"
import { enabledTargets, type CloudProviderId } from "@/lib/cloud-sync/types"
import { isTauri } from "@/lib/platform"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"
import {
  beginCloudSyncLogin,
  cancelCloudSyncLogin,
  createGithubRepo,
  getGithubAuthState,
  listGithubRepos,
  type GithubRepoChoice,
} from "@/lib/cloud-sync/client"
import { openExternalUrl } from "@/lib/open-external-url"
import { revealCloudSyncRemote } from "@/lib/cloud-sync/client"
import { toast } from "@/lib/toast"
import { useTranslation } from "react-i18next"

import { CloudSyncLoginDialog } from "./cloud-sync-login-dialog"

const PROVIDER_ICONS: Record<CloudProviderId, typeof Cloud> = {
  baidu: Cloud,
  webdav: Server,
  github: GitBranch,
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

/**
 * GitHub 连接：设备流（8 位码）+ 私有仓库选择。
 *
 * 为什么不用「点一下浏览器就回来」的回调：设备流不需要 client_secret、
 * 也不用占本地端口，代价只是用户要把码粘进浏览器一次。
 */
function GithubForm() {
  const connectGithub = useCloudSyncStore((state) => state.connectGithub)
  const [phase, setPhase] = useState<"loading" | "idle" | "waiting" | "choose">("loading")
  const [code, setCode] = useState<string | null>(null)
  const [uri, setUri] = useState("")
  const [repos, setRepos] = useState<GithubRepoChoice[]>([])
  const [picked, setPicked] = useState("")
  const [account, setAccount] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRepos = useCallback(async () => {
    setBusy(true)
    const result = await listGithubRepos()
    setBusy(false)
    if (!result.ok) {
      setError(resolveNotice(result.errorCode ?? "github.http").message)
      setPhase("idle")
      return
    }
    const list = result.repos ?? []
    setRepos(list)
    // 默认选中我们自己的备份仓库（如果它已经在列表里）。
    setPicked((current) => {
      if (current) return current
      const preferred = list.find((repo) => repo.name === "qmai-write-backup") ?? list[0]
      return preferred ? `${preferred.owner}/${preferred.name}` : ""
    })
    setPhase("choose")
  }, [])

  // 打开面板时先问一次：已经授权过就别再让用户走设备流。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const state = await getGithubAuthState()
      if (cancelled) return
      setAccount(state.accountLabel)
      if (state.authorized) {
        await loadRepos()
      } else {
        setPhase("idle")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadRepos])

  // 等用户在浏览器里确认：每 2 秒问一次后端（不依赖事件，关掉面板也不丢状态）。
  useEffect(() => {
    if (phase !== "waiting") return
    const timer = window.setInterval(() => {
      void (async () => {
        const state = await getGithubAuthState()
        if (state.authorized) {
          setAccount(state.accountLabel)
          await loadRepos()
        } else if (!state.loginPending) {
          setPhase("idle")
          setCode(null)
          setError("授权没有完成（码过期了？）再点一次「连接 GitHub」。")
        }
      })()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [phase, loadRepos])

  async function start() {
    setError(null)
    setBusy(true)
    const result = await beginCloudSyncLogin("github")
    setBusy(false)
    if (result.errorCode) {
      setError(resolveNotice(result.errorCode).message)
      return
    }
    if (result.alreadyAuthorized) {
      setAccount(result.accountLabel ?? "")
      await loadRepos()
      return
    }
    if (!result.userCode) return
    setCode(result.userCode)
    setUri(result.verificationUri ?? "")
    setPhase("waiting")
    if (result.verificationUri) void openExternalUrl(result.verificationUri)
  }

  async function createRepo() {
    setError(null)
    setBusy(true)
    const result = await createGithubRepo("")
    setBusy(false)
    if (!result.ok) {
      setError(resolveNotice(result.errorCode ?? "github.http").message)
      return
    }
    await loadRepos()
    if (result.repo) setPicked(`${result.repo.owner}/${result.repo.name}`)
  }

  async function connect() {
    if (!picked) return
    const [owner, repo] = picked.split("/")
    setError(null)
    setBusy(true)
    const result = await connectGithub({ owner, repo })
    setBusy(false)
    if (!result.ok) setError(resolveNotice(result.errorCode ?? "github.http").message)
  }

  return (
    <div className="space-y-3">
      {phase === "loading" ? <p className="text-xs text-muted-foreground">正在检查 GitHub 授权…</p> : null}

      {phase === "waiting" && code ? (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="text-sm">在浏览器里输入这个码，确认授权：</p>
          <p className="select-all font-mono text-2xl tracking-[0.3em]">{code}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void openExternalUrl(uri)}>
              再打开一次授权页面
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void cancelCloudSyncLogin().then(() => setPhase("idle"))}>
              取消
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            授权只给「私有仓库读写」。确认之后这里会自动列出你的私有仓库。
          </p>
        </div>
      ) : null}

      {phase === "idle" ? (
        <div className="space-y-2">
          <Button disabled={busy} onClick={() => void start()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitBranch className="mr-2 h-4 w-4" />}
            连接 GitHub
          </Button>
          <p className="text-xs text-muted-foreground">
            小说会存进你自己的<b>私有</b>仓库；公开仓库不允许连接（那等于把稿子公开）。
          </p>
        </div>
      ) : null}

      {phase === "choose" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {account ? `已授权：${account}` : "已授权"}。选一个<b>私有</b>仓库：
          </p>
          <select
            aria-label="GitHub 仓库"
            data-testid="cloud-sync-github-repo"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
          >
            {repos.length === 0 ? <option value="">（没有私有仓库）</option> : null}
            {repos.map((repo) => (
              <option key={`${repo.owner}/${repo.name}`} value={`${repo.owner}/${repo.name}`}>
                {repo.owner}/{repo.name}
                {repo.canPush ? "" : "（只读）"}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !picked} onClick={() => void connect()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              连接这个仓库
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void createRepo()}>
              新建私有仓库
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            新建会创建 <code>qmai-write-backup</code>（私有、空仓库）。连接时会在仓库里写一次探针文件验证写权限，然后删掉。
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
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
  const batches = useCloudSyncStore((state) => state.batches)
  const entries = useCloudSyncStore((state) => state.entries)
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

  /**
   * 打开某个网盘的「远端内容」。
   *
   * 为什么放在「退出登录」旁边：这是同一个层级的账号操作（我还连着哪个盘、
   * 那个盘里的东西在哪），用户找它时第一反应就是账号区。
   * WebDAV 没有可浏览的网页，改成复制地址；GitHub 会打开仓库网页，
   * 没登录 GitHub 时浏览器会先落到登录页 —— 这是用户自己的会话，我们不代劳。
   */
  const openRemoteContent = useCallback(
    async (providerId: string) => {
      if (providerId === "webdav") {
        const target = targets.find((entry) => entry.provider === providerId)
        const url = target?.webdavUrl ?? config.webdavUrl ?? ""
        try {
          await navigator.clipboard.writeText(url)
          toast.success("远端地址已复制，粘贴到你的 WebDAV 客户端即可打开")
        } catch {
          toast.error(`远端地址：${url}`)
        }
        return
      }
      try {
        await revealCloudSyncRemote(providerId as never)
        if (providerId === "github") {
          toast.success("已在浏览器打开仓库；如果还没登录 GitHub，先登录就能看到内容")
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "打不开远端内容")
      }
    },
    [config.webdavUrl, targets],
  )
  const provider = CLOUD_PROVIDERS.find((item) => item.id === config.provider) ?? null
  const lastSyncAge = formatSyncAge(config.lastSyncAt, Date.now())
  /*
   * 失败提示必须**点名到哪个盘**。
   *
   * 以前只写「有 N 项同步失败」，多网盘并存时用户根本不知道该去处理哪一个：
   * GitHub 失败多半是网络/授权，网盘本地文件夹失败多半是目录被占用，处置方式完全不同。
   * 数据来自历史记录（按批次反查 provider），不用运行态的残留计数。
   */
  const failureSummary = describeFailures(groupFailuresByProvider(batches, entries))

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
            {/*
               * auto-fit + minmax 而不是死写 sm:grid-cols-3：
               * 三列会把每张卡压到 ~197px，账号名一长就把内容撑出容器，
               * 整页因此多出一条纵向滚动条（用户投诉过）。
               * 改成"每张卡至少 11rem，放不下就换行"。
               */}
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))" }}
              role="radiogroup"
              aria-label="选择网盘"
            >
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
                {/* 百度已从 CLOUD_PROVIDERS 移除（这一版隐藏），这里不必再留「暂未开放」分支：
                    provider 永远来自列表，available 恒为 true。适配器与后端代码都还在。 */}
                {config.connected ? (
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <p className="text-sm">
                      {t("settings.sections.cloudSync.connectedAs", {
                        defaultValue: `已连接：${config.accountLabel ?? provider.label}`,
                        account: config.accountLabel ?? provider.label,
                      })}
                    </p>
                    {/*
                      这两个按钮必须挨在一起：它们同属「账号操作」一组。
                      以前「打开远端内容」是 justify-between 下的第二个子元素，
                      会被推到整行中间、和「退出登录」隔一大段空白（用户截图投诉）。
                      现在包进一个右对齐的小组，组内只留 8px 间距。
                    */}
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        data-ui="cloud-sync-reveal-remote"
                        data-provider={provider.id}
                        onClick={() => void openRemoteContent(provider.id)}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        打开远端内容
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void logout()}>
                        <LogOut className="mr-2 h-4 w-4" />
                        {t("settings.sections.cloudSync.logout", { defaultValue: "退出登录" })}
                      </Button>
                    </div>
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
                    ) : provider.login === "device" ? (
                      <GithubForm />
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
              {failureSummary ? (
                <p className="text-sm text-destructive" data-ui="cloud-sync-failure-line">
                  {failureSummary}
                  ，点击右上角云图标查看详情。
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
