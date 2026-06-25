import i18n from "@/i18n"
import { normalizeChapterStatus } from "@/lib/novel/chapter-meta"

export function getChapterStatusLabel(status: unknown): string {
  const normalized = normalizeChapterStatus(status)
  switch (normalized) {
    case "final":
      return i18n.t("novel.chapter.status.canon")
    case "revised":
      return i18n.t("novel.chapter.status.revised")
    case "archived":
      return i18n.t("novel.chapter.status.archived")
    case "draft":
    default:
      return i18n.t("novel.chapter.status.draft")
  }
}

export function buildChapterWordCountLabel(wordCount: number): string {
  return `${wordCount}字`
}

export function buildChapterTotalWordCountLabel(wordCount: number): string {
  return `总字数：${wordCount}字`
}
