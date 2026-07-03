export type IndexStatus = "valid" | "maybe_outdated" | "conflict"

export interface RetrievalEntry {
  chapterNumber: number
  chapterTitle: string
  filePath: string
  volumeName: string
  summary: string
  characterStates: string
  foreshadowingChanges: string
  timelineEvents: string
  sourceHash: string
  indexStatus: IndexStatus
  manualNotes: string
  manualReminders: string
}

export interface VolumeIndex {
  name: string
  fileName: string
  chapterStart: number
  chapterEnd: number
}

export interface InvertedIndex {
  foreshadowing: Record<string, number[]>
  characters: Record<string, number[]>
  timeline: Record<string, number[]>
}

export interface RetrievalIndex {
  volumes: VolumeIndex[]
  invertedIndex: InvertedIndex
  entries: RetrievalEntry[]
}

export const AUTO_START_MARKER = "<!-- qmai:auto:start -->"
export const AUTO_END_MARKER = "<!-- qmai:auto:end -->"
export const MANUAL_START_MARKER = "<!-- qmai:manual:start -->"
export const MANUAL_END_MARKER = "<!-- qmai:manual:end -->"

export const DEFAULT_CHAPTERS_PER_VOLUME = 50
