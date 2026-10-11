/**
 * 丁-3 输入框引用：`@` 一条文风 → 本次生成的文风覆盖 id。
 *
 * 这个文件钉住两件事：
 * 1. 解析口径（顺序 / 去重 / 只认文风子类型 / 空 id 忽略）；
 * 2. **产出端与消费端的接口**：`createSkillProvider` 吐出来的文风条目，
 *    必须能被 `collectReferencedStylePresetIds` 原样读回。
 *    ⚠️ 这一条是必须的：两边分居 UI 两侧，任何一侧换字段都不会有编译错误，
 *    只会静默变成「弹窗里有条目、生成时没有任何覆盖」。
 */
import { describe, expect, it } from "vitest"
import { createSkillProvider } from "./providers"
import { collectReferencedStylePresetIds, STYLE_SKILL_SUBTYPE } from "./style-reference"
import type { ReferenceToken } from "./types"
import { collectExplicitSkills } from "@/lib/novel/skill-route-registry"

function styleToken(id: string, skillId: string, skillSubtype: string = "style"): ReferenceToken {
  return {
    id,
    category: "skill",
    title: `预设-${skillId}`,
    skillId,
    skillSubtype: skillSubtype as ReferenceToken["skillSubtype"],
    displayTitle: `预设-${skillId}`,
  }
}

describe("collectReferencedStylePresetIds", () => {
  it("没有引用时返回空数组（= 没有覆盖，跟着工具栏选择器走）", () => {
    expect(collectReferencedStylePresetIds([])).toEqual([])
  })

  it("取出一条文风引用的预设 id", () => {
    expect(collectReferencedStylePresetIds([styleToken("ref-1", "style-a")])).toEqual(["style-a"])
  })

  it("按引用顺序返回，且同一个预设被引用两次只算一条", () => {
    expect(collectReferencedStylePresetIds([
      styleToken("ref-2", "style-b"),
      styleToken("ref-1", "style-a"),
      styleToken("ref-3", "style-b"),
    ])).toEqual(["style-b", "style-a"])
  })

  it("忽略非文风子类型的技能引用（它们的 skillId 是技能 id，不是预设 id）", () => {
    expect(collectReferencedStylePresetIds([
      styleToken("ref-deai", "deai-1", "deai"),
      styleToken("ref-writing", "writing-1", "writing"),
      { id: "ref-chapter", category: "chapter", title: "第一章", displayTitle: "第一章", path: "wiki/chapters/1.md" },
      styleToken("ref-style", "style-a"),
    ])).toEqual(["style-a"])
  })

  it("忽略缺 id 或 id 只有空白的文风条目", () => {
    const missingId: ReferenceToken = {
      id: "ref-no-id",
      category: "skill",
      title: "没有 id 的文风",
      skillSubtype: "style",
      displayTitle: "没有 id 的文风",
    }
    expect(collectReferencedStylePresetIds([missingId, styleToken("ref-blank", "   ")])).toEqual([])
  })

  it("去掉 id 两侧空白", () => {
    expect(collectReferencedStylePresetIds([styleToken("ref-1", "  style-a  ")])).toEqual(["style-a"])
  })

  /*
   * 产出端 ↔ 消费端的接口契约。
   * 改了 chat-panel 里文风条目的字段（或者 providers.ts 的透传），这条会红。
   */
  it("引用弹窗 provider 吐出的文风条目能被消费端原样读回", async () => {
    const provider = createSkillProvider(() => [
      { id: "style-a", name: "甲书 · 文风", subtype: STYLE_SKILL_SUBTYPE },
      { id: "skill-1", name: "combat-action", subtype: "writing" },
    ])

    const items = await provider.fetchItems("C:/Novel")
    const styleItem = items.find((item) => item.skillSubtype === STYLE_SKILL_SUBTYPE)

    expect(styleItem, "provider 必须为文风条目打上 style 子类型").toBeDefined()
    expect(styleItem?.skillId, "预设 id 必须落在 token.skillId 上").toBe("style-a")
    expect(collectReferencedStylePresetIds(items)).toEqual(["style-a"])
  })

  /*
   * 反面：文风引用**不得**顺带启用任何技能。
   * `resolveSkillReference` 见到 id 就直接按 id 查、不再回退按标题匹配，
   * 所以预设 id 在技能池里查不到 ⇒ 什么都不加。
   * ⚠️ 这条挡的是「文风引用按 skillId 被当成技能 id 消费」，且**真有同名技能**时也不许被选中。
   *
   * ⚠️ 覆盖范围的诚实说明：这里 `plainText` 传的是空串，所以走的是
   * `collectExplicitSkills` 的**引用**分支；它的**文本子串**分支（用户在正文里打出技能名）
   * 这两条断言都没碰到。那与本改动无关（文本路径不读引用 token），
   * 这里只是不假装覆盖了它。
   */
  it("文风引用不会启用同名技能", () => {
    const skills = [{ id: "skill-1", name: "甲书 · 文风" }]

    expect(
      collectExplicitSkills(skills, "", [{ skillId: "style-a", title: "甲书 · 文风" }]),
      "文风引用的标题与技能名相同也不许命中技能",
    ).toEqual([])
    // 对照：同一条引用按技能 id 给出时才会命中（证明上面不是「整体不生效」的假绿）
    expect(collectExplicitSkills(skills, "", [{ skillId: "skill-1", title: "甲书 · 文风" }])).toHaveLength(1)
  })
})
