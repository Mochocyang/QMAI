import { create } from "zustand"
import type { DraftReviewResult } from "@/lib/agent/skills/draft-review-skill"

export interface DraftReviewPhase {
  /** 当前阶段 */
  stage: "idle" | "loading" | "reviewing" | "repairing" | "done" | "error"
  /** 阶段描述（用于 UI 进度显示） */
  description: string
  /** 进度百分比（0-100） */
  progress: number
}

export interface DraftReviewHistoryEntry {
  timestamp: number
  result: DraftReviewResult
  originalDraft: string
  accepted: boolean | null
}

interface DraftReviewState {
  /** 校验是否激活（是否有未完成的校验流程） */
  active: boolean
  /** 当前阶段与进度 */
  phase: DraftReviewPhase
  /** 当前校验轮次（0=首次, 1..2=增量重校） */
  currentRound: number
  /** 校验结果 */
  result: DraftReviewResult | null
  /** 原始草稿（用于接受/拒绝按钮） */
  originalDraft: string
  /** 已接受的修订稿（用户点击"接受"后写回） */
  acceptedRevisedDraft: string | null
  /** 对话 Tab 是否被锁定（校验进行中） */
  dialogTabLocked: boolean
  /** 校验历史（多轮重校可回看） */
  history: DraftReviewHistoryEntry[]
  /** 用户是否已决策（接受/拒绝/重校） */
  decisionMade: boolean

  // Actions
  /** 开始校验 */
  startReview: (originalDraft: string) => void
  /** 更新校验阶段与进度 */
  setPhase: (phase: Partial<DraftReviewPhase>) => void
  /** 设置校验结果（一轮完成） */
  setResult: (result: DraftReviewResult) => void
  /** 进入下一轮重校 */
  nextRound: () => void
  /** 接受修订 */
  acceptRevision: () => void
  /** 拒绝修订（保留原稿） */
  rejectRevision: () => void
  /** 重置校验状态 */
  reset: () => void
  /** 记录历史 */
  pushHistory: () => void
}

export const useDraftReviewStore = create<DraftReviewState>((set, get) => ({
  active: false,
  phase: { stage: "idle", description: "", progress: 0 },
  currentRound: 0,
  result: null,
  originalDraft: "",
  acceptedRevisedDraft: null,
  dialogTabLocked: false,
  history: [],
  decisionMade: false,

  startReview: (originalDraft) =>
    set({
      active: true,
      phase: { stage: "loading", description: "正在加载记忆中心数据...", progress: 5 },
      currentRound: 0,
      result: null,
      originalDraft,
      acceptedRevisedDraft: null,
      dialogTabLocked: true,
      history: [],
      decisionMade: false,
    }),

  setPhase: (partial) =>
    set((state) => ({
      phase: { ...state.phase, ...partial },
    })),

  setResult: (result) =>
    set({
      result,
      phase: {
        stage: result.deviations.length === 0 ? "done" : "repairing",
        description:
          result.deviations.length === 0
            ? "校验完成，无偏差。"
            : `发现 ${result.deviations.length} 项偏差，正在自动修复...`,
        progress: result.deviations.length === 0 ? 100 : 70,
      },
      dialogTabLocked: result.deviations.length > 0,
    }),

  nextRound: () =>
    set((state) => ({
      currentRound: state.currentRound + 1,
      phase: {
        stage: "reviewing",
        description: `第 ${state.currentRound + 1} 轮重校中...`,
        progress: 40 + state.currentRound * 15,
      },
    })),

  acceptRevision: () => {
    const { result } = get()
    if (!result) return
    set({
      acceptedRevisedDraft: result.revisedDraft,
      decisionMade: true,
      dialogTabLocked: false,
      phase: { stage: "done", description: "已接受修订。", progress: 100 },
    })
    get().pushHistory()
  },

  rejectRevision: () =>
    set({
      decisionMade: true,
      dialogTabLocked: false,
      acceptedRevisedDraft: null,
      phase: { stage: "done", description: "已拒绝修订，保留原稿。", progress: 100 },
    }),

  reset: () =>
    set({
      active: false,
      phase: { stage: "idle", description: "", progress: 0 },
      currentRound: 0,
      result: null,
      originalDraft: "",
      acceptedRevisedDraft: null,
      dialogTabLocked: false,
      history: [],
      decisionMade: false,
    }),

  pushHistory: () => {
    const { result, originalDraft } = get()
    if (!result) return
    set((state) => ({
      history: [
        ...state.history,
        {
          timestamp: Date.now(),
          result: { ...result },
          originalDraft,
          accepted: state.acceptedRevisedDraft !== null,
        },
      ],
    }))
  },
}))
