/**
 * 「已停止生成」这件事的单一判定源。
 *
 * 用户手动停止生成时，两条链路都会把一句提示**追加到助手消息正文末尾**：
 *
 *   章节面板（chat-panel.tsx）：
 *     `${已生成内容}\n\n已停止生成。`   或   `已停止生成。`
 *   大纲面板（outline-chat-panel.tsx）：
 *     `${已生成内容}\n\n---\n\n⚠️ 生成已停止，以上为已生成的内容。`   或   `已停止生成。`
 *
 * 提示句是**内容的一部分**（要落盘、要随会话历史保存），所以「这条消息是不是被
 * 停止过」只能靠正文判定 —— 消息对象上没有 stopped 之类的标志位。
 * 「重试 / 继续」两个按钮的显示条件就建立在这个判定上，因此判定必须只有一处实现，
 * 否则两个面板迟早会对"什么样算停止"产生分歧。
 */

/**
 * 停止提示句，按「长标记优先」排列。
 *
 * 顺序有意义：`⚠️ 生成已停止，以上为已生成的内容。` 本身**包含**子串
 * "已停止生成"，若短标记先匹配，长标记的前缀部分会被先吃掉，剥离出来的
 * 已生成内容就会多出一截 `---\n\n⚠️` 垃圾。所以匹配时必须从长到短试。
 */
const STOP_MARKERS = [
  "\n\n---\n\n⚠️ 生成已停止，以上为已生成的内容。",
  "\n\n已停止生成。",
  "已停止生成。",
] as const

/** 完全没有产出内容时，正文就只有这一句。 */
export const STOPPED_GENERATION_NOTICE = "已停止生成。"

/** 点「继续」时发出的提示词。两个面板共用同一句，行为才一致。 */
export const CONTINUE_STOPPED_GENERATION_PROMPT =
  "继续。上一条回复在生成中途被停止了，请从停下的位置接着往下写，不要重复已经生成过的内容，也不要解释，直接输出剩余部分。"

/** 点「重试」时的无障碍与悬停文案（提示用户可以先换模型再重试）。 */
export const STOPPED_GENERATION_RETRY_LABEL = "重试"

/** 点「继续」时的无障碍与悬停文案。 */
export const STOPPED_GENERATION_CONTINUE_LABEL = "继续"

/** 正文里停止标记的起始下标；不是停止过的消息则返回 -1。 */
function findStopMarker(content: string): number {
  for (const marker of STOP_MARKERS) {
    // 只认**结尾**的标记：标记是收尾追加的，正文中间偶然出现同样的字句
    // （比如模型自己写了"已停止生成"）不该把整条消息判成被停止。
    if (content.endsWith(marker)) return content.length - marker.length
  }
  return -1
}

/** 这条助手消息是不是「被停止的生成」。 */
export function isStoppedGenerationMessage(content: string | undefined | null): boolean {
  if (!content) return false
  return findStopMarker(content) !== -1
}

/**
 * 剥掉停止标记后剩下的、真正已生成的内容（可能为空串，也可能只有空白）。
 *
 * 停止后这条消息不再是"正常完成的一轮"，下游有些地方需要知道到底还剩多少内容，
 * 例如「继续」只说"接着写"而不把这段内容再贴一遍时，得先确认它非空。
 */
export function stoppedGenerationContent(content: string): string {
  const markerIndex = findStopMarker(content)
  if (markerIndex === -1) return content
  const head = content.slice(0, markerIndex)
  // 长标记自带前导换行，短标记也预置了 `\n\n`，只有裸的 "已停止生成。"
  // 需要自己把连接正文的换行去掉。
  return head.endsWith("\n\n") ? head.slice(0, -2) : head
}

/** 停止时是否已经产出了可用内容（决定按钮旁要不要提示"已有内容"）。 */
export function hasStoppedGenerationContent(content: string): boolean {
  return stoppedGenerationContent(content).trim().length > 0
}
