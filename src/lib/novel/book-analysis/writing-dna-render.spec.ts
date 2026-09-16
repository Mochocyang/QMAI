import { describe, expect, it } from "vitest"
import type { ChapterMetaEntry } from "./chapter-meta"
import { computeStyleMetrics } from "./style-metrics"
import { INTEGRATED_DNA_CHAR_LIMIT, WRITING_DNA_LAYERS } from "./style-profile-schema"
import type { BookStyleProfile } from "./types"
import { renderIntegratedDna, renderWritingDnaFiles, styleProfileToMarkdown } from "./writing-dna-render"

function profile(overrides: Partial<BookStyleProfile> = {}): BookStyleProfile {
  return {
    schemaVersion: 2,
    generatedAt: 1,
    sampledChapterIds: ["ch-0001", "ch-0002"],
    metrics: computeStyleMetrics(["他走了。她没动。\n\n“别过来。”"]),
    layers: {
      languageDna: "短句为主。",
      structurePatterns: "推进章骨架。",
      cognitiveFrame: "能一句带过就不展开。",
      rhythmGuide: "一句一段用于转折。",
    },
    integratedDna: "## 语言特征\n短句为主。",
    constitution: "1. 环境描写不超过 2 句。",
    samples: ["片段一"],
    transitionStyle: "直接跳时间",
    narrativeVoice: "冷静叙述者",
    humorMechanisms: ["补刀"],
    vocabularyPreferences: ["回头"],
    avoidPatterns: ["长比喻链"],
    ...overrides,
  }
}

const chapterMeta: ChapterMetaEntry[] = [{
  chapterId: "ch-0001", order: 1, title: "试炼", wordCount: 900,
  hookType: "冲突式", structurePattern: "冲突章", sceneCount: 2,
  topicTags: ["宗门试炼"], dialogueRatio: 0.4, updatedAt: 1,
}]

describe("renderWritingDnaFiles", () => {
  it("产出整合文档与四份分层产物", () => {
    const files = renderWritingDnaFiles(profile(), "凡人修仙传", chapterMeta)
    expect(files.map((file) => file.fileName)).toEqual([
      "Writing-DNA.md",
      ...WRITING_DNA_LAYERS.map((layer) => layer.fileName),
    ])
  })

  it("语言DNA.md 含统计表、词汇偏好与禁用写法", () => {
    const content = renderWritingDnaFiles(profile(), "书", chapterMeta)
      .find((file) => file.fileName === "语言DNA.md")!.content
    expect(content).toContain("短句为主。")
    expect(content).toContain("| 指标 | 数值 |")
    expect(content).toContain("平均句长")
    expect(content).toContain("回头")
    expect(content).toContain("长比喻链")
  })

  it("章节结构模板.md 含分项说明与章节标注表", () => {
    const content = renderWritingDnaFiles(profile(), "书", chapterMeta)
      .find((file) => file.fileName === "章节结构模板.md")!.content
    expect(content).toContain("推进章骨架。")
    expect(content).toContain("直接跳时间")
    expect(content).toContain("ch-0001")
    expect(content).toContain("宗门试炼")
  })

  it("认知框架文件含视角说明与幽默机制", () => {
    const content = renderWritingDnaFiles(profile(), "书", chapterMeta)
      .find((file) => file.fileName === "叙事视角与认知框架.md")!.content
    expect(content).toContain("能一句带过就不展开。")
    expect(content).toContain("冷静叙述者")
    expect(content).toContain("补刀")
  })

  it("排版节奏指南含节奏统计", () => {
    const content = renderWritingDnaFiles(profile(), "书", chapterMeta)
      .find((file) => file.fileName === "排版节奏指南.md")!.content
    expect(content).toContain("一句一段用于转折。")
    expect(content).toContain("一句一段占比")
  })

  it("某层缺失时写占位提示而不是空文件", () => {
    const content = renderWritingDnaFiles(
      profile({ layers: { languageDna: "", structurePatterns: "", cognitiveFrame: "", rhythmGuide: "" } }),
      "书",
    ).find((file) => file.fileName === "语言DNA.md")!.content
    expect(content).toContain("请重新运行文风提取")
  })

  it("没有章节标注时给出占位而不是空表", () => {
    const content = renderWritingDnaFiles(profile(), "书")
      .find((file) => file.fileName === "章节结构模板.md")!.content
    expect(content).toContain("（无章节标注）")
  })

  it("统计缺失时不抛错", () => {
    const files = renderWritingDnaFiles(profile({ metrics: undefined }), "书")
    expect(files.find((file) => file.fileName === "语言DNA.md")!.content).toContain("（无统计数据）")
    expect(files.find((file) => file.fileName === "排版节奏指南.md")!.content).toContain("（无统计数据）")
  })
})

describe("renderIntegratedDna", () => {
  it("带文件头、样本数与整合正文", () => {
    const content = renderIntegratedDna(profile(), "凡人修仙传")
    expect(content).toContain("《凡人修仙传》Writing DNA")
    expect(content).toContain("2 章样本")
    expect(content).toContain("## 语言特征")
    expect(content).toContain("片段一")
  })

  it("超过字数上限时提醒重新提取", () => {
    const content = renderIntegratedDna(
      profile({ integratedDna: "字".repeat(INTEGRATED_DNA_CHAR_LIMIT + 1) }),
      "书",
    )
    expect(content).toContain(`超过 ${INTEGRATED_DNA_CHAR_LIMIT} 字上限`)
  })

  it("没有整合文档时降级展示硬约束", () => {
    const content = renderIntegratedDna(profile({ integratedDna: "" }), "书")
    expect(content).toContain("未生成整合文档")
    expect(content).toContain("环境描写不超过 2 句")
  })
})

describe("styleProfileToMarkdown", () => {
  it("style.md 含整合正文与分层产物索引", () => {
    const content = styleProfileToMarkdown(profile(), "书")
    expect(content).toContain("## 语言特征")
    expect(content).toContain("## 分层产物")
    for (const layer of WRITING_DNA_LAYERS) {
      expect(content).toContain(`./${layer.fileName}`)
    }
  })

  it("v1 迁移产物提示重新提取", () => {
    const content = styleProfileToMarkdown(
      profile({
        integratedDna: "",
        layers: { languageDna: "", structurePatterns: "", cognitiveFrame: "", rhythmGuide: "" },
      }),
      "书",
    )
    expect(content).toContain("建议重新提取文风")
  })
})
