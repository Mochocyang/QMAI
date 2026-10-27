import { describe, expect, it, vi } from "vitest"
import { ToolRegistry } from "@/lib/agent/registry"
import {
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
