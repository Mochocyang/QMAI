import { describe, expect, it } from "vitest"
import { filterPluginsByConfig, createPrePluginChain, type PrePlugin } from "./pipeline"

const mockPlugins: PrePlugin[] = [
  { name: "plugin_a", priority: 10, run: async () => ({}) },
  { name: "plugin_b", priority: 20, run: async () => ({}) },
  { name: "plugin_c", priority: 30, run: async () => ({}) },
]

describe("filterPluginsByConfig", () => {
  it("returns all plugins when no config", () => {
    const result = filterPluginsByConfig(mockPlugins)
    expect(result).toHaveLength(3)
    expect(result.map(p => p.name)).toEqual(["plugin_a", "plugin_b", "plugin_c"])
  })

  it("filters by enabledPlugins whitelist", () => {
    const result = filterPluginsByConfig(mockPlugins, { enabledPlugins: ["plugin_a", "plugin_c"] })
    expect(result).toHaveLength(2)
    expect(result.map(p => p.name)).toEqual(["plugin_a", "plugin_c"])
  })

  it("filters by disabledPlugins blacklist", () => {
    const result = filterPluginsByConfig(mockPlugins, { disabledPlugins: ["plugin_b"] })
    expect(result).toHaveLength(2)
    expect(result.map(p => p.name)).toEqual(["plugin_a", "plugin_c"])
  })

  it("disabledPlugins takes priority over enabledPlugins", () => {
    const result = filterPluginsByConfig(mockPlugins, {
      enabledPlugins: ["plugin_a", "plugin_b"],
      disabledPlugins: ["plugin_b"],
    })
    expect(result).toHaveLength(1)
    expect(result.map(p => p.name)).toEqual(["plugin_a"])
  })

  it("returns empty when enabledPlugins is empty array", () => {
    const result = filterPluginsByConfig(mockPlugins, { enabledPlugins: [] })
    expect(result).toHaveLength(0)
  })

  it("ignores unknown plugin names in enabledPlugins", () => {
    const result = filterPluginsByConfig(mockPlugins, { enabledPlugins: ["plugin_a", "unknown"] })
    expect(result).toHaveLength(1)
    expect(result.map(p => p.name)).toEqual(["plugin_a"])
  })

  it("ignores unknown plugin names in disabledPlugins", () => {
    const result = filterPluginsByConfig(mockPlugins, { disabledPlugins: ["unknown"] })
    expect(result).toHaveLength(3)
  })
})

describe("PrePluginChain with config", () => {
  it("returns executedPlugins list", async () => {
    const chain = createPrePluginChain(mockPlugins)
    const result = await chain.run({
      userMessage: "test",
      projectPath: "/test",
      agentConfig: {} as any,
    })
    expect(result.executedPlugins).toEqual(["plugin_a", "plugin_b", "plugin_c"])
  })

  it("respects enabledPlugins in run", async () => {
    const chain = createPrePluginChain(mockPlugins)
    const result = await chain.run(
      {
        userMessage: "test",
        projectPath: "/test",
        agentConfig: {} as any,
      },
      { enabledPlugins: ["plugin_a", "plugin_c"] },
    )
    expect(result.executedPlugins).toEqual(["plugin_a", "plugin_c"])
  })

  it("respects disabledPlugins in run", async () => {
    const chain = createPrePluginChain(mockPlugins)
    const result = await chain.run(
      {
        userMessage: "test",
        projectPath: "/test",
        agentConfig: {} as any,
      },
      { disabledPlugins: ["plugin_b"] },
    )
    expect(result.executedPlugins).toEqual(["plugin_a", "plugin_c"])
  })

  it("stops early and includes stopped plugin in executedPlugins", async () => {
    const stopPlugin: PrePlugin = {
      name: "stop_plugin",
      priority: 15,
      run: async () => ({ shouldStop: true, stopReason: "test_stop" }),
    }
    const chain = createPrePluginChain([...mockPlugins, stopPlugin])
    const result = await chain.run({
      userMessage: "test",
      projectPath: "/test",
      agentConfig: {} as any,
    })
    expect(result.shouldStop).toBe(true)
    expect(result.executedPlugins).toContain("stop_plugin")
    expect(result.executedPlugins.length).toBeLessThan(4)
  })
})
