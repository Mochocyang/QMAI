import { useCallback, useEffect, useMemo, useState } from "react"
import { LayoutGrid, List, Plus, Puzzle, RefreshCw, Search, X } from "lucide-react"

import { AddPluginDialog, type AddPluginMode } from "@/components/plugins/add-plugin-dialog"
import { BuiltinPluginCard } from "@/components/plugins/builtin-plugin-card"
import { BuiltinPluginRow } from "@/components/plugins/builtin-plugin-row"
import { ConfigForm } from "@/components/plugins/ConfigForm"
import { InstalledRow } from "@/components/plugins/installed-row"
import { SlotActions } from "@/components/plugins/SlotActions"
import { ContentPackBrowser } from "@/components/plugins/ContentPackBrowser"
import { MarketCard } from "@/components/plugins/market-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { pluginsApi, type PluginMarketEntry } from "@/lib/plugins/api"
import { declarativePluginsApi, usePluginSlotIndex } from "@/lib/plugins/declarative/api"
import { defaultTargetApplier } from "@/components/plugins/ActionDialog"
import type { ContentPackItem, OutputTarget } from "@/lib/plugins/declarative/types"
import { BUILTIN_PLUGINS } from "@/lib/plugins/builtin"
import { setBuiltinPluginEnabled } from "@/lib/plugins/builtin-state"
import type { PluginSummary } from "@/lib/plugins/types"
import { useBuiltinPluginsState } from "@/lib/plugins/use-builtin-plugins"
import { toast } from "@/lib/toast"

/**
 * 「插件」独立页面。
 *
 * 设计取舍（用户明确要求过）：
 *  1. **不再用 tab。** 旧版「插件市场 / 已安装」两个 tab 把同样的东西割成两半。
 *     用户点开插件页最想先知道「我装了什么、它们开没开」，所以已安装在上、市场在下，
 *     一屏看得完，不需要切换。之后又在其上加了「内置插件」分区（软件自带的先展示），
 *     于是从上到下是：内置 → 已安装（第三方）→ 市场。
 *  2. **已安装改成行式卡片 + 开关**。开关 = 启用/停用，这是插件最高频的动作，
 *     应该一步到位，而不是让用户在一列文字按钮里找「启用」。
 *  3. 页头**只保留一个**「添加插件」入口。曾经有三个（编辑插件 / 添加插件 /
 *     下拉里的两种安装方式）做同一件事，而对话框本身就有 GitHub/本地目录切换 ——
 *     用户点三个不同的东西看到同一个框，本身就是缺陷，已按用户要求删除重复项。
 */

/**
 * 内置插件的显示方式。
 *
 * 两种视图各有各的用处（见 `builtin-plugin-card.tsx` 顶部注释），所以做成可切换，
 * 而不是替用户做主选一个。选择存 localStorage：这是纯粹的显示偏好，
 * 不跟项目走 —— 换一本书不该让插件页突然变个样子。
 */
export type BuiltinLayout = "grid" | "list"

const BUILTIN_LAYOUT_KEY = "qmai-builtin-plugins-layout-v1"

function readBuiltinLayout(): BuiltinLayout {
  try {
    const raw = localStorage.getItem(BUILTIN_LAYOUT_KEY)
    return raw === "grid" ? "grid" : "list"
  } catch {
    // 存储不可用（隐私模式 / 测试环境）时退回列表：信息更完整，是更安全的默认。
    return "list"
  }
}

function writeBuiltinLayout(layout: BuiltinLayout): void {
  try {
    localStorage.setItem(BUILTIN_LAYOUT_KEY, layout)
  } catch {
    // 存不进去不影响本次会话（state 已更新），也不值得弹一个用户无法处理的提示。
  }
}

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
  const [fromBuiltin, setFromBuiltin] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [loadingMarket, setLoadingMarket] = useState(true)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<AddPluginMode>("url")
  const [configFor, setConfigFor] = useState<PluginSummary | null>(null)

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
      setFromBuiltin(Boolean(data.fromBuiltin))
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
      await refreshPluginState()
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
      await refreshPluginState()
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
      await refreshPluginState()
    } catch (cause) {
      toast.error(describeError(cause))
    } finally {
      setBusyId(null)
    }
  }

  const openAddDialog = (mode: AddPluginMode) => {
    setAddMode(mode)
    setAddOpen(true)
  }

  const hasMarket = market.length > 0

  /*
   * 内置插件的开关状态：应用级（localStorage），不跟项目走。
   * 一次订阅整张表，避免 4 行各自订阅一次；`builtinOn` 用来算分区标题右侧的计数。
   */
  const builtinState = useBuiltinPluginsState()
  /*
   * 插件的界面能力（`plugin-center` 插槽）。
   *
   * 这一区是**插件唯一的可操作入口**：声明式 action（如「生成书名」）会在这里
   * 出现成按钮。它原来挂在设置页的 PluginSection 里，而那个组件在
   * 「插件统一收进创作者中心」之后已无人渲染 —— 于是新装的插件虽然显示"运行中"，
   * 用户却找不到任何地方点它。功能再完整，没有入口就等于没装。
   */
  const pluginSlots = usePluginSlotIndex()
  const centerSlot = pluginSlots.index["plugin-center"]
  const hasCenterAbilities = centerSlot.actions.length > 0 || centerSlot.packs.length > 0

  /*
   * 插件状态变化后，**能力区必须跟着刷新**。
   *
   * 之前卸载插件只刷新了「已安装」列表（`plugins_list`），没有刷新插槽索引
   * （`plugins_actions`）—— 于是插件已经卸载、目录都删了，「插件能力」里那个
   * 按钮还在，点它只会报错。用户看到的是"卸载了却还在"，而界面没有任何自愈迹象。
   *
   * 卸载、启用、停用、安装，四种状态变化都会影响"有哪些能力可用"，
   * 所以统一走这一个函数，避免以后新增一种操作又漏刷。
   */
  const refreshPluginState = useCallback(async () => {
    await refreshInstalled()
    pluginSlots.reload()
  }, [refreshInstalled, pluginSlots])

  /*
   * 内容包浏览器的两个依赖。
   * `loadItems` 收的是合成键（`<pluginId>/<packId>`），不是包内 id ——
   * 宿主的取条目命令只认前者。
   */
  const loadPackItems = useCallback(
    (loadKey: string) => declarativePluginsApi.contentPackItems(loadKey),
    [],
  )
  const applyPackItem = useCallback(async (item: ContentPackItem, target: OutputTarget) => {
    await defaultTargetApplier(target, { kind: "text", text: item.body })
  }, [])
  const [builtinView, setBuiltinView] = useState<BuiltinLayout>(() => readBuiltinLayout())
  const setBuiltinViewMode = useCallback((next: BuiltinLayout) => {
    setBuiltinView(next)
    writeBuiltinLayout(next)
  }, [])
  const builtinOn = BUILTIN_PLUGINS.filter((plugin) => builtinState[plugin.id]).length

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
            页头**只有一个**添加入口。
            这里曾经有三个做同一件事的按钮（「编辑插件」、「＋ 添加插件」、它的下拉里
            又有「安装第三方插件 / 从本地目录安装」），而对话框里本来就有
            「GitHub 仓库 / 本地目录」的切换 —— 用户点了三个不同的东西，看到的是同一个框，
            这本身就是缺陷。用户明确要求：删掉重复的，只留一个「添加插件」。

            「编辑插件」也一并删除：它当时只是同一个对话框的别名，没有独立语义。
            "管理已安装的插件"这件事由下面的行式列表承担（开关 + ⋯ 菜单）。
          */}
          <Button
            type="button"
            data-plugins-manual="true"
            onClick={() => openAddDialog("url")}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            添加插件
          </Button>
        </div>
      </header>

      {/*
        「内置插件」分区放在「已安装」**之上**：内置是软件自带的，用户一进插件页
        最该先看到的是"我本来就有哪些功能、现在开了哪些"，而不是"我还没装什么"。
        已安装（第三方）与市场仍然在下面，三者自上而下是"自带 → 装过 → 可装"。
      */}
      <section aria-labelledby="plugins-builtin" className="px-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 id="plugins-builtin" className="text-sm font-medium">
              内置插件
            </h2>
            <span data-builtin-summary="true" className="text-xs text-muted-foreground">
              共 {BUILTIN_PLUGINS.length} 个 · 已开启 {builtinOn} 个
            </span>
          </div>
          {/*
            视图切换。两种视图不是谁替代谁：
              · 列表 — 描述与"关闭后会发生什么"完整可读，适合"我要关掉某个功能"；
              · 网格 — 图标与名字一屏扫完，适合"我有哪些、哪些开着"。
            选择记在 localStorage，用户下次进来还是同一个视图。
          */}
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5"
            role="group"
            aria-label="内置插件显示方式"
          >
            <Button
              type="button"
              size="sm"
              variant={builtinView === "grid" ? "secondary" : "ghost"}
              className="h-7 px-2"
              aria-pressed={builtinView === "grid"}
              data-builtin-view="grid"
              title="九宫格显示"
              onClick={() => setBuiltinViewMode("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="sr-only">九宫格显示</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={builtinView === "list" ? "secondary" : "ghost"}
              className="h-7 px-2"
              aria-pressed={builtinView === "list"}
              data-builtin-view="list"
              title="列表显示"
              onClick={() => setBuiltinViewMode("list")}
            >
              <List className="h-4 w-4" />
              <span className="sr-only">列表显示</span>
            </Button>
          </div>
        </div>

        {/*
          ⚠️ 诚实性说明，不能删、不能改软。
          内置插件**不是真的卸载**：代码仍在安装包里、磁盘占用不变、也不能单独分发。
          关掉只是让入口消失、功能不加载。不写清这句，用户会以为"关掉 = 卸掉了"，
          然后惊讶于"卸载了怎么还占空间"。
        */}
        <p
          data-builtin-notice="true"
          className="mb-3 rounded-lg border border-dashed px-3 py-2 text-xs leading-relaxed text-muted-foreground"
        >
          内置插件随软件提供，可以关闭但不占用额外空间，也不能卸载。
        </p>

        {builtinView === "grid" ? (
          <ul
            data-builtin-layout="grid"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
          >
            {BUILTIN_PLUGINS.map((plugin) => (
              <BuiltinPluginCard
                key={plugin.id}
                plugin={plugin}
                enabled={builtinState[plugin.id]}
                onToggle={(next) => setBuiltinPluginEnabled(plugin.id, next)}
              />
            ))}
          </ul>
        ) : (
          <ul data-builtin-layout="list" className="space-y-2">
            {BUILTIN_PLUGINS.map((plugin) => (
              <BuiltinPluginRow
                key={plugin.id}
                plugin={plugin}
                enabled={builtinState[plugin.id]}
                onToggle={(next) => setBuiltinPluginEnabled(plugin.id, next)}
              />
            ))}
          </ul>
        )}
      </section>

      {/*
        「插件能力」——**插件的可操作入口**。
        声明式 action 在这里长成按钮（如「生成书名」），点开就是表单 + 调模型 + 出结果。
        没有这一区，用户装了插件之后会看到"运行中"却找不到任何地方点它 ——
        这正是本次修掉的问题：功能完整但没有入口，等于没装。
      */}
      <section aria-labelledby="plugins-abilities" className="mt-6 px-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 id="plugins-abilities" className="text-sm font-medium">
              插件能力
            </h2>
            {hasCenterAbilities ? (
              <span className="text-xs text-muted-foreground">
                {centerSlot.actions.length + centerSlot.packs.length} 项可用
              </span>
            ) : null}
          </div>
          {pluginSlots.degraded ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => pluginSlots.reload()}>
              重新读取
            </Button>
          ) : null}
        </div>

        {pluginSlots.loading ? (
          <div
            role="status"
            className="rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground"
          >
            正在读取插件能力…
          </div>
        ) : hasCenterAbilities ? (
          <div data-plugin-abilities="true" className="space-y-3">
            <SlotActions entries={centerSlot.actions} variant="toolbar" />
            {centerSlot.packs.length > 0 ? (
              <ContentPackBrowser
                packs={centerSlot.packs}
                loadItems={loadPackItems}
                onUse={applyPackItem}
                actions={centerSlot.actions}
              />
            ) : null}
          </div>
        ) : (
          <div
            data-plugin-abilities="true"
            role="status"
            className="rounded-lg border border-dashed px-4 py-4 text-xs leading-relaxed text-muted-foreground"
          >
            还没有插件提供可操作的能力。装了带<strong>动作</strong>或
            <strong>灵感包</strong>的插件后，按钮会出现在这里。
            <br />
            只提供「工具」的插件（由 AI 在对话里自动调用）不会出现在这里。
          </div>
        )}
      </section>

      <section aria-labelledby="plugins-installed" className="mt-6 px-6">
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

        {fromBuiltin && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <span>当前离线模式：正在显示随软件内置的插件清单，可能不是最新。联网后点「刷新」获取最新列表。</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadMarket(true)}>
              重试
            </Button>
          </div>
        )}

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
          await refreshPluginState()
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
