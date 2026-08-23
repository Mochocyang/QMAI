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

describe("filterDeAiOutput", () => {
  it("过滤 Gemini 去 AI 味结果前置的思考摘要并保留正文", () => {
    const output = `${GEMINI_DE_AI_THOUGHTS}\n\n雨声压住了巷口的脚步。叶刃没有回头。`

    expect(filterDeAiOutput(output)).toBe("雨声压住了巷口的脚步。叶刃没有回头。")
  })

  it("思考过程是全部输出时返回空文本", () => {
    expect(filterDeAiOutput(GEMINI_DE_AI_THOUGHTS)).toBe("")
  })

  it("不改动正常的去 AI 味正文", () => {
    const output = "雨声压住了巷口的脚步。\n\n叶刃把伞往下压了压。"

    expect(filterDeAiOutput(output)).toBe(output)
  })
})
