import { describe, expect, it } from "vitest"
import { filterDeAiOutput } from "./de-ai-output"

const GEMINI_DE_AI_THOUGHTS = [
  "**Initiating the Analysis**",
  "",
  "I'm currently dissecting the task. The core of this process involves identifying and applying de-AI techniques.",
  "",
  "**Refining the Rewrite**",
  "",
  "I'm now zeroing in on the output constraints and improving the dialogue.",
].join("\n")

const SCREENSHOT_STYLE_GEMINI_DE_AI_THOUGHTS = [
  "I'm currently focused on defining the project scope, prioritizing the objective: refining the novel snippet to align with the \"去 AI 味\" skill's instructions. The crucial requirement is to modify the text, producing solely the revised narrative without any extraneous explanations.",
  "",
  "**Examining the Narrative Details**",
  "",
  "I'm now diving deep into analyzing the source text, identifying critical plot points and stylistic nuances. I'm preserving the dark fantasy setting while pinpointing the \"爽文打脸\" elements I need to tone down.",
  "",
  "**Analyzing the Conflict's Dynamics**",
  "",
  "I've been mapping out the escalating conflict within the narrative's framework and checking the characters' power dynamics.",
].join("\n")

const REVISED_CHINESE_BODY = [
  "地下暗轨深处，空气沉得像一汪死水，混杂着铁锈、陈年机油与腐败菌丝的气味。",
  "",
  "叶刃停在防爆门前，指节轻敲门框。",
].join("\n")

describe("filterDeAiOutput", () => {
  it("过滤 Gemini 去 AI 味结果前置的思考摘要并保留正文", () => {
    const output = `${GEMINI_DE_AI_THOUGHTS}\n\n雨声压住了巷口的脚步。叶刃没有回头。`

    expect(filterDeAiOutput(output)).toBe("雨声压住了巷口的脚步。叶刃没有回头。")
  })

  it("思考过程是全部输出时返回空文本", () => {
    expect(filterDeAiOutput(GEMINI_DE_AI_THOUGHTS)).toBe("")
  })

  it("过滤截图同型且引用少量中文的 Gemini 思考摘要", () => {
    expect(filterDeAiOutput(SCREENSHOT_STYLE_GEMINI_DE_AI_THOUGHTS)).toBe("")
  })

  it("过滤截图同型思考摘要并保留后续中文正文", () => {
    const output = `${SCREENSHOT_STYLE_GEMINI_DE_AI_THOUGHTS}\n\n${REVISED_CHINESE_BODY}`

    expect(filterDeAiOutput(output)).toBe(REVISED_CHINESE_BODY)
  })

  it("不改动正常的去 AI 味正文", () => {
    const output = "雨声压住了巷口的脚步。\n\n叶刃把伞往下压了压。"

    expect(filterDeAiOutput(output)).toBe(output)
  })
})
