import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  Puzzle,
  RefreshCw,
  Search,
} from "lucide-react"
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
import { MarketCard } from "@/components/plugins/market-card"
import { PluginSection } from "@/components/settings/sections/plugin-section"
import { pluginsApi, type PluginMarketEntry, type PluginMarketIndex } from "@/lib/plugins/api"
import type { PluginSummary } from "@/lib/plugins/types"
import { isTauri } from "@/lib/platform"
import { toast } from "@/lib/toast"

/**
 * 「插件」独立页面（与 书架 / 大纲 / 章节 / 灵魂 / 技能库 / 拆书库 同级的顶层视图）。
 *
 * 两个 tab：
 *   - 市场：浏览 `plugins/index.json` 里登记的第三方插件，一键安装；
 *   - 已安装：**直接渲染既有的 `<PluginSection />`**（见文件末尾那段注释）。
 *
 * 右上角的「手动安装」在**两个 tab 下都在**：市场索引是随仓库维护的静态清单，
 * 它没收录的插件（作者没提交、或者是用户自己正在写的）不能因此就没法装。
 * 所以市场页本身就是完整的插件入口，用户不必为了装一个已知地址再绕回设置。
 */

type PluginCenterTab = "market" | "installed"

const TABS: { id: PluginCenterTab; label: string }[] = [
  { id: "market", label: "插件市场" },
  { id: "installed", label: "已安装" },
]

/**
 * 读取 Tauri 命令失败原因。
 *
 * Rust 命令返回的是可直接展示的中文 `String`；Tauri 也可能把它包成 Error，
 * 因此字符串优先，其次 Error.message，最后才退化成一句通用提示。
 * 与 `plugin-section.tsx` 里同名函数同构 —— 那个模块是设置页的私有用例，
 * 为一个 20 行的小函数把它改成公共模块不划算，也没必要让市场页依赖设置页。
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

/**
 * 市场搜索：按 name / description / author / tags 过滤，大小写不敏感。
 *
 * 为什么**不含** repo 与分类：分类有专门的 chips（两套过滤会互相打架），
 * 而 repo 是 install 用的主键，把 `owner/repo` 丢进搜索里会让「搜 qmai」
 * 命中的全是同一作者的所有仓库，反而盖住真正按名字找的那一条。
 */
export function matchesMarketSearch(entry: PluginMarketEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [entry.name, entry.description, entry.author, ...entry.tags]
    .join("\n")
    .toLowerCase()
  return haystack.includes(needle)
}

/**
 * 把 `repo` 归一化成可比较的键，用于「市场条目 ↔ 已安装插件」的交叉比对。
 *
 * 为什么不能只比 id：市场条目的 `id` 来自索引，已安装插件的 `id` 来自插件清单，
 * 两者由不同的人写、在历史上有过不一致（索引写 `qmai-foo`、清单写 `foo`）。
 * 仓库地址是安装时**同一个字符串**流下去的那一份，比对它才不会把「已装」误判成「没装」。
 */
export function marketRepoKey(repo: string): string {
  return repo
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
}

/**
 * 已安装插件的查找索引：id 与仓库地址双键。
 *
 * 双键是**保守方向**的冗余：任一路径命中就算已安装。误判成「已安装」的后果是
 * 用户看不到安装按钮（但能从「已安装」tab 管理它）；误判成「未安装」的后果是
 * 用户点安装后被后端拒绝一次 —— 后者的体验更差，所以宁可多认。
 */
function buildInstalledLookup(plugins: PluginSummary[]): {
  byId: Map<string, PluginSummary>
  byRepo: Map<string, PluginSummary>
} {
  const byId = new Map<string, PluginSummary>()
  const byRepo = new Map<string, PluginSummary>()
  for (const plugin of plugins) {
    byId.set(plugin.id, plugin)
    const repo = plugin.sourceRepo?.trim()
    if (repo) byRepo.set(marketRepoKey(repo), plugin)
  }
  return { byId, byRepo }
}

export function PluginCenterView() {
  const [tab, setTab] = useState<PluginCenterTab>("market")

  const [index, setIndex] = useState<PluginMarketIndex | null>(null)
  const [indexLoading, setIndexLoading] = useState(true)
  const [indexError, setIndexError] = useState<string | null>(null)

  const [installed, setInstalled] = useState<PluginSummary[]>([])

  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [installingRepo, setInstallingRepo] = useState<string | null>(null)

  const [manualOpen, setManualOpen] = useState(false)
  const [manualUrl, setManualUrl] = useState("")
  const [manualInstalling, setManualInstalling] = useState(false)
  const [manualInstallingLocal, setManualInstallingLocal] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)

  /**
   * 拉索引。
   *
   * `refresh = false`（首屏 / 切回页面）让后端优先用缓存，`true` 只由「刷新 / 重试」
   * 触发 —— 用户点刷新时想要的正是「联网再看一眼」，此时再吃缓存等于按钮没反应。
   */
  const loadIndex = useCallback(async (refresh: boolean) => {
    setIndexLoading(true)
    try {
      const data = await pluginsApi.marketIndex(refresh)
      setIndex(data)
      setIndexError(null)
    } catch (cause) {
      /*
       * 失败时**不清空**已有索引：刷新失败不该让用户从「能看旧列表」退化成
       * 「一片错误页」。错误照样记下来，界面按「有没有旧数据」分两种形态展示。
       */
      setIndexError(describeError(cause))
    } finally {
      setIndexLoading(false)
    }
  }, [])

  const refreshInstalled = useCallback(async () => {
    try {
      setInstalled(await pluginsApi.list())
    } catch (cause) {
      /*
       * 已安装列表读不到时只会话内降级，不弹错误、不占满屏幕：
       * 市场本身还能看（这时候每张卡都会显示「安装」，点了由后端拒绝并 toast），
       * 而「插件」页真正的主线是浏览与安装，不该被一个交叉比对失败拦住。
       */
      console.warn("[plugins] 读取已安装插件失败：", cause)
      setInstalled([])
    }
  }, [])

  useEffect(() => {
    void loadIndex(false)
  }, [loadIndex])

  useEffect(() => {
    void refreshInstalled()
  }, [refreshInstalled])

  const entries = index?.plugins ?? []

  /** 分类 chips：从索引里聚合（后端不提供分类清单，避免又一份真源）。 */
  const categories = useMemo(() => {
    const seen = new Set<string>()
    for (const entry of entries) {
      for (const name of entry.categories) {
        if (name.trim()) seen.add(name)
      }
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "zh"))
  }, [entries])

  const visibleEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (!category || entry.categories.includes(category)) && matchesMarketSearch(entry, query),
      ),
    [entries, category, query],
  )

  const installedLookup = useMemo(() => buildInstalledLookup(installed), [installed])

  const installedFor = useCallback(
    (entry: PluginMarketEntry) =>
      installedLookup.byId.get(entry.id) ?? installedLookup.byRepo.get(marketRepoKey(entry.repo)) ?? null,
    [installedLookup],
  )

  async function installFromMarket(entry: PluginMarketEntry) {
    if (installingRepo) return
    setInstallingRepo(entry.repo)
    try {
      const summary = await pluginsApi.marketInstall(entry.repo)
      const name = summary?.name?.trim() || entry.name || entry.id
      toast.success(`已安装「${name}」`)
      /*
       * 成功后重新读一次 `plugins_list`：卡片要立刻变成「已安装」。
       * 只把本地状态改一下是不够的 —— 后端可能拒绝/改写了 id，界面得跟着后端的答案走。
       */
      await refreshInstalled()
    } catch (cause) {
      toast.error(describeError(cause))
    } finally {
      setInstallingRepo(null)
    }
  }

  async function installFromUrl() {
    const trimmed = manualUrl.trim()
    if (!trimmed || manualInstalling) return
    setManualInstalling(true)
    setManualError(null)
    try {
      const summary = await pluginsApi.install(trimmed)
      toast.success(`已安装「${summary?.name?.trim() || trimmed}」`)
      setManualUrl("")
      setManualOpen(false)
      await refreshInstalled()
    } catch (cause) {
      setManualError(describeError(cause))
    } finally {
      setManualInstalling(false)
    }
  }

  async function installFromLocalDirectory() {
    if (manualInstalling || manualInstallingLocal) return
    if (!isTauri()) {
      // 浏览器预览里拿不到真实绝对路径（showDirectoryPicker 只给目录名），如实说明原因。
      setManualError("需要在桌面应用里选择插件目录。")
      return
    }
    let picked: unknown = null
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      picked = await open({
        directory: true,
        multiple: false,
        title: "选择插件目录（根目录下需有 plugin.json）",
      })
    } catch (cause) {
      setManualError(describeError(cause))
      return
    }
    // 用户取消不是错误：不留错误条，也不让按钮一直转圈。
    if (typeof picked !== "string") return

    setManualInstallingLocal(true)
    setManualError(null)
    try {
      const summary = await pluginsApi.installLocal(picked)
      toast.success(`已安装「${summary?.name?.trim() || "插件"}」`)
      setManualOpen(false)
      await refreshInstalled()
    } catch (cause) {
      setManualError(describeError(cause))
    } finally {
      setManualInstallingLocal(false)
    }
  }

  const pageState =
    tab === "installed"
      ? "installed"
      : indexLoading && !index
        ? "loading"
        : indexError && !index
          ? "error"
          : entries.length === 0
            ? "empty"
            : "market"

  return (
    <div data-ui-page="plugins" data-ui-state={pageState} className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-6">插件</h1>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            插件是第三方作者写的扩展。安装后不会自动运行，需要手动启用。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-plugins-manual="true"
          onClick={() => {
            setManualError(null)
            setManualOpen(true)
          }}
        >
          <Puzzle className="mr-1 h-3.5 w-3.5" />
          手动安装
        </Button>
      </header>

      <div className="flex items-center gap-1 border-b px-4 py-2 sm:px-6" role="tablist" aria-label="插件">
        {TABS.map((item) => {
          const selected = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-plugin-tab={item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                selected
                  ? "qm-selected"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 [scrollbar-gutter:stable]">
        {tab === "market" ? (
          <section className="space-y-3" aria-label="插件市场">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称、描述、作者或标签"
                  aria-label="搜索插件"
                  data-market-search="true"
                  className="pl-7"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={indexLoading}
                data-market-refresh="true"
                onClick={() => void loadIndex(true)}
              >
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${indexLoading ? "animate-spin" : ""}`} />
                {indexLoading ? "刷新中…" : "刷新"}
              </Button>
            </div>

            {categories.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5" data-market-category-chips="true">
                {categories.map((name) => {
                  const active = category === name
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={active}
                      data-market-category={name}
                      onClick={() => setCategory((current) => (current === name ? null : name))}
                      className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                        active
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-border bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            ) : null}

            {/*
              缓存提示：网络不可用时后端会退回上次抓到的索引。用户必须知道
              「这份列表可能不是最新」，否则会以为市场里就这些插件、或者以为
              作者刚发布的版本还没被收录。
            */}
            {index?.fromCache ? (
              <div
                className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
                data-plugins-market="cache"
                role="status"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">当前显示的是本地缓存（网络不可用），可能不是最新</span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={indexLoading}
                  onClick={() => void loadIndex(true)}
                >
                  重试
                </Button>
              </div>
            ) : null}

            {/* 有旧数据时刷新失败：只留一行红字，不把整页换成错误页。 */}
            {indexError && index ? (
              <p className="break-words text-xs text-destructive" data-plugins-market="stale-error">
                刷新失败：{indexError}
              </p>
            ) : null}

            {indexLoading && !index ? (
              <div
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                正在读取插件市场…
              </div>
            ) : indexError && !index ? (
              /*
               * 命令还没就绪 / 网络与缓存都不可用时的错误态。
               *
               * ⚠ 这里**不能白屏**：市场命令与前端是两个并行开发的产物，
               * 前端先合入时 `plugins_market_index` 可能还不存在。错误态下依旧
               * 保留页面骨架与右上角「手动安装」，用户至少还能装一个已知地址的插件。
               */
              <div
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                data-plugins-market="error"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="break-words">读取插件市场失败：{indexError}</p>
                  <p className="text-xs leading-relaxed">
                    你仍然可以用右上角「手动安装」粘贴 GitHub 地址或选择本地目录。
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={indexLoading}
                    onClick={() => void loadIndex(true)}
                  >
                    重试
                  </Button>
                </div>
              </div>
            ) : entries.length === 0 ? (
              /*
               * 诚实空状态。
               *
               * 为什么把「为什么空」写出来：市场索引是随仓库维护的静态文件
               * （`plugins/index.json`），此刻为空**不是故障**，也不是「你网络不好」，
               * 而是「还没有第三方提交」。如果只显示一句「暂无插件」，用户会反复点刷新、
               * 去查网络，而真正该做的两件事（自己装、或向索引提交一条）一个字都没提到。
               * 所以这里直接说清数据来自哪里、以及空的时候还能做什么。
               */
              <div
                className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center"
                data-plugins-market="empty"
              >
                <Puzzle className="h-5 w-5 text-muted-foreground" />
                <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
                  市场里还没有插件。索引在{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    plugins/index.json
                  </code>
                  （随仓库维护），目前还没有第三方插件提交。
                </p>
                <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
                  你仍然可以在右侧「手动安装」里粘贴任意 GitHub 地址。
                </p>
              </div>
            ) : visibleEntries.length === 0 ? (
              <div
                className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground"
                data-plugins-market="no-match"
              >
                <p>没有匹配的插件。</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setQuery("")
                    setCategory(null)
                  }}
                >
                  清空筛选
                </Button>
              </div>
            ) : (
              <div
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3"
                data-plugins-market="grid"
              >
                {visibleEntries.map((entry) => (
                  <MarketCard
                    key={entry.id}
                    entry={entry}
                    installed={installedFor(entry)}
                    installing={installingRepo === entry.repo}
                    onInstall={(target) => void installFromMarket(target)}
                  />
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="space-y-3" aria-label="已安装插件">
            {/*
              为什么整块复用 `<PluginSection />` 而不另写一套管理界面：
              启用/停用/卸载、权限授予、崩溃原因与重试、断言式插件的配置表单与本页
              毫无区别 —— 那是**同一份数据**（`plugins_list`）的同一种管理动作。
              复制一份出来的必然结果是两处逐渐漂移：这边加了「重新启用」，那边忘了；
              用户也会奇怪「为什么同一个插件在两个地方能做的操作不一样」。
              所以这里只负责把入口摆在插件页里，管理界面本身一行都不重写。
            */}
            <p className="text-xs leading-relaxed text-muted-foreground">
              这里和 设置 → 插件 是同一份数据。
            </p>
            {/*
              只在切到这个 tab 时才挂载：`PluginSection` 挂载即读 `plugins_list`，
              常驻渲染会让每个进过插件页的用户都多付一次列表请求 —— 而他可能只想看看市场。
            */}
            <PluginSection />
          </section>
        )}
      </div>

      {/* 手动安装：两个 tab 共用同一个入口（市场没收录的插件也能装）。 */}
      <Dialog
        open={manualOpen}
        onOpenChange={(open) => {
          if (open) return
          setManualOpen(false)
          setManualError(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>手动安装插件</DialogTitle>
            <DialogDescription>
              市场没收录的插件也能装：粘贴 GitHub 仓库地址，或直接选一个本机目录（目录根下需有
              plugin.json）。
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-2"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              void installFromUrl()
            }}
          >
            <Label htmlFor="plugin-center-manual-url">从 GitHub 安装</Label>
            <div className="flex gap-2">
              <Input
                id="plugin-center-manual-url"
                value={manualUrl}
                onChange={(event) => setManualUrl(event.target.value)}
                placeholder="https://github.com/owner/repo"
                data-plugins-manual-url="true"
                disabled={manualInstalling || manualInstallingLocal}
                className="min-w-0 flex-1"
              />
              <Button
                type="submit"
                disabled={
                  manualInstalling || manualInstallingLocal || manualUrl.trim() === ""
                }
                data-plugins-manual-submit="true"
              >
                {manualInstalling ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                {manualInstalling ? "安装中…" : "安装"}
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-plugins-manual-local="true"
              disabled={manualInstalling || manualInstallingLocal}
              onClick={() => void installFromLocalDirectory()}
              title="用于安装你本机正在开发的插件目录。目录根下需要有 plugin.json。"
            >
              {manualInstallingLocal ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderOpen className="mr-1 h-3.5 w-3.5" />
              )}
              {manualInstallingLocal ? "安装中…" : "选本地目录"}
            </Button>
          </form>

          {manualError ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              data-plugins-manual-error="true"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 break-words">{manualError}</p>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={manualInstalling || manualInstallingLocal}
              onClick={() => {
                setManualOpen(false)
                setManualError(null)
              }}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
