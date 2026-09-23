import { describe, expect, it } from "vitest"
import {
  INTEGRATED_DNA_CHAR_LIMIT,
  WRITING_DNA_LAYERS,
  emptyWritingDnaLayers,
  isWritingDnaProfile,
  migrateStyleProfile,
  needsReextraction,
} from "./style-profile-schema"
import { computeStyleMetrics } from "./style-metrics"
import type { BookStyleProfile } from "./types"

function v1Profile(overrides: Partial<BookStyleProfile> = {}): BookStyleProfile {
  return {
    schemaVersion: 1,
    generatedAt: 1,
    sampledChapterIds: ["ch-0001"],
    narrativeDensity: "推进快",
    sentenceStyle: "短句为主",
    rhetoricDensity: "比喻少",
    dialogueStyle: "口语毛边",
    transitionStyle: "直接跳时间",
    descriptionWeight: "描写克制",
    emotionRendering: "动作外显",
    thematicHabits: "不点题",
    narrativeVoice: "冷静叙述者",
    pointOfView: "第三人称限知",
    vocabularyPreferences: ["回头", "愣住"],
    avoidPatterns: ["长比喻链"],
    humorMechanisms: ["补刀"],
    highEnergyMechanisms: ["抬压"],
    constitution: "1. 朴素\n2. 克制",
    samples: ["片段一"],
    ...overrides,
  }
}

describe("WRITING_DNA_LAYERS", () => {
  it("四层齐全且文件名唯一", () => {
    expect(WRITING_DNA_LAYERS).toHaveLength(4)
    const keys = WRITING_DNA_LAYERS.map((item) => item.key)
    expect(new Set(keys).size).toBe(4)
    expect(new Set(WRITING_DNA_LAYERS.map((item) => item.fileName)).size).toBe(4)
    expect(keys).toEqual(Object.keys(emptyWritingDnaLayers()))
  })

  it("整合文档上限沿用 writing-dna-skill 的 4000 字标准", () => {
    expect(INTEGRATED_DNA_CHAR_LIMIT).toBe(4000)
  })
})

describe("migrateStyleProfile", () => {
  it("把 v1 的 9 个维度按层归类，不丢内容", () => {
    const migrated = migrateStyleProfile(v1Profile())

    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.layers?.languageDna).toContain("推进快")
    expect(migrated.layers?.languageDna).toContain("短句为主")
    expect(migrated.layers?.languageDna).toContain("比喻少")
    expect(migrated.layers?.languageDna).toContain("口语毛边")
    expect(migrated.layers?.languageDna).toContain("回头、愣住")
    expect(migrated.layers?.structurePatterns).toContain("直接跳时间")
    expect(migrated.layers?.structurePatterns).toContain("描写克制")
    expect(migrated.layers?.structurePatterns).toContain("长比喻链")
    expect(migrated.layers?.cognitiveFrame).toContain("冷静叙述者")
    expect(migrated.layers?.cognitiveFrame).toContain("第三人称限知")
    expect(migrated.layers?.cognitiveFrame).toContain("补刀")
  })

  it("v1 没有 L6 对应维度，rhythmGuide 留空而不是编造", () => {
    expect(migrateStyleProfile(v1Profile()).layers?.rhythmGuide).toBe("")
  })

  it("保留 constitution、samples 与章节 id", () => {
    const migrated = migrateStyleProfile(v1Profile())
    expect(migrated.constitution).toBe("1. 朴素\n2. 克制")
    expect(migrated.samples).toEqual(["片段一"])
    expect(migrated.sampledChapterIds).toEqual(["ch-0001"])
  })

  it("v1 迁移后 integratedDna 仍为空", () => {
    expect(migrateStyleProfile(v1Profile()).integratedDna).toBe("")
  })

  it("已有 layers 的 v2 数据不被 9 维覆盖", () => {
    const migrated = migrateStyleProfile(v1Profile({
      schemaVersion: 2,
      layers: {
        languageDna: "已有的 L1",
        structurePatterns: "已有的 L2",
        cognitiveFrame: "已有的 L3",
        rhythmGuide: "已有的 L6",
      },
      integratedDna: "整合文档",
    }))

    expect(migrated.layers?.languageDna).toBe("已有的 L1")
    expect(migrated.layers?.rhythmGuide).toBe("已有的 L6")
    expect(migrated.integratedDna).toBe("整合文档")
  })

  it("部分 layers 缺字段时补齐为空串", () => {
    const migrated = migrateStyleProfile(v1Profile({
      layers: { languageDna: "只有 L1" } as never,
    }))
    expect(migrated.layers?.languageDna).toBe("只有 L1")
    expect(migrated.layers?.structurePatterns).toBe("")
  })

  it("缺 metrics 时补一个空统计而不是 undefined", () => {
    const migrated = migrateStyleProfile(v1Profile())
    expect(migrated.metrics?.counts.chapters).toBe(0)
  })

  it("字段类型异常时不抛错", () => {
    const migrated = migrateStyleProfile({
      ...v1Profile(),
      samples: undefined as never,
      sampledChapterIds: undefined as never,
      constitution: undefined as never,
    })
    expect(migrated.samples).toEqual([])
    expect(migrated.sampledChapterIds).toEqual([])
    expect(migrated.constitution).toBe("")
  })
})

describe("isWritingDnaProfile", () => {
  it("有整合文档即视为 v2", () => {
    expect(isWritingDnaProfile(v1Profile({ integratedDna: "整合" }))).toBe(true)
  })

  it("任一层非空即视为 v2", () => {
    expect(isWritingDnaProfile(v1Profile({
      layers: { ...emptyWritingDnaLayers(), rhythmGuide: "一句一段" },
    }))).toBe(true)
  })

  it("纯 v1 数据返回 false", () => {
    expect(isWritingDnaProfile(v1Profile())).toBe(false)
  })

  it("layers 全空返回 false", () => {
    expect(isWritingDnaProfile(v1Profile({ layers: emptyWritingDnaLayers() }))).toBe(false)
  })

  it("空值安全", () => {
    expect(isWritingDnaProfile(null)).toBe(false)
    expect(isWritingDnaProfile(undefined)).toBe(false)
  })
})

describe("needsReextraction", () => {
  it("v1 迁移产物需要重新提取", () => {
    expect(needsReextraction(migrateStyleProfile(v1Profile()))).toBe(true)
  })

  it("有分层但统计为空仍需重新提取", () => {
    expect(needsReextraction(v1Profile({
      integratedDna: "整合",
      metrics: computeStyleMetrics([]),
    }))).toBe(true)
  })

  it("分层与统计齐全时不需要重新提取", () => {
    expect(needsReextraction(v1Profile({
      integratedDna: "整合",
      metrics: computeStyleMetrics(["他走了。"]),
    }))).toBe(false)
  })

  it("没有画像时返回 false（而不是催用户重提取一个不存在的东西）", () => {
    expect(needsReextraction(null)).toBe(false)
  })
})
