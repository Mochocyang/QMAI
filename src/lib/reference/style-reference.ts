/**
 * 文风引用（丁-3）：把输入框里的 `@` 文风引用解析成「本次生成临时覆盖的文风预设 id」。
 *
 * 为什么单独一个模块：**解析口径必须只有一处**。产出端（引用弹窗里的条目，
 * `chat-panel.tsx` 的 `createSkillProvider` getter）与消费端（同文件 `handleSend` 与
 * `getWritingStyleIdOverride`）隔着整个 UI，各写一份就会出现「条目里带了 id、
 * 消费端读的是另一个字段」这种**看着接上、其实断开**的通道
 * —— 本仓库已经有过一条 `getPlanBlueprint` 形状的死通道（只注册了消费者、没有产出者）。
 *
 * 取哪个字段：文风条目和其它技能共用 `providers.ts` 的 `createSkillProvider`，
 * 那条透传写的是 `skillId: skill.id`，所以**预设 id 就落在 `ReferenceToken.skillId`**，
 * 没有第二个字段。`skillSubtype` 是引用弹窗子 tab 的过滤键，这里也用它认「这是文风条目」。
 */
import type { ReferenceToken, SkillSubtype } from "./types"

export const STYLE_SKILL_SUBTYPE: SkillSubtype = "style"

/**
 * 按引用顺序取出被点名的文风预设 id（去重，同一个预设被引用两次只算一条）。
 *
 * 只认 `skillSubtype === "style"` 的 token：别的子类型（去AI味 / 写作Skill）也带
 * `skillId`，混进来就会把某个技能 id 当成文风预设 id。
 *
 * ⚠️ 这里**不**判「预设是否还存在」，那是 `resolveWritingStylePreset` 的职责
 * （未知 id ⇒ 本次没有可用文风，**不**回退到项目启用项）。本函数只做引用 → id 的解析。
 */
export function collectReferencedStylePresetIds(tokens: readonly ReferenceToken[]): string[] {
  const presetIds: string[] = []
  for (const token of tokens) {
    if (token.skillSubtype !== STYLE_SKILL_SUBTYPE) continue
    const presetId = token.skillId?.trim()
    if (!presetId) continue
    if (!presetIds.includes(presetId)) presetIds.push(presetId)
  }
  return presetIds
}
