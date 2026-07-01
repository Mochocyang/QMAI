import { useEffect, useMemo, useState } from "react"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex max-h-[520px] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-base font-semibold">选择引用内容</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-lg leading-none text-gray-400 hover:text-gray-600"
            aria-label="关闭引用选择弹窗"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex w-28 flex-col gap-0.5 border-r bg-gray-50 py-2">
            {REFERENCE_TABS.map((tab) => {
              if (!providers.some((provider) => provider.category === tab.key)) return null
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`px-3 py-2 text-left text-sm transition-colors ${
                    activeTab === tab.key
                      ? "border-r-2 border-blue-600 bg-white font-medium text-blue-600"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                  onClick={() => {
                    setActiveTab(tab.key)
                    setSearch("")
                  }}
                >
                  {tab.icon} {tab.label}
                </button>
              )
            })}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b px-3 py-2">
              <input
                type="search"
                className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="搜索..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="min-h-[260px] flex-1 overflow-y-auto px-2 py-1">
              {loading ? (
                <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
              ) : filteredItems.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">暂无内容</div>
              ) : (
                filteredItems.map((item) => {
                  const isSelected = selected.some((selectedItem) => selectedItem.id === item.id)
                  return (
                    <label
                      key={item.id}
                      className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-blue-50 ${
                        isSelected ? "bg-blue-50" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleItem(item)}
                        className="accent-blue-500"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    </label>
                  )
                })
              )}
            </div>

            <div className="border-t px-3 py-2 text-xs text-gray-400">
              已选 {selected.length}/{MAX_REFERENCE_COUNT}
              {selected.length >= MAX_REFERENCE_COUNT && (
                <span className="ml-1 text-red-400">（已达上限）</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button
            type="button"
            className="rounded-md border px-4 py-1.5 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-md bg-blue-500 px-4 py-1.5 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
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
