import type { Tool } from "../types"

interface OutlineChatSource {
  id: string
  title: string
  messages: { role: string; content: string }[]
}

export function createReadOutlineHistoryTool(conversations: OutlineChatSource[]): Tool {
  return {
    name: "read_outline_history",
    description: "读取 AI 大纲历史会话中指定会话的全部对话内容。参数 conversationId 为会话 ID。",
    category: "read",
    parameters: {
      conversationId: { type: "string", description: "会话 ID", required: true },
    },
    execute: async (params) => {
      const id = params.conversationId as string
      const conversation = conversations.find((c) => c.id === id)
      if (!conversation) return `错误：未找到大纲会话「${id}」`
      return conversation.messages
        .map((m) => `[${m.role === "user" ? "用户" : "AI"}]: ${m.content}`)
        .join("\n\n")
    },
  }
}
