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

  /*
   * 插件工具的 parameters 是**原始 JSON Schema**（ToolParameter 表达不了嵌套结构）。
   * 若仍按 Object.entries(tool.parameters) 拼装，模型会看到 type/properties/required
   * 三个假参数 —— 这正是本文件新增 inputSchema 分支要避免的。
   */
  it("passes a plugin's inputSchema through verbatim", () => {
    const inputSchema = {
      type: "object",
      properties: {
        text: { type: "string", description: "正文" },
        options: {
          type: "object",
          properties: { mode: { type: "string" } },
          required: ["mode"],
        },
      },
      required: ["text"],
      additionalProperties: false,
    }
    const tool: Tool = {
      name: "chapter_metrics__analyze_chapter_text",
      description: "分析",
      category: "action",
      parameters: { text: { type: "string", description: "正文", required: true } },
      inputSchema,
      execute: async () => "",
    }

    const result = toOpenAITools([tool])

    expect(result[0].function.parameters).toEqual(inputSchema)
    // 键名必须是插件自己的参数名，而不是 "type"/"properties"/"required"
    expect(Object.keys(result[0].function.parameters.properties)).toEqual(["text", "options"])
  })

  it("keeps the legacy output for built-in tools without inputSchema", () => {
    const tool: Tool = {
      name: "write_chapter",
      description: "写章节",
      category: "write",
      parameters: {
        content: { type: "string", description: "正文", required: true },
        mode: { type: "string", description: "模式", enum: ["a", "b"] },
      },
      execute: async () => "",
    }

    const result = toOpenAITools([tool])

    expect(result).toEqual([
      {
        type: "function",
        function: {
          name: "write_chapter",
          description: "写章节",
          parameters: {
            type: "object",
            properties: {
              content: { type: "string", description: "正文" },
              mode: { type: "string", description: "模式", enum: ["a", "b"] },
            },
            required: ["content"],
          },
        },
      },
    ])
  })
})
