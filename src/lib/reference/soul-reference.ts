/**
 * 角色灵魂引用（丁-4）：把输入框里的 `@` 角色灵魂引用解析成
 * 「本条消息要临时绑定到某个小说人物的灵魂 id」。
 *
 * 为什么单独一个模块：与 `style-reference.ts` 同形，**解析口径必须只有一处**。
 * 产出端（引用弹窗里的条目，`chat-panel.tsx` / `outline-chat-panel.tsx` 的
 * `createSkillProvider` getter）与消费端（同两处的 `handleSend`）隔着整个 UI，
 * 各写一份就会出现「条目里带了 id、消费端读的是另一个字段」这种
 * **看着接上、其实断开**的通道。
 *
 * 取哪个字段：灵魂条目与其它技能共用 `providers.ts` 的 `createSkillProvider`，
 * 那条透传写的是 `skillId: skill.id`，所以 **aura id 就落在 `ReferenceToken.skillId`**，
 * 没有第二个字段。`skillSubtype` 是引用弹窗子 tab 的过滤键，这里也用它认「这是灵魂条目」。
 *
 * ⚠️ 术语：本模块的「灵魂」一律指**角色灵魂**（`character-aura.ts` 的 `CharacterAura`，
 * 存 `.qmai/character-aura.json`）。**不是**作品灵魂
 * （`soul-doc.ts` / `project-soul-style-store.ts` 的 `contextPack.soulDoc`）——
 * 两者是同名的两套东西，别把它们读成一条通道。
 */
import type { ReferenceToken, SkillSubtype } from "./types"

export const SOUL_SKILL_SUBTYPE: SkillSubtype = "soul"

/**
 * 按引用顺序取出被点名的角色灵魂 id（去重，同一个灵魂被引用两次只算一条）。
 *
 * 只认 `skillSubtype === "soul"` 的 token：别的子类型（去AI味 / 写作Skill / 文风）
 * 也带 `skillId`，混进来就会把某个技能 id 或文风预设 id 当成 aura id，
 * 进而去 `bindCharacterAura` —— 那会以
 * `CHARACTER_AURA_INVALID_AURA_MESSAGE` 拒绝，但拒绝本身就是一次误报。
 *
 * ⚠️ 这里**不**判「这条灵魂是否还存在」，那是 `bindCharacterAura` 的职责
 * （见 `character-aura.ts` 的 aura 存在性校验）。本函数只做引用 → id 的解析。
 */
export function collectReferencedSoulAuraIds(tokens: readonly ReferenceToken[]): string[] {
  const auraIds: string[] = []
  for (const token of tokens) {
    if (token.skillSubtype !== SOUL_SKILL_SUBTYPE) continue
    const auraId = token.skillId?.trim()
    if (!auraId) continue
    if (!auraIds.includes(auraId)) auraIds.push(auraId)
  }
  return auraIds
}
