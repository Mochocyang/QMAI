import { useEffect, useMemo, useState } from "react"
import { Search, X } from "lucide-react"
import type { ReferenceCategory, ReferenceToken } from "@/lib/reference/types"
import { MAX_REFERENCE_COUNT, REFERENCE_TABS } from "@/lib/reference/types"
import type { ReferenceProvider } from "@/lib/reference/providers"

interface ReferencePickerDialogProps {
  open: boolean
  providers: ReferenceProvider[]
  projectPath: string
  onConfirm: (tokens: ReferenceToken[]) => void
  onClose: () => void
  defaultTab?: ReferenceCategory
}

export function ReferencePickerDialog({
  open,
  providers,
  projectPath,
  onConfirm,
  onClose,
  defaultTab = "chapter",
}: ReferencePickerDialogProps) {
  const [activeTab, setActiveTab] = useState<ReferenceCategory>(defaultTab)
  const [items, setItems] = useState<ReferenceToken[]>([])
  const [selected, setSelected] = useState<ReferenceToken[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setActiveTab(defaultTab)
    setSelected([])
    setSearch("")
  }, [open, defaultTab])

  useEffect(() => {
    if (!open) return

    const provider = providers.find((candidate) => candidate.category === activeTab)
    if (!provider) {
      setItems([])
      return
    }

    let cancelled = false
    setLoading(true)
    provider
      .fetchItems(projectPath)
      .then((nextItems) => {
        if (!cancelled) setItems(nextItems)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeTab, open, projectPath, providers])

  const availableTabs = useMemo(
    () => REFERENCE_TABS.filter((tab) => providers.some((provider) => provider.category === tab.key)),
    [providers],
  )

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) => item.title.toLowerCase().includes(keyword))
  }, [items, search])

  function toggleItem(item: ReferenceToken) {
    setSelected((prev) => {
      const exists = prev.some((selectedItem) => selectedItem.id === item.id)
      if (exists) return prev.filter((selectedItem) => selectedItem.id !== item.id)
      if (prev.length >= MAX_REFERENCE_COUNT) return prev
      return [...prev, item]
    })
  }

  function handleConfirm() {
    onConfirm(selected)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reference-picker-title"
        className="flex max-h-[min(720px,calc(100vh-32px))] w-[920px] max-w-[min(920px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="min-w-0">
            <h3 id="reference-picker-title" className="text-base font-semibold">选择引用内容</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">选择后会插入到 AI 会话输入框，不会自动发送。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="关闭引用选择弹窗"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex w-40 shrink-0 flex-col gap-1 border-r bg-muted/30 p-2">
            {availableTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  activeTab === tab.key
                    ? "border border-primary/30 bg-background font-medium text-primary shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                onClick={() => {
                  setActiveTab(tab.key)
                  setSearch("")
                }}
              >
                <span className="truncate">{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b px-3 py-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  className="w-full rounded-md border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                  placeholder="搜索引用内容"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            </div>

            <div className="min-h-[320px] flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中...</div>
              ) : filteredItems.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                  暂无内容
                </div>
              ) : (
                <div className="grid gap-1">
                  {filteredItems.map((item) => {
                    const isSelected = selected.some((selectedItem) => selectedItem.id === item.id)
                    return (
                      <label
                        key={item.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                          isSelected
                            ? "border-primary/40 bg-primary/10"
                            : "border-transparent hover:border-border hover:bg-accent/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItem(item)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.displayTitle || item.title}</span>
                          {item.path ? (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.path}</span>
                          ) : null}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
              <span>
                已选 {selected.length}/{MAX_REFERENCE_COUNT}
                {selected.length >= MAX_REFERENCE_COUNT && (
                  <span className="ml-1 text-destructive">（已达上限）</span>
                )}
              </span>
              {selected.length > 0 ? (
                <span className="max-w-[60%] truncate">
                  {selected.map((item) => item.displayTitle || item.title).join("、")}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button
            type="button"
            className="rounded-md border px-4 py-1.5 text-sm hover:bg-accent"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={selected.length === 0}
            onClick={handleConfirm}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
