import { describe, expect, it, vi } from "vitest"
import { ToolRegistry } from "@/lib/agent/registry"
import { toOpenAITools } from "@/lib/agent/tools-schema"
import {
  inputSchemaToParameters,
  registerPluginTools,
  unregisterPluginTools,
  toHostToolName,
  toPluginToolName,
} from "./tool-bridge"
import type { PluginToolDescriptor } from "./types"

const descriptors: PluginToolDescriptor[] = [
  {
    pluginId: "chapter-insights",
    name: "analyze",
    description: "分析章节节奏",
    parameters: { chapterPath: { type: "string", description: "路径", required: true } },
  },
]

describe("registerPluginTools", () => {
  it("注入时加 pluginId 前缀", () => {
    const r = new ToolRegistry()
    registerPluginTools(r, descriptors, async () => "结果")
    expect(r.has("chapter_insights__analyze")).toBe(true)
    expect(r.has("analyze")).toBe(false)
  })

  it("调用时把插件内原名发给插件，而不是带前缀的名字", async () => {
    const r = new ToolRegistry()
    const invoke = vi.fn(async () => "结果")
    registerPluginTools(r, descriptors, invoke)
    const out = await r.get("chapter_insights__analyze")!.execute({ chapterPath: "/x.md" })
    expect(out).toBe("结果")
    expect(invoke).toHaveBeenCalledWith("chapter-insights", "analyze", { chapterPath: "/x.md" })
  })

  it("插件工具默认需要用户确认", () => {
    const r = new ToolRegistry()
    registerPluginTools(r, descriptors, async () => "结果")
    expect(r.get("chapter_insights__analyze")!.permission).toBe("confirm")
  })

  it("不覆盖同名内置工具", () => {
    const r = new ToolRegistry()
    r.register({
      name: "chapter_insights__analyze",
      description: "内置",
      category: "read",
      parameters: {},
      execute: async () => "builtin",
    })
    registerPluginTools(r, descriptors, async () => "plugin")
    expect(r.get("chapter_insights__analyze")!.description).toBe("内置")
  })

  it("卸载只清自己前缀，不碰内置工具", () => {
    const r = new ToolRegistry()
    r.register({
      name: "read_chapter",
      description: "内置",
      category: "read",
      parameters: {},
      execute: async () => "",
    })
    registerPluginTools(r, descriptors, async () => "结果")
    expect(unregisterPluginTools(r, "chapter-insights")).toBe(1)
    expect(r.has("read_chapter")).toBe(true)
  })
})

describe("工具名校验", () => {
  it("toHostToolName 把 - 换成 _", () => {
    expect(toHostToolName("chapter-insights", "analyze")).toBe("chapter_insights__analyze")
  })

  it("toPluginToolName 还原原名", () => {
    expect(toPluginToolName("chapter_insights__analyze")).toBe("analyze")
  })

  it("toPluginToolName 对非插件工具名返回 null", () => {
    expect(toPluginToolName("read_chapter")).toBeNull()
  })

  it("工具名自身含 __ 时也能正确还原", () => {
    expect(toHostToolName("p1", "a__b")).toBe("p1__a__b")
    expect(toPluginToolName("p1__a__b")).toBe("a__b")
  })
})

/**
 * 插件工具参数的形状转换。
 *
 * 错位点：插件按 OpenAI/MCP 习惯给 `{type:"object", properties, required}`，
 * 宿主内部 `Tool.parameters` 是 `{参数名: {type, description, required}}`。
 * 直接把前者塞进后者，`Object.entries` 会把 "type"/"properties"/"required"
 * 当成三个参数名发给模型。
 */
describe("inputSchemaToParameters", () => {
  it("把 properties + required 转成参数映射", () => {
    expect(
      inputSchemaToParameters({
        type: "object",
        properties: {
          text: { type: "string", description: "正文" },
          limit: { type: "integer", description: "上限" },
        },
        required: ["text"],
      }),
    ).toEqual({
      text: { type: "string", description: "正文", required: true },
      limit: { type: "integer", description: "上限" },
    })
  })

  it("enum 原样带过来，description 缺省为空串", () => {
    expect(
      inputSchemaToParameters({
        properties: { mode: { type: "string", enum: ["fast", "slow"] } },
      }),
    ).toEqual({ mode: { type: "string", description: "", enum: ["fast", "slow"] } })
  })

  it("type 不在合法集合内（含缺失、写歪）时回落 string", () => {
    expect(
      inputSchemaToParameters({
        properties: {
          a: { description: "没有 type" },
          b: { type: "file" },
          c: { type: ["string", "null"] },
        },
      }),
    ).toEqual({
      a: { type: "string", description: "没有 type" },
      b: { type: "string", description: "" },
      c: { type: "string", description: "" },
    })
  })

  it("畸形输入一律返回空映射", () => {
    expect(inputSchemaToParameters(null)).toEqual({})
    expect(inputSchemaToParameters("oops")).toEqual({})
    expect(inputSchemaToParameters([])).toEqual({})
    expect(inputSchemaToParameters({ type: "object" })).toEqual({})
    // properties 不是对象：写歪的 schema 不能把整批工具带崩
    expect(inputSchemaToParameters({ type: "object", properties: "nope" })).toEqual({})
  })
})

describe("registerPluginTools 的两种描述符形状", () => {
  const inputSchema = {
    type: "object",
    properties: { text: { type: "string", description: "正文" } },
    required: ["text"],
  }

  it("给了 inputSchema 时：parameters 是转换后的映射，inputSchema 是原始 schema", () => {
    const r = new ToolRegistry()
    registerPluginTools(
      r,
      [{ pluginId: "chapter-insights", name: "analyze", description: "分析", inputSchema }],
      async () => "结果",
    )

    const tool = r.get("chapter_insights__analyze")!
    // 内部视图：三个 JSON Schema 关键字不能变成三个参数名
    expect(tool.parameters).toEqual({
      text: { type: "string", description: "正文", required: true },
    })
    // 无损视图：发给模型的是插件原本的 schema
    expect(tool.inputSchema).toEqual(inputSchema)
  })

  it("只给 parameters 时行为与改动前一致（既有调用方/测试向后兼容）", () => {
    const r = new ToolRegistry()
    registerPluginTools(r, descriptors, async () => "结果")

    const tool = r.get("chapter_insights__analyze")!
    expect(tool.parameters).toEqual({
      chapterPath: { type: "string", description: "路径", required: true },
    })
    // 没有 JSON Schema 时不能凭空造一个：内置工具那条序列化路径必须原样走
    expect(tool.inputSchema).toBeUndefined()
    expect(toOpenAITools([tool])[0].function.parameters).toEqual({
      type: "object",
      properties: { chapterPath: { type: "string", description: "路径" } },
      required: ["chapterPath"],
    })
  })
})

/**
 * 样例插件的端到端契约（自带常量，不去读 samples 里的 json）。
 *
 * 这里刻意用「运行期 tools/list 的 inputSchema」，而不是 `plugin.json` 里
 * `contributes.tools[0].parameters`：后者是给安装前预览/管理页看的**映射形状**
 * （`{text:{type,description,required}}`），真正注入 registry 的是
 * `samples/plugins/chapter-metrics/index.js` 的 `TOOL.inputSchema`。
 * 两份写岔了用户就会看到「装了但参数不对」，所以这条断言必须钉在运行期契约上。
 */
describe("样例插件 chapter-metrics 的端到端契约", () => {
  const CHAPTER_METRICS_INPUT_SCHEMA = {
    type: "object",
    properties: {
      text: { type: "string", description: "章节正文全文（Markdown 也可以，会去掉标记）" },
    },
    required: ["text"],
  }

  it("模型看到的 properties 只有 text 一个键（不是 type/properties/required 三个）", () => {
    const r = new ToolRegistry()
    registerPluginTools(
      r,
      [
        {
          pluginId: "chapter-metrics",
          name: "analyze_chapter_text",
          description: "分析一段章节正文",
          inputSchema: CHAPTER_METRICS_INPUT_SCHEMA,
        },
      ],
      async () => "统计结果",
    )

    const tool = r.get("chapter_metrics__analyze_chapter_text")!
    expect(tool.parameters).toEqual({
      text: {
        type: "string",
        description: "章节正文全文（Markdown 也可以，会去掉标记）",
        required: true,
      },
    })

    const [descriptor] = toOpenAITools([tool])
    expect(Object.keys(descriptor.function.parameters.properties)).toEqual(["text"])
    // 无损：嵌套结构/其它关键字原样带给模型
    expect(descriptor.function.parameters).toEqual(CHAPTER_METRICS_INPUT_SCHEMA)
  })
})
