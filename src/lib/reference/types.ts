export type ReferenceCategory =
  | "chapter"
  | "memory"
  | "outline"
  | "deduction"
  | "skill"
  | "chat_history"
  | "outline_history"

export interface ReferenceToken {
  id: string
  category: ReferenceCategory
  title: string
  /** 文件路径或数据源标识 */
  path?: string
  /** 技能时存 skillId */
  skillId?: string
  /** 对话时存 conversationId */
  conversationId?: string
  /** 芯片显示用的截断标题 */
  displayTitle: string
}

export interface ReferencePickerTab {
  key: ReferenceCategory
  label: string
  icon: string
}

export const REFERENCE_TABS: ReferencePickerTab[] = [
  { key: "chapter", label: "章节", icon: "📄" },
  { key: "memory", label: "记忆库", icon: "🧠" },
  { key: "outline", label: "大纲", icon: "📋" },
  { key: "deduction", label: "推演室", icon: "🔬" },
  { key: "skill", label: "技能库", icon: "⚡" },
  { key: "chat_history", label: "AI对话", icon: "💬" },
  { key: "outline_history", label: "AI大纲", icon: "📝" },
]

export const MAX_REFERENCE_COUNT = 10
