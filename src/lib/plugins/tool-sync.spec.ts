/**
 * 插件工具描述符的同步（「装了插件、插件显示运行中，模型却不知道有这个工具」的回归钉）。
 *
 * 这组测试守两件事：
 *   1. `buildAgentConfig` 是**同步**函数，所以必须存在一条「异步拉取 → 同步读缓存」的路径；
 *   2. 一次 IPC 抖动**不能**让已经可用的工具从模型可用列表里消失（失败保留旧缓存）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const apiMocks = vi.hoisted(() => ({ tools: vi.fn(), invokeTool: vi.fn() }))

// 只 mock 命令层：同步逻辑本身要跑真实代码。
vi.mock("./api", () => ({
  pluginsApi: { tools: apiMocks.tools, invokeTool: apiMocks.invokeTool },
}))

import {
  getPluginToolDescriptors,
  invokePluginToolViaTauri,
  subscribePluginTools,
  syncPluginTools,
} from "./tool-sync"

/**
 * `plugins_tools()` 的一项。
 *
 * 注意字段名历史：Rust 侧这个字段叫 `parameters`，但 `describe_tool` 里装的是
 * `decl.input_schema`，即插件 tools/list 报上来的 **inputSchema 原文**。
 * 所以这里给的是 `{type:"object", properties, required}` 这种形状，而不是
 * 宿主内部的 `{参数名: ToolParameter}` 映射。
 */
const CHAPTER_METRICS_WIRE = {
  pluginId: "chapter-metrics",
  name: "analyze_chapter_text",
  description: "分析一段章节正文：字数、对话占比、句长分布、重复句。",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "章节正文全文（Markdown 也可以，会去掉标记）" },
    },
    required: ["text"],
  },
}

describe("syncPluginTools", () => {
  beforeEach(() => {
    apiMocks.tools.mockReset()
    apiMocks.invokeTool.mockReset()
  })

  it("拉取成功后同步读得到数据，且 inputSchema 已被换成宿主内部参数映射", async () => {
    apiMocks.tools.mockResolvedValue([CHAPTER_METRICS_WIRE])

    await syncPluginTools()

    const descriptors = getPluginToolDescriptors()
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0].pluginId).toBe("chapter-metrics")
    expect(descriptors[0].name).toBe("analyze_chapter_text")
    // 给内部消费者（toOpenAITools 的参数拼装路径）看的简化视图
    expect(descriptors[0].parameters).toEqual({
      text: {
        type: "string",
        description: "章节正文全文（Markdown 也可以，会去掉标记）",
        required: true,
      },
    })
    // 透传给 Tool 的无损契约
    expect(descriptors[0].inputSchema).toEqual(CHAPTER_METRICS_WIRE.parameters)
  })

  it("内容没变时不通知订阅者（每次启动都 setState 会让聊天页白白重渲染）", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribePluginTools(listener)
    apiMocks.tools.mockResolvedValue([CHAPTER_METRICS_WIRE])

    await syncPluginTools()

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("内容变化时通知订阅者", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribePluginTools(listener)
    apiMocks.tools.mockResolvedValue([
      { ...CHAPTER_METRICS_WIRE, description: "改过的描述" },
    ])

    await syncPluginTools()

    expect(listener).toHaveBeenCalledOnce()
    expect(getPluginToolDescriptors()[0].description).toBe("改过的描述")
    unsubscribe()
  })

  it("拉取失败只 warn，旧缓存必须留着（一次抖动不该让工具从模型可用列表消失）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    apiMocks.tools.mockRejectedValue(new Error("IPC 断了"))

    try {
      await expect(syncPluginTools()).resolves.toBeUndefined()
      // 上一条用例同步进来的工具仍在
      expect(getPluginToolDescriptors().map((d) => d.name)).toEqual(["analyze_chapter_text"])
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe("invokePluginToolViaTauri", () => {
  it("把宿主前缀名还原成插件内原名再调用插件", async () => {
    apiMocks.invokeTool.mockResolvedValue("统计结果")
    const invoke = invokePluginToolViaTauri()

    // registerPluginTools 传给 invoker 的本该是原名，但调用链上任何一环把宿主名漏下来，
    // 插件都会因为「未知工具」失败 —— 这里主动还原，多一层保险。
    await expect(
      invoke("chapter-metrics", "chapter_metrics__analyze_chapter_text", { text: "正文" }),
    ).resolves.toBe("统计结果")

    expect(apiMocks.invokeTool).toHaveBeenCalledWith(
      "chapter-metrics",
      "analyze_chapter_text",
      { text: "正文" },
    )
  })

  it("本来就是原名时原样透传", async () => {
    apiMocks.invokeTool.mockResolvedValue("ok")
    const invoke = invokePluginToolViaTauri()

    await invoke("chapter-metrics", "analyze_chapter_text", { text: "正文" })

    expect(apiMocks.invokeTool).toHaveBeenCalledWith(
      "chapter-metrics",
      "analyze_chapter_text",
      { text: "正文" },
    )
  })
})
