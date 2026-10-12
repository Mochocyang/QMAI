import i18n from "@/i18n"
import { normalizeChapterStatus } from "@/lib/novel/chapter-meta"

/**
 * 章节状态的**长文案**（「正式章节」/「草稿」）。
 *
 * 用在需要说清楚的地方（导入提示、执行报告等）。
 * 编辑器标题行上**不用**它 —— 那里用 `getChapterStatusBadge`，
 * 因为徽章的位置只放得下两个字（用户要求）。
 */
export function getChapterStatusLabel(status: unknown): string {
  return normalizeChapterStatus(status) === "final"
    ? i18n.t("novel.chapter.status.canon")
    : i18n.t("novel.chapter.status.draft")
}

/**
 * 章节状态徽章的**两个字文案**（「正式」/「草稿」）。
 *
 * ⚠️ 与 `getChapterStatusLabel` 是两个函数、两套 i18n key，**刻意不共用**：
 * 长文案是「正式章节」（4 字）而徽章是「正式」（2 字），
 * 共用一份的话，将来有人把徽章文案改短会顺手把长文案也改短，
 * 反之亦然 —— 而这两处对字数的要求是相反的（一处要说得清楚、
 * 一处被徽章高度钉死在两个字）。
 *
 * 用户口径：「徽章尺寸12加粗」「里面就两个字，比如"正式草稿"」。
 */
export function getChapterStatusBadge(status: unknown): string {
  return normalizeChapterStatus(status) === "final"
    ? i18n.t("novel.chapter.status.badgeCanon")
    : i18n.t("novel.chapter.status.badgeDraft")
}

export function buildChapterWordCountLabel(wordCount: number): string {
  return `${wordCount}字`
}
