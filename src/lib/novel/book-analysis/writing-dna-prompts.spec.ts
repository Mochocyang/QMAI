import { describe, expect, it } from "vitest"
import { computeStyleMetrics } from "./style-metrics"
import {
  FALLBACK_STYLE_CONSTITUTION,
  buildCognitiveFramePrompt,
  buildDnaIntegrationPrompt,
  buildLanguageAndRhythmPrompt,
  buildLayerAggregatePrompt,
  buildStructurePatternPrompt,
  parseCognitiveFrameResult,
  parseIntegratedDnaResult,
  parseLanguageAndRhythmResult,
  parseLayerAggregateResult,
  parseStructurePatternResult,
  parseStyleEvidenceResult,
  stripConstitutionSection,
} from "./writing-dna-prompts"

const metrics = computeStyleMetrics(["他走了。她没动。\n\n“别过来。”"])

describe("buildLanguageAndRhythmPrompt", () => {
  it("带上书名、统计数字与原文样本", () => {
    const prompt = buildLanguageAndRhythmPrompt(metrics, "一段原文样本。", "凡人修仙传")
    expect(prompt).toContain("凡人修仙传")
    expect(prompt).toContain("脚本统计结果")
    expect(prompt).toContain("平均句长")
    expect(prompt).toContain("一段原文样本。")
    expect(prompt).toContain("languageDna")
    expect(prompt).toContain("rhythmGuide")
  })

  it("明确要求模型不要重新估算统计数字", () => {
    expect(buildLanguageAndRhythmPrompt(metrics, "样本", "书")).toContain("不要重新估算")
  })

  it("分词降级时把局限性写进 prompt", () => {
    const degraded = { ...metrics, segmenterAvailable: false }
    const prompt = buildLanguageAndRhythmPrompt(degraded, "样本", "书")
    expect(prompt).toContain("缺少中文分词能力")
    expect(prompt).toContain("说明其局限")
  })

  it("截断过长样本", () => {
    const prompt = buildLanguageAndRhythmPrompt(metrics, "字".repeat(30000), "书")
    expect(prompt).toContain("样本过长已截断")
  })
})

describe("parseLanguageAndRhythmResult", () => {
  it("解析干净的 JSON", () => {
    const raw = JSON.stringify({
      languageDna: "短句为主",
      rhythmGuide: "一句一段",
      sentenceStyle: "口语",
      vocabularyPreferences: ["回头", "愣住"],
      avoidPatterns: ["长比喻链"],
    })
    const result = parseLanguageAndRhythmResult(raw)
    expect(result.languageDna).toBe("短句为主")
    expect(result.rhythmGuide).toBe("一句一段")
    expect(result.vocabularyPreferences).toEqual(["回头", "愣住"])
    expect(result.avoidPatterns).toEqual(["长比喻链"])
  })

  it("剥掉 ```json 围栏", () => {
    const raw = "结果：\n```json\n" + JSON.stringify({ languageDna: "X" }) + "\n```"
    expect(parseLanguageAndRhythmResult(raw).languageDna).toBe("X")
  })

  it("前置含方括号的散文时仍能取到 JSON", () => {
    const raw = "我读了样本[第1章]，结果：" + JSON.stringify({ languageDna: "Y" })
    expect(parseLanguageAndRhythmResult(raw).languageDna).toBe("Y")
  })

  it("非 JSON 输出返回空值而不抛错", () => {
    const result = parseLanguageAndRhythmResult("这里没有 JSON")
    expect(result.languageDna).toBe("")
    expect(result.vocabularyPreferences).toEqual([])
  })
})

describe("buildStructurePatternPrompt / parseStructurePatternResult", () => {
  it("prompt 要求章节标注覆盖每一章", () => {
    const prompt = buildStructurePatternPrompt("样本", "书")
    expect(prompt).toContain("chapterMeta")
    expect(prompt).toContain("必须覆盖样本里出现的每一个章节 ID")
    expect(prompt).toContain("evidence")
  })

  it("解析结构、样本与章节标注", () => {
    const raw = JSON.stringify({
      structurePatterns: "推进章骨架",
      transitionStyle: "直接跳时间",
      samples: ["片段"],
      chapterMeta: [
        { chapterId: "ch-0001", hookType: "冲突式", structurePattern: "推进章", topicTags: ["试炼"] },
        { chapterId: "", hookType: "场景式" },
      ],
    })
    const result = parseStructurePatternResult(raw)
    expect(result.structurePatterns).toBe("推进章骨架")
    expect(result.samples).toEqual(["片段"])
    expect(result.chapterMeta).toHaveLength(1)
    expect(result.chapterMeta[0].topicTags).toEqual(["试炼"])
  })

  it("samples 上限 6 条", () => {
    const raw = JSON.stringify({ samples: Array.from({ length: 10 }, (_, i) => `s${i}`) })
    expect(parseStructurePatternResult(raw).samples).toHaveLength(6)
  })

  it("chapterMeta 缺失时返回空数组", () => {
    expect(parseStructurePatternResult(JSON.stringify({ structurePatterns: "x" })).chapterMeta).toEqual([])
  })
})

describe("buildCognitiveFramePrompt / parseCognitiveFrameResult", () => {
  it("prompt 要求三个小节与不显而易见的命题", () => {
    const prompt = buildCognitiveFramePrompt("样本", "书")
    expect(prompt).toContain("推进取舍（L3）")
    expect(prompt).toContain("细节素材（L4）")
    expect(prompt).toContain("价值判断（L5）")
    expect(prompt).toContain("不显而易见")
  })

  it("解析认知框架与机制数组", () => {
    const raw = JSON.stringify({
      cognitiveFrame: "### 推进取舍（L3）\n能一句带过就不展开。",
      pointOfView: "第三人称限知",
      humorMechanisms: ["补刀"],
      highEnergyMechanisms: [],
    })
    const result = parseCognitiveFrameResult(raw)
    expect(result.cognitiveFrame).toContain("推进取舍")
    expect(result.pointOfView).toBe("第三人称限知")
    expect(result.humorMechanisms).toEqual(["补刀"])
    expect(result.highEnergyMechanisms).toEqual([])
  })
})

describe("buildDnaIntegrationPrompt", () => {
  const layers = {
    languageDna: "短句为主",
    structurePatterns: "推进章骨架",
    cognitiveFrame: "能一句带过就不展开",
    rhythmGuide: "一句一段",
  }

  it("要求输出 markdown 且带字数上限与硬约束小节", () => {
    const prompt = buildDnaIntegrationPrompt(layers, metrics, "凡人修仙传")
    expect(prompt).toContain("不超过 4000 字")
    expect(prompt).toContain("不要 JSON")
    expect(prompt).toContain("## 风格硬约束")
    expect(prompt).toContain("短句为主")
    expect(prompt).toContain("推进章骨架")
  })

  it("某层缺失时标注未提取而不是留白", () => {
    const prompt = buildDnaIntegrationPrompt({ ...layers, rhythmGuide: "" }, metrics, "书")
    expect(prompt).toContain("（未提取）")
  })
})

describe("parseIntegratedDnaResult", () => {
  const markdown = [
    "## 语言特征",
    "短句为主。",
    "",
    "## 风格硬约束",
    "1. 环境描写不超过 2 句，因为作者用动作带出场景。",
    "2. 比喻只用日常喻体。",
  ].join("\n")

  it("整篇作为整合文档，硬约束小节单独抽出", () => {
    const result = parseIntegratedDnaResult(markdown)
    expect(result.integratedDna).toContain("## 语言特征")
    expect(result.constitution).toContain("环境描写不超过 2 句")
    expect(result.constitution).toContain("比喻只用日常喻体")
    expect(result.constitution).not.toContain("短句为主")
  })

  it("剥掉 markdown 代码围栏", () => {
    const result = parseIntegratedDnaResult("```markdown\n" + markdown + "\n```")
    expect(result.integratedDna.startsWith("## 语言特征")).toBe(true)
  })

  it("没有硬约束小节时兜底抓编号行", () => {
    const result = parseIntegratedDnaResult("## 语言特征\n1. 用短句。\n2. 少比喻。")
    expect(result.constitution).toContain("用短句")
    expect(result.constitution).toContain("少比喻")
  })

  it("空输出时回落到通用宪法", () => {
    const result = parseIntegratedDnaResult("   ")
    expect(result.integratedDna).toBe("")
    expect(result.constitution).toBe(FALLBACK_STYLE_CONSTITUTION)
  })

  it("既无小节也无编号行时回落到通用宪法", () => {
    const result = parseIntegratedDnaResult("## 语言特征\n就是一段散文，没有任何编号。")
    expect(result.constitution).toBe(FALLBACK_STYLE_CONSTITUTION)
  })
})

describe("stripConstitutionSection", () => {
  it("摘掉硬约束小节，保留其余小节", () => {
    const body = stripConstitutionSection([
      "## 语言特征",
      "短句为主。",
      "",
      "## 风格硬约束",
      "1. 环境描写不超过 2 句。",
      "",
      "## 排版与节奏",
      "一句一段。",
    ].join("\n"))
    expect(body).toContain("短句为主")
    expect(body).toContain("一句一段")
    expect(body).not.toContain("环境描写不超过 2 句")
  })

  it("硬约束在末尾时也能摘掉", () => {
    const body = stripConstitutionSection("## 语言特征\n短句为主。\n\n## 风格硬约束\n1. 用短句。")
    expect(body).toContain("短句为主")
    expect(body).not.toContain("用短句")
  })

  it("没有该小节时原样返回", () => {
    expect(stripConstitutionSection("## 语言特征\n短句为主。")).toBe("## 语言特征\n短句为主。")
  })
})

describe("parseStyleEvidenceResult", () => {
  it("解析证据并跳过缺字段的项", () => {
    const raw = JSON.stringify({
      evidence: [
        { chapterId: "ch-0001", text: "片段", tags: ["钩子"], reason: "r", purpose: "p" },
        { chapterId: "", text: "片段" },
        { chapterId: "ch-0002", text: "" },
      ],
    })
    const result = parseStyleEvidenceResult(raw)
    expect(result).toHaveLength(1)
    expect(result[0].tags).toEqual(["钩子"])
  })

  it("上限 8 条", () => {
    const raw = JSON.stringify({
      evidence: Array.from({ length: 12 }, (_, i) => ({ chapterId: `ch-${i}`, text: "片段" })),
    })
    expect(parseStyleEvidenceResult(raw)).toHaveLength(8)
  })

  it("非 JSON 返回空数组", () => {
    expect(parseStyleEvidenceResult("没有 JSON")).toEqual([])
  })
})

describe("buildLayerAggregatePrompt / parseLayerAggregateResult", () => {
  it("列出所有区块并要求剔除偶发特征", () => {
    const prompt = buildLayerAggregatePrompt("L1 语言 DNA", ["区块甲", "区块乙"], "凡人修仙传")
    expect(prompt).toContain("L1 语言 DNA")
    expect(prompt).toContain("区块 1")
    expect(prompt).toContain("区块 2")
    expect(prompt).toContain("偶发特征")
  })

  it("解析时剥围栏并去空白", () => {
    expect(parseLayerAggregateResult("```md\n合并结果\n```")).toBe("合并结果")
    expect(parseLayerAggregateResult("  合并结果  ")).toBe("合并结果")
  })
})
