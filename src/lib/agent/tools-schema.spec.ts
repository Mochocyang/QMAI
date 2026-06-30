import { describe, expect, it } from "vitest"
import { toOpenAITools } from "./tools-schema"
import type { Tool } from "./types"

describe("toOpenAITools", () => {
  it("converts a simple tool to OpenAI format", () => {
    const tool: Tool = {
      name: "read_chapter",
      description: "读取章节全文",
      category: "read",
      parameters: {
        name: { type: "string", description: "章节名称" },
      },
      execute: async () => "",
    }
    const result = toOpenAITools([tool])
    expect(result).toEqual([
      {
        type: "function",
        function: {
          name: "read_chapter",
          description: "读取章节全文",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "章节名称" },
            },
            required: [],
          },
        },
      },
    ])
  })

  it("marks required parameters", () => {
    const tool: Tool = {
      name: "foo",
      description: "",
      category: "read",
      parameters: {
        a: { type: "string", description: "a", required: true },
        b: { type: "number", description: "b" },
      },
      execute: async () => "",
    }
    const result = toOpenAITools([tool])
    expect(result[0].function.parameters.required).toEqual(["a"])
  })

  it("includes enum when present", () => {
    const tool: Tool = {
      name: "foo",
      description: "",
      category: "action",
      parameters: {
        mode: { type: "string", description: "mode", enum: ["a", "b"], required: true },
      },
      execute: async () => "",
    }
    const result = toOpenAITools([tool])
    const modeProp = result[0].function.parameters.properties.mode as { enum?: string[] }
    expect(modeProp.enum).toEqual(["a", "b"])
  })
})
