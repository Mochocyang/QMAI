import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GUIDE_STEPS, getChapterStartIndex } from "./guide-steps"
import {
  GUIDE_STORAGE_KEY,
  readGuideSnapshot,
  useGuideStore,
  writeGuideSnapshot,
} from "./guide-store"

/**
 * 引导进度的推进与持久化。
 *
 * 重点不是「点击一次 index 加一」，而是几种**用户真会遇到**的边界：
 *   · 最后一步点「下一步」要落成 done，而不是越界后白屏；
 *   · 跳过本阶段要落到下一阶段的**第一步**，不是跳到末尾；
 *   · 点错靶点不能推进（否则用户点空白处就把关键动作跳过了）；
 *   · 持久化的 JSON 被改坏、或步骤数变少导致下标越界时，要能安全回退。
 */

const memoryStore = new Map<string, string>()

function stubLocalStorage() {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStore.set(key, String(value)) },
    removeItem: (key: string) => { memoryStore.delete(key) },
    clear: () => memoryStore.clear(),
  })
}

function resetStore() {
  useGuideStore.setState({
    status: "new",
    stepIndex: 0,
    skippedChapters: [],
    finishedAt: undefined,
    hydrated: false,
  })
}

beforeEach(() => {
  memoryStore.clear()
  stubLocalStorage()
  resetStore()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("引导进度", () => {
  it("初始状态是「从未开始」，且只有它才会自动弹出", () => {
    expect(useGuideStore.getState().status).toBe("new")
    expect(useGuideStore.getState().stepIndex).toBe(0)
  })

  it("start() 从第一步开始", () => {
    useGuideStore.getState().start()
    expect(useGuideStore.getState().status).toBe("running")
    expect(useGuideStore.getState().stepIndex).toBe(0)
  })

  it("start(chapter) 从指定阶段的第一步开始", () => {
    useGuideStore.getState().start("outline")
    expect(useGuideStore.getState().stepIndex).toBe(getChapterStartIndex("outline"))
    expect(GUIDE_STEPS[useGuideStore.getState().stepIndex].chapter).toBe("outline")
  })

  it("最后一步点下一步会落成 done，不会越界", () => {
    useGuideStore.setState({ status: "running", stepIndex: GUIDE_STEPS.length - 1 })
    useGuideStore.getState().next()
    const state = useGuideStore.getState()
    expect(state.status).toBe("done")
    expect(state.stepIndex).toBe(GUIDE_STEPS.length - 1)
    expect(state.finishedAt).toBeTypeOf("number")
  })

  it("prev() 不会退到负数", () => {
    useGuideStore.getState().start()
    useGuideStore.getState().prev()
    expect(useGuideStore.getState().stepIndex).toBe(0)
  })

  it("skipChapter() 跳到下一阶段第一步并记下跳过", () => {
    useGuideStore.getState().start()
    useGuideStore.getState().skipChapter()
    const state = useGuideStore.getState()
    expect(GUIDE_STEPS[state.stepIndex].chapter).toBe("models")
    expect(state.skippedChapters).toContain("start")
  })

  it("最后一个阶段跳过会直接完成", () => {
    const lastChapter = GUIDE_STEPS[GUIDE_STEPS.length - 1].chapter
    useGuideStore.setState({
      status: "running",
      stepIndex: getChapterStartIndex(lastChapter),
      skippedChapters: [],
    })
    useGuideStore.getState().skipChapter()
    expect(useGuideStore.getState().status).toBe("done")
    expect(useGuideStore.getState().skippedChapters).toContain(lastChapter)
  })

  it("只有「需要亲手点」的步骤、且锚点匹配时才推进", () => {
    const clickStepIndex = GUIDE_STEPS.findIndex((step) => step.requireClick)
    useGuideStore.setState({ status: "running", stepIndex: clickStepIndex })
    const anchor = GUIDE_STEPS[clickStepIndex].anchor

    expect(useGuideStore.getState().confirmAnchorTap("别的锚点")).toBe(false)
    expect(useGuideStore.getState().stepIndex).toBe(clickStepIndex)

    expect(useGuideStore.getState().confirmAnchorTap(anchor!)).toBe(true)
    expect(useGuideStore.getState().stepIndex).toBe(clickStepIndex + 1)
  })

  it("不需要点击的步骤点了锚点也不推进", () => {
    const passiveIndex = GUIDE_STEPS.findIndex((step) => !step.requireClick && Boolean(step.anchor))
    const step = GUIDE_STEPS[passiveIndex]
    useGuideStore.setState({ status: "running", stepIndex: passiveIndex })
    expect(useGuideStore.getState().confirmAnchorTap(step.anchor!)).toBe(false)
    expect(useGuideStore.getState().stepIndex).toBe(passiveIndex)
  })

  it("声明了 advanceOn 的讲解步，只有点到那个锚点才推进", () => {
    const index = GUIDE_STEPS.findIndex((step) => step.advanceOn?.length)
    expect(index, "没有任何步骤声明 advanceOn").toBeGreaterThanOrEqual(0)
    const step = GUIDE_STEPS[index]
    useGuideStore.setState({ status: "running", stepIndex: index })
    // 前一个动作（软盘「保存为大纲」）只是打开弹窗，还没落盘，不该前进
    expect(useGuideStore.getState().confirmAnchorTap(step.anchors!.at(-1)!)).toBe(false)
    expect(useGuideStore.getState().stepIndex).toBe(index)
    // 确认按钮才是真正写盘
    expect(useGuideStore.getState().confirmAnchorTap(step.advanceOn![0])).toBe(true)
    expect(useGuideStore.getState().stepIndex).toBe(index + 1)
  })

  it("未在运行中时点击锚点不推进", () => {
    const clickStepIndex = GUIDE_STEPS.findIndex((step) => step.requireClick)
    useGuideStore.setState({ status: "done", stepIndex: clickStepIndex })
    expect(useGuideStore.getState().confirmAnchorTap(GUIDE_STEPS[clickStepIndex].anchor!)).toBe(false)
  })

  it("finish() 标记完成并记录时间", () => {
    useGuideStore.getState().start()
    useGuideStore.getState().finish()
    const state = useGuideStore.getState()
    expect(state.status).toBe("done")
    expect(state.finishedAt).toBeTypeOf("number")
  })

  it("dismiss() 之后不再自动弹（卡片「取消」走这条）", () => {
    useGuideStore.getState().start()
    useGuideStore.getState().dismiss()
    expect(useGuideStore.getState().status).toBe("off")
  })

  it("每次推进都写盘，hydrate 能读回来", () => {
    useGuideStore.getState().start("outline")
    useGuideStore.getState().next()
    const expected = useGuideStore.getState().stepIndex

    resetStore()
    useGuideStore.getState().hydrate()
    const state = useGuideStore.getState()
    expect(state.hydrated).toBe(true)
    expect(state.status).toBe("running")
    expect(state.stepIndex).toBe(expected)
  })
})

describe("持久化的容错", () => {
  it("没有存储时读出「从未开始」", () => {
    expect(readGuideSnapshot().status).toBe("new")
  })

  it("坏 JSON 不抛错，回退到初始状态", () => {
    memoryStore.set(GUIDE_STORAGE_KEY, "{不是 json")
    expect(() => readGuideSnapshot()).not.toThrow()
    expect(readGuideSnapshot().status).toBe("new")
  })

  it("未知状态值归一为 new", () => {
    writeGuideSnapshot({ status: "weird" as never, stepIndex: 3, skippedChapters: [] })
    expect(readGuideSnapshot().status).toBe("new")
  })

  it("越界的步骤下标被夹回末尾", () => {
    writeGuideSnapshot({ status: "running", stepIndex: 99999, skippedChapters: [] })
    expect(readGuideSnapshot().stepIndex).toBe(GUIDE_STEPS.length - 1)
  })

  it("负下标夹回 0", () => {
    writeGuideSnapshot({ status: "running", stepIndex: -8, skippedChapters: [] })
    expect(readGuideSnapshot().stepIndex).toBe(0)
  })

  it("丢弃不认识的阶段 id，保留认识的", () => {
    writeGuideSnapshot({
      status: "running",
      stepIndex: 0,
      skippedChapters: ["outline", "不存在的阶段" as never],
    })
    expect(readGuideSnapshot().skippedChapters).toEqual(["outline"])
  })
})
