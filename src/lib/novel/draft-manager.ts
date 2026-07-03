import { readFile, writeFile, deleteFile, fileExists, createDirectory, listDirectory } from "@/commands/fs"
import { parseFrontmatter } from "@/lib/frontmatter"
import type { ChapterDraft, DraftStatus } from "./lifecycle-types"
import { DRAFTS_DIR } from "./lifecycle-types"
import { normalizePath } from "@/lib/path-utils"

function generateDraftId(): string {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function draftsDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/${DRAFTS_DIR}`
}

function chaptersDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/chapters`
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

function parseDraftFromFile(filePath: string, rawContent: string): ChapterDraft {
  const parsed = parseFrontmatter(rawContent)
  const fm = parsed.frontmatter as Record<string, string | string[]> | null
  const idMatch = filePath.match(/([^/\\]+)\.md$/)
  const id = idMatch ? idMatch[1] : (fm?.draft_id as string) || "unknown"
  const chapterName = typeof fm?.chapter_name === "string" ? fm.chapter_name : "未命名章节"
  const createdAt = fm?.created_at ? Number(String(fm.created_at)) : Date.now()
  const status = (typeof fm?.status === "string" ? fm.status : "draft") as DraftStatus
  return {
    id,
    chapterName,
    content: parsed.body,
    createdAt,
    status,
    sourceConversationId: typeof fm?.source_conversation_id === "string" ? fm.source_conversation_id : undefined,
    sourceMessageId: typeof fm?.source_message_id === "string" ? fm.source_message_id : undefined,
  }
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

export async function getDraft(projectPath: string, draftId: string): Promise<ChapterDraft | null> {
  const filePath = `${draftsDir(projectPath)}/${draftId}.md`
  if (!await fileExists(filePath)) return null
  const raw = await readFile(filePath)
  return parseDraftFromFile(filePath, raw)
}

export async function listDrafts(projectPath: string): Promise<ChapterDraft[]> {
  const dir = draftsDir(projectPath)
  if (!await fileExists(dir)) return []
  const files = await listDirectory(dir)
  const mdFiles = files.filter((f) => !f.is_dir && f.name.endsWith(".md"))
  const drafts: ChapterDraft[] = []
  for (const f of mdFiles) {
    try {
      const raw = await readFile(`${dir}/${f.name}`)
      drafts.push(parseDraftFromFile(f.name, raw))
    } catch {
      /* skip corrupted files */
    }
  }
  return drafts.sort((a, b) => b.createdAt - a.createdAt)
}

export async function confirmDraft(
  projectPath: string,
  draftId: string,
): Promise<{ success: boolean; chapterPath: string; error?: string }> {
  const draft = await getDraft(projectPath, draftId)
  if (!draft) {
    return { success: false, chapterPath: "", error: "草稿不存在" }
  }

  const chapterFileName = draft.chapterName.replace(/[\\/:*?"<>|]/g, "_")
  const chapterPath = `${chaptersDir(projectPath)}/${chapterFileName}.md`

  try {
    const chDir = chaptersDir(projectPath)
    if (!await fileExists(chDir)) {
      await createDirectory(chDir)
    }
    await writeFile(chapterPath, draft.content)
    await deleteFile(`${draftsDir(projectPath)}/${draftId}.md`)
    return { success: true, chapterPath }
  } catch (e) {
    return { success: false, chapterPath: "", error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteDraft(projectPath: string, draftId: string): Promise<void> {
  const filePath = `${draftsDir(projectPath)}/${draftId}.md`
  if (await fileExists(filePath)) {
    await deleteFile(filePath)
  }
}
