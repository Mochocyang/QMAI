import { describe, expect, it } from "vitest"
import { normalizeUserSkill } from "./skill-library"
import {
  DEFAULT_SKILL_ROUTE_CATEGORIES,
  filterSkillsForSkillRoute,
  inferSkillRoute,
  isFanficTopicText,
  resolveOutlineTopicSkillRoutes,
  SKILL_ROUTE_CATEGORY_IDS,
} from "./skill-route"

describe("skill-route", () => {
  it("defines the default skill folders used by writing and outline routing", () => {
    expect(DEFAULT_SKILL_ROUTE_CATEGORIES.map((category) => category.name)).toEqual([
      "正文",
      "大纲",
      "设定",
      "角色",
      "世界观",
      "势力",
      "伏笔",
      "地图",
      "题材",
    ])
  })

  it("prefers explicit category folders when resolving a skill route", () => {
    const skill = normalizeUserSkill({
      id: "skill:outline",
      name: "正文输出协议",
      kind: ["output"],
      stages: ["output"],
      modes: ["standard", "strict"],
      content: "只输出正文",
      categoryId: SKILL_ROUTE_CATEGORY_IDS.outline,
    })

    expect(inferSkillRoute(skill)).toBe("outline")
  })

  it("filters skills by route and excludes skills from other folders", () => {
    const outlineSkill = normalizeUserSkill({
      id: "skill:outline",
      name: "章纲结构",
      kind: ["planning"],
      stages: ["planning"],
      modes: ["standard", "strict"],
      content: "生成章纲",
      categoryId: SKILL_ROUTE_CATEGORY_IDS.outline,
    })
    const writingSkill = normalizeUserSkill({
      id: "skill:writing",
      name: "正文输出协议",
      kind: ["output"],
      stages: ["output"],
      modes: ["standard", "strict"],
      content: "只输出正文",
      categoryId: SKILL_ROUTE_CATEGORY_IDS.writing,
    })

    expect(filterSkillsForSkillRoute([outlineSkill, writingSkill], "outline")).toEqual([outlineSkill])
  })

  it("为不同频道和题材补充章纲生成 Skill 路由", () => {
    expect(resolveOutlineTopicSkillRoutes({ channel: "male", genre: "玄幻" })).toEqual(expect.arrayContaining([
      "outline",
      "topic",
      "worldbuilding",
      "setting",
      "faction",
      "map",
    ]))

    expect(resolveOutlineTopicSkillRoutes({ channel: "female", genre: "知乎短篇" })).toEqual(expect.arrayContaining([
      "outline",
      "topic",
      "character",
      "foreshadowing",
    ]))
  })

  it("同人题材额外补充角色、设定与伏笔路由", () => {
    expect(resolveOutlineTopicSkillRoutes({ channel: "male", genre: "同人" })).toEqual(expect.arrayContaining([
      "outline",
      "topic",
      "character",
      "setting",
      "foreshadowing",
    ]))
  })

  it("同人的关键词能覆盖二创、原作正典、AU/OOC/CP 与番外穿书", () => {
    for (const genre of ["二创", "衍生", "原作正典", "AU", "OOC", "CP", "番外", "穿书"]) {
      expect(resolveOutlineTopicSkillRoutes({ genre })).toContain("character")
    }
  })

  it("原创题材不会被误判为同人", () => {
    expect(isFanficTopicText("男频 玄幻 高武")).toBe(false)
    expect(isFanficTopicText("女频 现言 追妻")).toBe(false)
    expect(isFanficTopicText("短篇 知乎短篇")).toBe(false)
    expect(isFanficTopicText("同人 二创 衍生 原作正典 番外 穿书 AU OOC CP")).toBe(true)
  })

  it("玄幻题材仍然补齐世界观与势力路由，不受同人分支影响", () => {
    expect(resolveOutlineTopicSkillRoutes({ channel: "male", genre: "玄幻" }))
      .toEqual(expect.arrayContaining(["worldbuilding", "faction", "map"]))
  })
})
