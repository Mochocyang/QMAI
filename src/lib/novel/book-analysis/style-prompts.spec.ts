import { describe, expect, it } from "vitest"
import {
  buildStyleExtractionPrompt,
  parseStyleProfileResult,
  FALLBACK_STYLE_CONSTITUTION,
} from "./style-prompts"

describe("parseStyleProfileResult", () => {
  it("parses a clean JSON object and keeps sampled chapter ids", () => {
    const raw = JSON.stringify({
      narrativeDensity: "密度高、推进快",
      descriptionWeight: "环境描写少且具体",
      constitution: "1. 朴素\n2. 克制",
      samples: ["原文片段一", "原文片段二"],
    })
    const profile = parseStyleProfileResult(raw, ["ch-0001", "ch-0050"])

    expect(profile.narrativeDensity).toBe("密度高、推进快")
    expect(profile.descriptionWeight).toBe("环境描写少且具体")
    expect(profile.constitution).toBe("1. 朴素\n2. 克制")
    expect(profile.samples).toEqual(["原文片段一", "原文片段二"])
    expect(profile.sampledChapterIds).toEqual(["ch-0001", "ch-0050"])
  })

  it("strips ```json fences and extracts the object", () => {
    const raw = "分析完成，结果如下：\n```json\n" + JSON.stringify({ constitution: "宪法X", samples: [] }) + "\n```"
    expect(parseStyleProfileResult(raw, []).constitution).toBe("宪法X")
  })

  it("extracts the trailing JSON even when prose with brackets precedes it", () => {
    const raw = "我读了样本[第1章]，下面是 JSON：" + JSON.stringify({ constitution: "宪法Y", samples: ["s"] })
    const profile = parseStyleProfileResult(raw, [])
    expect(profile.constitution).toBe("宪法Y")
    expect(profile.samples).toEqual(["s"])
  })

  it("falls back to the default constitution on non-JSON output", () => {
    expect(parseStyleProfileResult("这里没有 JSON", []).constitution).toBe(FALLBACK_STYLE_CONSTITUTION)
  })

  it("falls back to the default constitution when the field is missing", () => {
    const raw = JSON.stringify({ narrativeDensity: "高" })
    const profile = parseStyleProfileResult(raw, [])
    expect(profile.constitution).toBe(FALLBACK_STYLE_CONSTITUTION)
    expect(profile.narrativeDensity).toBe("高")
  })

  it("caps samples at 6", () => {
    const raw = JSON.stringify({ constitution: "x", samples: Array.from({ length: 10 }, (_, i) => `s${i}`) })
    expect(parseStyleProfileResult(raw, []).samples).toHaveLength(6)
  })
})

describe("buildStyleExtractionPrompt", () => {
  it("includes the book title, dimension keys and the samples field instruction", () => {
    const prompt = buildStyleExtractionPrompt("一段原文样本。", "凡人修仙传")
    expect(prompt).toContain("凡人修仙传")
    expect(prompt).toContain("narrativeDensity")
    expect(prompt).toContain("constitution")
    expect(prompt).toContain("samples")
    expect(prompt).toContain("一段原文样本。")
  })
})
