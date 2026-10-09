/**
 * 「立刻把当前章节正文落盘」的登记处。
 *
 * ── 为什么需要它 ──
 * 章节正文的自动保存原本是「停止输入 1 秒就写盘」。用户反馈这样太吵：
 * 每按一次回车都会弹出保存提示，而且频繁写盘偶尔会卡一下。于是改成
 * 每 3 分钟写一次（见 `preview-panel.tsx` 的 `CHAPTER_AUTOSAVE_INTERVAL_MS`）。
 *
 * 但间隔一拉长，**没走完间隔就退出**这条路径就会丢字：
 * 关窗、切章节、组件卸载时，待落盘的那一份正文还在定时器里。
 * `App.tsx` 的关窗处理器需要能主动触发一次落盘，而它拿不到
 * `preview-panel` 内部的定时器，所以这里做一个只放一个处理器的登记处，
 * 形状与 `editor-external-update-session.ts` 一致。
 *
 * ⚠️ 卸载路径必须 **flush 而不是丢弃**。`debounced-persist.ts` 里那条
 * 「不要在组件卸载时丢弃 pending」的教训同样适用于这里：丢掉就等于
 * 用户最后几分钟写的内容永远不落盘。
 */
export type ChapterSaveFlushHandler = () => Promise<void>

/**
 * 章节正文自动写盘的间隔（用户选定：3 分钟）。
 *
 * 原来是「停止输入 1 秒就写盘」：每按一次回车都弹保存提示，且频繁写盘
 * 偶尔卡顿。改长间隔后，**必须**同时靠上面的 flush 兜底，
 * 否则最后几分钟写的内容会留在定时器里丢掉。
 */
export const CHAPTER_AUTOSAVE_INTERVAL_MS = 3 * 60 * 1000

let activeHandler: ChapterSaveFlushHandler | null = null

export function registerChapterSaveFlush(handler: ChapterSaveFlushHandler): () => void {
  activeHandler = handler
  return () => {
    if (activeHandler === handler) activeHandler = null
  }
}

/**
 * 立刻落盘当前待保存的章节正文。
 *
 * 没有待保存内容、或没有登记处理器（例如停在书架页）时是空操作 ——
 * 关窗路径不应因为它抛错而卡住退出。
 */
export async function flushPendingChapterSave(): Promise<void> {
  if (!activeHandler) return
  await activeHandler()
}
