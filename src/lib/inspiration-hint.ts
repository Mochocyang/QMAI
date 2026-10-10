/**
 * 「新章节灵感提示」的文案与判定（丙-4a）。
 *
 * ── 为什么判据必须复用草稿提示那一套，而不是新写一份 ──
 * 草稿提示（`draft-memory-hint.ts` 的 `resolveDraftMemoryHint`）与灵感提示是
 * 关于**同一个章节**的两句话，都必须能回答「这一章有没有正文」。
 * 各自写一份正则/判据迟早会分叉，出现「草稿提示说这是空章节、灵感提示说不是」
 * 这种自相矛盾的界面。
 *
 * ⚠️ 但「同源」只到**同一个计算函数**为止，**不是同一个数**：
 * `countChapterBodyWords(fileContent)`（实时）与草稿链实际喂进去的
 * `session.persistedWords`（只在切章或保存成功时刷新的快照）会在
 * 「磁盘上还有正文、编辑框刚被清空」时给出不同的值。所以调用方把
 * `countChapterBodyWords(fileContent)` 算好的 `wordCount` 传进来，
 * 与 `resolveDraftMemoryHint` 的入参形状对齐；而**互斥**必须靠下面那个
 * 显式的 `draftHintVisible` 入参保证（修复批 F1）。
 */

/**
 * 气泡文案。
 *
 * 口径与 `DRAFT_MEMORY_HINT_MESSAGE`（`draft-memory-hint.ts:6-7`）一致：
 * **硬编码常量**，不走 i18n —— `hardcoded-ui-chinese-i18n.test.ts` 不是通用的
 * 「禁止硬编码中文」规则，而是一份具体字符串的黑名单 + 反向白名单。
 *
 * ⚠️ 「点击这里生成新章节故事灵感」是用户原话（丙-4 需求 1），不要改写这句；
 * 前后可以补上下文说明。
 */
export const INSPIRATION_HINT_MESSAGE =
  "这一章还没有正文。点击这里生成新章节故事灵感：先按你填的目标章号与事件数，给出这一章的事件细纲。"

export interface InspirationHintInput {
  /** 当前打开的是章节文件（`isChapterPath(selectedFile)`）。 */
  isChapter: boolean
  /** 实时正文的字数：`countChapterBodyWords(fileContent)`，与草稿提示同一个来源。 */
  wordCount: number
  /** `novelConfig.inspirationHintEnabled`：写作设置里的开关。 */
  enabled: boolean
  /** 本次会话里点过「知道了」。**不落盘**。 */
  dismissed: boolean
  /** `novelConfig.inspirationHintSeen`：这本书里已经挂过一次。 */
  bookHintSeen: boolean
  /** 这一章里气泡当前已经挂着。 */
  currentlyVisible: boolean
  /**
   * 草稿气泡这一次是否挂着 —— 由**同一次判定里**草稿链刚算出来的结果传入。
   *
   * ⚠️ 这个入参就是两条气泡的互斥本身，不要删、也不要用别的量去推：
   * 两条气泡共用 `.ui-test-editor-hint-anchor`，定位属性（`top` / `left` /
   * `width: min(280px, 100%)`）也是逐项照抄的，同时挂着就会**精确重叠**
   * 在同一坐标上（修复批 F1 实测：删掉编辑框里的正文即触发）。
   */
  draftHintVisible: boolean
}

/**
 * 决定 A（用户 2026-10-10 拍板）：判据是**章节自身的状态** ——
 * 「正文为空」即视为新章节，**不依赖**「本次会话里刚点过『新建章节』这个动作」。
 *
 * 决定 B：这枚气泡是**并行的说明性气泡**，不是进入向导的前置关卡，
 * 也不是「点气泡直接跳过向导生成」的捷径。所以这里**只**回答「气泡该不该挂着」，
 * 「向导要不要打开」由按钮自己的 `onClick` 决定，两者互不阻塞。
 *
 * ⚠️ **与草稿提示的互斥来自 `draftHintVisible` 这个显式入参**，
 * **不是**「`wordCount === 0` 与草稿提示的 `wordCount > 0` 互补」的后果 ——
 * 那个互补只在两条链喂进**同一个** `wordCount` 时成立，而真实接线里不成立：
 * 草稿链喂 `session.persistedWords`（切章/保存成功时才刷新的快照），
 * 灵感链喂实时字数。修复批 F1 之前就是靠这个错前提「保证」互斥的，
 * 结果「有正文的草稿章 + 清空编辑框」会让两条气泡一起挂出来。
 * 同一份 `wordCount` 下的互补仍然成立（见 `inspiration-hint.spec.ts` 的穷举），
 * 但它**不覆盖接线**；接线的证明在
 * `ui-test-editor.spec.tsx` 的「草稿章有正文时清空编辑器」那条用例里。
 */
export function resolveInspirationHint(input: InspirationHintInput): boolean {
  if (
    !input.enabled
    || !input.isChapter
    || input.draftHintVisible
    || input.wordCount !== 0
    || input.dismissed
  ) {
    return false
  }
  // 同一次打开里刚记下「本书已提示」（显示即记 seen），不要把正在挂着的气泡收掉。
  if (input.currentlyVisible) return true
  if (input.bookHintSeen) return false
  return true
}
