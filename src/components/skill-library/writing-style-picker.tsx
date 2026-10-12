import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Feather, Library } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { useWritingStyleOptions } from "./use-writing-style-options"

/**
 * 「文风写作」选择器（丁-2）。
 *
 * ## 下拉只剩两项（本次改造）
 *
 *   (a)「当前文风」—— **只读**，直接把现在生效的那条名字摆出来；
 *   (b)「打开文风库」—— 唯一的动作入口，跳 `/writingStyleLibrary`（与改造前一致）。
 *
 * 改造前这里是「文风列表（逐条带「当前」「默认」徽章）+ 跟随项目设置的文风 +
 * 本次不用文风 + 打开完整文风库 + 一句上下文预算提示」五块。用户报的是
 * 「打开后一堆选项，既不知道点哪个、也看不出现在用的是哪条」，于是收成两块。
 *
 * ⚠️ **两个覆盖入口（`onChange(null)` / `onChange(undefined)`）已按要求移除**，
 * 因此本组件现在**不调用** `onChange`。props 留着是故意的，理由见下面
 * `WritingStylePickerProps.onChange` 的注释 —— 别把它当成漏删的死代码。
 *
 * ⚠️ (a) 是**纯展示**，不要给它加 `role="option"` / `onClick` / `aria-selected`。
 * 它不在键盘选单里，也不该看起来能点；「换文风」这件事只有 (b) 一条路。
 * （原先那套 listbox + ArrowUp/ArrowDown 的键盘契约随列表一起删掉了，
 * 别照着旧版 spec 再把 `role="listbox"` 加回来。）
 */
interface WritingStylePickerProps {
  /**
   * 本次生成选中的文风（三态，语义见 `use-writing-style-options` 与
   * `writing-style-store.ts` 的 `styleIdOverride`）：
   * - `undefined` = 没有覆盖，显示项目启用项；
   * - `null` = 显式「本次不用文风」；
   * - `string` = 指定预设 id。
   *
   * 新 UI 不再产生后两种，但外部（chat-panel）仍按三态传，显示逻辑照旧。
   */
  value?: string | null
  /**
   * ⚠️ **当前 UI 已无触发点**：下拉收成「当前文风 + 打开文风库」两项之后，
   * 本组件不会调用它。
   *
   * 保留（且标成可选）是**故意**的：chat-panel 那条三态管道
   * （`sessionWritingStyleId` → `getWritingStyleIdOverride` → `run_chapter_workflow`
   * → `DeepChapterGenerationInput.writingStyleIdOverride`）用的是同一个接口形状，
   * 删掉它会连带改一大片代码，而**行为一个字节都不会变**。
   * 将来要恢复「本次用某条 / 本次不用」入口，从这里接回去即可。
   */
  onChange?: (styleId: string | null | undefined) => void
  buttonLabel?: string
  iconOnly?: boolean
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

export function WritingStylePicker({
  value,
  buttonLabel,
  iconOnly = false,
}: WritingStylePickerProps) {
  const project = useWikiStore((s) => s.project)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ left: 8, top: 8 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const openLibraryRef = useRef<HTMLButtonElement | null>(null)
  const { loading, effectiveName } = useWritingStyleOptions({
    projectPath: project?.path,
    selectedSkillId: value,
  })
  /*
   * ── 触发按钮的文案 ──
   *
   * 常态只留一个图标，文字全部退到悬停提示里：
   *   · 没有任何文风生效 → 「文风」（两个字的入口名）
   *   · 有文风生效       → 「文风：甲书 · 文风」
   *
   * ⚠️ 悬停时为什么还要带上名称：只留图标之后，「现在生效的是哪个」
   * 在收起状态下就没有别的落点了。浮层里 (a) 那一行只有打开才看得到，
   * 所以悬停这一句是收起状态下的唯一出口。
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

  /*
   * 打开即把焦点放到「打开文风库」上。
   *
   * 这不是装饰：改造前浮层里是个 `role="listbox"`（`tabIndex=0` + 箭头键选单），
   * 焦点本来就会落进去；收成两项之后如果什么都不做，键盘用户打开浮层后
   * 焦点还留在触发器上，得再按一次 Tab 才够得着唯一的动作 —— 那就白退化了一步。
   * （(a) 是只读读数，不该抢焦点，所以只聚焦这一个按钮。）
   */
  useEffect(() => {
    if (open) openLibraryRef.current?.focus()
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
          {/*
           * ── (a) 当前文风：只读 ──
           *
           * 不给它 hover 底色、不给 onClick：它是个状态读数，不是选项。
           * 名字用 `truncate` + `title` —— 文风名（形如「我的文风 · 自动进化 · 第 3 轮」）
           * 可以很长，截断后靠悬停看全名。
           */}
          <div
            data-testid="writing-style-picker-current"
            className="flex items-center gap-2 px-2 py-2"
          >
            <Feather className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span
              className="min-w-0 flex-1 truncate text-foreground"
              title={loading ? undefined : effectiveName}
            >
              {loading ? "正在读取文风..." : effectiveName}
            </span>
          </div>
          {/*
           * ── (b) 打开文风库：唯一的动作入口 ──
           *
           * 上边框把它与上面那行读数分开（读数不可点、动作可点，视觉上要能区分）。
           * 跳转目标与改造前的「打开完整文风库」完全相同，操作方式不变。
           */}
          <button
            type="button"
            ref={openLibraryRef}
            data-testid="writing-style-picker-open-library"
            className="mt-1 flex w-full items-center gap-2 rounded border-t px-2 py-2 text-left text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => {
              setOpen(false)
              setActiveView("writingStyleLibrary")
            }}
          >
            <Library className="h-3.5 w-3.5" />
            打开文风库
          </button>
        </div>
      ) : null}
    </div>
  )
}
