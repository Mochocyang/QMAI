import { create } from "zustand"
import type { GuideChapterId, GuideSnapshot, GuideStep } from "./guide-types"
import { GUIDE_CHAPTERS, GUIDE_STEPS, getChapterStartIndex, getGuideStepIndex } from "./guide-steps"

/**
 * 新手引导的进度状态。
 *
 * 为什么不用组件内 state：
 *   · 引导要跨视图存活 —— 用户在设置页走两步、回书架走两步，组件全换过一遍，
 *     进度不能丢；
 *   · 「设置 → 新手引导 → 重新开始」要在**另一个组件**里改这份进度；
 *   · 关掉软件再打开要接着上次那一步（持久化到 localStorage）。
 *
 * 持久化只写一个键，读的时候做**宽松校验**：旧版本快照、手改坏的 JSON、
 * 步骤数变少后的越界下标，都必须能安全回落到「从头开始」而不是白屏。
 */

export const GUIDE_STORAGE_KEY = "qmai-guide-v1"

const EMPTY_SNAPSHOT: GuideSnapshot = {
  status: "new",
  stepIndex: 0,
  skippedChapters: [],
}

function clampStepIndex(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  const index = Math.trunc(value)
  if (index < 0) return 0
  if (index >= GUIDE_STEPS.length) return Math.max(0, GUIDE_STEPS.length - 1)
  return index
}

function isChapterId(value: unknown): value is GuideChapterId {
  return typeof value === "string" && GUIDE_CHAPTERS.some((chapter) => chapter.id === value)
}

/** 读取持久化快照。任何异常都退回「新装状态」，绝不抛给调用方。 */
export function readGuideSnapshot(): GuideSnapshot {
  if (typeof localStorage === "undefined") return { ...EMPTY_SNAPSHOT }
  try {
    const raw = localStorage.getItem(GUIDE_STORAGE_KEY)
    if (!raw) return { ...EMPTY_SNAPSHOT }
    const parsed = JSON.parse(raw) as Partial<GuideSnapshot> | null
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_SNAPSHOT }
    const status = parsed.status
    const normalizedStatus =
      status === "running" || status === "done" || status === "off" ? status : "new"
    const skippedChapters = Array.isArray(parsed.skippedChapters)
      ? parsed.skippedChapters.filter(isChapterId)
      : []
    return {
      status: normalizedStatus,
      stepIndex: clampStepIndex(parsed.stepIndex),
      skippedChapters,
      finishedAt: typeof parsed.finishedAt === "number" ? parsed.finishedAt : undefined,
    }
  } catch {
    return { ...EMPTY_SNAPSHOT }
  }
}

export function writeGuideSnapshot(snapshot: GuideSnapshot): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* 存储写失败不影响当前这次引导，只是下次打开不记得进度。 */
  }
}

interface GuideStoreState extends GuideSnapshot {
  /** 读取持久化后的初始化标记：外壳用它在首帧决定要不要显示引导。 */
  hydrated: boolean
  hydrate: () => void
  start: (chapterId?: GuideChapterId) => void
  /** 从某一步开始（设置页按步骤重播时使用）。 */
  startAtStep: (stepId: string) => void
  next: () => void
  prev: () => void
  /** 只跳过当前这一步，继续下一步。 */
  skipStep: () => void
  /** 跳过本阶段剩余步骤，落到下一阶段第一步。 */
  skipChapter: () => void
  /** 整段结束（完成或「不再提示」）。 */
  finish: () => void
  /**
   * 用户主动关闭引导但不标记完成：下次启动不再自动弹。
   *
   * 设置页现在只有一颗「播放」，没有开关 —— 但卡片上的「取消」仍然需要
   * 这个动作：关掉后本次不再出现，下次启动也不自动弹，想看要自己点播放。
   */
  dismiss: () => void
  /**
   * 用户点到了当前步骤要求点击的靶点。
   * 只有 `requireClick` 的步骤会因此前进；返回是否真的前进了。
   */
  confirmAnchorTap: (anchor: string) => boolean
}

function currentStep(state: Pick<GuideStoreState, "stepIndex">): GuideStep | undefined {
  return GUIDE_STEPS[state.stepIndex]
}

function commit(
  set: (partial: Partial<GuideStoreState>) => void,
  patch: Partial<GuideSnapshot>,
  base: GuideSnapshot,
): void {
  const nextSnapshot: GuideSnapshot = { ...base, ...patch }
  writeGuideSnapshot(nextSnapshot)
  set(nextSnapshot)
}

export const useGuideStore = create<GuideStoreState>((set, get) => ({
  ...EMPTY_SNAPSHOT,
  hydrated: false,

  hydrate: () => {
    const snapshot = readGuideSnapshot()
    set({ ...snapshot, hydrated: true })
  },

  start: (chapterId) => {
    const stepIndex = chapterId ? Math.max(0, getChapterStartIndex(chapterId)) : 0
    commit(set, {
      status: "running",
      stepIndex,
      skippedChapters: get().skippedChapters.filter((id) => id !== chapterId),
      finishedAt: undefined,
    }, get())
  },

  startAtStep: (stepId) => {
    const index = getGuideStepIndex(stepId)
    if (index < 0) return
    const step = GUIDE_STEPS[index]
    commit(set, {
      status: "running",
      stepIndex: index,
      skippedChapters: get().skippedChapters.filter((id) => id !== step.chapter),
      finishedAt: undefined,
    }, get())
  },

  next: () => {
    const state = get()
    const nextIndex = state.stepIndex + 1
    if (nextIndex >= GUIDE_STEPS.length) {
      commit(set, { status: "done", stepIndex: GUIDE_STEPS.length - 1, finishedAt: Date.now() }, state)
      return
    }
    commit(set, { status: "running", stepIndex: nextIndex }, state)
  },

  prev: () => {
    const state = get()
    if (state.stepIndex <= 0) return
    commit(set, { status: "running", stepIndex: state.stepIndex - 1, finishedAt: undefined }, state)
  },

  skipStep: () => {
    get().next()
  },

  skipChapter: () => {
    const state = get()
    const step = currentStep(state)
    if (!step) return
    const chapterOrder = GUIDE_CHAPTERS.map((chapter) => chapter.id)
    const position = chapterOrder.indexOf(step.chapter)
    const nextChapterId = chapterOrder[position + 1]
    const skipped = state.skippedChapters.includes(step.chapter)
      ? state.skippedChapters
      : [...state.skippedChapters, step.chapter]
    if (!nextChapterId) {
      commit(set, {
        status: "done",
        stepIndex: GUIDE_STEPS.length - 1,
        skippedChapters: skipped,
        finishedAt: Date.now(),
      }, state)
      return
    }
    commit(set, {
      status: "running",
      stepIndex: Math.max(0, getChapterStartIndex(nextChapterId)),
      skippedChapters: skipped,
    }, state)
  },

  finish: () => {
    commit(set, { status: "done", stepIndex: GUIDE_STEPS.length - 1, finishedAt: Date.now() }, get())
  },

  dismiss: () => {
    commit(set, { status: "off" }, get())
  },

  confirmAnchorTap: (anchor) => {
    const state = get()
    const step = currentStep(state)
    if (!step || state.status !== "running") return false
    if (step.requireClick) {
      // 候选锚点里任意一个被点到都算完成（例如「保存为大纲」与弹窗里的「确认保存」）。
      const candidates = [...(step.anchors ?? []), ...(step.anchor ? [step.anchor] : [])]
      if (!candidates.includes(anchor)) return false
    } else if (!step.advanceOn?.includes(anchor)) {
      // 普通讲解步只在点到显式声明的「完成信号」时前进，点别的按钮不打扰。
      return false
    }
    get().next()
    return true
  },
}))

/** 当前是否正在展示某一步（外壳与覆盖层共用这一判定）。 */
export function isGuideVisible(state: Pick<GuideStoreState, "status" | "hydrated">): boolean {
  return state.hydrated && state.status === "running"
}
