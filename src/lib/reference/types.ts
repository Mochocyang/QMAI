import type { SkillKind, SkillMode, SkillStage } from "@/lib/novel/skill-library"

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
  /** 技能类型、阶段和适用模式 */
  skillKinds?: SkillKind[]
  skillStages?: SkillStage[]
  skillModes?: SkillMode[]
  /** 对话时存 conversationId */
  conversationId?: string
  /** 芯片显示用的截断标题 */
  displayTitle: string
}

export interface ReferencePickerTab {
  key: ReferenceCategory
  label: string
}

export const REFERENCE_TABS: ReferencePickerTab[] = [
  { key: "chapter", label: "章节" },
  { key: "memory", label: "记忆库" },
  { key: "outline", label: "大纲" },
  { key: "deduction", label: "推演室" },
  { key: "skill", label: "技能库" },
  { key: "chat_history", label: "AI对话" },
  { key: "outline_history", label: "AI大纲" },
]

export const MAX_REFERENCE_COUNT = 10
