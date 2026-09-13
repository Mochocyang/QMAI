import { describe, expect, it } from "vitest"
import {
  findOutlinePlanElementSpec,
  getOutlinePlanRequiredElements,
  resolveOutlinePlanModuleKind,
} from "./outline-plan-elements"
import { OUTLINE_SECTION_GENERATION_CONFIGS } from "./outline-section-configs"
import { VOLUME_OUTLINE_REQUIRED_FIELDS } from "./outline-templates"

describe("outline plan elements", () => {
  it("classifies modules into the four outline structure kinds", () => {
    expect(resolveOutlinePlanModuleKind("故事大纲")).toBe("story")
    expect(resolveOutlinePlanModuleKind("完整新书规划")).toBe("story")
    expect(resolveOutlinePlanModuleKind("卷纲")).toBe("volume")
    expect(resolveOutlinePlanModuleKind("章节细纲")).toBe("chapter")
    expect(resolveOutlinePlanModuleKind("章纲")).toBe("chapter")
    expect(resolveOutlinePlanModuleKind("人物小传")).toBe("section")
  })

  it("derives new book elements from the wizard sufficiency gate", () => {
    const keys = getOutlinePlanRequiredElements("故事大纲").map((spec) => spec.key)

    expect(keys).toEqual([
      "length",
      "channel",
      "genre",
      "inspiration",
      "sellingPoints",
      "scale",
      "characterDirection",
      "worldview",
      "chapterStructure",
    ])
  })

  it("derives volume elements from VOLUME_OUTLINE_REQUIRED_FIELDS", () => {
    const specs = getOutlinePlanRequiredElements("卷纲")

    expect(specs[0].key).toBe("volumeScope")
    expect(specs.slice(1).map((spec) => spec.label)).toEqual([
      ...VOLUME_OUTLINE_REQUIRED_FIELDS,
    ])
  })

  it("derives chapter elements from the chapter outline required sections", () => {
    const specs = getOutlinePlanRequiredElements("章节细纲")
    const keys = specs.map((spec) => spec.key)

    expect(keys).toContain("chapterRange")
    expect(keys).toContain("upstreamBasis")
    expect(keys).toContain("chapterGoal")
    expect(keys).toContain("coreEventDirection")
    expect(keys).toContain("sceneCount")
    expect(keys).toContain("openingHookType")
    expect(keys).toContain("endingHookType")
    expect(keys).toContain("foreshadowingState")
    expect(keys).toContain("wordCountTarget")
    expect(keys).toContain("pov")
    expect(keys).toContain("timeAnchor")
    expect(specs.find((spec) => spec.key === "chapterPosition")?.required).toBe(false)
  })

  it("derives section elements from the section generation config request hint", () => {
    const specs = getOutlinePlanRequiredElements("人物小传")
    const requirement = specs.find((spec) => spec.key === "moduleRequirement")
    const config = OUTLINE_SECTION_GENERATION_CONFIGS.find((item) => item.title === "人物小传")

    expect(requirement?.hint).toBe(config?.requestHint)
    expect(specs.some((spec) => spec.key === "itemPriority")).toBe(true)
  })

  it("omits item priority for single output sections", () => {
    const specs = getOutlinePlanRequiredElements("背景设定")

    expect(specs.some((spec) => spec.key === "itemPriority")).toBe(false)
  })

  it("covers every section generation config with a usable element list", () => {
    for (const config of OUTLINE_SECTION_GENERATION_CONFIGS) {
      const specs = getOutlinePlanRequiredElements(config.title)

      expect(specs.length).toBeGreaterThan(0)
      expect(specs.some((spec) => spec.required)).toBe(true)
    }
  })

  it("always offers at least three fallback options per element", () => {
    const modules = [
      "故事大纲",
      "卷纲",
      "章节细纲",
      ...OUTLINE_SECTION_GENERATION_CONFIGS.map((config) => config.title),
    ]

    for (const module of modules) {
      for (const spec of getOutlinePlanRequiredElements(module)) {
        expect(spec.fallbackOptions.length).toBeGreaterThanOrEqual(3)
        expect(new Set(spec.fallbackOptions).size).toBe(spec.fallbackOptions.length)
        expect(spec.label.trim()).not.toBe("")
        expect(spec.hint.trim()).not.toBe("")
      }
    }
  })

  it("finds element specs by key or by label", () => {
    const specs = getOutlinePlanRequiredElements("卷纲")

    expect(findOutlinePlanElementSpec(specs, "volumeScope")?.label).toBe("卷范围")
    expect(findOutlinePlanElementSpec(specs, "本卷目标")?.key).toBe("volume:本卷目标")
    expect(findOutlinePlanElementSpec(specs, "不存在")).toBeUndefined()
  })
})
