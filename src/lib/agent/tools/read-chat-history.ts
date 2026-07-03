import type { Tool } from "../types"

interface ChatHistorySource {
  id: string
  title: string
  messages: { role: string; content: string }[]
}

export function createReadChatHistoryTool(conversations: ChatHistorySource[]): Tool {
  return {
    name: "read_chat_history",
    description: "读取 AI 会话历史记录中指定会话的全部对话内容。参数 conversationId 为会话 ID，或 conversationTitle 为会话标题。",
    category: "read",
    parameters: {
      conversationId: { type: "string", description: "会话 ID" },
      conversationTitle: { type: "string", description: "会话标题（可选，用于模糊匹配）" },
    },
    execute: async (params) => {
      const id = params.conversationId as string | undefined
      const title = params.conversationTitle as string | undefined
      const conversation = conversations.find(
        (c) => (id && c.id === id) || (title && c.title.includes(title)),
      )
      if (!conversation) return `错误：未找到会话「${id || title}」`
      return conversation.messages
        .map((m) => `[${m.role === "user" ? "用户" : "AI"}]: ${m.content}`)
        .join("\n\n")
    },
  }
}
