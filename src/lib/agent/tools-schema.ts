import type { Tool, ToolParameter } from "./types"

interface OpenAIFunctionDef {
  type: "function"
  function: {
    name: string
    description: string
    parameters: {
      type: "object"
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

function convertParameter(param: ToolParameter): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: param.type,
    description: param.description,
  }
  if (param.enum && param.enum.length > 0) {
    schema.enum = param.enum
  }
  return schema
}

export function toOpenAITools(tools: Tool[]): OpenAIFunctionDef[] {
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, param] of Object.entries(tool.parameters)) {
      properties[key] = convertParameter(param)
      if (param.required) required.push(key)
    }
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties,
          required,
        },
      },
    }
  })
}
