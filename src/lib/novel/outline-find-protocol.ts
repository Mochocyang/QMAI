/**
 * 写作前找大纲协议：先钉目标章号，再按文件夹分流（主路径），旧 type 仅作兼容，最后读正文判断归属。
 * 不依赖文件名规范，也不要求大纲正文写法统一。
 */

import type { NovelTaskIntent } from "./task-router"

/** 需要「按目标章找纲」协议的章节写作意图（不含大纲生成） */
export const OUTLINE_FIND_CHAPTER_INTENTS = new Set<NovelTaskIntent>([
  "write_chapter",
  "continue_chapter",
  "rewrite_chapter",
  "polish_chapter",
])

export function shouldIncludeOutlineFindProtocol(intent?: string | null): boolean {
  return Boolean(intent && OUTLINE_FIND_CHAPTER_INTENTS.has(intent as NovelTaskIntent))
}

export function buildOutlineFindProtocol(targetChapterNumber?: number): string {
  const targetLine =
    typeof targetChapterNumber === "number" && targetChapterNumber > 0
      ? `本次写作目标：第 ${targetChapterNumber} 章。后续找大纲必须以该章号为准。`
      : "写作前必须先明确本次要写的目标章号 N（可从任务路由、list_chapters 的最新章+1，或用户明示获得）。"

  return [
    "## 大纲定位协议（写章节前必须遵守）",
    "",
    targetLine,
    "1. 调用 list_outlines 查看全部大纲候选；优先扫 folder（大纲 / 设定 / 章纲 / 卷纲 / 人物小传等），不要只盯卷纲文件名。",
    "2. 按文件夹分流（主路径；新项目默认无 type）：",
    "   - 大纲：索引/总纲入口；应优先 read_outline 读索引，发现必须遵守的规则文档与卷纲入口；本身通常不是本章剧情细纲。",
    "   - 设定：写作硬约束/机制；写正文前应至少读与本次任务相关的设定。不要用章号去「匹配」设定，也不要把它们当成卷纲。",
    "   - 章纲：本章主候选；必须 read_outline 读正文，按目标章号定位对应章纲。",
    "   - 卷纲：卷级候选；确认章号落在该卷后再读。",
    "   - 人物小传 / 伏笔 / 组织：辅助资料，不当本章剧情大纲。",
    "3. 兼容（非强制）：若几乎无标准文件夹、却有旧 frontmatter type，可参考 overview≈大纲、concept≈设定、outline≈卷纲/章纲；不要求新项目补 type。",
    "4. 文件夹与 type 都缺失时，必须读正文判断是卷纲、章纲、设定还是清单；禁止只看文件名就选定。",
    "5. 确认对应该章的大纲，并已知相关 大纲/设定（或旧 overview/concept）约束后，必须调用 run_chapter_workflow；禁止直接输出终稿正文。",
    "禁止只凭文件名猜测分卷；禁止把设定/人物小传（或旧 concept/overview）当成章节剧情大纲；禁止在未查看 大纲/设定 的情况下只读一份卷纲就开写。",
  ].join("\n")
}

export function formatTargetChapterLine(chapterNumber: number): string {
  return `本次写作目标：第 ${chapterNumber} 章。`
}

/** 从已拼接的系统提示中移除找纲协议块，避免与 plugin 重复注入。 */
export function stripOutlineFindProtocol(prompt: string): string {
  return prompt
    .replace(/\n*## 大纲定位协议（写章节前必须遵守）\n[\s\S]*?(?=\n## |\n*$)/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
