/**
 * 追踪层统一类型定义
 * 用于 wiki/tracking/ 目录下的动态追踪数据结构
 */

/** 角色状态变更记录 */
export interface StateChangeRecord {
  chapter: number
  change: string
  timestamp: string
}

/** 关键关系条目 */
export interface KeyRelationship {
  target: string
  status: string
  changedChapter?: number
}

/** 升级后的角色状态 */
export interface EnhancedCharacterState {
  name: string
  currentIdentity: string
  currentAbilities: string[]
  keyRelationships: KeyRelationship[]
  publicImage: string
  pendingForeshadowing: string[]
  stateChangeHistory: StateChangeRecord[]
}

/** 伏笔重要度 */
export type ForeshadowingImportance = "high" | "medium" | "low"

/** 伏笔状态 */
export type ForeshadowingStatus = "planted" | "advanced" | "resolved" | "abandoned"

/** 升级后的伏笔 */
export interface EnhancedForeshadowing {
  id: string
  description: string
  plantedChapter: number
  expectedResolveChapter?: number
  status: ForeshadowingStatus
  advancedChapters: number[]
  resolvedChapter?: number
  importance: ForeshadowingImportance
  relatedCharacters: string[]
  notes: string
}

/** 已回收伏笔记录 */
export interface ResolvedForeshadowingRecord {
  id: string
  resolvedInChapter: number
  resolution: string
}

/** 写作进度（上下文.md） */
export interface WritingProgress {
  lastCompletedChapter: number
  lastCompletedChapterTitle: string
  lastUpdated: string
  currentArc: string
  activeForeshadowingCount: number
  keyPendingForeshadowing: string[]
  relationshipStatus: string
  nextChapterGuidance: string
  notes: string[]
}

/** 本节速记 */
export interface SectionBriefing {
  chapterNumber: number
  characterStates: Array<{ name: string; brief: string }>
  relevantForeshadowing: Array<{
    id: string
    status: "plant" | "advance" | "resolve"
    detail: string
  }>
  worldConstraints: string[]
}