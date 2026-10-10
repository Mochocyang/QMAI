/**
 * 「新章节灵感提示」的文案与判定（丙-4a）。
 *
 * ── 为什么判据必须复用草稿提示那一套，而不是新写一份 ──
 * 草稿提示（`draft-memory-hint.ts` 的 `resolveDraftMemoryHint`）与灵感提示是
 * 关于**同一个章节**的两句话，都必须从 `countChapterBodyWords(fileContent)`
 * 这一个来源得出「这一章有没有正文」。各自写一份正则/判据迟早会分叉，
 * 出现「草稿提示说这是空章节、灵感提示说不是」这种自相矛盾的界面。
 *
 * 所以这里不重新实现任何「内容是否为空」的逻辑：调用方把
 * `countChapterBodyWords(fileContent)` 算好的 `wordCount` 传进来，
 * 与 `resolveDraftMemoryHint` 的入参形状对齐。
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
}

/**
 * 决定 A（用户 2026-10-10 拍板）：判据是**章节自身的状态** ——
 * 「正文为空」即视为新章节，**不依赖**「本次会话里刚点过『新建章节』这个动作」。
 *
 * 决定 B：这枚气泡是**并行的说明性气泡**，不是进入向导的前置关卡，
 * 也不是「点气泡直接跳过向导生成」的捷径。所以这里**只**回答「气泡该不该挂着」，
 * 「向导要不要打开」由按钮自己的 `onClick` 决定，两者互不阻塞。
 *
 * ⚠️ **与草稿提示的互斥是这一行的直接后果，不是巧合**：
 * `resolveDraftMemoryHint`（`draft-memory-hint.ts:23`）的第一道门就要求
 * `wordCount > 0`，而这里要求 `wordCount === 0` —— 两者互补，永远不可能同时为真。
 *
 * 为什么必须写下来：两条气泡共用 `.ui-test-editor-hint-anchor`，
 * 定位属性（`top: calc(100% + 10px)` / `left: 0` / `width: min(280px, 100%)`）
 * 也是逐项照抄的，所以一旦同时挂着，它们会**精确重叠**在同一坐标上 ——
 * 视觉上是一条盖住另一条，而所有既有断言仍然全绿。
 * 谁要放宽草稿提示那道 `wordCount <= 0` 的门，必须先回来改这里。
 * 穷举证明在 `src/lib/inspiration-hint.spec.ts` 的「两条气泡互斥」一组里。
 */
export function resolveInspirationHint(input: InspirationHintInput): boolean {
  if (!input.enabled || !input.isChapter || input.wordCount !== 0 || input.dismissed) {
    return false
  }
  // 同一次打开里刚记下「本书已提示」（显示即记 seen），不要把正在挂着的气泡收掉。
  if (input.currentlyVisible) return true
  if (input.bookHintSeen) return false
  return true
}
