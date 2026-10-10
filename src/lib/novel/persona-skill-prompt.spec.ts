import { describe, expect, it } from "vitest"
import {
  PERSONA_SKILL_BODY_HEAD_CHARS,
  PERSONA_SKILL_BODY_TAIL_CHARS,
  buildPersonaSkillBody,
  buildPersonaSkillMessages,
  buildPersonaSkillResearchMessages,
  buildPersonaSkillUserPrompt,
  type PersonaSkillPromptTarget,
} from "./persona-skill-prompt"

function target(overrides: Partial<PersonaSkillPromptTarget> = {}): PersonaSkillPromptTarget {
  return {
    characterName: "林清越",
    aliases: [],
    roleType: "男主",
    tier: "major",
    mode: "create",
    pinned: false,
    withResearch: false,
    appearanceCount: 1,
    ...overrides,
  }
}

describe("buildPersonaSkillBody", () => {
  it("预算内不改动正文，只归一化首尾空白", () => {
    // 正文来自 markdown 解析，首尾常带换行 —— 归一化是想要的行为。
    expect(buildPersonaSkillBody("他推开门。")).toBe("他推开门。")
    expect(buildPersonaSkillBody("\n\n他推开门。\n")).toBe("他推开门。")
    // ⚠️ JS 的 String.prototype.trim() 按规范剥掉所有 WhiteSpace，**包含 U+3000 表意空格**，
    // 所以中文段首缩进也会被去掉。这是有意保留的行为（缩进是排版、不是内容，对模型无意义）。
    // 不要把这条改回「原样保留缩进」——它与 .trim() 逻辑上不相容。
    expect(buildPersonaSkillBody("　　他推开门。")).toBe("他推开门。")
  })

  it("超出预算时留开头 + 省略标记 + 结尾", () => {
    const body = "甲".repeat(PERSONA_SKILL_BODY_HEAD_CHARS + PERSONA_SKILL_BODY_TAIL_CHARS + 100)
    const result = buildPersonaSkillBody(body)
    expect(result.startsWith("甲".repeat(PERSONA_SKILL_BODY_HEAD_CHARS))).toBe(true)
    expect(result.endsWith("甲".repeat(PERSONA_SKILL_BODY_TAIL_CHARS))).toBe(true)
    expect(result).toContain("省略")
    expect(result.length).toBeLessThan(body.length)
  })
})

describe("buildPersonaSkillMessages", () => {
  it("system 里写清 JSON 契约", () => {
    const messages = buildPersonaSkillMessages({ chapterNumber: 1, chapterBody: "正文", targets: [target()] })
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe("system")
    expect(messages[0].content).toContain('"skills"')
    expect(messages[0].content).toContain("只输出 JSON")
  })

  it("五个人物合成一条 user 消息，不是五条", () => {
    const names = ["甲", "乙", "丙", "丁", "戊"]
    const messages = buildPersonaSkillMessages({
      chapterNumber: 3,
      chapterBody: "第三章正文",
      targets: names.map((name) => target({ characterName: name })),
    })
    expect(messages).toHaveLength(2)
    expect(messages[1].content).toContain("本章要处理的人物：5 位")
    for (const name of names) expect(messages[1].content).toContain(`### ${name}`)
  })

  it("主要人物列全 7 个字段", () => {
    const messages = buildPersonaSkillMessages({ chapterNumber: 1, chapterBody: "正文", targets: [target()] })
    for (const field of ["怎么说话", "怎么判断", "在意什么", "底线与逆鳞", "关系网", "语言标记", "成长轨迹"]) {
      expect(messages[1].content).toContain(field)
    }
  })

  it("次要人物只要 2 个字段，不出现其余字段名", () => {
    const messages = buildPersonaSkillMessages({
      chapterNumber: 1,
      chapterBody: "正文",
      targets: [target({ tier: "minor", roleType: "配角", mode: "refine" })],
    })
    expect(messages[1].content).toContain("怎么说话 / 怎么判断")
    expect(messages[1].content).not.toContain("成长轨迹")
    expect(messages[1].content).not.toContain("底线与逆鳞")
  })

  it("绿勾人物才要求研究文件", () => {
    const plain = buildPersonaSkillMessages({ chapterNumber: 1, chapterBody: "正文", targets: [target()] })
    expect(plain[1].content).not.toContain("人物小传")

    const pinned = buildPersonaSkillMessages({
      chapterNumber: 1,
      chapterBody: "正文",
      targets: [target({ pinned: true, withResearch: true })],
    })
    expect(pinned[1].content).toContain("人物小传")
    expect(pinned[1].content).toContain("名场面")
  })

  it("pinned 但本轮不需要研究文件时不要求 research（已有研究文件的不重复生成）", () => {
    const prompt = buildPersonaSkillUserPrompt({
      chapterNumber: 3,
      chapterBody: "第三章正文",
      targets: [
        {
          characterName: "沈砚",
          aliases: [],
          roleType: "配角",
          tier: "major",
          mode: "refine",
          pinned: true,
          withResearch: false,
          appearanceCount: 3,
        },
      ],
    })
    expect(prompt).not.toContain("需要研究文件")
    expect(prompt).toContain("用户手动标记的重要人物")
  })

  it("已有档案原文进 user 消息，并标明是补充而不是重写", () => {
    const messages = buildPersonaSkillMessages({
      chapterNumber: 5,
      chapterBody: "正文",
      targets: [target({ mode: "refine", existingSkill: "## 怎么说话\n\n句子很短。" })],
    })
    expect(messages[1].content).toContain("句子很短。")
    expect(messages[1].content).toContain("不要重写")
    expect(messages[1].content).toContain("在已有档案上补本章新增信息")
  })

  it("别名进 user 消息", () => {
    const messages = buildPersonaSkillMessages({
      chapterNumber: 1,
      chapterBody: "正文",
      targets: [target({ aliases: ["清越", "林公子"] })],
    })
    expect(messages[1].content).toContain("清越、林公子")
  })
})

describe("buildPersonaSkillResearchMessages", () => {
  it("强调只能依据既有档案，禁止引入新事实", () => {
    const messages = buildPersonaSkillResearchMessages({
      characterName: "林清越",
      roleType: "男主",
      document: "# 林清越\n\n## 怎么说话\n\n句子短。",
    })
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toContain("禁止引入")
    expect(messages[0].content).toContain('"research"')
    expect(messages[1].content).toContain("句子短。")
    expect(messages[1].content).toContain("林清越")
  })
})
