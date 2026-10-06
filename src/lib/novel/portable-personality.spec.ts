import { describe, expect, it } from "vitest"
import {
  parsePortablePersonality, renderPersonalityRules, renderPersonalitySkill,
  readPersonalitySkill, personalityFields,
} from "./portable-personality"

import { personality } from "@/test-helpers/portable-personality-fixture"

describe("可迁移人格规则", () => {
  it("正文规则不携带职业、来源证据和原作身份", () => {
    const parsed = parsePortablePersonality(personality)
    const text = renderPersonalityRules(parsed)
    expect(text).toContain("R1")
    expect(text).toContain("允许试探")
    expect(text).not.toContain("警察")
    expect(text).not.toContain("盘缠")
    expect(personalityFields(parsed).mentalModel).toContain("不能直接定罪")
    expect(personalityFields(parsed).expressionDna).toContain("嘴硬")
  })
  it("结构化规则能从Skill完整恢复，YAML特殊字符不会损坏元数据", () => {
    const profile = parsePortablePersonality(personality)
    const skill = renderPersonalitySkill("某人: 青年", "书名: 初章", profile)
    expect(readPersonalitySkill(skill)).toEqual(profile)
  })
  it("旧Skill保持兼容，新格式损坏时明确拒绝，不能降级为无约束", () => {
    expect(readPersonalitySkill("# 旧角色\n沉稳")).toBeUndefined()
    expect(() => readPersonalitySkill("---\nportablePersonality: {}\n---\n")).toThrow("人格")
    expect(() => parsePortablePersonality({ ...personality, rules: [] })).toThrow("人格")
    expect(() => parsePortablePersonality({
      ...personality, rules: [{ ...personality.rules[0], evidenceIds: ["missing"] }],
    })).toThrow("证据")
  })
})
