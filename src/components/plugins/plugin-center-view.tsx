import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Plus, Puzzle, RefreshCw, Search, Settings2, X } from "lucide-react"

import { AddPluginDialog, type AddPluginMode } from "@/components/plugins/add-plugin-dialog"
import { ConfigForm } from "@/components/plugins/ConfigForm"
import { InstalledRow } from "@/components/plugins/installed-row"
import { MarketCard } from "@/components/plugins/market-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { pluginsApi, type PluginMarketEntry } from "@/lib/plugins/api"
import type { PluginSummary } from "@/lib/plugins/types"
import { toast } from "@/lib/toast"

/**
 * 「插件」独立页面。
 *
 * 设计取舍（用户明确要求过）：
 *  1. **不再用 tab。** 旧版「插件市场 / 已安装」两个 tab 把同样的东西割成两半。
 *     用户点开插件页最想先知道「我装了什么、它们开没开」，所以已安装在上、市场在下，
 *     一屏看得完，不需要切换。
 *  2. **已安装改成行式卡片 + 开关**。开关 = 启用/停用，这是插件最高频的动作，
 *     应该一步到位，而不是让用户在一列文字按钮里找「启用」。
 *  3. 保留「编辑插件」入口（用户原文要求）：它打开的就是「添加插件」对话框 ——
 *     对用户而言「编辑插件」= 「管理/添加插件」，不必真的去编辑清单文件。
 */

export function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === "string") return cause
  return "未知错误"
}

/** 市场卡片的搜索命中所属字段：名称、描述、作者、标签。 */
export function matchesMarketSearch(entry: PluginMarketEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [entry.name, entry.description, entry.author, ...entry.tags]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(q))
}

/**
 * 把仓库地址归一成比对用的键。
 *
 * 索引里的 `repo` 与插件清单里的来源由不同人写，可能对不上；
 * 所以「是否已安装」按 **id 或归一化 repo** 双键判断，命中任一就算装过。
 */
export function marketRepoKey(repo: string): string {
  return repo
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
}

function buildInstalledLookup(plugins: PluginSummary[]): {
  byId: Map<string, PluginSummary>
  byRepo: Map<string, PluginSummary>
} {
  const byId = new Map<string, PluginSummary>()
  const byRepo = new Map<string, PluginSummary>()
  for (const plugin of plugins) {
    byId.set(plugin.id, plugin)
    const repo = plugin.sourceRepo ?? ""
    if (repo) byRepo.set(marketRepoKey(repo), plugin)
  }
  return { byId, byRepo }
}

/** 读 `preview` 里的 configSchema；没有就返回 undefined（InstalledRow 据此决定显不显示「设置」）。 */
export function previewConfigSchema(preview: unknown): unknown {
  if (!preview || typeof preview !== "object") return undefined
  const record = preview as Record<string, unknown>
  return record.configSchema
}

export function PluginCenterView() {
  const [installed, setInstalled] = useState<PluginSummary[]>([])
  const [market, setMarket] = useState<PluginMarketEntry[]>([])
  const [fromCache, setFromCache] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [loadingMarket, setLoadingMarket] = useState(true)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<AddPluginMode>("url")
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [configFor, setConfigFor] = useState<PluginSummary | null>(null)
  const addMenuRef = useRef<HTMLDivElement | null>(null)

  const refreshInstalled = useCallback(async () => {
    try {
      setInstalled(await pluginsApi.list())
    } catch (cause) {
      // 列表读不出来不该把整页变成错误页 —— 市场那半仍然可用。
      console.warn("[plugins] 读取已安装列表失败：", cause)
    }
  }, [])

  const loadMarket = useCallback(async (refresh: boolean) => {
    setLoadingMarket(true)
    setMarketError(null)
    try {
      const data = await pluginsApi.marketIndex(refresh)
      setMarket(data.plugins)
      setFromCache(data.fromCache)
    } catch (cause) {
      setMarketError(describeError(cause))
    } finally {
      setLoadingMarket(false)
    }
  }, [])

  useEffect(() => {
    void refreshInstalled()
    void loadMarket(false)
  }, [refreshInstalled, loadMarket])

  // 点外面关掉「添加方式」小菜单
  useEffect(() => {
    if (!addMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [addMenuOpen])

  const installedLookup = useMemo(() => buildInstalledLookup(installed), [installed])

  const categories = useMemo(() => {
    const seen = new Set<string>()
    for (const entry of market) for (const item of entry.categories) seen.add(item)
    return [...seen].sort((a, b) => a.localeCompare(b, "zh-CN"))
  }, [market])

  const visibleMarket = useMemo(
    () =>
      market.filter(
        (entry) =>
          (!category || entry.categories.includes(category)) && matchesMarketSearch(entry, query),
      ),
    [market, category, query],
  )

  const installFromMarket = async (entry: PluginMarketEntry) => {
    setInstallingId(entry.id)
    try {
      await pluginsApi.marketInstall(entry.repo)
      toast.success(`已安装「${entry.name}」`)
      await refreshInstalled()
    } catch (cause) {
      toast.error(describeError(cause))
    } finally {
      setInstallingId(null)
    }
  }

  const togglePlugin = async (plugin: PluginSummary, next: boolean) => {
    setBusyId(plugin.id)
    try {
      if (next) {
        // 授予「清单里申请的权限」——传空数组会让插件拿不到读项目的资格（后端会照实拒绝）。
        await pluginsApi.enable(plugin.id, plugin.declaredPermissions ?? [])
      } else {
        await pluginsApi.disable(plugin.id)
      }
      await refreshInstalled()
    } catch (cause) {
      toast.error(describeError(cause))
    } finally {
      setBusyId(null)
    }
  }

  const uninstallPlugin = async (plugin: PluginSummary) => {
    if (!window.confirm(`确定卸载「${plugin.name || plugin.id}」吗？插件自己的数据会保留。`)) return
    setBusyId(plugin.id)
    try {
      await pluginsApi.uninstall(plugin.id, false)
      toast.success("已卸载")
      await refreshInstalled()
    } catch (cause) {
      toast.error(describeError(cause))
    } finally {
      setBusyId(null)
    }
  }

  const openAddDialog = (mode: AddPluginMode) => {
    setAddMode(mode)
    setAddOpen(true)
    setAddMenuOpen(false)
  }

  const hasMarket = market.length > 0

  return (
    /*
     * `data-ui-page="plugins"` 是**路由标记**：`content-area` 的 routing 测试与
     * UI 测试壳都按它确认「当前渲染的是插件页，而不是掉进 default 的 AI 会话」。
     * 没有它，页面能画出来但自动化测试会认不出这一页 —— 这是上一版就有、
     * 重做视觉时不能丢的东西。
     */
    <div data-ui-page="plugins" className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-start justify-between gap-3 px-6 pb-4 pt-6">
        <div>
          <h1 className="text-xl font-semibold">插件</h1>
          <p className="mt-1 text-sm text-muted-foreground">安装、启用和配置插件</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="刷新插件市场"
            title="刷新插件市场"
            disabled={loadingMarket}
            onClick={() => {
              void loadMarket(true)
              void refreshInstalled()
            }}
          >
            <RefreshCw className={loadingMarket ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
          {/*
            「编辑插件」是用户点名要的入口：它打开的就是「添加插件」对话框。
            和右侧「＋ 添加插件」是同一个东西，只是措辞更贴近「管理我已有的插件」。
          */}
          <Button
            type="button"
            variant="outline"
            aria-label="编辑插件"
            onClick={() => openAddDialog("url")}
          >
            <Settings2 className="mr-1.5 h-4 w-4" />
            编辑插件
          </Button>
          <div className="relative flex" ref={addMenuRef}>
            <Button
              type="button"
              className="rounded-r-none"
              data-plugins-manual="true"
              onClick={() => openAddDialog("url")}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              添加插件
            </Button>
            <Button
              type="button"
              className="rounded-l-none border-l border-primary-foreground/25 px-2"
              aria-label="更多添加方式"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              onClick={() => setAddMenuOpen((open) => !open)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            {addMenuOpen && (
              <div
                role="menu"
                aria-label="添加插件方式"
                className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => openAddDialog("url")}
                >
                  <Plus className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="flex flex-col">
                    <span>安装第三方插件</span>
                    <span className="text-xs text-muted-foreground">
                      GitHub 仓库地址或本地目录
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => openAddDialog("local")}
                >
                  <Puzzle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="flex flex-col">
                    <span>从本地目录安装</span>
                    <span className="text-xs text-muted-foreground">用于本机正在开发的插件</span>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section aria-labelledby="plugins-installed" className="px-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="plugins-installed" className="text-sm font-medium">
            已安装
          </h2>
          <span className="text-xs text-muted-foreground">共 {installed.length} 个</span>
        </div>
        {installed.length === 0 ? (
          <div
            role="status"
            className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
          >
            还没有安装任何插件。可以在下面的市场里挑一个，或粘贴一个 GitHub 仓库地址。
          </div>
        ) : (
          <ul className="space-y-2">
            {installed.map((plugin) => (
              <InstalledRow
                key={plugin.id}
                plugin={plugin}
                busy={busyId === plugin.id}
                onToggle={(target, next) => void togglePlugin(target, next)}
                onConfigure={setConfigFor}
                onUninstall={(target) => void uninstallPlugin(target)}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="plugins-market" className="mt-6 px-6 pb-8">
        <h2 id="plugins-market" className="mb-2 text-sm font-medium">
          插件市场
        </h2>

        {fromCache && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <span>当前显示的是本地缓存（网络不可用），可能不是最新。</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadMarket(true)}>
              重试
            </Button>
          </div>
        )}

        {hasMarket && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                value={query}
                placeholder="搜索插件名称、作者或标签"
                aria-label="搜索插件"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label="清空搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setQuery("")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {categories.map((item) => {
              const active = category === item
              return (
                <Button
                  key={item}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "secondary"}
                  aria-pressed={active}
                  onClick={() => setCategory(active ? null : item)}
                >
                  {item}
                </Button>
              )
            })}
          </div>
        )}

        {loadingMarket && !hasMarket ? (
          <div role="status" className="py-10 text-center text-sm text-muted-foreground">
            正在加载插件市场…
          </div>
        ) : marketError && !hasMarket ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center"
          >
            <p className="text-sm text-destructive">无法加载插件市场：{marketError}</p>
            <div className="mt-3 flex justify-center gap-2">
              <Button type="button" size="sm" onClick={() => void loadMarket(true)}>
                重试
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => openAddDialog("url")}>
                手动安装
              </Button>
            </div>
          </div>
        ) : !hasMarket ? (
          <div
            role="status"
            className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center"
          >
            <Puzzle className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
            <p className="text-sm font-medium">市场里还没有插件</p>
            <p className="max-w-md text-xs text-muted-foreground">
              索引在 <code className="rounded bg-muted px-1">plugins/index.json</code>
              （随仓库维护），目前还没有第三方插件提交。你仍然可以手动粘贴一个 GitHub
              仓库地址来安装。
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-1"
              onClick={() => openAddDialog("local")}
            >
              从本地目录安装
            </Button>
          </div>
        ) : visibleMarket.length === 0 ? (
          <div role="status" className="py-10 text-center text-sm text-muted-foreground">
            没有匹配的插件。
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleMarket.map((entry) => (
              <li key={entry.id}>
                <MarketCard
                  entry={entry}
                  installed={
                    /*
                     * 必须给出 **null** 表示"没装"。MarketCard 用 `installed !== null` 判定，
                     * 若这里写成 `?? { version: null }`，每张卡都会变成"已安装" —— 那个兜底
                     * 对象永远不是 null，"是否已装"的判据就永久为真。
                     */
                    installedLookup.byId.get(entry.id) ??
                    installedLookup.byRepo.get(marketRepoKey(entry.repo)) ??
                    null
                  }
                  installing={installingId === entry.id}
                  onInstall={(target) => void installFromMarket(target)}
                />
              </li>
            ))}
          </ul>
        )}

        {marketError && hasMarket && (
          <p className="mt-3 text-xs text-destructive">刷新失败：{marketError}</p>
        )}
      </section>

      <AddPluginDialog
        open={addOpen}
        mode={addMode}
        onModeChange={setAddMode}
        onOpenChange={setAddOpen}
        onInstalled={async () => {
          await refreshInstalled()
        }}
      />

      {configFor && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="插件设置"
        >
          <div className="w-full max-w-lg rounded-xl border bg-card p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-medium">设置 · {configFor.name || configFor.id}</h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="关闭"
                onClick={() => setConfigFor(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <ConfigForm
              pluginId={configFor.id}
              pluginName={configFor.name || configFor.id}
              configSchema={previewConfigSchema(configFor.preview)}
              onSaved={() => setConfigFor(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
