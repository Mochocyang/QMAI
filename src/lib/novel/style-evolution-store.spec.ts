import { beforeEach, describe, expect, it, vi } from "vitest"

const mem = new Map<string, string>()

vi.mock("@/commands/fs", () => ({
  fileExists: vi.fn(async (path: string) => mem.has(path)),
  readFile: vi.fn(async (path: string) => {
    if (!mem.has(path)) throw new Error("ENOENT")
    return mem.get(path)!
  }),
  writeFileAtomic: vi.fn(async (path: string, content: string) => {
    mem.set(path, content)
  }),
  createDirectory: vi.fn(async () => {}),
}))

const { bumpSpy } = vi.hoisted(() => ({ bumpSpy: vi.fn() }))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: { getState: () => ({ bumpDataVersion: bumpSpy }) },
}))

import {
  emptyState,
  loadStyleEvolutionState,
  MAX_ROUND_HISTORY,
  saveStyleEvolutionState,
  subscribeStyleEvolution,
  type StyleEvolutionState,
} from "./style-evolution-store"

const PROJECT = "E:/Novel"
const STORE_FILE = `${PROJECT}/.qmai/style-evolution.json`

function writeRaw(content: unknown) {
  mem.set(STORE_FILE, typeof content === "string" ? content : JSON.stringify(content))
}

beforeEach(() => {
  mem.clear()
  bumpSpy.mockClear()
})

describe("emptyState", () => {
  it("默认关闭，且 nextThreshold 落在 {3,4,5}", () => {
    const s = emptyState()
    expect(s.version).toBe(1)
    // 用户明确要求「默认关闭，我来开」
    expect(s.enabled).toBe(false)
    expect([3, 4, 5]).toContain(s.nextThreshold)
    expect(s.nextThreshold).toBe(3)
    expect(s.openDayCount).toBe(0)
    expect(s.probe).toBeNull()
    expect(s.rounds).toEqual([])
  })
})

describe("loadStyleEvolutionState：缺文件与坏数据都要退化，且不许把它当「已开启」", () => {
  it("文件不存在 ⇒ 默认关闭", async () => {
    const s = await loadStyleEvolutionState(PROJECT)
    expect(s.enabled).toBe(false)
    expect(s.nextThreshold).toBe(3)
  })

  it("坏 JSON ⇒ 默认关闭（不是抛错，也不是当成启用）", async () => {
    writeRaw("{ 这不是 JSON")
    const s = await loadStyleEvolutionState(PROJECT)
    expect(s.enabled).toBe(false)
    expect(s.rounds).toEqual([])
  })

  it("顶层是数组 / null ⇒ 默认关闭", async () => {
    writeRaw([1, 2, 3])
    expect((await loadStyleEvolutionState(PROJECT)).enabled).toBe(false)
    writeRaw("null")
    expect((await loadStyleEvolutionState(PROJECT)).enabled).toBe(false)
  })

  /*
   * ★ 这条是「第 1 次打开就分析」的纵深防御。
   * 初值必须是 3~5；但盘上的文件可能来自早期版本、手工编辑或半途失败的写入，
   * 出现 0 / 负数 / 超大值。0 会让 `count(1) >= 0` 恒真 ⇒ 每次打开都分析，
   * 用户的「每 3/4/5 次」被彻底绕过。所以读取时就要夹回合法区间。
   */
  it("nextThreshold 是 0 / 越界 / 非数字 ⇒ 夹回合法区间（绝不留在 0）", async () => {
    for (const bad of [0, -5, 1, 2, 9, 100, Number.NaN, "3", null, undefined]) {
      writeRaw({ version: 1, enabled: true, nextThreshold: bad })
      const s = await loadStyleEvolutionState(PROJECT)
      expect([3, 4, 5], `nextThreshold=${String(bad)} 没有被夹回合法区间`).toContain(s.nextThreshold)
    }
  })

  it("合法的 4 与 5 必须被保留（夹取不能一律改成 3）", async () => {
    writeRaw({ version: 1, nextThreshold: 5 })
    expect((await loadStyleEvolutionState(PROJECT)).nextThreshold).toBe(5)
    writeRaw({ version: 1, nextThreshold: 4 })
    expect((await loadStyleEvolutionState(PROJECT)).nextThreshold).toBe(4)
  })

  it("openDayCount 非法或负数 ⇒ 0", async () => {
    for (const bad of [-1, Number.NaN, "2", null, 1.5]) {
      writeRaw({ version: 1, openDayCount: bad })
      const s = await loadStyleEvolutionState(PROJECT)
      expect(s.openDayCount, `openDayCount=${String(bad)}`).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(s.openDayCount)).toBe(true)
    }
  })

  it("enabled 非布尔 ⇒ false（字符串 \"false\" 不能当成真）", async () => {
    writeRaw({ version: 1, enabled: "false" })
    expect((await loadStyleEvolutionState(PROJECT)).enabled).toBe(false)
    writeRaw({ version: 1, enabled: 1 })
    expect((await loadStyleEvolutionState(PROJECT)).enabled).toBe(false)
    writeRaw({ version: 1, enabled: true })
    expect((await loadStyleEvolutionState(PROJECT)).enabled).toBe(true)
  })

  it("日期字段非字符串 ⇒ 空串（空串被视为「新的一天」，会重新开始计数）", async () => {
    writeRaw({ version: 1, lastOpenDate: 12345, lastAttemptedOn: null, lastAnalyzedOn: {} })
    const s = await loadStyleEvolutionState(PROJECT)
    expect(s.lastOpenDate).toBe("")
    expect(s.lastAttemptedOn).toBe("")
    expect(s.lastAnalyzedOn).toBeNull()
  })
})

describe("轮次历史", () => {
  it("畸形项被过滤，合法项保留", async () => {
    writeRaw({
      version: 1,
      rounds: [
        { at: "2026-10-01", round: 1, outcome: "bootstrap" },
        null,
        "垃圾",
        { at: "2026-10-02" }, // 缺 outcome
        { at: "2026-10-03", round: 2, outcome: "kept", distanceCandidate: 0.1, distanceBase: 0.3 },
        { at: "2026-10-04", round: 3, outcome: "不存在的结论" },
      ],
    })
    const s = await loadStyleEvolutionState(PROJECT)
    expect(s.rounds).toHaveLength(2)
    expect(s.rounds[0].outcome).toBe("bootstrap")
    expect(s.rounds[1].outcome).toBe("kept")
    expect(s.rounds[1].distanceCandidate).toBe(0.1)
  })

  it("非数组 ⇒ 空数组", async () => {
    writeRaw({ version: 1, rounds: { a: 1 } })
    expect((await loadStyleEvolutionState(PROJECT)).rounds).toEqual([])
  })

  it(`写入时只保留最近 ${MAX_ROUND_HISTORY} 条（防止文件无限增长）`, async () => {
    const rounds = Array.from({ length: MAX_ROUND_HISTORY + 40 }, (_, i) => ({
      at: "2026-10-01",
      round: i + 1,
      outcome: "reverted" as const,
    }))
    await saveStyleEvolutionState(PROJECT, { ...emptyState(), rounds })

    const s = await loadStyleEvolutionState(PROJECT)
    expect(s.rounds).toHaveLength(MAX_ROUND_HISTORY)
    // 保留的是**最近**的，不是最早的
    expect(s.rounds[s.rounds.length - 1].round).toBe(MAX_ROUND_HISTORY + 40)
    expect(s.rounds[0].round).toBe(41)
  })

  /*
   * 读取侧也要截取，而且这条用例必须**绕过 save 直接写盘**。
   *
   * 否则测不出东西：save 路径已经截过一次，读到的是截好的数组，
   * 读取侧就算写反成 `slice(0, MAX)` 也看不出来（对等长数组是恒等操作）。
   * 直接写盘模拟的正是真实场景 —— 文件来自早期版本、手工编辑，或一次
   * 只写了一半的落盘。
   */
  it("盘上历史超过上限时，读取侧也截取最近的", async () => {
    const rounds = Array.from({ length: MAX_ROUND_HISTORY + 40 }, (_, i) => ({
      at: "2026-10-01",
      round: i + 1,
      outcome: "reverted",
    }))
    writeRaw({ version: 1, rounds })

    const s = await loadStyleEvolutionState(PROJECT)
    expect(s.rounds).toHaveLength(MAX_ROUND_HISTORY)
    expect(s.rounds[s.rounds.length - 1].round).toBe(MAX_ROUND_HISTORY + 40)
    expect(s.rounds[0].round).toBe(41)
  })
})

describe("探针缓存", () => {
  it("只缓存指标，不缓存距离", async () => {
    writeRaw({
      version: 1,
      probe: {
        stylePresetId: "p1",
        sourceBook: "我的文风 · 自动进化 · 第 1 轮",
        at: "2026-10-01",
        metrics: { avgSentenceChars: 20 },
        // 故意塞一个 distance：读取时不许把它带出来
        distance: 0.123,
      },
    })
    const s = await loadStyleEvolutionState(PROJECT)
    expect(s.probe).not.toBeNull()
    expect(s.probe?.metrics.avgSentenceChars).toBe(20)
    /*
     * 距离必须每轮用**当前**的目标重算。若把距离也缓存下来，
     * 下一轮就是拿一把过期的尺子去量新候选 —— 目标 T 已经变了。
     */
    expect(s.probe && "distance" in s.probe).toBe(false)
  })

  it("探针缺指标 / 指标非法 ⇒ 整条丢弃（宁可不比，也不能拿垃圾当基线）", async () => {
    writeRaw({ version: 1, probe: { stylePresetId: "p1" } })
    expect((await loadStyleEvolutionState(PROJECT)).probe).toBeNull()

    writeRaw({ version: 1, probe: "垃圾" })
    expect((await loadStyleEvolutionState(PROJECT)).probe).toBeNull()

    // 指标里全是垃圾 ⇒ 丢弃
    writeRaw({ version: 1, probe: { stylePresetId: "p1", metrics: { avgSentenceChars: "高" } } })
    expect((await loadStyleEvolutionState(PROJECT)).probe).toBeNull()
  })

  it("缺 stylePresetId 的探针被丢弃（回滚时要按它找预设）", async () => {
    writeRaw({ version: 1, probe: { metrics: { avgSentenceChars: 20 }, sourceBook: "x" } })
    expect((await loadStyleEvolutionState(PROJECT)).probe).toBeNull()
  })
})

describe("save / load 往返", () => {
  it("完整状态原样往返", async () => {
    const state: StyleEvolutionState = {
      ...emptyState(),
      enabled: true,
      lastOpenDate: "2026-10-11",
      lastAttemptedOn: "2026-10-11",
      openDayCount: 2,
      nextThreshold: 4,
      lastAnalyzedOn: "2026-10-09",
      rounds: [
        {
          at: "2026-10-09",
          round: 1,
          outcome: "kept",
          reason: "improved",
          distanceCandidate: 0.12,
          distanceBase: 0.3,
          stylePresetId: "auto-1",
          sourceBook: "我的文风 · 自动进化 · 第 1 轮",
        },
      ],
    }

    await saveStyleEvolutionState(PROJECT, state)
    const loaded = await loadStyleEvolutionState(PROJECT)

    expect(loaded.enabled).toBe(true)
    expect(loaded.lastOpenDate).toBe("2026-10-11")
    expect(loaded.openDayCount).toBe(2)
    expect(loaded.nextThreshold).toBe(4)
    expect(loaded.rounds[0].distanceBase).toBe(0.3)
    expect(loaded.rounds[0].sourceBook).toBe("我的文风 · 自动进化 · 第 1 轮")
  })

  it("写到 <项目>/.qmai/style-evolution.json", async () => {
    await saveStyleEvolutionState(PROJECT, emptyState())
    expect(mem.has(STORE_FILE)).toBe(true)
  })
})

describe("通知：走自己的订阅，不碰 dataVersion", () => {
  /*
   * `bumpDataVersion()` 的语义是「项目数据变了，文风库/写作区重读」。
   * 打开日计数变化跟它无关 —— 若挂上去，用户每打开一次项目都会触发
   * 全应用重读文风库与写作区。所以这里明确断言它**没有**被调用；
   * 界面刷新由本模块自己的订阅承担。
   */
  it("保存时不调用 bumpDataVersion", async () => {
    await saveStyleEvolutionState(PROJECT, { ...emptyState(), enabled: true })
    expect(bumpSpy).not.toHaveBeenCalled()
  })

  it("保存后通知订阅者，并带上项目路径与新状态", async () => {
    const seen: Array<{ path: string; enabled: boolean }> = []
    const unsubscribe = subscribeStyleEvolution((path, state) => {
      seen.push({ path, enabled: state.enabled })
    })

    await saveStyleEvolutionState(PROJECT, { ...emptyState(), enabled: true })
    unsubscribe()
    await saveStyleEvolutionState(PROJECT, { ...emptyState(), enabled: false })

    expect(seen).toEqual([{ path: PROJECT, enabled: true }])
  })

  it("取消订阅后不再收到通知", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeStyleEvolution(listener)
    await saveStyleEvolutionState(PROJECT, emptyState())
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    await saveStyleEvolutionState(PROJECT, emptyState())
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
