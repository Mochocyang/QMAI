import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react"
import { Feather, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { useWritingStyleOptions, type WritingStyleOption } from "./use-writing-style-options"

/**
 * 「文风写作」选择器（丁-2）：生成时临时选一条文风，**只影响这一次**。
 *
 * 形状照 `DeAiSkillPicker`（`de-ai-skill-picker.tsx`）—— 同一套三态签名、
 * 同一套可访问性契约（键盘 + `role="option"`）、同一套「打开完整库」跳转。
 * 见《docs/scratch-20261010-文风-skill化-实施计划.md》§2 第 4 步。
 *
 * ⚠️ 三态语义（`onChange` 的参数）**不能混用**：
 * - `string` → 本次用这条预设（`DeepChapterGenerationInput.writingStyleIdOverride`）；
 * - `null` → 「本次不用文风」，渲染成 `""`，提示词里不出现这一节；
 * - `undefined` → 「跟随项目设置」，即没有覆盖。
 *
 * ⚠️ **绝不写项目设置**：选择只进 React 状态，`enabledStyleId` 不被改
 * （用户决定 2）。本组件不 import 任何写盘的 store 函数。
 */
interface WritingStylePickerProps {
  value?: string | null
  onChange: (styleId: string | null | undefined) => void
  /** 是否给「本次不用文风」入口（`onChange(null)`）。 */
  includeDisableOption?: boolean
  /** 是否给「跟随项目设置」入口（`onChange(undefined)`），即清掉这次覆盖。 */
  includeFollowProjectOption?: boolean
  buttonLabel?: string
  iconOnly?: boolean
  showLibraryShortcut?: boolean
}

interface WritingStyleOptionsPanelProps {
  loading: boolean
  errorMessage: string
  emptyMessage: string
  styles: WritingStyleOption[]
  currentSkillId?: string | null
  defaultSkillId?: string | null
  onPick: (styleId: string) => void
  onClose?: () => void
}

function getPickerPanelStyle(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect()
  const panelWidth = 264
  const gap = 8
  const viewportWidth = window.innerWidth || panelWidth
  const left = Math.min(Math.max(rect.left, gap), Math.max(gap, viewportWidth - panelWidth - gap))
  if (rect.top > 320) {
    return {
      left,
      bottom: Math.max(gap, (window.innerHeight || rect.top) - rect.top + gap),
    }
  }
  return {
    left,
    top: rect.bottom + gap,
  }
}

/**
 * 选项面板：**独立的可访问组件**，不内联进选择器。
 *
 * 键盘契约照 `DeAiSkillOptionsPanel`（`:90-107`）：ArrowUp/ArrowDown 移动焦点、
 * Enter 选中、Escape 关闭；每项是 `role="option"` + `aria-selected`/`aria-current`。
 * 只做鼠标下拉是不够的 —— 那样键盘用户根本选不了文风。
 */
export function WritingStyleOptionsPanel({
  loading,
  errorMessage,
  emptyMessage,
  styles,
  currentSkillId,
  defaultSkillId,
  onPick,
  onClose,
}: WritingStyleOptionsPanelProps) {
  const styleIds = useMemo(() => styles.map((style) => style.id), [styles])
  const [focusedStyleId, setFocusedStyleId] = useState<string | null>(null)
  const listboxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (styles.length === 0) {
      setFocusedStyleId(null)
      return
    }
    setFocusedStyleId(currentSkillId && styleIds.includes(currentSkillId) ? currentSkillId : styles[0].id)
  }, [currentSkillId, styleIds, styles])

  useEffect(() => {
    if (!loading && !errorMessage && styles.length > 0) {
      listboxRef.current?.focus()
    }
  }, [errorMessage, loading, styles.length])

  if (loading) {
    return <div className="px-2 py-3 text-xs text-muted-foreground">正在读取文风...</div>
  }
  if (errorMessage) {
    return <div className="px-2 py-3 text-xs text-destructive">{errorMessage}</div>
  }
  if (styles.length === 0) {
    return <div className="px-2 py-3 text-xs text-muted-foreground">{emptyMessage}</div>
  }
  return (
    <div
      ref={listboxRef}
      role="listbox"
      aria-label="文风预设"
      tabIndex={0}
      className="max-h-72 overflow-y-auto outline-none"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onClose?.()
          return
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return
        event.preventDefault()
        const currentIndex = Math.max(0, styleIds.indexOf(focusedStyleId ?? ""))
        if (event.key === "Enter") {
          const pickedStyleId = focusedStyleId ?? styles[currentIndex]?.id
          if (pickedStyleId) onPick(pickedStyleId)
          return
        }
        const offset = event.key === "ArrowDown" ? 1 : -1
        const nextIndex = (currentIndex + offset + styles.length) % styles.length
        setFocusedStyleId(styles[nextIndex].id)
      }}
    >
      {styles.map((style) => (
        <button
          key={style.id}
          type="button"
          role="option"
          aria-selected={style.id === focusedStyleId}
          aria-current={style.id === currentSkillId ? "true" : undefined}
          className={`block w-full rounded px-2 py-2 text-left hover:bg-accent ${
            style.id === currentSkillId ? "bg-accent text-foreground" : ""
          } ${style.id === focusedStyleId ? "ring-1 ring-primary/40" : ""}`}
          onMouseEnter={() => setFocusedStyleId(style.id)}
          onClick={() => onPick(style.id)}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">{style.name}</span>
            {style.id === currentSkillId ? (
              <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[0.625rem] text-primary-foreground">
                当前
              </span>
            ) : null}
            {style.id === defaultSkillId ? (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">
                默认
              </span>
            ) : null}
          </div>
          {style.description ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{style.description}</div>
          ) : null}
        </button>
      ))}
    </div>
  )
}

export function WritingStylePicker({
  value,
  onChange,
  includeDisableOption = true,
  includeFollowProjectOption = true,
  buttonLabel,
  iconOnly = false,
  showLibraryShortcut = false,
}: WritingStylePickerProps) {
  const project = useWikiStore((s) => s.project)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ left: 8, top: 8 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const {
    loading,
    styles,
    effectiveName,
    currentSkillId,
    defaultSkillId,
    loadError,
  } = useWritingStyleOptions({ projectPath: project?.path, selectedSkillId: value })
  /*
   * ── 触发按钮的文案（用户要求收窄）──
   *
   * 改造前常态写着「文风写作：甲书 · 文风」四个字起步，把工具栏挤得很宽。
   * 现在常态只留一个图标，文字全部退到悬停提示里：
   *   · 没有任何文风生效 → 「文风」（两个字的入口名）
   *   · 有文风生效       → 「文风：甲书 · 文风」
   *
   * ⚠️ 悬停时为什么还要带上名称：只留图标之后，「点了哪个 / 现在生效的是哪个」
   * 在界面上就没有别的落点了（这是用户报的第二项）。浮层里的「当前」徽章
   * 只有打开时才看得到，所以悬停这一句是收起状态下的唯一出口。
   *
   * ⚠️ `buttonLabel` 仍然优先：调用方可以完全接管文案（现在的调用方都不传）。
   */
  const triggerTitle = effectiveName === "未启用" ? "文风" : `文风：${effectiveName}`
  const triggerLabel = buttonLabel ?? `文风写作：${effectiveName}`

  useEffect(() => {
    if (!open) return
    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid="writing-style-picker-trigger"
        onClick={(event) => {
          if (!open) {
            setPanelStyle(getPickerPanelStyle(event.currentTarget))
          }
          setOpen((next) => !next)
        }}
        /*
         * `iconOnly` 形态：`h-7 w-7`（28px），不是 32px。
         *
         * 用户反馈「两个图标之间相隔的距离都太大了」。间距 = 容器 gap + 两侧按钮的
         * 内边距之和；只收 gap 不够，还得把方框收到 28px（16px 图标 → 每侧 6px）。
         * 28px 与同一行里本来就是 28px 的「上下文用量」圆环、@ 按钮统一，
         * 配合左组 `gap-0.5`（见 ReferenceInput.tsx）把墨迹间距从约 25px 收到约 16px。
         *
         * ⚠️ 只有 `iconOnly` 变；带文字的形态仍是 `h-8`（要装 12px 文字，28px 会挤），
         * 它在写作区已经不使用了，但别顺手改掉。
         */
        className={iconOnly
          ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          : "flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"}
        /*
         * ⚠️ `title` 与 `aria-label` 现在是**同一句**（`triggerTitle`），
         * 不再给图标形态拼「。点击选择本次使用的文风」那半句：
         * 悬停提示要的就是「文风」/「文风：名称」这么短，
         * 拼长句等于把刚收窄的文案又放回去。
         * 「可点击」这件事由按钮本身（`<button>`）承载，不需要写进提示里。
         */
        title={triggerTitle}
        aria-label={triggerTitle}
      >
        <Feather className="h-4 w-4" />
        {iconOnly ? null : (
          <span className="max-w-[10rem] truncate">{triggerLabel}</span>
        )}
      </button>
      {open ? (
        <div
          data-testid="writing-style-picker-popover"
          className="fixed z-50 w-64 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
          style={panelStyle}
        >
          <WritingStyleOptionsPanel
            loading={loading}
            errorMessage={loadError}
            emptyMessage="文风库还是空的：对一部作品做完文风提炼后，这里就能选它。"
            styles={styles}
            currentSkillId={currentSkillId}
            defaultSkillId={defaultSkillId}
            onClose={() => setOpen(false)}
            onPick={(styleId) => {
              onChange(styleId)
              setOpen(false)
            }}
          />
          {includeFollowProjectOption ? (
            <button
              type="button"
              className="mt-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-muted-foreground hover:bg-accent"
              onClick={() => {
                onChange(undefined)
                setOpen(false)
              }}
            >
              <Feather className="h-3.5 w-3.5" />
              跟随项目设置的文风
            </button>
          ) : null}
          {includeDisableOption ? (
            <button
              type="button"
              className="mt-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-muted-foreground hover:bg-accent"
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
            >
              <X className="h-3.5 w-3.5" />
              本次不用文风
            </button>
          ) : null}
          {showLibraryShortcut ? (
            <button
              type="button"
              className="mt-1 flex w-full items-center gap-2 rounded border-t px-2 py-2 text-left text-muted-foreground hover:bg-accent"
              onClick={() => {
                setOpen(false)
                setActiveView("writingStyleLibrary")
              }}
            >
              打开完整文风库
            </button>
          ) : null}
          {/*
            预算提示（不是装饰）：`trimContextPack` 对 writingStyle 是**整段丢弃**
            （priority 19），不是逐字截断 —— 文风越长越可能整段被丢。
            结构化画像会因此**停机报错**，旧画像会**静默不生效**。
            这条可达路径必须让用户至少有机会看到，不能只留在代码注释里。
          */}
          <p
            className="mt-1 border-t px-2 pb-1 pt-2 text-[0.6875rem] leading-4 text-muted-foreground"
            title="文风文本较长时，可能因本次上下文预算不足被整段丢弃：结构化画像会停机报错，旧画像会不生效。"
          >
            只影响这一次生成，不改动项目设置。
          </p>
        </div>
      ) : null}
    </div>
  )
}
