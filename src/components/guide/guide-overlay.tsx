import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, ArrowRight, Check, MousePointerClick, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { GUIDE_STEPS, getGuideChapter } from "@/lib/guide/guide-steps"
import { useGuideStore } from "@/lib/guide/guide-store"
import type { GuideDirective, GuidePlacement, GuideStep } from "@/lib/guide/guide-types"
import "./guide.css"

/**
 * 新手引导覆盖层。
 *
 * 三个硬性要求决定了实现方式：
 *
 * 1. **靶点必须真的可点**。用户要亲手点「设置」「DeepSeek」「拉取模型」。
 *    因此遮罩不是一整块半透明层，而是**四块**围着靶点拼出来的：
 *    上 / 下 / 左 / 右各自拦截点击，中间留出的洞没有任何元素覆盖，
 *    靶点元素收到的是真实点击（而不是被引导层"模拟"的点击）。
 *
 * 2. **靶点可能在异步界面里**（设置弹窗、提供方网格、保存后才出现的按钮）。
 *    所以位置是持续测量的：每 80ms 比较一次矩形，元素出现就自动贴上，
 *    没出现就把卡片放到右下角并提示「正在等待界面」。
 *
 * 3. **不能挡住用户操作**。没有靶点的纯讲解步骤，遮罩完全不拦截点击；
 *    有靶点时只拦截靶点以外的区域 —— 用户随时能继续操作界面。
 */

const CARD_MAX_WIDTH = 380
const VIEWPORT_GAP = 14

function renderRichText(text: string, keyPrefix: string): ReactNode[] {
  // 支持三种最小语法：**加粗**、`代码`、[文字](链接)。
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/
  return text.split(pattern).filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
          {link[1]}
        </a>
      )
    }
    return <span key={key}>{part}</span>
  })
}

type TargetStatus = "none" | "missing" | "covered" | "ok"

interface TargetState {
  /** 只有 status === "ok" 才给坐标：被遮挡时不能挖洞。 */
  rect: DOMRect | null
  status: TargetStatus
}

/**
 * 靶点是否被**别的**元素盖住。
 *
 * 真机上踩过的坑：引导走到「保存这份大纲」时，靶点是消息下方那枚软盘按钮；
 * 用户点开保存确认弹窗后，软盘按钮仍留在 DOM 里、矩形也没变，但已经被弹窗
 * 盖住了。此时若照旧按它的矩形挖洞，四块遮罩就会原地重新上岗 —— 洞开在
 * 被压住的按钮上，紧挨着它的「确认保存」反而落进了遮罩区，用户怎么点都没反应。
 *
 * 判定方式：取靶点中心点，看该点上最上层（排除引导层自己）是不是靶点或其子树。
 * 环境不支持 / 拿不到结果时（jsdom 恒返回空数组）保守认为**没被遮挡**，
 * 以免测试环境与老浏览器上整片引导退化成纯讲解。
 */
function isOccludedByOtherLayer(el: HTMLElement, rect: DOMRect): boolean {
  if (typeof document.elementsFromPoint !== "function") return false
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false
  let stack: Element[]
  try {
    stack = Array.from(document.elementsFromPoint(x, y) as Element[])
  } catch {
    return false
  }
  if (!stack.length) return false
  // 遮罩与卡片都是自己人：它们压在靶点上属于正常状态（正是遮罩在挖洞）。
  const top = stack.find((node) => !node.closest(".guide-root"))
  if (!top) return false
  // 命中的是靶点本身、它的子元素，或它的祖先容器，都不算遮挡。
  return !(top === el || el.contains(top) || top.contains(el))
}

/**
 * 持续跟踪靶点矩形。
 *
 * 用 rAF + 80ms 节流而不是 ResizeObserver/MutationObserver 组合：
 * 靶点会随「展开配置卡」「滚动容器高度变化」「弹窗挂载」等各种原因移动，
 * 观察器需要挂一堆目标且容易漏；这里只管几个选择器，成本可以忽略。
 *
 * `anchors` 按优先级排列，取第一个**存在且没被盖住**的；`anchor` 视作最后一档。
 */
function useGuideTarget(anchors: string[]): TargetState {
  const [state, setState] = useState<TargetState>({ rect: null, status: "none" })
  const lastKey = useRef("")
  const anchorsRef = useRef(anchors)
  anchorsRef.current = anchors
  const signature = anchors.join("|")

  useEffect(() => {
    if (!signature) {
      lastKey.current = ""
      setState((previous) => (previous.status === "none" ? previous : { rect: null, status: "none" }))
      return
    }
    let raf = 0
    let lastTick = 0
    let stopped = false

    const measure = () => {
      if (stopped) return
      let sawElement = false
      for (const anchor of anchorsRef.current) {
        const el = document.querySelector<HTMLElement>(`[data-guide="${anchor}"]`)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        sawElement = true
        if (isOccludedByOtherLayer(el, rect)) continue
        const key = `${anchor}@${rect.left},${rect.top},${rect.width},${rect.height}`
        if (key === lastKey.current) return
        lastKey.current = key
        setState({ rect, status: "ok" })
        return
      }
      // 有元素但全被盖住 → "covered"：不挖洞，让遮罩整片穿透，用户能正常操作上层弹窗。
      const status: TargetStatus = sawElement ? "covered" : "missing"
      if (status === lastKey.current) return
      lastKey.current = status
      setState({ rect: null, status })
    }

    const tick = (time: number) => {
      if (time - lastTick >= 80) {
        lastTick = time
        measure()
      }
      raf = requestAnimationFrame(tick)
    }
    measure()
    raf = requestAnimationFrame(tick)

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
    }
  }, [signature])

  return state
}

interface CardBox {
  left: number
  top: number
  width: number
}

function computeCardBox(
  rect: DOMRect | null,
  cardHeight: number,
  placement: GuidePlacement,
): CardBox {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth
  const vh = typeof window === "undefined" ? 800 : window.innerHeight
  const width = Math.max(280, Math.min(CARD_MAX_WIDTH, vw - VIEWPORT_GAP * 2))

  if (!rect || placement === "center") {
    return {
      left: Math.max(VIEWPORT_GAP, (vw - width) / 2),
      top: Math.max(VIEWPORT_GAP, (vh - cardHeight) / 2),
      width,
    }
  }

  const clampLeft = (value: number) => Math.max(VIEWPORT_GAP, Math.min(value, vw - width - VIEWPORT_GAP))
  const clampTop = (value: number) => Math.max(VIEWPORT_GAP, Math.min(value, vh - cardHeight - VIEWPORT_GAP))

  const spaceBelow = vh - rect.bottom
  const spaceAbove = rect.top
  const spaceRight = vw - rect.right
  const spaceLeft = rect.left
  const need = cardHeight + VIEWPORT_GAP * 2

  const placeBottom = () => ({ left: clampLeft(rect.left), top: clampTop(rect.bottom + VIEWPORT_GAP) })
  const placeTop = () => ({ left: clampLeft(rect.left), top: clampTop(rect.top - cardHeight - VIEWPORT_GAP) })
  const placeRight = () => ({ left: clampLeft(rect.right + VIEWPORT_GAP), top: clampTop(rect.top) })
  const placeLeft = () => ({ left: clampLeft(rect.left - width - VIEWPORT_GAP), top: clampTop(rect.top) })

  if (placement === "bottom") return { ...placeBottom(), width }
  if (placement === "top") return { ...placeTop(), width }
  if (placement === "right") return { ...placeRight(), width }
  if (placement === "left") return { ...placeLeft(), width }

  if (spaceBelow >= need) return { ...placeBottom(), width }
  if (spaceAbove >= need) return { ...placeTop(), width }
  if (spaceRight >= width + VIEWPORT_GAP) return { ...placeRight(), width }
  if (spaceLeft >= width + VIEWPORT_GAP) return { ...placeLeft(), width }
  // 四个方向都挤：贴在空间最大的一侧，允许压住靶点一部分（内容是关键）。
  if (spaceBelow >= spaceAbove) return { ...placeBottom(), width }
  return { ...placeTop(), width }
}

export interface GuideOverlayProps {
  /** 由外壳执行界面配合动作（打开设置 / 回书架 / 开新建弹窗 / 切视图）。 */
  onDirective?: (directive: GuideDirective) => void
}

export function GuideOverlay({ onDirective }: GuideOverlayProps) {
  const status = useGuideStore((s) => s.status)
  const hydrated = useGuideStore((s) => s.hydrated)
  const stepIndex = useGuideStore((s) => s.stepIndex)
  const next = useGuideStore((s) => s.next)
  const prev = useGuideStore((s) => s.prev)
  const skipStep = useGuideStore((s) => s.skipStep)
  const skipChapter = useGuideStore((s) => s.skipChapter)
  const finish = useGuideStore((s) => s.finish)
  /** 「取消」：用户不需要这套引导 → 整段退出，且以后不再自动弹（设置里可重开）。 */
  const dismiss = useGuideStore((s) => s.dismiss)
  const confirmAnchorTap = useGuideStore((s) => s.confirmAnchorTap)

  const step = GUIDE_STEPS[stepIndex]
  const chapter = step ? getGuideChapter(step.chapter) : undefined
  const running = hydrated && status === "running" && Boolean(step)

  const anchorList = useMemo(
    () => (running && step ? [...(step.anchors ?? []), ...(step.anchor ? [step.anchor] : [])] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在步骤身份/锚点变化时重建
    [running, step?.id, step?.anchor, step?.anchors],
  )
  const { rect, status: targetStatus } = useGuideTarget(anchorList)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [cardHeight, setCardHeight] = useState(220)
  /**
   * 视口尺寸变了要重算卡片位置。
   *
   * 靶点矩形是 80ms 轮询的，但**只在矩形变化时**才 setState；把窗口拖大时
   * 靶点可能一动不动，于是卡片一直按旧视口算「贴哪一侧」，贴到屏幕外面去。
   * 遮罩那边已经改成 inset 表达（CSS 天然跟随），卡片位置只能靠这条监听重算。
   */
  const [viewportTick, setViewportTick] = useState(0)
  useEffect(() => {
    const onResize = () => setViewportTick((tick) => tick + 1)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  /**
   * 进入步骤时把界面切到位。
   *
   * `prepare` 直接写 store（设置页会读这两个字段并切到对应分类/页签）；
   * `directive` 交给外壳（只有它持有关闭设置、开弹窗、切主视图这几件事）。
   * 用 ref 存回调：父组件每次渲染都会传新函数，放进依赖会让步骤被重复执行。
   */
  const onDirectiveRef = useRef(onDirective)
  useEffect(() => { onDirectiveRef.current = onDirective }, [onDirective])

  useEffect(() => {
    if (!running || !step) return
    const prepare = step.prepare
    if (prepare?.settingsCategory) {
      useWikiStore.getState().setActiveSettingsCategory(prepare.settingsCategory)
    }
    if (prepare?.modelTab) {
      useWikiStore.getState().setActiveModelSettingsTab(prepare.modelTab)
    }
    if (step.directive) onDirectiveRef.current?.(step.directive)
    // 依赖里只放步骤身份：同一大步内的界面变化不该触发重复指令。
  }, [running, step?.id, step?.directive, step?.prepare?.settingsCategory, step?.prepare?.modelTab])

  // 靶点出现后，若在视口外就滚进来（nearest 不会把固定顶栏顶走）。
  useEffect(() => {
    if (!running || !step?.anchor) return
    const timer = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-guide="${step.anchor}"]`)
      if (!el) return
      const box = el.getBoundingClientRect()
      const outside = box.top < 0 || box.bottom > window.innerHeight || box.left < 0 || box.right > window.innerWidth
      if (outside) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [running, step?.anchor, step?.id, rect === null])

  /**
   * 点击委托：用户点到带 `data-guide` 的元素时通知 store。
   *
   * 用捕获阶段监听，**不**阻止冒泡也不 preventDefault —— 元素原本的 onClick
   * 必须照常执行（点「设置」要真的进设置）。引导只负责「记下这一步做完了」。
   */
  useEffect(() => {
    if (!running) return
    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const marker = target.closest<HTMLElement>("[data-guide]")
      const anchor = marker?.dataset.guide
      if (anchor) confirmAnchorTap(anchor)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [running, confirmAnchorTap])

  const advance = useCallback(() => {
    if (step?.requireClick) return
    next()
  }, [next, step?.requireClick])

  // 键盘：Esc 结束、← 上一步、→ / Enter 下一步（需要亲手点的那步不响应 Enter）。
  useEffect(() => {
    if (!running) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        finish()
        return
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        prev()
        return
      }
      if (event.key === "ArrowRight" || event.key === "Enter") {
        if (step?.requireClick) return
        const target = event.target
        if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
        event.preventDefault()
        next()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [running, finish, prev, next, step?.requireClick])

  useLayoutEffect(() => {
    if (!running) return
    const node = cardRef.current
    if (!node) return
    const height = node.getBoundingClientRect().height
    if (Math.abs(height - cardHeight) > 1) setCardHeight(height)
  }, [running, step?.id, cardHeight])

  const box = useMemo(
    () => computeCardBox(rect, cardHeight, step?.placement ?? "auto"),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewportTick 只是「重算」信号
    [rect, cardHeight, step?.placement, viewportTick],
  )

  if (!running || !step) return null

  const stepNumber = stepIndex + 1
  const total = GUIDE_STEPS.length
  const padding = step.padding ?? 6
  const hole = rect
    ? {
      left: Math.max(0, rect.left - padding),
      top: Math.max(0, rect.top - padding),
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    }
    : null

  const maskBlocks = hole ? (
    /*
     * 四块遮罩用 `right / bottom` 收边，而不是拿 innerWidth/innerHeight 算像素：
     * 像素值只在渲染那一刻是准的，窗口从默认尺寸拖到大屏时，下块会停在旧高度，
     * 屏幕底部留一条没有遮罩的白边（真实窗口/无头浏览器都复现过）。
     * 交给 CSS 约束后，视口怎么变都由浏览器自己补，不必等 React 重渲染。
     */
    <>
      <div className="guide-mask-block" style={{ left: 0, right: 0, top: 0, height: hole.top }} />
      <div className="guide-mask-block" style={{ left: 0, right: 0, top: hole.top + hole.height, bottom: 0 }} />
      <div className="guide-mask-block" style={{ left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height }} />
      <div className="guide-mask-block" style={{ left: hole.left + hole.width, right: 0, top: hole.top, height: hole.height }} />
    </>
  ) : (
    <div className="guide-mask-block guide-mask-pass-through" style={{ inset: 0 }} />
  )

  return createPortal(
    /*
     * ⚠️ 这里**不能**用 `role="dialog"`。
     *
     * 引导是非模态的（用户仍能点界面），语义上也不是 dialog；更实际的原因：
     * 项目里多处按 `document.querySelector('[role="dialog"]')` 取「当前弹窗」
     * （模型草稿确认框就靠它定位按钮），引导卡片一旦占了这个 role，就会把它们
     * 全部指到一个没有那些按钮的元素上。用 region 表达「一块讲解区域」即可。
     */
    <div className="guide-root" data-guide-active="true" aria-label="新手引导">
      <div className="guide-mask" aria-hidden="true">
        {maskBlocks}
        {hole && <div className="guide-hole" style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height }} />}
      </div>

      <div
        ref={cardRef}
        className={`guide-card${step.requireClick ? " is-click-step" : ""}`}
        style={{ left: box.left, top: box.top, width: box.width }}
        role="region"
        aria-label={`新手引导：${step.title}`}
      >
        <div className="guide-card-head">
          <span className="guide-chip">{chapter?.title ?? "新手引导"}</span>
          <span className="guide-count">{stepNumber} / {total}</span>
          <button type="button" className="guide-close" aria-label="结束引导" title="结束引导" onClick={finish}>
            <X aria-hidden="true" />
          </button>
        </div>

        <h2 className="guide-title">{step.title}</h2>

        <div className="guide-body">
          {step.body.map((paragraph, index) => (
            <p key={index}>{renderRichText(paragraph, `p${index}`)}</p>
          ))}
        </div>

        {step.bullets?.length ? (
          <ul className="guide-bullets">
            {step.bullets.map((bullet, index) => (
              <li key={index}>
                <span className="guide-bullet-title">{bullet.title}</span>
                <span className="guide-bullet-text">{renderRichText(bullet.text, `b${index}`)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {step.requireClick ? (
          <div className="guide-hint" role="status">
            <MousePointerClick aria-hidden="true" />
            <span>
              {targetStatus === "ok"
                ? "请点击上方高亮的位置，亲手做一次"
                : targetStatus === "covered"
                  ? "目标按钮被上层的窗口挡住了，先按上面的说明操作；窗口收起来后会自动贴上"
                  : "正在等待界面就绪…"}
            </span>
          </div>
        ) : null}

        {targetStatus === "covered" && !step.requireClick ? (
          <p className="guide-waiting" role="status">
            目标按钮此刻被上层窗口盖住，引导先让开不挡路；关掉那个窗口后会自动重新高亮。
          </p>
        ) : null}

        {targetStatus === "missing" && !step.requireClick ? (
          <p className="guide-waiting" role="status">这一步对应的界面还没出现，可以先看说明，稍后会自己贴上。</p>
        ) : null}

        <div className="guide-footer">
          <div className="guide-footer-left">
            {step.chapterBreak ? (
              <button type="button" className="guide-btn text" onClick={skipChapter}>跳过本阶段</button>
            ) : (
              <button type="button" className="guide-btn text" onClick={skipStep}>跳过这一步</button>
            )}
            {/*
             * 顶部的 X 只有图标，用户常常以为它「只是关掉这一张卡片」；
             * 「不需要这些」的人需要一个写得出来的出口。
             * 语义与 X 不同：X 记「已完成」，取消记「已关闭，以后不再自动弹」，
             * 想再看时回「设置 → 新手引导」重新开始即可。
             */}
            <button
              type="button"
              className="guide-btn text guide-btn-quit"
              aria-label="取消引导"
              title="取消后整段引导不再自动弹出；需要时可到「设置 → 新手引导」重新开始"
              onClick={dismiss}
            >
              取消
            </button>
          </div>
          <div className="guide-footer-right">
            {stepIndex > 0 ? (
              <button type="button" className="guide-btn ghost" onClick={prev}>
                <ArrowLeft aria-hidden="true" />
                上一步
              </button>
            ) : null}
            {step.requireClick ? (
              <button type="button" className="guide-btn ghost" onClick={skipStep} title="找不到这个按钮时可以用它继续">
                跳过这一步
              </button>
            ) : (
              <button type="button" className="guide-btn primary" onClick={advance}>
                {stepIndex + 1 >= total ? "完成引导" : "下一步"}
                {stepIndex + 1 >= total ? <Check aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 供外壳判断是否需要自动启动：只有「从没开始过」才自动弹。 */
export function shouldAutoStartGuide(status: string): boolean {
  return status === "new"
}

/** 解析某一步的锚点元素（供测试与外壳聚焦使用）。 */
export function findGuideAnchor(anchor: string): HTMLElement | null {
  if (typeof document === "undefined") return null
  return document.querySelector<HTMLElement>(`[data-guide="${anchor}"]`)
}

export type { GuideStep }
