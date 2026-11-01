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

/** 内置工具的老路径：从 `ToolParameter` 映射拼 JSON Schema。 */
function parametersFromToolParameters(
  parameters: Record<string, ToolParameter>,
): OpenAIFunctionDef["function"]["parameters"] {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, param] of Object.entries(parameters)) {
    properties[key] = convertParameter(param)
    if (param.required) required.push(key)
  }
  return {
    type: "object",
    properties,
    required,
  }
}

export function toOpenAITools(tools: Tool[]): OpenAIFunctionDef[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      /*
       * 插件工具带 `inputSchema`（插件原样透传的 JSON Schema）：直接用它。
       *
       * 为什么不能继续从 `tool.parameters` 拼：那里只有顶层、且已被压成
       * `ToolParameter` 的简化视图，嵌套 object/array、additionalProperties
       * 这些信息都丢了。发给模型的契约必须与插件实际校验的一致。
       *
       * 内置工具没有这个字段，仍走 parametersFromToolParameters，输出逐字不变。
       */
      parameters: tool.inputSchema
        ? (tool.inputSchema as unknown as OpenAIFunctionDef["function"]["parameters"])
        : parametersFromToolParameters(tool.parameters),
    },
  }))
}
