import { toast } from "@/lib/toast"
import { useChatStore } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"

/**
 * 细纲 → 写作现场：把扩写提示词填进写作输入框。
 *
 * 为什么抽成模块而不是两处各写一遍：事件细纲卡片现在有**两个**宿主 ——
 * 大纲助手的气泡下方，以及写作助手（章节区 AI 对话）的气泡下方（用户要求
 * 「生成的内容在 AI 对话框中显示」）。同一个按钮在两处长着同样的脸，
 * 落点也必须是同一处：写作输入框。复制一份必然漂移，用户会在两个面板上
 * 得到两种不同的交接行为。
 *
 * 三个「为什么」都在下面：
 * 1. **只填不发**：误点一次就烧掉一次正文生成太贵，也让用户有机会先改两句。
 * 2. **必须展开写作助手**：写作面只在 `chatExpanded` 为 true 时才渲染 ChatPanel，
 *    而「关闭写作助手」会把它置 false。不展开的话草稿落进一个看不见的输入框，
 *    提示却还在说「已填进写作输入框」。
 * 3. **不覆盖已有草稿**：用户可能已经在写作输入框里打了半页想法，交接不该把它删掉，
 *    所以是追加（有草稿时补两个换行）而不是赋值。
 *
 * 切回 `wiki` 视图这一步同样必要：卡片可能是在「大纲」视图里点开的，而输入框属于
 * 章节区的写作助手 —— 不切视图，用户会对着大纲面板找不到刚填进去的那段字。
 */
export function handoffEventOutlineToProse(prompt: string): void {
  const chat = useChatStore.getState()
  const targetConversationId = chat.activeConversationId ?? chat.createConversation()
  useWikiStore.getState().setChatExpanded(true)
  const existingDraft =
    chat.conversations.find((item) => item.id === targetConversationId)?.inputDraft ?? ""
  const appended = Boolean(existingDraft.trim())
  chat.setConversationInputDraft(
    targetConversationId,
    appended ? `${existingDraft}\n\n${prompt}` : prompt,
  )
  useWikiStore.getState().setActiveView("wiki")
  toast.info(
    appended
      ? "已把这一章的事件细纲追加到写作输入框里已有草稿的后面，确认后发送。"
      : "已把这一章的事件细纲填进写作输入框，确认后发送。",
    { dedupeKey: "event-outline-to-prose" },
  )
}
