import { describe, expect, it } from "vitest"
import {
  filterUserSkills,
  normalizeUserSkill,
  type UserSkill,
} from "./skill-library"
import { deAiSkillToUserSkill } from "./de-ai-skill-library"

describe("generic skill library", () => {
  it("normalizes a structure planning skill such as 三翻四抖", () => {
    const skill = normalizeUserSkill({
      id: "project:three-turns-four-reveals",
      name: "三翻四抖",
      description: "三次转折，四次震惊。",
      kind: ["structure", "planning", "structure"],
      stages: ["planning", "review"],
      modes: ["standard", "strict"],
      content: "每章设置三次局势变化和四次信息冲击。",
      source: "uploaded",
    })

    expect(skill).toMatchObject({
      id: "project:three-turns-four-reveals",
      name: "三翻四抖",
      kind: ["structure", "planning"],
      stages: ["planning", "review"],
      modes: ["standard", "strict"],
      source: "uploaded",
    })
  })

  it("converts legacy de-AI skills into generic style skills", () => {
    const skill = deAiSkillToUserSkill({
      id: "built-in:comprehensive",
      name: "综合去AI味",
      description: "减少 AI 味。",
      templateId: "comprehensive",
      content: "只输出正文。",
      source: "built-in",
    })

    expect(skill).toMatchObject({
      id: "built-in:comprehensive",
      name: "综合去AI味",
      kind: ["style"],
      stages: ["rewrite", "output"],
      modes: ["fast", "standard", "strict"],
      source: "built-in",
    })
  })

  it("filters skills by mode and stage without forcing every skill into context", () => {
    const skills: UserSkill[] = [
      normalizeUserSkill({
        id: "s1",
        name: "正文输出协议",
        description: "",
        kind: ["output"],
        stages: ["output"],
        modes: ["fast", "standard", "strict"],
        content: "只输出正文。",
        source: "built-in",
      }),
      normalizeUserSkill({
        id: "s2",
        name: "伏笔管理",
        description: "",
        kind: ["structure"],
        stages: ["planning", "review"],
        modes: ["strict"],
        content: "检查伏笔推进。",
        source: "built-in",
      }),
    ]

    expect(filterUserSkills(skills, { mode: "fast", stage: "output" }).map((skill) => skill.id)).toEqual(["s1"])
    expect(filterUserSkills(skills, { mode: "strict", stage: "planning" }).map((skill) => skill.id)).toEqual(["s2"])
  })
})
