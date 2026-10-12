import { describe, expect, it } from "vitest"
import { dayKey } from "../user-memory/learning-budget"
import {
  advanceOpenDay,
  completeRound,
  emptyScheduleState,
  pickThreshold,
  remainingOpenDays,
  THRESHOLD_RANGE,
  type StyleEvolutionScheduleState,
} from "./style-evolution-schedule"

/*
 * 节律纯函数的穷举测试。
 *
 * 为什么这些用例值得写这么细：「每天只算一次、跨天才 +1、到阈值才分析」这类规则
 * **只能靠时间流逝在真实环境里观察**，和 IO 混在一起就等于不可测。抽成纯函数之后，
 * 同一天开 6 次、连开 7 天、隔 30 天再开，全都能在一个测试里跑完。
 *
 * 用户原话（逐字，测试必须守住）：
 *   ①「每打开 3 次、4 次或 5 次时，才进行一次自动分析」
 *   ②「我们将每天的打开行为定义为 1 次……如果第二天没有打开，隔了很长时间
 *       第三天再打开，依然算作第 2 次」
 *   ③「如果用户一天内打开了 5 到 6 次，不能每天都分析」
 */

/** 固定序列的假随机源，用来把「抽到哪个阈值」钉死。 */
function seqRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

const T = (s: number) => `2026-10-${String(s).padStart(2, "0")}`

describe("emptyScheduleState", () => {
  it("初值落在合法区间：nextThreshold 必须是 3~5，取 3", () => {
    const s = emptyScheduleState()
    /*
     * ⚠️ 这条看着琐碎，其实防的是一个很贵的缺陷：
     * 若初值写成 0（或漏字段取 0），第 1 次打开就会 `count(1) >= 0` ⇒ **立刻分析**，
     * 直接违反原话①，而且它会静默发生 —— 用户第一次开软件就花掉一次模型调用。
     */
    expect(s.nextThreshold).toBe(3)
    expect(THRESHOLD_RANGE).toContain(s.nextThreshold)
    expect(s.openDayCount).toBe(0)
    expect(s.lastOpenDate).toBe("")
    expect(s.lastAnalyzedOn).toBeNull()
  })

  it("空 lastOpenDate 视为「新的一天」：第一次打开要计数", () => {
    const first = advanceOpenDay(emptyScheduleState(), T(1))
    expect(first.state.openDayCount).toBe(1)
    expect(first.state.lastOpenDate).toBe(T(1))
    // 阈值是 3，所以第 1 天不该分析。
    expect(first.shouldAnalyze).toBe(false)
  })
})

describe("pickThreshold", () => {
  it("把 [0,1) 均匀映射到 {3,4,5}", () => {
    expect(pickThreshold(() => 0)).toBe(3)
    expect(pickThreshold(() => 0.34)).toBe(4)
    expect(pickThreshold(() => 0.99)).toBe(5)
  })

  it("rng 返回 1（越界）时仍不许溢出成 6", () => {
    // 有些假随机源/实现会返回 1.0；不夹紧就会抽出 6，用户会看到「每 6 次」。
    expect(pickThreshold(() => 1)).toBe(5)
    expect(pickThreshold(() => 1.5)).toBe(5)
  })

  it("任何取值都落在 {3,4,5}", () => {
    for (let i = 0; i <= 100; i += 1) {
      const v = i / 100
      expect(THRESHOLD_RANGE).toContain(pickThreshold(() => v))
    }
  })
})

describe("同一天内多次打开（原话③：开 5~6 次也只算 1 次）", () => {
  it("同一天开 6 次，计数完全不动，也不会反复触发分析", () => {
    let state = emptyScheduleState()
    const analyzed: boolean[] = []
    for (let i = 0; i < 6; i += 1) {
      const r = advanceOpenDay(state, T(1))
      state = r.state
      analyzed.push(r.shouldAnalyze)
    }
    // 计数只涨到 1：不是 +6，也不是"忽略"记一笔。
    expect(state.openDayCount).toBe(1)
    expect(state.lastOpenDate).toBe(T(1))
    // 阈值 3，一天内不该有任何一次分析。
    expect(analyzed).toEqual([false, false, false, false, false, false])
  })

  it("同一天在阈值之上再打开，不重复触发（失败重试要等下一个打开日）", () => {
    /*
     * 关键边界：达到阈值那一天的计数**保留在阈值之上**（归零与成功解耦），
     * 所以 `count >= threshold` 在当天一直是 true。若不看 lastAttemptedOn，
     * 用户在同一天里切书 A→B→A 就会反复烧 token。
     */
    // 真实前置状态：前两天已开过（计数 2），昨天尝试过一次（比如失败了）。
    let state: StyleEvolutionScheduleState = {
      ...emptyScheduleState(),
      openDayCount: 2,
      lastOpenDate: T(4),
      lastAttemptedOn: T(4),
    }
    const first = advanceOpenDay(state, T(5))
    state = first.state
    expect(first.shouldAnalyze).toBe(true)
    // ⚠️ 核心断言：计数计数**没有被归零**，仍停在阈值之上。
    expect(state.openDayCount).toBe(3)
    expect(state.openDayCount).toBeGreaterThanOrEqual(state.nextThreshold)
    expect(state.lastAttemptedOn).toBe(T(5))

    // 同一天再来两次：都不许再触发
    const second = advanceOpenDay(state, T(5))
    const third = advanceOpenDay(second.state, T(5))
    expect(second.shouldAnalyze).toBe(false)
    expect(third.shouldAnalyze).toBe(false)
  })
})

describe("跨天计次（原话②）", () => {
  it("第一天第 1 次、第二天第 2 次", () => {
    const d1 = advanceOpenDay(emptyScheduleState(), T(1))
    expect(d1.state.openDayCount).toBe(1)
    const d2 = advanceOpenDay(d1.state, T(2))
    expect(d2.state.openDayCount).toBe(2)
    expect(d2.shouldAnalyze).toBe(false)
  })

  it("第二天没打开、隔到第三十天再打开，依然算第 2 次（不是第 3 次、也不清零）", () => {
    const d1 = advanceOpenDay(emptyScheduleState(), T(1))
    const d30 = advanceOpenDay(d1.state, T(28))
    expect(d30.state.openDayCount).toBe(2)
    expect(d30.state.lastOpenDate).toBe(T(28))
  })

  it("连开 7 天：阈值 3 时第 3 天触发，之后重新计数", () => {
    let state = emptyScheduleState()
    const triggers: number[] = []
    for (let day = 1; day <= 7; day += 1) {
      const r = advanceOpenDay(state, T(day))
      state = r.state
      if (r.shouldAnalyze) triggers.push(day)
      if (r.shouldAnalyze) state = completeRound(state, T(day), seqRng([0]))
    }
    // 第 3 天触发（阈值 3），随后归零，第 6 天再次触发。
    expect(triggers).toEqual([3, 6])
  })

  it("阈值 5 时第 5 天才触发（间隔在 3~5 间浮动，而不是第 3、4、5 次各分析一次）", () => {
    let state: StyleEvolutionScheduleState = { ...emptyScheduleState(), nextThreshold: 5 }
    const triggers: number[] = []
    for (let day = 1; day <= 5; day += 1) {
      const r = advanceOpenDay(state, T(day))
      state = r.state
      if (r.shouldAnalyze) triggers.push(day)
    }
    expect(triggers).toEqual([5])
  })
})

describe("阈值边界：恰好等于 / 大于 / 小于", () => {
  const at = (count: number): StyleEvolutionScheduleState => ({
    ...emptyScheduleState(),
    openDayCount: count,
    nextThreshold: 3,
  })

  it("小于阈值不触发", () => {
    expect(advanceOpenDay(at(1), T(9)).shouldAnalyze).toBe(false)
  })

  it("恰好等于阈值触发", () => {
    const r = advanceOpenDay(at(2), T(9))
    expect(r.shouldAnalyze).toBe(true)
    expect(r.state.openDayCount).toBe(3)
  })

  it("已经大于阈值（上一轮失败留下的）照样触发", () => {
    const r = advanceOpenDay(at(4), T(9))
    expect(r.shouldAnalyze).toBe(true)
    expect(r.state.openDayCount).toBe(5)
  })
})

describe("completeRound：归零只属于「一轮完整跑完」", () => {
  it("归零、抽新阈值、记 lastAnalyzedOn", () => {
    const before: StyleEvolutionScheduleState = {
      ...emptyScheduleState(),
      openDayCount: 3,
      lastOpenDate: T(3),
      lastAttemptedOn: T(3),
    }
    const after = completeRound(before, T(3), seqRng([0.5]))
    expect(after.openDayCount).toBe(0)
    expect(after.nextThreshold).toBe(4)
    expect(after.lastAnalyzedOn).toBe(T(3))
    expect(after.lastAttemptedOn).toBe(T(3))
  })

  it("归零之后同一天再打开，不再触发（这一轮已经跑完了）", () => {
    let state: StyleEvolutionScheduleState = { ...emptyScheduleState(), openDayCount: 3 }
    const fired = advanceOpenDay(state, T(7))
    state = completeRound(fired.state, T(7), seqRng([0]))
    expect(advanceOpenDay(state, T(7)).shouldAnalyze).toBe(false)
  })

  it("新阈值永远落在 {3,4,5}", () => {
    for (const v of [0, 0.2, 0.5, 0.8, 0.99]) {
      const after = completeRound(emptyScheduleState(), T(1), seqRng([v]))
      expect(THRESHOLD_RANGE).toContain(after.nextThreshold)
    }
  })
})

describe("失败不推进计数（边界①）", () => {
  it("达到阈值但没跑成：计数保留在阈值之上，且不写 lastAnalyzedOn", () => {
    let state = emptyScheduleState()
    // 连开 3 天，第 3 天达到阈值
    for (let day = 1; day <= 3; day += 1) {
      const r = advanceOpenDay(state, T(day))
      state = r.state
      expect(r.shouldAnalyze).toBe(day === 3)
    }
    // 假设这一轮失败了：**不调用** completeRound
    expect(state.openDayCount).toBe(3)
    expect(state.lastAnalyzedOn).toBeNull()

    // 下一个打开日应当自动重试（不需要额外标记）
    const retry = advanceOpenDay(state, T(4))
    expect(retry.shouldAnalyze).toBe(true)
    expect(retry.state.openDayCount).toBe(4)
  })

  it("反例对照：若在达到阈值时就归零，重试将永远等不到（这条用例锁住那个错法）", () => {
    // 模拟「错误实现」：达到阈值就归零
    const buggy = { ...emptyScheduleState(), openDayCount: 3, lastOpenDate: T(3) }
    const wronglyReset = { ...buggy, openDayCount: 0, lastOpenDate: T(4) }
    // 下一日：0+1=1 < 3 ⇒ 不分析。用户的 3 天白等了。
    expect(advanceOpenDay(wronglyReset, T(4)).shouldAnalyze).toBe(false)
    // 而正确实现（计数保留）在下一日立刻重试：
    const correct = { ...emptyScheduleState(), openDayCount: 3, lastOpenDate: T(3), lastAttemptedOn: T(3) }
    expect(advanceOpenDay(correct, T(4)).shouldAnalyze).toBe(true)
  })
})

describe("remainingOpenDays：界面要显示「还需 N 次打开」", () => {
  it("按当前计数算还差几次", () => {
    expect(remainingOpenDays({ ...emptyScheduleState(), nextThreshold: 4, openDayCount: 1 })).toBe(3)
    expect(remainingOpenDays({ ...emptyScheduleState(), nextThreshold: 4, openDayCount: 2 })).toBe(2)
  })

  it("已经到阈值时返回 0（不是负数）", () => {
    // 失败后计数会停在阈值之上，界面不能显示「还需 -1 次」。
    expect(remainingOpenDays({ ...emptyScheduleState(), nextThreshold: 3, openDayCount: 3 })).toBe(0)
    expect(remainingOpenDays({ ...emptyScheduleState(), nextThreshold: 3, openDayCount: 5 })).toBe(0)
  })
})

/*
 * 跨模块对齐：节律的「打开日」必须与 `user-memory/learning-budget.ts` 的 `dayKey`
 * 是**同一个口径**。
 *
 * 两边都在按「天」计数，但用途完全无关，所以很容易各自演化出不同的日期算法。
 * 一旦其中一份改用 UTC（`toISOString().slice(0, 10)`），东八区用户在清晨到
 * 早上 8 点之间打开项目，两个功能就会处在不同的「天」上 ——
 * 表现为「昨天刚分析过，今天怎么又分析了」这类无从复现的偶发。
 *
 * 这里不重写日期逻辑，只钉住「dayKey 的输出可以直接喂给 advanceOpenDay」。
 */
describe("与 dayKey 的口径一致", () => {
  it("dayKey 产出的日期串可直接作为打开日：同一天算 1 次、跨天算 2 次", () => {
    // 用本地时间构造，期望值与时区无关。
    const morning = dayKey(new Date(2026, 9, 11, 9, 0).getTime())
    const evening = dayKey(new Date(2026, 9, 11, 22, 0).getTime())
    const nextDay = dayKey(new Date(2026, 9, 12, 9, 0).getTime())

    expect(morning).toBe(evening) // 同一天
    expect(nextDay).not.toBe(morning)

    const first = advanceOpenDay(emptyScheduleState(), morning)
    expect(first.state.openDayCount).toBe(1)

    // 同一天晚些时候再打开：仍是 1 次
    const sameDayAgain = advanceOpenDay(first.state, evening)
    expect(sameDayAgain.state.openDayCount).toBe(1)

    // 第二天：2 次
    const second = advanceOpenDay(sameDayAgain.state, nextDay)
    expect(second.state.openDayCount).toBe(2)
  })

  it("空串不是合法的打开日，会被当成新的一天（防止「从未打开」被误判为同一天）", () => {
    // 初值 lastOpenDate 是 ""。若把 "" 也当「同一天」，第一次打开就永远不计数。
    const state = emptyScheduleState()
    expect(state.lastOpenDate).toBe("")
    expect(advanceOpenDay(state, dayKey(new Date(2026, 9, 11, 9, 0).getTime())).state.openDayCount).toBe(1)
  })
})
