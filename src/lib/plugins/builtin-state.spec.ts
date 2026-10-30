// @vitest-environment jsdom
/**
 * 内置插件开关的状态层测试。
 *
 * 这一层被四处使用：插件页（渲染开关）、导航栏（过滤入口）、页面路由（关闭态）、
 * 以及 `lib/web-search.ts` 的非 React 闸门。所以它的容错与一致性必须钉死：
 * 存储坏了不能让插件页崩，也不能让"关掉的搜索"悄悄自己打开。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BUILTIN_PLUGINS } from "./builtin"
import {
  BUILTIN_PLUGINS_STORAGE_KEY,
  __resetBuiltinPluginCacheForTests,
  builtinPluginsSnapshot,
  isBuiltinPluginEnabled,
  isBuiltinViewEnabled,
  resetBuiltinPlugin,
  setBuiltinPluginEnabled,
  subscribeBuiltinPlugins,
} from "./builtin-state"

beforeEach(() => {
  localStorage.clear()
  __resetBuiltinPluginCacheForTests()
})

afterEach(() => {
  localStorage.clear()
  __resetBuiltinPluginCacheForTests()
})

describe("builtin-state：默认值", () => {
  it("没有任何存储时，全部按清单里的 defaultEnabled 生效（默认全开）", () => {
    for (const plugin of BUILTIN_PLUGINS) {
      expect(isBuiltinPluginEnabled(plugin.id)).toBe(plugin.defaultEnabled)
    }
  })

  it("没有内置插件管辖的视图一律可用", () => {
    expect(isBuiltinViewEnabled("wiki")).toBe(true)
    expect(isBuiltinViewEnabled("sources")).toBe(true)
    expect(isBuiltinViewEnabled("plugins")).toBe(true)
    expect(isBuiltinViewEnabled(null)).toBe(true)
    expect(isBuiltinViewEnabled(undefined)).toBe(true)
  })
})

describe("builtin-state：开关与视图联动", () => {
  it("关掉「审查中心」后，它的视图不可用；其它视图不受影响", () => {
    setBuiltinPluginEnabled("review-center", false)

    expect(isBuiltinPluginEnabled("review-center")).toBe(false)
    expect(isBuiltinViewEnabled("reviewCenter")).toBe(false)
    // 邻居必须不受牵连 —— 这是"只关一个功能"的核心承诺
    expect(isBuiltinViewEnabled("storySimulation")).toBe(true)
    expect(isBuiltinViewEnabled("search")).toBe(true)
    expect(isBuiltinViewEnabled("wiki")).toBe(true)
  })

  it("关掉「剧情搜索」不影响「审查中心」", () => {
    setBuiltinPluginEnabled("plot-search", false)
    expect(isBuiltinViewEnabled("search")).toBe(false)
    expect(isBuiltinViewEnabled("reviewCenter")).toBe(true)
  })

  it("重新打开后恢复可用", () => {
    setBuiltinPluginEnabled("story-simulation", false)
    expect(isBuiltinViewEnabled("storySimulation")).toBe(false)
    setBuiltinPluginEnabled("story-simulation", true)
    expect(isBuiltinViewEnabled("storySimulation")).toBe(true)
  })

  it("resetBuiltinPlugin 回到清单默认值", () => {
    setBuiltinPluginEnabled("review-center", false)
    resetBuiltinPlugin("review-center")
    expect(isBuiltinPluginEnabled("review-center")).toBe(true)
  })
})

describe("builtin-state：持久化与订阅", () => {
  it("开关会写进 localStorage，并能在清掉缓存后读回", () => {
    setBuiltinPluginEnabled("web-search", false)

    const raw = localStorage.getItem(BUILTIN_PLUGINS_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toMatchObject({ "web-search": false })

    __resetBuiltinPluginCacheForTests()
    expect(isBuiltinPluginEnabled("web-search")).toBe(false)
  })

  it("订阅者在开关变化时被通知", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeBuiltinPlugins(listener)

    setBuiltinPluginEnabled("review-center", false)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    setBuiltinPluginEnabled("review-center", true)
    // 已退订，不该再收到
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("快照引用稳定（同样内容多次读返回同一个对象）", () => {
    const first = builtinPluginsSnapshot()
    const second = builtinPluginsSnapshot()
    expect(first).toBe(second)
  })
})

describe("builtin-state：存储容错", () => {
  it("坏 JSON 回落到默认值，而不是抛异常", () => {
    localStorage.setItem(BUILTIN_PLUGINS_STORAGE_KEY, "{not json")
    __resetBuiltinPluginCacheForTests()

    expect(() => isBuiltinPluginEnabled("web-search")).not.toThrow()
    expect(isBuiltinPluginEnabled("web-search")).toBe(true)
  })

  it("字符串 \"false\" 不被当成 false（只认真正的 boolean）", () => {
    /*
     * 这是真实会踩的坑：早期版本或手改存储可能留下 "false" 字符串。
     * 若用 `Boolean(value)` 判断，它会被当成 false，用户会发现自己
     * 明明没关过搜索，联网搜索却停了 —— 而且无处排查。
     */
    localStorage.setItem(
      BUILTIN_PLUGINS_STORAGE_KEY,
      JSON.stringify({ "web-search": "false" }),
    )
    __resetBuiltinPluginCacheForTests()

    expect(isBuiltinPluginEnabled("web-search")).toBe(true)
  })

  it("未知的插件 id 被忽略，不影响已知项", () => {
    localStorage.setItem(
      BUILTIN_PLUGINS_STORAGE_KEY,
      JSON.stringify({ "no-such-plugin": false, "review-center": false }),
    )
    __resetBuiltinPluginCacheForTests()

    expect(isBuiltinPluginEnabled("review-center")).toBe(false)
    expect(isBuiltinPluginEnabled("web-search")).toBe(true)
  })

  it("存储里有部分键时，缺失的键用默认值补齐", () => {
    localStorage.setItem(
      BUILTIN_PLUGINS_STORAGE_KEY,
      JSON.stringify({ "plot-search": false }),
    )
    __resetBuiltinPluginCacheForTests()

    expect(isBuiltinPluginEnabled("plot-search")).toBe(false)
    expect(isBuiltinPluginEnabled("story-simulation")).toBe(true)
  })
})

describe("内置插件：覆盖范围", () => {
  it("记忆中心 / 灵魂 / 技能库 / 拆书库 默认开启，且都能独立开关", () => {
    const cases: Array<[Parameters<typeof setBuiltinPluginEnabled>[0], string]> = [
      ["memory-center", "lint"],
      ["soul", "soul"],
      ["skill-library", "skillLibrary"],
      ["book-analysis", "bookAnalysis"],
    ]

    for (const [id, view] of cases) {
      expect(isBuiltinViewEnabled(view)).toBe(true)
      setBuiltinPluginEnabled(id, false)
      expect(isBuiltinViewEnabled(view)).toBe(false)
      // 关一个不影响其它
      setBuiltinPluginEnabled(id, true)
      expect(isBuiltinViewEnabled(view)).toBe(true)
    }
  })

  it("小说图谱默认关闭（创作工具里一开始不显示），但可以被打开", () => {
    /*
     * 用户决定：图谱作为「内置插件」保留，但**默认不在创作工具里出现**。
     * 想要的人到插件页打开；数据不会因为默认关闭而被删。
     */
    expect(isBuiltinPluginEnabled("novel-graph")).toBe(false)
    expect(isBuiltinViewEnabled("graph")).toBe(false)

    setBuiltinPluginEnabled("novel-graph", true)
    expect(isBuiltinViewEnabled("graph")).toBe(true)
  })

  it("关掉记忆中心不会牵连别的视图（各自独立）", () => {
    setBuiltinPluginEnabled("memory-center", false)
    expect(isBuiltinViewEnabled("lint")).toBe(false)
    // 灵魂默认开着，不该被牵连
    expect(isBuiltinViewEnabled("soul")).toBe(true)
  })

  it("「剧本/回收站」这类不属于内置插件的视图永远可用", () => {
    // 维护工具与回收站是基础操作，不该被插件开关影响
    for (const view of ["maintenance", "trash", "wiki", "sources", "settings", "plugins"]) {
      expect(isBuiltinViewEnabled(view)).toBe(true)
    }
  })
})
