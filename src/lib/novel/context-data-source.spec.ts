import { describe, expect, it, vi } from "vitest"
import {
  DataSourceRegistry,
  type DataSource,
  type ContextLoadContext,
  type DataSourceLoadAdapter,
} from "./context-data-source"

const context: ContextLoadContext = {
  projectPath: "E:/Novel",
  task: "生成大纲",
  config: {
    recentSummaryWindow: 8,
    searchTopK: 5,
    snapshotLookback: 3,
    revisionFeedbackWindowConfig: {},
  },
}

describe("DataSourceRegistry", () => {
  it("uses an optional load adapter without changing the source contract", async () => {
    const load = vi.fn(async () => "原始值")
    const fallback = vi.fn(async () => "适配器取值")
    // loadAdapter.load 的生产类型是泛型方法
    //   <T>(source: DataSource<T>, context, directLoad) => Promise<T>
    // 适配器对任意 T 都只能返回同一个 T，不能把来源的值改写成别的类型 —— 这正是用例名所说的
    //「不改变来源契约」，生产里的 DataSourceCacheAdapter 也是这么实现的。
    // 这里让适配器在调用过一次 directLoad（主路径）之后，按自己的策略返回来源声明的 fallback 值：
    // 两条路径都是同一个 T，类型契约不变，但结果值只可能来自适配器自己的返回值。
    // 另外：vi.fn 的 Mock 会把调用签名擦成 (...args) => Promise<unknown>（显式传泛型签名也一样），
    // 擦除后的签名无法赋给上面的泛型方法，所以适配器只用真实对象实现该契约，
    // 并用自带的记录数组代替 Mock 的调用记录。
    const seen: Array<{ sourceName: string; context: ContextLoadContext }> = []
    const adapter: DataSourceLoadAdapter = {
      async load<T>(source: DataSource<T>, context: ContextLoadContext, directLoad: () => Promise<T>) {
        seen.push({ sourceName: source.name, context })
        const primaryValue = await directLoad()
        return source.fallback ? source.fallback(context) : primaryValue
      },
    }
    const registry = new DataSourceRegistry({ loadAdapter: adapter })
    registry.register({ name: "outline", priority: 1, load, fallback })

    const loaded = await registry.loadAll(context)

    // 适配器被调用恰好一次，收到的是 outline 来源和本次 context；
    // 主路径（registry 传进来的 directLoad → 来源 load）恰好执行一次；
    // 结果值取自适配器自己的返回值，而不是 registry 手里的主路径结果。
    expect(seen).toEqual([{ sourceName: "outline", context }])
    expect(loaded).toMatchObject({ outline: "适配器取值" })
    expect(load).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledOnce()
  })

  it("replaces undefined snapshot payloads with default values", async () => {
    const registry = new DataSourceRegistry()
    const snapshotsSource: DataSource<unknown> = {
      name: "snapshots",
      priority: 1,
      load: async () => undefined,
    }

    registry.register(snapshotsSource)
    const loaded = await registry.loadAll(context)

    expect(loaded.snapshots).toEqual({
      recentSummaries: [],
      previousChapterEnding: "",
      characterStates: "",
      foreshadowingSignals: [],
      timeline: "",
    })
  })

  it("replaces undefined scalar payloads with source defaults", async () => {
    const registry = new DataSourceRegistry()
    registry.register({
      name: "fallbackRecentSummaries",
      priority: 1,
      load: async () => undefined,
    })
    registry.register({
      name: "outline",
      priority: 2,
      load: async () => undefined,
    })

    const loaded = await registry.loadAll(context)

    expect(loaded.fallbackRecentSummaries).toEqual([])
    expect(loaded.outline).toBe("")
  })

  it("records read_failed without fallback_used when the source has no fallback", async () => {
    const adapter = {
      load: vi.fn(async () => {
        throw new Error("磁盘损坏")
      }),
      recordReadFailed: vi.fn(),
      recordFallbackUsed: vi.fn(),
    }
    const registry = new DataSourceRegistry({ loadAdapter: adapter })
    registry.register({
      name: "outline",
      priority: 1,
      load: async () => "不应调用",
    })

    await expect(registry.loadAll(context)).resolves.toMatchObject({ outline: "" })
    expect(adapter.recordReadFailed).toHaveBeenCalledWith("outline")
    expect(adapter.recordFallbackUsed).not.toHaveBeenCalled()
  })

  it("records fallback_used only after a real source.fallback succeeds", async () => {
    const adapter = {
      load: vi.fn(async () => {
        throw new Error("主路径失败")
      }),
      recordReadFailed: vi.fn(),
      recordFallbackUsed: vi.fn(),
    }
    const registry = new DataSourceRegistry({ loadAdapter: adapter })
    registry.register({
      name: "outline",
      priority: 1,
      load: async () => "不应调用",
      fallback: async () => "降级大纲",
    })

    await expect(registry.loadAll(context)).resolves.toMatchObject({ outline: "降级大纲" })
    expect(adapter.recordReadFailed).toHaveBeenCalledWith("outline")
    expect(adapter.recordFallbackUsed).toHaveBeenCalledWith("outline")
  })
})
