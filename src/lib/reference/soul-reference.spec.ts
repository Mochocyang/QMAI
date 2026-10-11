/**
 * 丁-4 输入框引用：`@` 一条角色灵魂 → 本条消息要临时绑定的 aura id。
 *
 * 这个文件钉住两件事：
 * 1. 解析口径（顺序 / 去重 / 只认灵魂子类型 / 空 id 忽略）；
 * 2. **产出端与消费端的接口**：`createSkillProvider` 吐出来的灵魂条目，
 *    必须能被 `collectReferencedSoulAuraIds` 原样读回。
 *    ⚠️ 这一条是必须的：两边分居 UI 两侧，任何一侧换字段都不会有编译错误，
 *    只会静默变成「弹窗里有条目、生成时什么都没绑」。
 */
import { describe, expect, it } from "vitest"
import { createSkillProvider } from "./providers"
import { collectReferencedSoulAuraIds, SOUL_SKILL_SUBTYPE } from "./soul-reference"
import type { ReferenceToken } from "./types"
import { collectExplicitSkills } from "@/lib/novel/skill-route-registry"

function soulToken(id: string, skillId: string, skillSubtype: string = "soul"): ReferenceToken {
  return {
    id,
    category: "skill",
    title: `灵魂-${skillId}`,
    skillId,
    skillSubtype: skillSubtype as ReferenceToken["skillSubtype"],
    displayTitle: `灵魂-${skillId}`,
  }
}

describe("collectReferencedSoulAuraIds", () => {
  it("没有引用时返回空数组（= 本条消息不绑定任何灵魂）", () => {
    expect(collectReferencedSoulAuraIds([])).toEqual([])
  })

  it("取出一条灵魂引用的 aura id", () => {
    expect(collectReferencedSoulAuraIds([soulToken("ref-1", "builtin-li-qingzhao")]))
      .toEqual(["builtin-li-qingzhao"])
  })

  it("按引用顺序返回，且同一个灵魂被引用两次只算一条", () => {
    expect(collectReferencedSoulAuraIds([
      soulToken("ref-2", "custom-b"),
      soulToken("ref-1", "custom-a"),
      soulToken("ref-3", "custom-b"),
    ])).toEqual(["custom-b", "custom-a"])
  })

  it("忽略其它子类型的技能引用（它们的 skillId 是技能 id / 文风预设 id，不是 aura id）", () => {
    expect(collectReferencedSoulAuraIds([
      soulToken("ref-deai", "deai-1", "deai"),
      soulToken("ref-writing", "writing-1", "writing"),
      soulToken("ref-style", "preset-cool", "style"),
      { id: "ref-chapter", category: "chapter", title: "第一章", displayTitle: "第一章", path: "wiki/chapters/1.md" },
      soulToken("ref-soul", "custom-a"),
    ])).toEqual(["custom-a"])
  })

  it("忽略缺 id 或 id 只有空白的灵魂条目", () => {
    const missingId: ReferenceToken = {
      id: "ref-no-id",
      category: "skill",
      title: "没有 id 的灵魂",
      skillSubtype: "soul",
      displayTitle: "没有 id 的灵魂",
    }
    expect(collectReferencedSoulAuraIds([missingId, soulToken("ref-blank", "   ")])).toEqual([])
  })

  it("去掉 id 两侧空白", () => {
    expect(collectReferencedSoulAuraIds([soulToken("ref-1", "  custom-a  ")])).toEqual(["custom-a"])
  })

  /*
   * 产出端 ↔ 消费端的接口契约。
   * 改了 chat-panel / outline-chat-panel 里灵魂条目的字段（或者 providers.ts 的透传），
   * 这条会红。
   */
  it("引用弹窗 provider 吐出的灵魂条目能被消费端原样读回", async () => {
    const provider = createSkillProvider(() => [
      { id: "custom-a", name: "甲书 · 许七安", subtype: SOUL_SKILL_SUBTYPE },
      { id: "skill-1", name: "combat-action", subtype: "writing" },
    ])

    const items = await provider.fetchItems("C:/Novel")
    const soulItem = items.find((item) => item.skillSubtype === SOUL_SKILL_SUBTYPE)

    expect(soulItem, "provider 必须为灵魂条目打上 soul 子类型").toBeDefined()
    expect(soulItem?.skillId, "aura id 必须落在 token.skillId 上").toBe("custom-a")
    expect(collectReferencedSoulAuraIds(items)).toEqual(["custom-a"])
  })

  /*
   * 反面：灵魂引用**不得**顺带启用任何技能。
   * `resolveSkillReference` 见到 id 就直接按 id 查、不再回退按标题匹配，
   * 所以 aura id 在技能池里查不到 ⇒ 什么都不加。
   * ⚠️ 这条挡的是「灵魂条目被当成技能条目消费」：真有同名技能时也不许被选中。
   */
  it("灵魂引用不会启用同名技能", () => {
    const skills = [{ id: "skill-1", name: "甲书 · 许七安" }]

    expect(
      collectExplicitSkills(skills, "", [{ skillId: "custom-a", title: "甲书 · 许七安" }]),
      "灵魂引用的标题与技能名相同也不许命中技能",
    ).toEqual([])
    // 对照：同一条引用按技能 id 给出时才会命中（证明上面不是「整体不生效」的假绿）
    expect(collectExplicitSkills(skills, "", [{ skillId: "skill-1", title: "甲书 · 许七安" }])).toHaveLength(1)
  })
})
