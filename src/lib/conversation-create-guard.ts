export const EMPTY_CONVERSATION_CREATE_REASON =
  "请先发送当前会话内容，再新建对话。"

export function canCreateNewConversation(
  activeConversationId: string | null,
  hasSentUserMessage: boolean,
): boolean {
  return activeConversationId === null || hasSentUserMessage
}
