import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, Check } from "lucide-react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { useWikiStore, type SavedModel } from "@/stores/wiki-store"
import { findLlmPresetById } from "@/components/settings/llm-presets"
import { getEffectiveSavedModels, isProviderAvailable } from "@/lib/llm-model-keys"

interface ChatModelSelectorProps {
  value: string
  onChange: (model: string) => void
  disabled?: boolean
}

interface ModelGroup {
  id: string
  label: string
  models: SavedModel[]
}

const DROPDOWN_MAX_HEIGHT = 360
const DROPDOWN_GAP = 4
/** Prefer opening downward when at least this much space exists below the trigger. */
const DROPDOWN_PREFER_BELOW_PX = 200

type ChatModelDropdownStyle = {
  right: number
  width: number
  maxHeight: number
} & ({ top: number; bottom?: undefined } | { bottom: number; top?: undefined })

/** 两套位置是否完全一致：一致就复用旧对象，避免无谓重渲染。 */
export function sameDropdownStyle(
  a: ChatModelDropdownStyle | null,
  b: ChatModelDropdownStyle | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.right === b.right &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight &&
    a.top === b.top &&
    a.bottom === b.bottom
  )
}

/** Pure layout helper — open below when space allows; otherwise open above. */
export function getChatModelDropdownStyle(
  rect: Pick<DOMRect, "top" | "bottom" | "right" | "width">,
  viewport: { width: number; height: number } = {
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  },
): ChatModelDropdownStyle {
  const width = Math.min(Math.max(rect.width, 280), Math.max(0, viewport.width - 8))
  const desiredRight = viewport.width - rect.right - Math.max(0, width - rect.width)
  const right = Math.max(4, Math.min(desiredRight, Math.max(4, viewport.width - width - 4)))
  const spaceAbove = rect.top
  const spaceBelow = viewport.height - rect.bottom
  const openBelow =
    spaceBelow >= DROPDOWN_PREFER_BELOW_PX || spaceBelow >= spaceAbove

  if (openBelow) {
    return {
      right,
      width,
      top: rect.bottom + DROPDOWN_GAP,
      maxHeight: Math.min(
        DROPDOWN_MAX_HEIGHT,
        Math.max(120, spaceBelow - DROPDOWN_GAP - 4),
      ),
    }
  }

  return {
    right,
    width,
    bottom: viewport.height - rect.top + DROPDOWN_GAP,
    maxHeight: Math.min(
      DROPDOWN_MAX_HEIGHT,
      Math.max(120, spaceAbove - DROPDOWN_GAP - 4),
    ),
  }
}

/**
 * 下拉项要显示什么。
 *
 * 保存模型时如果没有单独起名，`name` 会等于模型 ID，直接两行一起渲染就会
 * 出现「同一个模型上下各显示一次」的错觉。这里把这种情况收敛成一行。
 */
export function resolveModelItemLabel(
  model: Pick<SavedModel, "name" | "model">,
): { title: string; showModelId: boolean } {
  const title = model.name?.trim() || model.model
  return { title, showModelId: Boolean(model.model) && title !== model.model }
}

export function ChatModelSelector({ value, onChange, disabled }: ChatModelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  /** 每次打开只自动定位一次，之后用户怎么滚都不再干预。 */
  const scrolledToSelectionRef = useRef(false)
  const [dropdownStyle, setDropdownStyle] = useState<ChatModelDropdownStyle | null>(null)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)

  const modelGroups = useMemo<ModelGroup[]>(() => {
    const groups: ModelGroup[] = []

    const builtinKeys = Object.keys(providerConfigs).filter((k) => !k.startsWith("custom-"))
    for (const key of builtinKeys) {
      const config = providerConfigs[key]
      if (!isProviderAvailable(key, config)) continue
      const models = getEffectiveSavedModels(config)
      if (models.length > 0) {
        const preset = findLlmPresetById(key)
        groups.push({
          id: key,
          label: preset?.label || config.label || key,
          models,
        })
      }
    }

    const customKeys = Object.keys(providerConfigs).filter((k) => k.startsWith("custom-"))
    for (const key of customKeys) {
      const config = providerConfigs[key]
      if (!isProviderAvailable(key, config)) continue
      const models = getEffectiveSavedModels(config)
      if (models.length > 0) {
        groups.push({
          id: key,
          label: config.label || "自定义模型",
          models,
        })
      }
    }

    return groups
  }, [providerConfigs])

  const selectedModel = useMemo(() => {
    if (!value) return null
    const slashIdx = value.indexOf("/")
    if (slashIdx > 0) {
      const providerId = value.slice(0, slashIdx)
      const modelId = value.slice(slashIdx + 1)
      const group = modelGroups.find((g) => g.id === providerId)
      if (group) {
        const found = group.models.find((m) => m.model === modelId)
        if (found) return found
      }
    }
    for (const group of modelGroups) {
      const found = group.models.find((m) => m.model === value)
      if (found) return found
    }
    return null
  }, [value, modelGroups])

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const next = getChatModelDropdownStyle(trigger.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    // 位置没变就别建新对象：每次 scroll 都 setState 会触发重渲染，
    // 而下面的「打开时定位到当前模型」effect 依赖 dropdownStyle，
    // 一重渲染就把用户刚滚到的位置又拉回选中项——表现为"滚不动"。
    setDropdownStyle((prev) => (sameDropdownStyle(prev, next) ? prev : next))
  }, [])

  useEffect(() => {
    if (!open) {
      setDropdownStyle(null)
      return
    }
    let frame2 = 0
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        updatePosition()
      })
    })
    // 只跟随"外部"滚动（页面/弹窗滚动会让锚点位移）；
    // 下拉列表自己的滚动必须忽略，否则每滚一格就重算一次位置。
    const handleReposition = (event?: Event) => {
      const target = event?.target
      const container = dropdownRef.current
      if (container && target instanceof Node && container.contains(target)) return
      updatePosition()
    }
    const onScroll = (event: Event) => handleReposition(event)
    const onResize = () => handleReposition()
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      cancelAnimationFrame(frame1)
      cancelAnimationFrame(frame2)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open])

  /**
   * 打开时把当前选中的模型滚到视野里（尽量居中）。
   *
   * 以前每次都从第一个模型开始显示，模型多的时候用户得自己往下翻才能找到
   * 正在用的那个。等 dropdownStyle 就位后再算：此时容器高度已确定。
   *
   * 只在「每次打开」执行一次：之前把 dropdownStyle 放进依赖里，位置一变化
   * （哪怕是列表自身滚动触发的重算）就会把用户滚到的位置又拽回选中项，
   * 表现出来就是「下拉后滚不动」。
   */
  useEffect(() => {
    if (!open) {
      scrolledToSelectionRef.current = false
      return
    }
    if (!dropdownStyle || scrolledToSelectionRef.current) return
    const container = dropdownRef.current
    if (!container) return
    scrolledToSelectionRef.current = true
    const selected = container.querySelector<HTMLElement>('[data-selected="true"]')
    if (!selected) return
    const target = selected.offsetTop - (container.clientHeight - selected.offsetHeight) / 2
    const max = Math.max(0, container.scrollHeight - container.clientHeight)
    container.scrollTop = Math.min(Math.max(0, target), max)
  }, [open, dropdownStyle])

  if (modelGroups.length === 0) {
    return null
  }

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="h-8 w-fit max-w-40 justify-start gap-1 px-2 text-xs"
      >
        <span className="max-w-32 truncate text-left">
          {selectedModel?.name ?? (value && value.trim() ? value : t("chat.selectModel"))}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </Button>

      {open && dropdownStyle && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          {/* 顶部不留 padding：吸顶标题要贴到滚动区最上沿，否则上一行会从那条缝里透出来（实测见 preview/sticky-ab.html） */}
          <div
            ref={dropdownRef}
            className="fixed rounded-md border bg-popover px-0.5 pb-0.5 pt-0 shadow-lg model-selector-dropdown"
            style={{
              right: dropdownStyle.right,
              top: dropdownStyle.top,
              bottom: dropdownStyle.bottom,
              width: dropdownStyle.width,
              maxHeight: dropdownStyle.maxHeight,
              overflowY: "auto",
              zIndex: 9999,
            }}
          >
            {modelGroups.map((group) => (
              <div key={group.id}>
                {/* 分组标题吸顶：滚动时压在最上面，下一组标题上来会把它顶走 */}
                <div className="sticky top-0 z-10 rounded-t-md bg-popover px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                {group.models.map((model) => {
                  const modelKey = `${group.id}/${model.model}`
                  const { title, showModelId } = resolveModelItemLabel(model)
                  const selected = value === modelKey
                  return (
                  <button
                    key={model.id}
                    type="button"
                    data-selected={selected ? "true" : undefined}
                    onClick={() => {
                      onChange(modelKey)
                      setOpen(false)
                    }}
                    className={`relative flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                      selected ? "bg-accent" : ""
                    }`}
                  >
                    {/* 选中用左侧竖条表示，比整行高亮更轻 */}
                    <span
                      aria-hidden="true"
                      className={`absolute left-1 top-1/2 w-1 -translate-y-1/2 rounded-full bg-primary transition-[height] ${
                        selected ? "h-5" : "h-0"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm leading-5">{title}</div>
                      {showModelId && (
                        <code className="block truncate text-xs leading-4 text-muted-foreground">
                          {model.model}
                        </code>
                      )}
                    </div>
                    {/* 勾选放右侧：左侧要留给模型名，不留图标占位，列表看起来才是齐的 */}
                    <Check
                      className={`h-3.5 w-3.5 shrink-0 ${
                        selected ? "opacity-100" : "opacity-0"
                      }`}
                    />
                  </button>
                  )
                })}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
