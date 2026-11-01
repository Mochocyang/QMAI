import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, Check, ChevronRight } from "lucide-react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { useWikiStore, type SavedModel } from "@/stores/wiki-store"
import { findLlmPresetById } from "@/components/settings/llm-presets"
import { getEffectiveSavedModels, isProviderAvailable } from "@/lib/llm-model-keys"
import { isObsoleteProviderId } from "@/lib/obsolete-providers"
import { refreshBuiltinModels } from "@/lib/builtin-models/auto-sync"
import {
  ModelSettingsPopover,
  getModelSettingsPanelStyle,
  type ModelSettingsPanelStyle,
} from "./model-settings-popover"

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
/**
 * 下拉最小宽度。与「模型设置」悬停面板同宽（320），
 * 也是「名称 + 优惠标签 + 倍率列」三项并排不截断的实测下限。
 */
const DROPDOWN_MIN_WIDTH = 320

/** 自定义模型整块是否展开（方案 F 的开关）：记住用户上一次的选择。 */
const CUSTOM_OPEN_STORAGE_KEY = "qmai:chat-model-selector:custom-open"
/** 每个自定义提供方的展开状态（方案 D 的折叠）：按 providerId 存一份。 */
const PROVIDER_OPEN_STORAGE_KEY = "qmai:chat-model-selector:providers-open"

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
  const width = Math.min(Math.max(rect.width, DROPDOWN_MIN_WIDTH), Math.max(0, viewport.width - 8))
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

/**
 * 倍率怎么显示。
 *
 * 内置模型的倍率来自中转站（与控制台同步）；没有倍率时不显示占位符 ——
 * 需求明确要求「自定义模型后面不要出现横线」，所以两类模型都只画有值的倍率。
 */
export function formatModelRatio(ratio: number | undefined | null): string | null {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return null
  // 控制台允许任意数值（0–100），这里最多留两位小数并去掉末尾的 0：0.08 / 0.3 / 1 / 1.25
  const fixed = ratio.toFixed(2).replace(/\.?0+$/, "")
  return `${fixed === "" ? "0" : fixed}x`
}

/** 一行里除了名称之外，右侧还挂什么（倍率、时段标签）。 */
export interface ModelRowDecoration {
  ratio: string | null
  /** 命中时段倍率时的角标，如「夜间折扣」 */
  rule: string | null
}

export function resolveModelRowDecoration(model: SavedModel): ModelRowDecoration {
  return {
    ratio: formatModelRatio(model.rating?.ratio),
    rule: model.rating?.rule?.trim() || null,
  }
}

/** 内置模型行的小方块标记：取名称首字，和中转站品牌无关，离线也能显示。 */
export function modelRowMark(title: string): string {
  const trimmed = (title ?? "").trim()
  if (!trimmed) return "?"
  const ascii = /^[A-Za-z0-9]/.test(trimmed)
  return ascii ? trimmed.slice(0, 2).toUpperCase() : trimmed.slice(0, 1)
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : raw === "1"
  } catch {
    return fallback
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0")
  } catch {
    // 隐私模式/配额满：记住状态只是顺手，不记也不影响功能
  }
}

function readProviderOpen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PROVIDER_OPEN_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [])
  } catch {
    return new Set()
  }
}

function writeProviderOpen(open: Set<string>): void {
  try {
    window.localStorage.setItem(PROVIDER_OPEN_STORAGE_KEY, JSON.stringify([...open]))
  } catch {
    // 同上：存不下就算了
  }
}

export function ChatModelSelector({ value, onChange, disabled }: ChatModelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  /** 每次打开只自动定位一次，之后用户怎么滚都不再干预。 */
  const scrolledToSelectionRef = useRef(false)
  const [dropdownStyle, setDropdownStyle] = useState<ChatModelDropdownStyle | null>(null)
  /** 悬停弹窗：与下拉列表互斥，打开列表时立刻收起。 */
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<ModelSettingsPanelStyle | null>(null)
  /** 用于「点面板外面才关闭」的命中判断。 */
  const panelRef = useRef<HTMLDivElement>(null)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)

  /** 方案 F：自定义模型整块默认收起，状态记在本地。 */
  const [customOpen, setCustomOpen] = useState<boolean>(() => readBool(CUSTOM_OPEN_STORAGE_KEY, false))
  /** 方案 D：每个自定义提供方各自折叠。 */
  const [openProviders, setOpenProviders] = useState<Set<string>>(() => readProviderOpen())

  const { builtinGroups, customGroups } = useMemo(() => {
    const builtins: ModelGroup[] = []
    const customs: ModelGroup[] = []

    for (const [key, config] of Object.entries(providerConfigs)) {
      if (!isProviderAvailable(key, config)) continue
      const models = getEffectiveSavedModels(config)
      if (models.length === 0) continue
      const isCustom = key.startsWith("custom-")
      const group: ModelGroup = {
        id: key,
        label: isCustom
          ? (config.label || "自定义模型")
          : (findLlmPresetById(key)?.label || config.label || key),
        models,
      }
      ;(isCustom ? customs : builtins).push(group)
    }

    return { builtinGroups: builtins, customGroups: customs }
  }, [providerConfigs])

  const allGroups = useMemo(
    () => [...builtinGroups, ...customGroups],
    [builtinGroups, customGroups],
  )

  /*
   * 选中值可能仍指向已移除的 provider（例如 aiChatModel 还是 "workbuddy/xxx"）。
   * 那种情况下方下拉里已经没有这个分组，界面不该把 "workbuddy/xxx" 原样显示出来 ——
   * 统一回落到「选择模型」占位文案。
   */
  const valueProviderId = useMemo(() => {
    const slash = value?.indexOf("/") ?? -1
    return slash > 0 ? value!.slice(0, slash) : ""
  }, [value])
  const selectorFallbackLabel = useMemo(() => {
    if (!value || !value.trim()) return t("chat.selectModel")
    return isObsoleteProviderId(valueProviderId) ? t("chat.selectModel") : value
  }, [value, valueProviderId, t])

  const selectedModel = useMemo(() => {
    if (!value) return null
    const slashIdx = value.indexOf("/")
    if (slashIdx > 0) {
      const providerId = value.slice(0, slashIdx)
      const modelId = value.slice(slashIdx + 1)
      const group = allGroups.find((g) => g.id === providerId)
      if (group) {
        const found = group.models.find((m) => m.model === modelId)
        if (found) return found
      }
    }
    for (const group of allGroups) {
      const found = group.models.find((m) => m.model === value)
      if (found) return found
    }
    return null
  }, [value, allGroups])

  /**
   * 悬停弹窗要把改动写回哪一家：解析出 `providerId` + `modelId`。
   * `value` 是 `providerId/modelId`，解析不出对应分组时（例如旧数据只有模型名）就不弹。
   */
  const selectedEntry = useMemo(() => {
    if (!value?.trim()) return null
    const slashIdx = value.indexOf("/")
    if (slashIdx > 0) {
      const providerId = value.slice(0, slashIdx)
      const modelId = value.slice(slashIdx + 1)
      const group = allGroups.find((g) => g.id === providerId)
      const model = group?.models.find((m) => m.model === modelId)
      if (group && model) {
        return { providerId, modelId, title: resolveModelItemLabel(model).title }
      }
    }
    for (const group of allGroups) {
      const model = group.models.find((m) => m.model === value)
      if (model) {
        return { providerId: group.id, modelId: model.model, title: resolveModelItemLabel(model).title }
      }
    }
    return null
  }, [value, allGroups])

  /** 当前选中项是不是某个自定义提供方里的模型 —— 决定打开时要展开哪一块。 */
  const selectedCustomProviderId = useMemo(() => {
    if (!value) return null
    const slashIdx = value.indexOf("/")
    const providerId = slashIdx > 0 ? value.slice(0, slashIdx) : ""
    if (customGroups.some((group) => group.id === providerId)) return providerId
    return customGroups.find((group) => group.models.some((m) => m.model === value))?.id ?? null
  }, [value, customGroups])

  const clearPanelTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  /**
   * 用户一旦在面板里动过手（点档位、拨开关），就不再因为「鼠标离开」收起。
   *
   * 原来的毛病：点一下就关，想连着改「上下文窗口 + 输出上限」得反复把鼠标移回去。
   * 现在的关闭条件只有三条：点面板外面、点模型按钮、按 Esc。
   */
  const panelPinnedRef = useRef(false)

  const closePanel = useCallback(() => {
    clearPanelTimers()
    panelPinnedRef.current = false
    setPanelOpen(false)
  }, [clearPanelTimers])

  const updatePanelStyle = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    setPanelStyle(
      getModelSettingsPanelStyle(trigger.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    )
  }, [])

  /** 悬停有一小段延迟：鼠标只是路过时不弹，避免面板一直闪。 */
  const schedulePanelOpen = useCallback(() => {
    if (panelPinnedRef.current) return
    clearPanelTimers()
    openTimerRef.current = window.setTimeout(() => setPanelOpen(true), 140)
  }, [clearPanelTimers])

  const schedulePanelClose = useCallback(() => {
    // 用户已经在面板里操作过：不再自动收起，改由「点外面 / 点模型 / Esc」关闭。
    if (panelPinnedRef.current) return
    clearPanelTimers()
    closeTimerRef.current = window.setTimeout(() => setPanelOpen(false), 220)
  }, [clearPanelTimers])

  /** 鼠标从按钮移到面板上时取消关闭（两者之间有一小段缝）。 */
  const cancelPanelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  /** 在面板里按下鼠标：钉住面板，之后可以连续调整多项。 */
  const pinPanel = useCallback(() => {
    panelPinnedRef.current = true
    cancelPanelClose()
  }, [cancelPanelClose])

  useEffect(() => clearPanelTimers, [clearPanelTimers])

  // 打开模型列表就不再需要悬停弹窗：两者叠在一起会互相挡。
  useEffect(() => {
    if (open && panelOpen) closePanel()
  }, [open, panelOpen, closePanel])

  /**
   * 打开下拉框时先让「当前选中的自定义模型」可见：
   * 它所在的那一块如果是收起的，选中态就藏起来了，用户会以为没选中。
   */
  useEffect(() => {
    if (!open || !selectedCustomProviderId) return
    setCustomOpen(true)
    setOpenProviders((prev) => {
      if (prev.has(selectedCustomProviderId)) return prev
      const next = new Set(prev)
      next.add(selectedCustomProviderId)
      return next
    })
  }, [open, selectedCustomProviderId])

  /**
   * 打开下拉框时刷新倍率：控制台改完倍率要立刻能看到。
   *
   * 内部有 30 秒节流，所以可以放心地挂在「每次打开」上；失败也只是静默，
   * 界面上继续显示上一次缓存的值，不打断用户挑模型。
   */
  useEffect(() => {
    if (!open) return
    void refreshBuiltinModels().catch(() => {})
  }, [open])

  /**
   * 点面板外面关闭。
   *
   * 捕获阶段监听：即使外部控件自己 stopPropagation 也能收到。
   * 点在模型按钮上不在这里关——那一下交给按钮自己的 onClick（它要么开列表、要么收起面板）。
   */
  useEffect(() => {
    if (!panelOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      closePanel()
    }
    window.addEventListener("mousedown", handlePointerDown, true)
    return () => window.removeEventListener("mousedown", handlePointerDown, true)
  }, [panelOpen, closePanel])

  useEffect(() => {
    if (!panelOpen) {
      setPanelStyle(null)
      return
    }
    updatePanelStyle()
    const onReposition = () => updatePanelStyle()
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    return () => {
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
  }, [panelOpen, updatePanelStyle])

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
    if (!open && !panelOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
        closePanel()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, panelOpen, closePanel])

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

  const toggleCustomOpen = useCallback(() => {
    setCustomOpen((prev) => {
      const next = !prev
      writeBool(CUSTOM_OPEN_STORAGE_KEY, next)
      return next
    })
  }, [])

  const toggleProvider = useCallback((providerId: string) => {
    setOpenProviders((prev) => {
      const next = new Set(prev)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      writeProviderOpen(next)
      return next
    })
  }, [])

  if (allGroups.length === 0) {
    return null
  }

  return (
    <div
      className="relative"
      /*
        悬停弹窗的三个出口：鼠标进入/离开、键盘聚焦/失焦。
        鼠标离开时延迟收起（鼠标要穿过按钮与弹窗之间那道缝），
        移进弹窗由 `cancelPanelClose` 取消；弹窗本身是 portal，所以只能靠计时器接。
      */
      onMouseEnter={() => {
        if (!disabled && selectedEntry && !open) schedulePanelOpen()
      }}
      onMouseLeave={schedulePanelClose}
      onFocus={() => {
        if (!disabled && selectedEntry && !open) schedulePanelOpen()
      }}
      onBlur={schedulePanelClose}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={() => {
          if (disabled) return
          // 点模型按钮：面板开着就收起来，顺手把列表打开——「点模型即关闭」这条语义。
          if (panelOpen) closePanel()
          setOpen(!open)
        }}
        disabled={disabled}
        className="h-8 w-fit max-w-40 justify-start gap-1 px-2 text-xs"
      >
        <span className="max-w-32 truncate text-left">
          {selectedModel?.name ?? selectorFallbackLabel}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </Button>

      {/*
        悬停面板：推理程度 / 上下文窗口 / 输出上限 / 启用 Function Calling。
        改动即时写回该供应商的配置（与「设置 → 模型设置」同一份数据）。

        关闭条件只有三条：点面板外面、点模型按钮、按 Esc。
        在面板里点过档位之后，鼠标离开不再自动收起（`pinPanel`），
        这样能连着改「上下文窗口 → 输出上限 → Function Calling」。
      */}
      {!open && panelOpen && panelStyle && selectedEntry && createPortal(
        <ModelSettingsPopover
          providerId={selectedEntry.providerId}
          modelId={selectedEntry.modelId}
          modelTitle={selectedEntry.title}
          style={panelStyle}
          onPointerEnter={cancelPanelClose}
          onPointerLeave={schedulePanelClose}
          onPointerDown={pinPanel}
          panelRef={panelRef}
        />,
        document.body,
      )}

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
            {/* ---------- 内置模型：永远完整可见，带倍率 ---------- */}
            {builtinGroups.map((group) => (
              <div key={group.id} data-model-group={group.id}>
                {/* 分组标题吸顶：滚动时压在最上面，下一组标题上来会把它顶走 */}
                <div className="sticky top-0 z-10 rounded-t-md bg-popover px-4 pb-1 pt-2 text-[0.6875rem] font-semibold text-muted-foreground">
                  {group.label}
                </div>
                {group.models.map((model) => {
                  const modelKey = `${group.id}/${model.model}`
                  const { title } = resolveModelItemLabel(model)
                  const selected = value === modelKey
                  const { ratio, rule } = resolveModelRowDecoration(model)
                  return (
                    <button
                      key={model.id}
                      type="button"
                      data-selected={selected ? "true" : undefined}
                      title={model.model}
                      onClick={() => {
                        onChange(modelKey)
                        setOpen(false)
                      }}
                      className={`flex h-9 w-full items-center gap-2.5 px-4 text-left transition-colors hover:bg-accent ${
                        selected ? "bg-accent" : ""
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-secondary text-[10px] font-bold text-primary"
                      >
                        {modelRowMark(title)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm leading-5">{title}</span>
                      {rule && (
                        <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
                          {rule}
                        </span>
                      )}
                      {ratio && (
                        <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {ratio}
                        </span>
                      )}
                      <Check
                        className={`h-3.5 w-3.5 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`}
                      />
                    </button>
                  )
                })}
              </div>
            ))}

            {/* ---------- 自定义模型：默认收起，展开后按提供方折叠 ---------- */}
            {customGroups.length > 0 && (
              <div className={builtinGroups.length > 0 ? "mt-1.5 border-t" : ""}>
                <div className="sticky top-0 z-10 flex items-center gap-2 bg-popover px-4 pb-1 pt-2">
                  <span className="text-[0.6875rem] font-semibold text-muted-foreground">
                    {t("chat.customModels")}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={customOpen}
                    aria-label={customOpen ? t("chat.collapseCustomModels") : t("chat.expandCustomModels")}
                    onClick={toggleCustomOpen}
                    className={`ml-auto relative h-5 w-[34px] shrink-0 rounded-full transition-colors ${
                      customOpen ? "bg-primary" : "bg-border"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${
                        customOpen ? "translate-x-[14px]" : ""
                      }`}
                    />
                  </button>
                </div>

                {customOpen && customGroups.map((group) => {
                  const expanded = openProviders.has(group.id)
                  const hasSelected = group.models.some((model) => value === `${group.id}/${model.model}`)
                  return (
                    <div key={group.id} data-model-group={group.id}>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => toggleProvider(group.id)}
                        className="flex h-[34px] w-full items-center gap-2 px-4 text-left transition-colors hover:bg-accent"
                      >
                        <ChevronRight
                          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                            expanded ? "rotate-90" : ""
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                          {group.label}
                        </span>
                        {hasSelected && (
                          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        )}
                      </button>

                      {expanded && group.models.map((model) => {
                        const modelKey = `${group.id}/${model.model}`
                        const { title } = resolveModelItemLabel(model)
                        const selected = value === modelKey
                        return (
                          <button
                            key={model.id}
                            type="button"
                            data-selected={selected ? "true" : undefined}
                            title={model.model}
                            onClick={() => {
                              onChange(modelKey)
                              setOpen(false)
                            }}
                            className={`flex h-[34px] w-full items-center gap-2 pl-[38px] pr-4 text-left transition-colors hover:bg-accent ${
                              selected ? "bg-accent" : ""
                            }`}
                          >
                            {/*
                              自定义模型只显示名称本身：不跟 provider/ 前缀，也不留倍率占位。
                              用户明确要求过「后面不要出现 /glm-5.3 和那条横线」。
                            */}
                            <span className="min-w-0 flex-1 truncate text-[13.5px] leading-5">{title}</span>
                            <Check
                              className={`h-3.5 w-3.5 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`}
                            />
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
