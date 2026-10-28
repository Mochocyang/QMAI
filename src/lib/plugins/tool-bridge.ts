import type { ToolRegistry } from "@/lib/agent/registry"
import type { Tool, ToolParameter } from "@/lib/agent/types"
import type { PluginToolDescriptor, PluginToolInvoker } from "./types"

/**
 * 插件工具名一律加前缀再进 registry。
 *
 * `ToolRegistry.register` 内部是 `Map.set`，同名会**静默覆盖**；内置工具已占用
 * `read_chapter` / `search_chapters` 这类通用名，不加前缀时一个同名的插件工具
 * 就能悄悄顶掉内置能力。
 */
const HOST_NAME_SEPARATOR = "__"

/** pluginId 里的 `-` 换成 `_`，拼上 `__` 与工具名 */
export function toHostToolName(pluginId: string, toolName: string): string {
  return `${pluginId.replace(/-/g, "_")}${HOST_NAME_SEPARATOR}${toolName}`
}

/** 反向还原；不是插件工具名（不含 `__`）时返回 null */
export function toPluginToolName(hostName: string): string | null {
  const idx = hostName.indexOf(HOST_NAME_SEPARATOR)
  // 用 indexOf 而不是 split：工具名自身可能含 `__`（如 a__b），只切第一个分隔符
  return idx < 0 ? null : hostName.slice(idx + HOST_NAME_SEPARATOR.length)
}

export function pluginToolPrefix(pluginId: string): string {
  return `${pluginId.replace(/-/g, "_")}${HOST_NAME_SEPARATOR}`
}

/** `ToolParameter` 认得的类型集合；插件写出别的类型时只能回落。 */
const TOOL_PARAMETER_TYPES = new Set<ToolParameter["type"]>([
  "string",
  "number",
  "boolean",
  "object",
  "array",
  "integer",
])

function asJsonObject(value: unknown): Record<string, unknown> | undefined {
  // 数组也是 object：JSON Schema 的 properties 必须是对象，数组一律当没写
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * 把插件透传的 JSON Schema 转成宿主内部的参数映射。
 *
 * 为什么需要这层：插件按 OpenAI/MCP 习惯写的是 `{type:"object", properties, required}`，
 * 而宿主内部 `Tool.parameters` 是 `{参数名: {type, description, required}}`。
 * 直接透传会让 toOpenAITools 把 "type"/"properties"/"required" 三个键当成参数名。
 *
 * 只做**顶层**转换：嵌套的 object/array 结构无法用 ToolParameter 表达，
 * 原始 schema 会通过 `Tool.inputSchema` 原样带给模型，所以这里丢掉的只是
 * 「给内部消费者看的简化视图」，不影响模型看到的契约。
 */
export function inputSchemaToParameters(schema: unknown): Record<string, ToolParameter> {
  const root = asJsonObject(schema)
  if (!root) return {}
  const properties = asJsonObject(root.properties)
  if (!properties) return {}

  // required 写歪（非数组/含非字符串）时当没有：一个字段类型不对不该让整批工具注册失败
  const requiredNames = new Set(
    Array.isArray(root.required)
      ? root.required.filter((name): name is string => typeof name === "string")
      : [],
  )

  const parameters: Record<string, ToolParameter> = {}
  for (const [name, value] of Object.entries(properties)) {
    const property = asJsonObject(value) ?? {}
    const declared = property.type
    // 联合类型、缺失、写歪：ToolParameter 表达不了，一律回落 string
    const type = typeof declared === "string"
      && TOOL_PARAMETER_TYPES.has(declared as ToolParameter["type"])
      ? (declared as ToolParameter["type"])
      : "string"
    const parameter: ToolParameter = {
      type,
      description: typeof property.description === "string" ? property.description : "",
    }
    if (requiredNames.has(name)) parameter.required = true
    if (Array.isArray(property.enum)) {
      const values = property.enum.filter((item): item is string => typeof item === "string")
      if (values.length > 0) parameter.enum = values
    }
    parameters[name] = parameter
  }
  return parameters
}

/**
 * 把插件工具注入 registry。
 *
 * 已存在同名工具时**不覆盖**——插件的工具必须让位于宿主已注册的同名工具，
 * 否则一次插件安装就能替换掉内置能力（register 内部是 Map.set，覆盖是静默的）。
 */
export function registerPluginTools(
  registry: ToolRegistry,
  descriptors: PluginToolDescriptor[],
  invoke: PluginToolInvoker,
): void {
  for (const d of descriptors) {
    const hostName = toHostToolName(d.pluginId, d.name)
    if (registry.has(hostName)) continue
    // 两种描述符形状都收：新调用方给 inputSchema（插件原样透传的 JSON Schema），
    // 旧调用方/测试给 parameters（宿主内部映射）。给了映射就以映射为准，
    // 否则从 schema 顶算一份「给内部消费者看的视图」。
    const parameters = d.parameters ?? inputSchemaToParameters(d.inputSchema)
    const inputSchema = asJsonObject(d.inputSchema)
    const tool: Tool = {
      name: hostName,
      description: d.description,
      category: "action",
      // 第三方代码写用户项目，默认要人工确认，不做静默执行
      permission: "confirm",
      parameters,
      // 有原始 schema 就带上：序列化时优先用它，嵌套结构才不会被压平
      ...(inputSchema ? { inputSchema } : {}),
      // 发给插件的必须是插件内的原名：插件不认识带宿主前缀的名字
      execute: async (params) => invoke(d.pluginId, d.name, params),
    }
    registry.register(tool)
  }
}

export function unregisterPluginTools(registry: ToolRegistry, pluginId: string): number {
  return registry.unregisterPrefix(pluginToolPrefix(pluginId))
}
