import { useEffect, useMemo, useRef, useState } from "react"
import { Search, X } from "lucide-react"
import type { ReferenceCategory, ReferenceToken, SkillSubtype } from "@/lib/reference/types"
import { MAX_REFERENCE_COUNT, REFERENCE_TABS } from "@/lib/reference/types"
import type { ReferenceProvider } from "@/lib/reference/providers"
import {
  SKILL_KIND_LABELS,
  SKILL_STAGE_LABELS,
  SKILL_MODE_LABELS,
} from "@/lib/novel/skill-library"

/*
 * 技能库下的子类型清单（**全集**，不是每次都渲染的清单）。
 * 渲染处按「这次真的有条目」再过滤一次，见 `availableSkillSubtabs`。
 */
const SKILL_SUBTABS: Array<{ key: SkillSubtype; label: string }> = [
  { key: "deai", label: "去AI味技能" },
  { key: "writing", label: "写作Skill" },
  // 丁-3：文风预设（项目里的文风库）。只有真的产出了文风条目的面板才会看到这个子 tab。
  { key: "style", label: "文风" },
]

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
  const [skillSubtab, setSkillSubtab] = useState<SkillSubtype>("deai")
  const [items, setItems] = useState<ReferenceToken[]>([])
  const [selected, setSelected] = useState<ReferenceToken[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const uiTestDialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    uiTestDialogRef.current?.querySelector<HTMLElement>("button, input")?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); return }
      if (event.key !== "Tab") return
      const items = Array.from(uiTestDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? [])
      if (!items.length) return
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); items[items.length - 1].focus() }
      else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0].focus() }
    }
    document.addEventListener("keydown", keyboard, true)
    return () => { document.removeEventListener("keydown", keyboard, true); if (previous?.isConnected) previous.focus() }
  }, [open])

  useEffect(() => {
    if (!open) return
    setActiveTab(defaultTab)
    setSkillSubtab("deai")
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

  /*
   * 子 tab 只列出**这次真的有条目**的子类型。
   *
   * `SKILL_SUBTABS` 是模块级共享常量，而各面板的 skill provider 覆盖的子类型并不一样：
   * 大纲/细纲面板只吐 deai/writing（它的 agent 配置里没有文风覆盖通道，
   * 见 `outline-chat-panel.tsx` 的 `buildOutlineReferenceSkillEntries`）。
   * 无条件渲染全部子 tab，就会给它摆出一个永远「暂无内容」的「文风」子 tab
   * —— 用户会读成「库里没有文风」，而不是「这个面板不支持引用文风」，
   * 这正是本批要消灭的死入口形状（只差一个层级：不是死条目，而是死子 tab）。
   *
   * 判据用**未经搜索过滤的** `items`：搜索是用户当下的筛选动作，
   * 不该让子 tab 随关键词出现/消失。
   *
   * ⚠️ **如实说明这条逃生口的边界**（初版注释在这里说过头了）：
   * 它只判 `items.length === 0`，**不判 `loading`**。而 `items` 在切换分类时不重置，
   * 所以「从章节切到技能库、fetch 还没回来」的这段时间里，`items` 是**上一个分类的旧值**
   * （非空、且没有 `skillSubtype`）⇒ 过滤结果为空 ⇒ 子 tab 条**会短暂整条消失**，
   * 列表此时显示「加载中...」。旧代码同样如此（这是既有行为，本批没动它）。
   * 它真正保证的是**首次打开 / 列表确实为空**时不闪：那时 `items` 是 `[]`，
   * 保留全部子 tab 并显示「暂无内容」—— 那才是「库里没有」的诚实表达。
   */
  const availableSkillSubtabs = useMemo(
    () => (items.length === 0
      ? SKILL_SUBTABS
      : SKILL_SUBTABS.filter((subtab) => items.some((item) => item.skillSubtype === subtab.key))),
    [items],
  )

  /*
   * 当前子 tab 若已不在可用列表里（例如项目里只有文风预设、没有去AI味技能），
   * 落到第一个可用子 tab。否则会出现「高亮停在一个看不见的 tab 上、列表恒为空」。
   * 列表为空时 `availableSkillSubtabs === SKILL_SUBTABS`，这里恒等于原状态。
   */
  const effectiveSkillSubtab = availableSkillSubtabs.some((subtab) => subtab.key === skillSubtab)
    ? skillSubtab
    : availableSkillSubtabs[0]?.key ?? skillSubtab

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    let result = items
    if (activeTab === "skill") {
      result = result.filter((item) => item.skillSubtype === effectiveSkillSubtab)
    }
    if (!keyword) return result
    return result.filter((item) => item.title.toLowerCase().includes(keyword))
  }, [items, search, activeTab, effectiveSkillSubtab])

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
    <div data-ui-reference="overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div
        ref={uiTestDialogRef}
        data-ui-reference="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reference-picker-title"
        className="flex h-[min(720px,calc(100vh-32px))] w-[920px] max-w-[min(920px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-2xl"
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

        <div data-ui-reference="body" className="flex min-h-0 flex-1 overflow-hidden">
          <div data-ui-reference="tabs" role="tablist" aria-label="引用分类" className="flex w-40 shrink-0 flex-col gap-1 border-r bg-muted/30 p-2">
            {availableTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
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
            {activeTab === "skill" && availableSkillSubtabs.length > 0 && (
              <div data-ui-reference="skill-subtabs" className="flex gap-1 border-b px-3 py-2">
                {availableSkillSubtabs.map((subtab) => (
                  <button
                    key={subtab.key}
                    type="button"
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      effectiveSkillSubtab === subtab.key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                    onClick={() => {
                      setSkillSubtab(subtab.key)
                      setSearch("")
                    }}
                  >
                    {subtab.label}
                  </button>
                ))}
              </div>
            )}
            <div className="border-b px-3 py-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  className="w-full rounded-md border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                  placeholder="搜索引用内容"
                  aria-label="搜索引用内容"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            </div>

            <div data-ui-reference="list" className="min-h-[320px] min-h-0 flex-1 overflow-y-auto p-2">
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
                    const hasSkillMeta = item.category === "skill" && (item.skillKinds?.length || item.skillStages?.length || item.skillModes?.length)
                    return (
                      <label
                        key={item.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                          isSelected
                            ? "border-primary/40 bg-primary/10"
                            : "border-transparent hover:border-border hover:bg-accent/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItem(item)}
                          className="mt-0.5 h-4 w-4 accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.displayTitle || item.title}</span>
                          {item.path ? (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.path}</span>
                          ) : null}
                          {hasSkillMeta ? (
                            <span className="mt-1.5 flex flex-wrap gap-1">
                              {item.skillKinds?.map((kind) => (
                                <span
                                  key={kind}
                                  className="inline-flex items-center rounded border px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground"
                                >
                                  {SKILL_KIND_LABELS[kind]}
                                </span>
                              ))}
                              {item.skillStages?.map((stage) => (
                                <span
                                  key={stage}
                                  className="inline-flex items-center rounded border border-dashed px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
                                >
                                  {SKILL_STAGE_LABELS[stage]}
                                </span>
                              ))}
                              {item.skillModes?.map((mode) => (
                                <span
                                  key={mode}
                                  className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
                                >
                                  {SKILL_MODE_LABELS[mode]}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div data-ui-reference="selection" className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
              <span>
                已选 {selected.length}/{MAX_REFERENCE_COUNT}
                {selected.length >= MAX_REFERENCE_COUNT && (
                  <span className="ml-1 text-destructive">（已达上限）</span>
                )}
              </span>
              {<div data-ui-reference="selected">{selected.map(item => <button type="button" key={item.id} aria-label={`移除引用${item.displayTitle || item.title}`} onClick={() => toggleItem(item)}>{item.displayTitle || item.title}<X aria-hidden="true" /></button>)}</div>}
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
            {`确认引用 ${selected.length} 项`}
          </button>
        </div>
      </div>
    </div>
  )
}
