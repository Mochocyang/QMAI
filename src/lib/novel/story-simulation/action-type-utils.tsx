
import {
  Brain,
  Forward,
  Eye,
  Zap,
  MessageCircle,
  Handshake,
  Swords,
  EyeOff,
  Search,
  CheckCircle,
  Flame,
  Users,
  Lock,
  type LucideIcon,
} from "lucide-react"

/** 行为类型 → 中文短标签（2-4字），用于列表/卡片展示 */
export function actionTypeShortLabel(type: string): string {
  return LABEL_MAP[type] || type
}

/** 行为类型 → 中文动词短语（含目标名），用于事件流展示 */
export function actionTypePhrase(type: string, targetName?: string): string {
  switch (type) {
    case "evaluate":
      return "心中评价"
    case "pushPlot":
      return "推动事态"
    case "observe":
      return "观察到"
    case "react":
      return targetName ? `对 ${targetName} 的反应` : "做出反应"
    case "speak":
      return targetName ? `对 ${targetName} 说` : "说"
    case "ally":
      return targetName ? `向 ${targetName} 示好` : "寻求合作"
    case "confront":
      return targetName ? `与 ${targetName} 对抗` : "采取对抗姿态"
    case "conceal":
      return "隐瞒内心"
    case "investigate":
      return "调查"
    default:
      return "行动"
  }
}

/** 行为类型 → 纯动词（不含目标名），用于可点击目标名场景 */
export function actionTypePhraseOnly(type: string): string {
  switch (type) {
    case "evaluate":
      return "评价"
    case "pushPlot":
      return "推动"
    case "observe":
      return "观察到"
    case "react":
      return "对"
    case "speak":
      return "对"
    case "ally":
      return "向"
    case "confront":
      return "与"
    case "conceal":
      return "隐瞒"
    case "investigate":
      return "调查"
    default:
      return "对"
  }
}

/** 行为类型 → Lucide 图标组件 */
export function actionTypeIcon(type: string): LucideIcon {
  return ICON_MAP[type] || Zap
}

// ── 中文标签映射 ──
const LABEL_MAP: Record<string, string> = {
  evaluate: "评价",
  pushPlot: "推动",
  observe: "观察",
  react: "反应",
  speak: "对话",
  ally: "示好",
  confront: "对抗",
  conceal: "隐瞒",
  investigate: "调查",
  act: "行动",
  decide: "决策",
  conflict: "冲突",
  cooperate: "合作",
  withhold: "隐瞒",
}

// ── 图标组件映射 ──
const ICON_MAP: Record<string, LucideIcon> = {
  evaluate: Brain,
  pushPlot: Forward,
  observe: Eye,
  react: Zap,
  speak: MessageCircle,
  ally: Handshake,
  confront: Swords,
  conceal: EyeOff,
  investigate: Search,
  act: Zap,
  decide: CheckCircle,
  conflict: Flame,
  cooperate: Users,
  withhold: Lock,
}