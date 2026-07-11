import { describe, it, expect } from "vitest"
import { parseIntentClarity, stripStructuredMarkers } from "./outline-intent-clarity"

describe("parseIntentClarity", () => {
  it("解析 clear 意图", () => {
    const text = `<!-- intent_clarity -->
{"clarity":"clear","module":"章节细纲","analysis":"检测到3章缺细纲","detectedScope":"第1-3章","missingItems":["第1章细纲"],"options":[],"question":""}
<!-- /intent_clarity -->`
    const result = parseIntentClarity(text)
    expect(result).not.toBeNull()
    expect(result!.clarity).toBe("clear")
    expect(result!.module).toBe("章节细纲")
    expect(result!.detectedScope).toBe("第1-3章")
  })

  it("解析 needs_input 意图并提取选项", () => {
    const text = `<!-- intent_clarity -->
{"clarity":"needs_input","module":"章节细纲","analysis":"0章有细纲","detectedScope":"","missingItems":[],"options":[{"id":"A","label":"生成全部缺失细纲","description":"第1-35章"},{"id":"D","label":"自定义","description":"自行描述"}],"question":"请问要生成哪些章节的细纲？"}
<!-- /intent_clarity -->`
    const result = parseIntentClarity(text)
    expect(result).not.toBeNull()
    expect(result!.clarity).toBe("needs_input")
    expect(result!.options).toHaveLength(2)
    expect(result!.options[0].id).toBe("A")
    expect(result!.question).toContain("哪些章节")
  })

  it("无标记块时返回 null", () => {
    expect(parseIntentClarity("普通文本无标记")).toBeNull()
  })

  it("JSON 格式错误时返回 null", () => {
    const text = `<!-- intent_clarity -->
{invalid json}
<!-- /intent_clarity -->`
    expect(parseIntentClarity(text)).toBeNull()
  })
})

describe("stripStructuredMarkers", () => {
  it("移除 intent_clarity 标记块", () => {
    const text = `分析结果如下：\n<!-- intent_clarity -->\n{"clarity":"clear"}\n<!-- /intent_clarity -->\n\n这是正文内容。`
    expect(stripStructuredMarkers(text)).toBe("分析结果如下：\n\n这是正文内容。")
  })

  it("移除 next_step 标记块", () => {
    const text = `正文内容\n<!-- next_step -->\n{"recommendations":[]}\n<!-- /next_step -->`
    expect(stripStructuredMarkers(text).trim()).toBe("正文内容")
  })

  it("同时移除两种标记块", () => {
    const text = `<!-- intent_clarity -->\n{"clarity":"clear"}\n<!-- /intent_clarity -->\n正文\n<!-- next_step -->\n{"recommendations":[]}\n<!-- /next_step -->`
    expect(stripStructuredMarkers(text).trim()).toBe("正文")
  })

  it("无标记块时原样返回", () => {
    const text = "纯文本内容"
    expect(stripStructuredMarkers(text)).toBe("纯文本内容")
  })
})
