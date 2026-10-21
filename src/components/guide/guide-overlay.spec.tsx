// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GuideOverlay } from "./guide-overlay"
import { GUIDE_STEPS } from "@/lib/guide/guide-steps"
import { useGuideStore, GUIDE_STORAGE_KEY } from "@/lib/guide/guide-store"

/**
 * 覆盖层的行为。
 *
 * 这里只测「用户能否走完一步」这条主干，不测样式：
 *   · 卡片是否会渲染当前步骤；
 *   · 点「下一步」是否推进；
 *   · 需要亲手点的步骤，点靶点是否推进、点别处是否**不**推进；
 *   · 「结束引导」是否真的收起来。
 *
 * 高亮挖洞的视觉效果（四块遮罩、矩形跟随）无法在 jsdom 里断言 ——
 * jsdom 的 getBoundingClientRect 恒为 0，那部分靠真机验收。
 */

let host: HTMLDivElement
let root: Root

function mount(onDirective?: (directive: string) => void) {
  act(() => {
    root.render(<GuideOverlay onDirective={onDirective as never} />)
  })
}

function setStep(stepIndex: number, status: "running" | "done" | "new" = "running") {
  useGuideStore.setState({ status, stepIndex, skippedChapters: [], hydrated: true, finishedAt: undefined })
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  useGuideStore.setState({ status: "new", stepIndex: 0, skippedChapters: [], hydrated: false })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ""
  useGuideStore.setState({ status: "new", stepIndex: 0, skippedChapters: [], hydrated: false })
})

describe("新手引导覆盖层", () => {
  it("未运行时什么都不渲染", () => {
    setStep(0, "new")
    mount()
    expect(document.querySelector(".guide-card")).toBeNull()
  })

  it("渲染当前步骤的标题与正文", () => {
    setStep(0)
    mount()
    const card = document.querySelector(".guide-card")
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain(GUIDE_STEPS[0].title)
    expect(card!.textContent).toContain(`1 / ${GUIDE_STEPS.length}`)
  })

  it("不用点靶点的步骤，点「下一步」会推进", () => {
    const passiveIndex = GUIDE_STEPS.findIndex((step) => !step.requireClick && Boolean(step.anchor))
    setStep(passiveIndex)
    mount()
    const next = [...document.querySelectorAll<HTMLButtonElement>(".guide-card button")]
      .find((item) => item.textContent?.includes("下一步"))
    expect(next).toBeTruthy()
    act(() => next!.click())
    expect(useGuideStore.getState().stepIndex).toBe(passiveIndex + 1)
  })

  it("需要亲手点的步骤：点靶点推进，点别处不推进", () => {
    const clickIndex = GUIDE_STEPS.findIndex((step) => step.requireClick)
    const anchor = GUIDE_STEPS[clickIndex].anchor!
    setStep(clickIndex)

    const target = document.createElement("button")
    target.dataset.guide = anchor
    document.body.append(target)
    const other = document.createElement("button")
    document.body.append(other)

    mount()

    act(() => other.click())
    expect(useGuideStore.getState().stepIndex).toBe(clickIndex)

    act(() => target.click())
    expect(useGuideStore.getState().stepIndex).toBe(clickIndex + 1)
  })

  it("这一步不显示「下一步」，而是提示去点高亮位置", () => {
    const clickIndex = GUIDE_STEPS.findIndex((step) => step.requireClick)
    setStep(clickIndex)
    mount()
    const card = document.querySelector(".guide-card")!
    // jsdom 里没有真实布局，靶点矩形恒为 0，卡片会走「等待界面就绪」分支；
    // 这里只断言**没有**「下一步」——那才是这一步的关键行为。
    expect(card.textContent).not.toContain("下一步")
    expect(card.querySelector(".guide-hint")).not.toBeNull()
  })

  it("点右上角关闭会结束引导并收起卡片", () => {
    setStep(0)
    mount()
    const close = document.querySelector<HTMLButtonElement>(".guide-close")!
    act(() => close.click())
    expect(useGuideStore.getState().status).toBe("done")
    expect(document.querySelector(".guide-card")).toBeNull()
  })

  /**
   * 用户诉求：「有些用户不需要这些」。
   * 顶部的 X 只有图标，看不出是整段退出；卡片里必须有一个写得出来的「取消」，
   * 而且它要与「跳过这一步」区分开 —— 跳过只前进一格，取消是整段不再自动弹。
   */
  it.each([
    { label: "纯讲解步骤", index: GUIDE_STEPS.findIndex((step) => !step.requireClick && Boolean(step.anchor)) },
    { label: "需要亲手点的步骤", index: GUIDE_STEPS.findIndex((step) => step.requireClick) },
  ])("$label 都提供「取消」，点了整段退出且不记为已完成", ({ index }) => {
    expect(index).toBeGreaterThanOrEqual(0)
    setStep(index)
    mount()
    const cancel = [...document.querySelectorAll<HTMLButtonElement>(".guide-card button")]
      .find((item) => item.getAttribute("aria-label") === "取消引导")
    expect(cancel, "卡片里应有「取消」按钮").toBeTruthy()
    expect(cancel!.textContent?.trim()).toBe("取消")
    act(() => cancel!.click())
    const state = useGuideStore.getState()
    expect(state.status).toBe("off")
    expect(state.finishedAt).toBeUndefined()
    expect(document.querySelector(".guide-card")).toBeNull()
    // 持久化也要落成 off：下次启动不再自动弹。
    expect(JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY)!).status).toBe("off")
  })

  it("点「跳过这一步」只前进一格", () => {
    const clickIndex = GUIDE_STEPS.findIndex((step) => step.requireClick)
    setStep(clickIndex)
    mount()
    const skip = [...document.querySelectorAll<HTMLButtonElement>(".guide-card button")]
      .find((item) => item.textContent?.includes("跳过这一步"))
    expect(skip).toBeTruthy()
    act(() => skip!.click())
    expect(useGuideStore.getState().stepIndex).toBe(clickIndex + 1)
  })

  it("阶段第一步提供「跳过本阶段」，跳到下一阶段首步", () => {
    setStep(0)
    mount()
    const skipChapter = [...document.querySelectorAll<HTMLButtonElement>(".guide-card button")]
      .find((item) => item.textContent?.includes("跳过本阶段"))
    expect(skipChapter).toBeTruthy()
    act(() => skipChapter!.click())
    expect(GUIDE_STEPS[useGuideStore.getState().stepIndex].chapter).toBe("models")
  })

  it("进入带 directive 的步骤时会请求外壳配合", () => {
    const directiveIndex = GUIDE_STEPS.findIndex((step) => Boolean(step.directive))
    const directive = GUIDE_STEPS[directiveIndex].directive
    const onDirective = vi.fn()
    setStep(directiveIndex)
    mount(onDirective)
    expect(onDirective).toHaveBeenCalledWith(directive)
  })

  it("按 Esc 结束引导", () => {
    setStep(0)
    mount()
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(useGuideStore.getState().status).toBe("done")
  })

  /**
   * 真机事故回归：靶点被上层弹窗盖住时仍然挖洞，四块遮罩会正好压住弹窗
   * 自己的按钮（「保存大纲」那一步的「确认保存」点不动）。
   * 规则：**被挡住就不挖洞**，遮罩退化成整片穿透，把界面交还给用户。
   */
  describe("靶点被遮挡时", () => {
    function stubRect(el: HTMLElement) {
      el.getBoundingClientRect = () => ({
        left: 100, top: 100, width: 40, height: 40,
        right: 140, bottom: 140, x: 100, y: 100,
        toJSON: () => ({}),
      }) as DOMRect
    }

    function stubStack(nodes: Element[]) {
      const restore = Object.getOwnPropertyDescriptor(document, "elementsFromPoint")
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        writable: true,
        value: () => nodes,
      })
      return () => {
        if (restore) Object.defineProperty(document, "elementsFromPoint", restore)
        else Reflect.deleteProperty(document, "elementsFromPoint")
      }
    }

    async function settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120))
      })
    }

    it("不挖洞，整片遮罩都让点击穿透", async () => {
      const index = GUIDE_STEPS.findIndex((step) => step.id === "outline-save")
      setStep(index)
      const target = document.createElement("button")
      target.dataset.guide = "outline.save"
      document.body.append(target)
      stubRect(target)
      const cover = document.createElement("div")
      document.body.append(cover)
      const restore = stubStack([cover])
      try {
        mount()
        await settle()
        expect(document.querySelector(".guide-hole")).toBeNull()
        const blocks = [...document.querySelectorAll(".guide-mask-block")]
        expect(blocks).toHaveLength(1)
        expect(blocks[0].classList.contains("guide-mask-pass-through")).toBe(true)
        expect(document.querySelector(".guide-waiting")?.textContent).toContain("被上层窗口盖住")
      } finally {
        restore()
      }
    })

    it("没被遮挡时正常挖洞", async () => {
      const index = GUIDE_STEPS.findIndex((step) => step.id === "outline-save")
      setStep(index)
      const target = document.createElement("button")
      target.dataset.guide = "outline.save"
      document.body.append(target)
      stubRect(target)
      const restore = stubStack([target])
      try {
        mount()
        await settle()
        expect(document.querySelector(".guide-hole")).not.toBeNull()
      } finally {
        restore()
      }
    })
  })
})
