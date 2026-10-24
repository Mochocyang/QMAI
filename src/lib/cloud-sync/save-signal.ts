/**
 * 「项目里有内容落盘了」的信号。
 *
 * 编辑器把正文写进磁盘的地方只有一处（`preview-panel` 的 `runPendingChapterSave`），
 * 但它在组件内部，云同步拿不到；所以这里放一个**只放一个处理器集合**的登记处，
 * 形状与 `chapter-save-flush.ts` 保持一致。
 *
 * 为什么不用文件监听：同步的目标就是「用户明确的保存动作」，文件监听会把
 * 同步自己写下来的临时文件也当成用户改动，形成自我触发的死循环。
 */

type SavedListener = () => void

const listeners = new Set<SavedListener>()

/** 落盘成功后调用（不区分章节/大纲，两者都算一次改动）。 */
export function notifyProjectSaved(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      // 一个监听者抛错不能影响保存本身：保存是主路径，同步是副路径。
      console.error("云同步：落盘信号处理失败", error)
    }
  }
}

export function subscribeProjectSaved(listener: SavedListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 仅测试用：清空订阅，避免用例之间互相影响。 */
export function resetProjectSavedListenersForTest(): void {
  listeners.clear()
}
