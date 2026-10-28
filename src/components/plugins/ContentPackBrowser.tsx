/**
 * 内容包（灵感库）浏览器：左侧包列表、右侧条目卡片，顶部搜索 + 标签筛选。
 *
 * 搜索与筛选**复用 `declarative/content-pack.ts` 的纯函数**（`filterContentItems` /
 * `collectTags`），不另写一套：同一套匹配规则将来还要被 `qmai-plugin validate`
 * 的"检查标签覆盖率"用到，两套实现必然一个说命中、一个说不命中。
 *
 * 每张卡片下的操作来自内容包声明（`pack.actions`），四种里：
 *   - `insert-at-cursor` / `project-field` / `clipboard` → 交给宿主的 `onUse`
 *   - `run-action` → 走 `ActionDialog`（复用 action 执行器，不另做机制，设计 §4.3）
 *
 * `run-action` 的**链式保护**（禁止跨插件、深度 > 3 拒绝，设计 §4.3）属于执行期
 * 约束，落在接线任务的执行器里；这里只保证"能找到同插件的那条 action"，
 * 找不到就禁用按钮并说明原因。
 */
import { useEffect, useMemo, useState } from "react"
import { Loader2, Puzzle, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createDefaultRunDeps, type PackItemAction } from "@/lib/plugins/declarative/api"
import { collectTags, filterContentItems } from "@/lib/plugins/declarative/content-pack"
import type { RunActionDeps } from "@/lib/plugins/declarative/run"
import type { ContentPack, ContentPackItem, OutputTarget } from "@/lib/plugins/declarative/types"
import type { SlotActionEntry, SlotPackEntry } from "@/lib/plugins/slots"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { ActionDialog, defaultTargetApplier, type TargetApplier } from "./ActionDialog"
import { describeRunError } from "./ActionDialog"

export interface ContentPackBrowserProps {
  packs: SlotPackEntry[]
  loadItems: (packId: string) => Promise<ContentPackItem[]>
  onUse: (item: ContentPackItem, target: OutputTarget) => Promise<void>
  /** 同插槽的 action 列表：`run-action` 用它找到要执行的 action。 */
  actions?: SlotActionEntry[]
  deps?: RunActionDeps
  onApplyTarget?: TargetApplier
  editorAvailable?: boolean
}

/**
 * 内容包声明的操作；没声明时给两个通用操作。
 *
 * 为什么要有兜底：一个只写了 `items` 的包如果没有任何操作，用户只能看着卡片
 * 干瞪眼（没法把内容拿走）。"插入正文 + 复制"是任何灵感文本都成立的用法。
 */
const FALLBACK_PACK_ACTIONS: PackItemAction[] = [
  { kind: "insert-at-cursor", label: "插入正文" },
  { kind: "clipboard", label: "复制" },
]

export function resolvePackActions(pack: ContentPack): PackItemAction[] {
  const declared = (pack.actions ?? []) as PackItemAction[]
  return declared.length > 0 ? declared : FALLBACK_PACK_ACTIONS
}

/** 标签筛选的一次开关（纯函数，便于单测）。 */
export function toggleTagFilter(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag]
}

export function ContentPackBrowser({
  packs,
  loadItems,
  onUse,
  actions,
  deps,
  onApplyTarget,
  editorAvailable = false,
}: ContentPackBrowserProps) {
  const [activePackId, setActivePackId] = useState<string>(() => packs[0]?.pack.id ?? "")
  const [query, setQuery] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [itemsByPack, setItemsByPack] = useState<Record<string, ContentPackItem[]>>({})
  const [useError, setUseError] = useState("")
  const [activeRun, setActiveRun] = useState<{ entry: SlotActionEntry; item: ContentPackItem } | null>(null)

  const fallbackDeps = useMemo(() => createDefaultRunDeps(), [])
  const resolvedDeps = deps ?? fallbackDeps

  // 包列表变化（例如刚装了一个插件）时，保证当前选中的包仍然存在。
  useEffect(() => {
    if (packs.length === 0) {
      if (activePackId !== "") setActivePackId("")
      return
    }
    if (!packs.some((entry) => entry.pack.id === activePackId)) {
      setActivePackId(packs[0].pack.id)
    }
  }, [packs, activePackId])

  // 条目按需加载：内容包可达数千条，插件中心不该为"显示一个包名"把全部拉进内存。
  //
  // 加载态**由 `itemsByPack` 是否已有该键推导**，不额外存一个 loading 状态：
  // 存状态就得在 effect 清理里复位，而清理恰好发生在"数据刚写入"的那次提交上
  // （依赖 `itemsByPack` 变了），于是复位被跳过、面板永远停在"正在加载"。
  useEffect(() => {
    if (activePackId === "") return
    if (itemsByPack[activePackId] !== undefined) return
    let cancelled = false
    void loadItems(activePackId)
      .then((items) => {
        if (cancelled) return
        setItemsByPack((previous) => ({ ...previous, [activePackId]: items }))
      })
      .catch((cause: unknown) => {
        // 单个包读失败不该把整个灵感库变成错误页：显示空包（原因进 console）
        if (cancelled) return
        console.warn(`[plugins] 内容包 ${activePackId} 读取失败：`, cause)
        setItemsByPack((previous) => ({ ...previous, [activePackId]: [] }))
      })
    return () => {
      cancelled = true
    }
  }, [activePackId, itemsByPack, loadItems])

  const activePack = packs.find((entry) => entry.pack.id === activePackId)
  const allItems = activePackId === "" ? [] : itemsByPack[activePackId] ?? []
  const isLoadingPack = activePackId !== "" && itemsByPack[activePackId] === undefined
  const tagStats = useMemo(() => collectTags(allItems), [allItems])
  const visibleItems = useMemo(
    () => filterContentItems(allItems, query, selectedTags),
    [allItems, query, selectedTags],
  )

  function switchPack(packId: string) {
    setActivePackId(packId)
    // 换包时清筛选条件：上一个包的标签/关键词对下一个包几乎没有意义，
    // 留着会让用户看到"空的列表"却不知道为什么。
    setQuery("")
    setSelectedTags([])
    setUseError("")
  }

  async function useItem(item: ContentPackItem, action: PackItemAction) {
    setUseError("")
    try {
      await onUse(item, action)
    } catch (cause) {
      setUseError(describeRunError(cause))
    }
  }

  function runActionOnItem(item: ContentPackItem, action: PackItemAction) {
    const actionId = action.actionId
    if (!actionId) {
      setUseError("这条操作没有指定要执行的 action。")
      return
    }
    // 只认同插件内的 action：跨插件调用会形成隐式依赖（设计 §4.3）
    const entry = actions?.find(
      (candidate) => candidate.pluginId === activePack?.pluginId && candidate.action.id === actionId,
    )
    if (!entry) {
      setUseError(`找不到动作「${action.label}」对应的实现，可能插件版本不匹配。`)
      return
    }
    setActiveRun({ entry, item })
  }

  if (packs.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center"
        data-content-browser="empty-packs"
      >
        <Puzzle className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">还没有可用的灵感包。安装声明了内容包的插件后会出现在这里。</p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(120px,180px)_1fr]" data-content-browser="true">
      <div className="space-y-1" role="tablist" aria-label="灵感包列表">
        {packs.map((entry) => {
          const selected = entry.pack.id === activePackId
          return (
            <button
              key={`${entry.pluginId}:${entry.pack.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => switchPack(entry.pack.id)}
              title={entry.pack.description ?? entry.pack.title}
              className={cn(
                "w-full rounded-md px-2.5 py-1.5 text-left text-xs",
                selected
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className="block truncate">{entry.pack.title}</span>
              <span className="block truncate text-[0.625rem] opacity-70">{entry.pluginName}</span>
            </button>
          )
        })}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[140px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、正文或标签"
              aria-label="搜索灵感条目"
              data-content-search="true"
              className="h-8 w-full rounded-md border border-input bg-background pr-2.5 pl-7 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {allItems.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {visibleItems.length} / {allItems.length} 条
            </span>
          ) : null}
        </div>

        {tagStats.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" data-content-tags="true">
            {tagStats.map(({ tag, count }) => {
              const selected = selectedTags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedTags((previous) => toggleTagFilter(previous, tag))}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[0.6875rem]",
                    selected
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-accent",
                  )}
                >
                  {tag}
                  <span className="ml-1 opacity-60">{count}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        {useError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" role="alert">
            {useError}
          </div>
        ) : null}

        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {isLoadingPack ? (
            <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载条目…
            </div>
          ) : allItems.length === 0 ? (
            <div
              className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
              data-content-browser="empty-items"
            >
              这个灵感包还没有内容。
            </div>
          ) : visibleItems.length === 0 ? (
            <div
              className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
              data-content-browser="no-match"
            >
              没有匹配的条目，换个关键词或标签试试。
            </div>
          ) : (
            visibleItems.map((item) => (
              <div
                key={item.id}
                className="space-y-2 rounded-lg border border-border px-3 py-2"
                data-content-item={item.id}
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium break-words">{item.title}</p>
                  <p className="text-xs leading-relaxed break-words text-muted-foreground">{item.body}</p>
                </div>
                {item.tags && item.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  {(activePack ? resolvePackActions(activePack.pack) : []).map((action) => {
                    const isRunAction = (action.kind as string) === "run-action"
                    return (
                      <Button
                        key={`${action.kind}-${action.label}`}
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => (isRunAction ? runActionOnItem(item, action) : void useItem(item, action))}
                      >
                        {action.label}
                      </Button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {activeRun ? (
        <ActionDialog
          open
          entry={activeRun.entry}
          onClose={() => setActiveRun(null)}
          deps={resolvedDeps}
          onApplyTarget={onApplyTarget ?? defaultTargetApplier}
          editorAvailable={editorAvailable}
        />
      ) : null}
    </div>
  )
}

/** 供宿主在"用条目"失败时提示（避免各处自己写一遍 toast 文案）。 */
export function describeUseError(cause: unknown): string {
  return describeRunError(cause)
}

/** 内容包条目的默认使用提示：成功时给一句可读反馈。 */
export function notifyItemUsed(item: ContentPackItem, target: OutputTarget): void {
  toast.success(`已${target.label}：${item.title}`)
}
