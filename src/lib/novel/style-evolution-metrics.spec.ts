import { describe, expect, it } from "vitest"
import { computeStyleMetrics, type StyleMetricDerived } from "./book-analysis/style-metrics"
import {
  distance,
  EPSILON,
  flattenMetrics,
  METRIC_KEYS,
  METRIC_SCALES,
  resolveVerdict,
} from "./style-evolution-metrics"

/*
 * 指标折算：把「两份统计数字」变成「离用户的真实写法有多远」。
 *
 * 这是整个棘轮**唯一的判据**，所以它错的方式特别安静：
 * 若距离恒为 NaN，`候选取胜` 永远为假 ⇒ 表现成「功能一直没效果」，
 * 没有报错、没有日志、界面上一切正常。下面这几条用例就是为这个而写。
 */

/** 手工构造一个 derived，只覆盖被测字段，其余给 0。 */
function derived(partial: Partial<StyleMetricDerived>): StyleMetricDerived {
  return {
    avgSentenceChars: 0,
    shortSentenceRatio: 0,
    longSentenceRatio: 0,
    avgParagraphChars: 0,
    avgParagraphSentences: 0,
    oneSentenceParagraphRatio: 0,
    longParagraphRatio: 0,
    dialogueParagraphRatio: 0,
    punctuationPerThousand: {
      dash: 0,
      ellipsis: 0,
      quote: 0,
      exclamation: 0,
      question: 0,
      comma: 0,
      semicolon: 0,
      colon: 0,
    },
    latinCharRatio: 0,
    ...partial,
  }
}

const SHIFT = { avgSentenceChars: 30 }

describe("flattenMetrics", () => {
  it("把 punctuaionPerThousand 摊平成 8 个标量，而不是留成一个对象", () => {
    const vector = flattenMetrics(
      derived({
        punctuationPerThousand: {
          dash: 2,
          ellipsis: 1,
          quote: 8,
          exclamation: 1,
          question: 1,
          comma: 20,
          semicolon: 1,
          colon: 2,
        },
      }),
    )

    // 八个标点各自成键
    for (const k of ["dash", "ellipsis", "quote", "exclamation", "question", "comma", "semicolon", "colon"]) {
      expect(vector).toHaveProperty(`punctuationPerThousand.${k}`)
      expect(typeof vector[`punctuationPerThousand.${k}` as keyof typeof vector]).toBe("number")
    }
    expect(vector["punctuationPerThousand.quote"]).toBe(8)
    // 整个向量的每个分量都必须是有限数：留成对象的话 Math.abs 会给出 NaN
    for (const [key, value] of Object.entries(vector)) {
      expect(Number.isFinite(value), `${key} 不是有限数：${value}`).toBe(true)
    }
  })

  it("向量长度等于量表长度，且键与量表一一对应", () => {
    const vector = flattenMetrics(derived({}))
    expect(Object.keys(vector).sort()).toEqual([...METRIC_KEYS].sort())
  })

  it("缺字段 / 非有限数一律当 0，不把 NaN 传下去", () => {
    const broken = derived({})
    // 模拟「分析结果字段缺失」或「模型给了垃圾」
    const partial = {
      ...broken,
      avgSentenceChars: undefined,
      latinCharRatio: Number.NaN,
    } as unknown as StyleMetricDerived

    const vector = flattenMetrics(partial)
    expect(vector.avgSentenceChars).toBe(0)
    expect(vector.latinCharRatio).toBe(0)
    for (const value of Object.values(vector)) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe("distance", () => {
  it("同一份指标距离为 0", () => {
    expect(distance(flattenMetrics(derived({})), flattenMetrics(derived({})))).toBe(0)
    expect(distance(flattenMetrics(derived(SHIFT)), flattenMetrics(derived(SHIFT)))).toBe(0)
  })

  it("对称：a→b 与 b→a 相同", () => {
    const a = flattenMetrics(derived({ avgSentenceChars: 20, dialogueParagraphRatio: 0.1 }))
    const b = flattenMetrics(derived({ avgSentenceChars: 45, dialogueParagraphRatio: 0.6 }))
    expect(distance(a, b)).toBeCloseTo(distance(b, a), 10)
  })

  it("偏离越大，距离越大（单调）", () => {
    const base = flattenMetrics(derived({ avgSentenceChars: 30 }))
    const near = flattenMetrics(derived({ avgSentenceChars: 40 }))
    const far = flattenMetrics(derived({ avgSentenceChars: 59 }))

    expect(distance(near, base)).toBeGreaterThan(0)
    expect(distance(far, base)).toBeGreaterThan(distance(near, base))
  })

  /*
   * ★ 最关键的一条：纯中文文本下 latinCharRatio 恒为 0。
   * 若实现写成「除以目标值」（norm = x / target），这一步就是 0/0 = NaN，
   * 于是所有比较恒为 false，判定静默退化且**不报错**。
   * 所以这里既断言「不是 NaN」，也断言「仍是有限数」。
   */
  it("纯中文（latinCharRatio 为 0）时距离是有限数，不是 NaN", () => {
    const chinese = derived({ avgSentenceChars: 18, shortSentenceRatio: 0.5, latinCharRatio: 0 })
    const other = derived({ avgSentenceChars: 42, shortSentenceRatio: 0.1, latinCharRatio: 0 })

    const d = distance(flattenMetrics(chinese), flattenMetrics(other))
    expect(Number.isNaN(d)).toBe(false)
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBeGreaterThan(0)
  })

  it("端到端：真实中文文本的指标之间距离是有限数", () => {
    // 走真正的 computeStyleMetrics，让「文本 → 指标 → 向量 → 距离」跑通一遍。
    const a = computeStyleMetrics([
      "他点了根烟。\n\n「你来晚了。」她说。\n\n窗外下着雨，雨点打在铁皮棚上，声音又密又乱，像有人在楼上不停地倒豆子。",
    ])
    const b = computeStyleMetrics([
      "他点了根烟，慢慢地吸了一口，然后把烟按在栏杆上，看着楼下那条被雨水泡得发亮的巷子。\n\n「你来晚了。」她说这话的时候没有回头。",
    ])

    const d = distance(flattenMetrics(a.derived), flattenMetrics(b.derived))
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBeGreaterThan(0)

    // 纯中文样本 ⇒ 拉丁字符占比必须真的是 0，否则这条用例没测到那个边界
    expect(a.derived.latinCharRatio).toBe(0)
  })

  /*
   * 距离必须是**平均**，不是求和。
   *
   * 求和只是把结果乘上一个常数（项数），看起来"只是量纲不同"，
   * 但 ε 是**绝对**阈值：距离被放大 17 倍后，等于把 ε 悄悄放大 17 倍，
   * 于是「改善 0.06%」也会被当成改进 —— 棘轮开始接受噪声。
   * 所以这里把绝对尺度钉死。
   */
  it("只差一个满量纲维度时，距离恰好是 1/项数（证明是平均）", () => {
    const zero = flattenMetrics(derived({}))
    const oneOff = flattenMetrics(derived({ avgSentenceChars: METRIC_SCALES.avgSentenceChars }))
    expect(distance(zero, oneOff)).toBeCloseTo(1 / METRIC_KEYS.length, 12)
  })

  it("每个维度都差满量纲时，距离恰好是 1", () => {
    const zero = flattenMetrics(derived({}))
    const maxed = flattenMetrics(
      derived({
        shortSentenceRatio: 1,
        longSentenceRatio: 1,
        oneSentenceParagraphRatio: 1,
        longParagraphRatio: 1,
        dialogueParagraphRatio: 1,
        latinCharRatio: 1,
        avgSentenceChars: METRIC_SCALES.avgSentenceChars,
        avgParagraphChars: METRIC_SCALES.avgParagraphChars,
        avgParagraphSentences: METRIC_SCALES.avgParagraphSentences,
        punctuationPerThousand: {
          dash: 100,
          ellipsis: 100,
          quote: 100,
          exclamation: 100,
          question: 100,
          comma: 100,
          semicolon: 100,
          colon: 100,
        },
      }),
    )
    expect(distance(zero, maxed)).toBeCloseTo(1, 12)
  })

  it("量表里没有任何一项是 0（除零会立刻产生 Infinity）", () => {
    for (const key of METRIC_KEYS) {
      expect(METRIC_SCALES[key], `${key} 的量纲不能为 0`).toBeGreaterThan(0)
    }
  })

  it("距离本身有上界意义：极端差异不会溢出成 Infinity", () => {
    const low = flattenMetrics(derived({}))
    const high = flattenMetrics(
      derived({
        avgSentenceChars: 10000,
        avgParagraphChars: 100000,
        punctuationPerThousand: {
          dash: 10000,
          ellipsis: 10000,
          quote: 10000,
          exclamation: 10000,
          question: 10000,
          comma: 10000,
          semicolon: 10000,
          colon: 10000,
        },
      }),
    )
    expect(Number.isFinite(distance(low, high))).toBe(true)
  })
})

describe("resolveVerdict", () => {
  it("候选明显更近 ⇒ 保留", () => {
    const r = resolveVerdict(0.1, 0.3)
    expect(r.verdict).toBe("kept")
    expect(r.reason).toBe("improved")
  })

  it("候选更远 ⇒ 不保留", () => {
    const r = resolveVerdict(0.5, 0.3)
    expect(r.verdict).toBe("reverted")
    expect(r.reason).toBe("not-improved")
  })

  it("完全一样 ⇒ 不保留（没有证据就不采纳）", () => {
    expect(resolveVerdict(0.3, 0.3).verdict).toBe("reverted")
  })

  /*
   * ε 的边界必须用**二进制精确**的数来测。
   *
   * 先记一个踩过的坑：`resolveVerdict(0.3 - EPSILON, 0.3)` 看起来是「差值恰好等于 ε」，
   * 但在 double 下 `0.3 - 0.01 = 0.29` 并不精确，反算回来是 0.010000000000000009，
   * 比 ε 大一点点 ⇒ 会被判成 kept。那条用例测的其实是浮点表示，不是 `>` / `>=` 的语义。
   * 所以这里用 0.5 / 0.25 / 0.25 这类二进制可精确表示的值，
   * 让断言只针对「是否严格大于」。
   */
  it("改善幅度**恰好等于** ε ⇒ 不保留（必须是严格大于）", () => {
    // 0.5 - 0.25 === 0.25 精确成立
    const r = resolveVerdict(0.25, 0.5, 0.25)
    expect(r.delta).toBe(0.25)
    expect(r.verdict).toBe("reverted")
    expect(r.reason).toBe("not-improved")
  })

  it("改善幅度大于 ε ⇒ 保留", () => {
    expect(resolveVerdict(0.25, 0.5, 0.2).verdict).toBe("kept")
  })

  it("改善幅度小于 ε ⇒ 不保留（挡住抖动）", () => {
    expect(resolveVerdict(0.25, 0.5, 0.3).verdict).toBe("reverted")
  })

  /*
   * fail-closed：任何一路距离算不出来时，**绝不能**当成改进。
   * 「无法判定」的归宿是不采纳，而不是采纳 —— 否则一个 NaN 就能把
   * 一份没验证过的画像推给用户。
   */
  it("任一路是 NaN / Infinity ⇒ 不保留，且标记为无法判定", () => {
    for (const [cand, base] of [
      [Number.NaN, 0.3],
      [0.1, Number.NaN],
      [Number.POSITIVE_INFINITY, 0.3],
      [0.1, Number.POSITIVE_INFINITY],
    ] as const) {
      const r = resolveVerdict(cand, base)
      expect(r.verdict).toBe("reverted")
      expect(r.reason).toBe("undecidable")
    }
  })

  it("ε 默认取 0.01，且可被显式覆盖", () => {
    expect(EPSILON).toBe(0.01)
    // 差值 0.005：默认 ε 下不保留；把 ε 调小到 0.001 后保留
    expect(resolveVerdict(0.295, 0.3).verdict).toBe("reverted")
    expect(resolveVerdict(0.295, 0.3, 0.001).verdict).toBe("kept")
  })
})
