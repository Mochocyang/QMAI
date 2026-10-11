import type { SkillKind, SkillMode, SkillStage } from "@/lib/novel/skill-library"

/**
 * 引用弹窗「技能库」子 tab 的子类型。
 *
 * `"style"` 是丁-3 新增的**文风预设**子类型：条目来自 `writing-style-store.ts` 的
 * preset（**不是** `UserSkill`），id 落在 `ReferenceToken.skillId` 上，
 * 由 `style-reference.ts` 的 `collectReferencedStylePresetIds` 读回、转成本次生成的
 * `writingStyleIdOverride`（见 `chat-panel.tsx` 的 `getWritingStyleIdOverride`）。
 * `ReferencePickerDialog` 的子 tab 过滤按本字段相等判断，所以新增成员不需要改过滤逻辑。
 */
export type SkillSubtype = "deai" | "writing" | "style"

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
  /**
   * 技能时存 skillId。
   * `skillSubtype === "style"` 时它就是**文风预设 id**（丁-3）——预设和其它技能
   * 共用 `createSkillProvider` 的 `skillId: skill.id` 这一条透传，故没有第二个字段。
   * ⚠️ 它**不会**被误导成「启用了某个技能」：`resolveSkillReference` 见到 id 就直接返回
   * `find(id)` 的结果、不再回退到按名字匹配，而预设 id 不在技能池里。
   */
  skillId?: string
  /** 技能子类型：去AI味 / 写作Skill / 文风。 */
  skillSubtype?: SkillSubtype
  /** 技能类型、阶段和适用模式 */
  skillKinds?: SkillKind[]
  skillStages?: SkillStage[]
  skillModes?: SkillMode[]
  /** 对话时存 conversationId */
  conversationId?: string
  /** 芯片显示用的截断标题 */
  displayTitle: string
}

interface ReferencePickerTab {
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
