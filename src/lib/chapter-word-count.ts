import { normalizeCountableText } from "@/lib/writing-stats"

/**
 * 章节正文字数。
 *
 * 口径唯一由 `normalizeCountableText` 定义：「丢掉 frontmatter → 丢掉首个
 * `# 标题` 行 → 丢掉所有空白（含全角空格）」后的字符数。写作统计的
 * 「今日手写 / 今日 AI」刻意复用同一个归一化函数，否则「手写 + AI」永远
 * 对不上「总字数」，两个数字会在界面上互相打架。
 */
export function countChapterBodyWords(markdown: string): number {
  return normalizeCountableText(markdown).length
}
