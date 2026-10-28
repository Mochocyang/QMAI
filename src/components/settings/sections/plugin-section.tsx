import { useCallback, useEffect, useState, type FormEvent } from "react"
import { AlertTriangle, Loader2, Puzzle, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { pluginsApi } from "@/lib/plugins/api"
import { clearPluginProviderAuth } from "@/lib/plugins/provider-auth"
import type { PluginSummary } from "@/lib/plugins/types"
import { toast } from "@/lib/toast"

type ProcessState = PluginSummary["processState"]

/**
 * processState 的中文文案与颜色。
 *
 * 颜色不是装饰：运行中 / 异常退出 / 被安全停用必须一眼能分开，
 * 否则用户会把「插件崩了」误认为「我还没启用」。
 */
const PROCESS_STATE_BADGES: Record<ProcessState, { label: string; className: string }> = {
  stopped: { label: "已停止", className: "border-border bg-muted text-muted-foreground" },
  starting: {
    label: "启动中",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  running: {
    label: "运行中",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  failed: { label: "启动失败", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  crashed: {
    label: "异常退出",
    className: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  disabled_by_crash: {
    label: "已停用·异常退出",
    className: "border-destructive/40 bg-destructive/15 text-destructive",
  },
}

/** 已知权限给出可读说明，未知值仍保留原始标识，避免吞掉后端新增的权限。 */
const PERMISSION_LABELS: Record<string, string> = {
  "fs:project-read": "读取项目文件",
  "fs:project-write": "写入项目文件",
  "net:https": "访问网络",
  "llm:use": "调用模型",
  "data:write": "写入插件数据",
}

/** 插件名可能为空：此时退回稳定的 id，至少让用户知道卸载的是哪一个。 */
function pluginDisplayName(plugin: PluginSummary): string {
  return plugin.name.trim() || plugin.id
}

/**
 * 读取 Tauri 命令失败原因。
 *
 * Rust 命令返回的是可直接展示的中文 `String`；Tauri 也可能把它包成 Error，
 * 因此字符串优先，其次 Error.message，最后才退化成一句通用提示。
 */
function describeError(cause: unknown): string {
  if (typeof cause === "string" && cause.trim()) return cause
  if (cause instanceof Error && cause.message.trim()) return cause.message
  if (cause === null || cause === undefined) return "操作失败，请重试。"
  try {
    return JSON.stringify(cause)
  } catch {
    return String(cause)
  }
}

export function PluginSection() {
  const [plugins, setPlugins] = useState<PluginSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [source, setSource] = useState("")
  const [installing, setInstalling] = useState(false)
  const [busy, setBusy] = useState<{ id: string; kind: "disable" | "uninstall" } | null>(null)
  const [enableTarget, setEnableTarget] = useState<PluginSummary | null>(null)
  const [enabling, setEnabling] = useState(false)
  const [enableError, setEnableError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const items = await pluginsApi.list()
      setPlugins(items)
      setLoadError(null)
    } catch (cause) {
      setLoadError(describeError(cause))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void pluginsApi.list()
      .then((items) => {
        if (cancelled) return
        setPlugins(items)
        setLoadError(null)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(describeError(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reload() {
    setLoading(true)
    await refresh()
    setLoading(false)
  }

  async function installPlugin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = source.trim()
    if (!trimmed || installing) return
    setInstalling(true)
    setActionError(null)
    try {
      const installed = await pluginsApi.install(trimmed)
      setSource("")
      toast.success(`已安装「${pluginDisplayName(installed)}」`)
      await refresh()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setInstalling(false)
    }
  }

  function openEnableDialog(plugin: PluginSummary) {
    setEnableError(null)
    setEnableTarget(plugin)
  }

  async function confirmEnable() {
    if (!enableTarget || enabling) return
    const target = enableTarget
    setEnabling(true)
    setEnableError(null)
    try {
      /*
       * 第一期有意只授予空权限，不做「逐项勾选」。
       *
       * 原因：PluginSummary 只有 grantedPermissions（已授予的），没有插件清单里
       * 申请的权限列表，前端无法知道该给用户勾哪些项。凭 id 猜一份列表等于伪造
       * 授权界面，反而会让人误以为自己批准过某项权限。空数组是后端支持的
       * 最小授权（仅能写插件自己的数据目录），权限界面等后端补上申请列表后再做。
       */
      const granted: string[] = []
      await pluginsApi.enable(target.id, granted)
      toast.success(`已启用「${pluginDisplayName(target)}」`)
      setEnableTarget(null)
      await refresh()
    } catch (cause) {
      setEnableError(describeError(cause))
    } finally {
      setEnabling(false)
    }
  }

  async function disablePlugin(plugin: PluginSummary) {
    if (busy) return
    setBusy({ id: plugin.id, kind: "disable" })
    setActionError(null)
    try {
      await pluginsApi.disable(plugin.id)
      // provider token 只活在本进程缓存里（不落盘，见 v2.0 计划第 0 节）。
      // 插件停了就清掉：否则后续请求会带着已失效的 token 打到已经关闭的端口上。
      // 这里清全部而不是按 providerId 清：一个插件可能声明多个 provider，而
      // 手头只有 pluginId（providerId 可以不同名），清全部最省事且不会漏。
      clearPluginProviderAuth()
      toast.success(`已停用「${pluginDisplayName(plugin)}」`)
      await refresh()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setBusy(null)
    }
  }

  async function uninstallPlugin(plugin: PluginSummary) {
    if (busy) return
    const name = pluginDisplayName(plugin)
    /*
     * 默认保留插件私有数据：卸载经常只是重装/升级前的动作，删数据不可逆。
     * 第一期没有「同时删除数据」的勾选项，所以 deleteData 固定传 false。
     */
    if (!window.confirm(`确定卸载「${name}」吗？插件自己的数据会保留。`)) return
    setBusy({ id: plugin.id, kind: "uninstall" })
    setActionError(null)
    try {
      await pluginsApi.uninstall(plugin.id, false)
      // 卸载同样要清 provider token 缓存（理由同 disablePlugin）。
      clearPluginProviderAuth()
      toast.success(`已卸载「${name}」`)
      await refresh()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">插件</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          安装和管理第三方作者编写的扩展能力。安装后不会自动运行，需要手动启用。
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-900 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          插件是第三方作者写的程序，装进来后以独立进程运行，可以读取项目文件、访问网络。请只安装你信任的仓库。内置随软件更新的能力不属于插件。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="plugin-install-source">从 GitHub 安装</Label>
        <form onSubmit={(event) => void installPlugin(event)} className="flex gap-2">
          <Input
            id="plugin-install-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="https://github.com/owner/repo"
            disabled={installing}
            className="min-w-0 flex-1"
          />
          <Button type="submit" disabled={installing || source.trim() === ""}>
            {installing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {installing ? "安装中…" : "安装"}
          </Button>
        </form>
        {actionError ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 break-words">{actionError}</p>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">已安装插件</h3>
          {!loading && plugins.length > 0 ? (
            <span className="text-xs text-muted-foreground">共 {plugins.length} 个</span>
          ) : null}
        </div>

        {loading ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载插件…
          </div>
        ) : loadError ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="break-words">{loadError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void reload()}
              >
                重新加载
              </Button>
            </div>
          </div>
        ) : plugins.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <Puzzle className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              还没有安装插件。粘贴一个 GitHub 仓库地址开始。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {plugins.map((plugin) => {
              const status = PROCESS_STATE_BADGES[plugin.processState] ?? PROCESS_STATE_BADGES.stopped
              const pluginBusy = busy?.id === plugin.id
              const disabling = pluginBusy && busy?.kind === "disable"
              const uninstalling = pluginBusy && busy?.kind === "uninstall"
              // 同一时间只允许一个启停/卸载请求，避免两个命令同时改注册表。
              const actionsLocked = Boolean(busy) || installing
              return (
                <div
                  key={plugin.id}
                  className="space-y-3 rounded-lg border border-border px-4 py-3"
                  data-plugin-id={plugin.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 break-words font-medium">
                          {pluginDisplayName(plugin)}
                        </span>
                        {plugin.version ? (
                          <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                        ) : null}
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium leading-4 ${status.className}`}
                        >
                          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                          {status.label}
                        </span>
                      </div>

                      {plugin.description ? (
                        <p className="break-words text-sm text-muted-foreground">
                          {plugin.description}
                        </p>
                      ) : null}

                      <p className="break-all text-xs text-muted-foreground">
                        来源：{plugin.sourceRepo || "未知"}
                        {plugin.sourceCommit ? (
                          <span className="ml-1 font-mono">
                            @{plugin.sourceCommit.slice(0, 7)}
                          </span>
                        ) : null}
                      </p>

                      {plugin.grantedPermissions.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>已授权权限：</span>
                          {plugin.grantedPermissions.map((permission) => (
                            <span
                              key={permission}
                              title={permission}
                              className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.6875rem] text-foreground/80"
                            >
                              {PERMISSION_LABELS[permission] ?? permission}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {plugin.enabled ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={actionsLocked}
                          onClick={() => void disablePlugin(plugin)}
                        >
                          {disabling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {disabling ? "停用中…" : "停用"}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={actionsLocked}
                          onClick={() => openEnableDialog(plugin)}
                        >
                          启用
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={actionsLocked}
                        onClick={() => void uninstallPlugin(plugin)}
                      >
                        {uninstalling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {uninstalling ? "卸载中…" : "卸载"}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog
        open={enableTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          setEnableTarget(null)
          setEnableError(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>启用插件</DialogTitle>
            <DialogDescription>
              {enableTarget
                ? `「${pluginDisplayName(enableTarget)}」将以独立进程运行，随时可以在这里停用。`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 leading-relaxed text-amber-900 dark:text-amber-200">
              该插件将以「无额外权限」启用：不能读项目文件、不能联网。如需与其功能匹配的权限，请等待后续版本提供逐项授权界面。
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              当前版本还无法列出插件清单里申请的权限，因此这里不提供权限勾选。确认启用只会授予插件写入自己数据目录的能力。
            </p>
            {enableError ? (
              <div
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="min-w-0 break-words">{enableError}</p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={enabling}
              onClick={() => {
                setEnableTarget(null)
                setEnableError(null)
              }}
            >
              取消
            </Button>
            <Button type="button" disabled={enabling} onClick={() => void confirmEnable()}>
              {enabling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {enabling ? "启用中…" : "确认启用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
