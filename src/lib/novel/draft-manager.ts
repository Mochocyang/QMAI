import { writeFile, fileExists, createDirectory } from "@/commands/fs"
import type { ChapterDraft } from "./lifecycle-types"
import { DRAFTS_DIR } from "./lifecycle-types"
import { normalizePath } from "@/lib/path-utils"

function generateDraftId(): string {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function draftsDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/${DRAFTS_DIR}`
}

async function ensureDraftsDir(projectPath: string): Promise<void> {
  const dir = draftsDir(projectPath)
  if (!await fileExists(dir)) {
    await createDirectory(dir)
  }
}

function buildDraftContent(draft: ChapterDraft): string {
  const metaLines: string[] = [
    `draft_id: ${draft.id}`,
    `chapter_name: ${draft.chapterName}`,
    `status: ${draft.status}`,
    `created_at: ${draft.createdAt}`,
  ]
  if (draft.sourceConversationId) metaLines.push(`source_conversation_id: ${draft.sourceConversationId}`)
  if (draft.sourceMessageId) metaLines.push(`source_message_id: ${draft.sourceMessageId}`)
  return `---\n${metaLines.join("\n")}\n---\n\n${draft.content}`
}

export async function writeDraft(
  projectPath: string,
  chapterName: string,
  content: string,
  meta?: { sourceConversationId?: string; sourceMessageId?: string },
): Promise<ChapterDraft> {
  await ensureDraftsDir(projectPath)
  const draft: ChapterDraft = {
    id: generateDraftId(),
    chapterName,
    content,
    createdAt: Date.now(),
    status: "draft",
    sourceConversationId: meta?.sourceConversationId,
    sourceMessageId: meta?.sourceMessageId,
  }
  const filePath = `${draftsDir(projectPath)}/${draft.id}.md`
  await writeFile(filePath, buildDraftContent(draft))
  return draft
}
