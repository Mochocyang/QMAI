export type DraftStatus = "draft" | "confirming" | "saving" | "saved" | "failed"

export interface ChapterDraft {
  id: string
  chapterName: string
  content: string
  createdAt: number
  status: DraftStatus
  sourceConversationId?: string
  sourceMessageId?: string
  errorMessage?: string
}

export const DRAFTS_DIR = ".qm-drafts"
