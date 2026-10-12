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

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: { getState: () => ({ bumpDataVersion: vi.fn() }) },
}))

import {
  runStyleEvolutionRound,
  MIN_TOTAL_CHARS,
  OUTLINE_MARKER,
  RECENT_CHAPTERS,
  buildAnalysisPrompt,
  buildFitText,
  pickProbePassages,
  selectAuthoredRecentChapters,
  selectRecentChapters,
  AI_SAMPLE_FALLBACK_NOTE,
  type StyleEvolutionDeps,
} from "./style-evolution-engine"
import { emptyState, loadStyleEvolutionState, saveStyleEvolutionState } from "./style-evolution-store"
import { advanceOpenDay } from "./style-evolution-schedule"
import { loadWritingStyleStore, setEnabledWritingStyle } from "./writing-style-store"

const PROJECT = "E:/Novel"
const DAY = "2026-10-11"

/** 生成一段够长的中文正文（重复同一句，只为凑字数与分段）。 */
function makeBody(seed: string, chars: number): string {
  const unit = `他${seed}看着窗外，雨还在下。\n\n“走吧。”她说。\n\n他没有回答，只是把烟按在栏杆上。\n\n`
  let text = ""
  while (text.length < chars) text += unit
  return text.slice(0, chars)
}

function makeBodies(count = 3, chars = 600): string[] {
  return Array.from({ length: count }, (_, i) => makeBody(String(i), chars))
}

/** 一份合法的候选画像 JSON。 */
function profileJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 2,
    generatedAt: 1770000000000,
    sampledChapterIds: [],
    integratedDna: "## 语言特征\n短句为主，平均句长 18 字。\n\n## 风格硬约束\n1. 环境描写不超过两句。",
    constitution: "1. 朴素克制\n2. 少形容词",
    samples: ["他点了根烟。"],
    ...overrides,
  })
}

/** 造一个已开启、且已攒够打开日的状态，让这一轮该跑。 */
async function primeDueState(projectPath = PROJECT, threshold = 3) {
  let state = { ...emptyState(), enabled: true, nextThreshold: threshold as 3 }
  // 攒够 threshold - 1 个打开日
  for (let d = 1; d < threshold; d += 1) {
    state = advanceOpenDay(state, `2026-10-${String(d).padStart(2, "0")}`).state
  }
  await saveStyleEvolutionState(projectPath, state)
  return state
}

/** 默认依赖：模型返回合法画像，章节够长。 */
function deps(overrides: Partial<StyleEvolutionDeps> = {}): StyleEvolutionDeps {
  return {
    now: DAY,
    rng: () => 0, // 阈值固定抽到 3
    collectChapterBodies: async () => makeBodies(),
    callModel: async () => profileJson(),
    ...overrides,
  }
}

const NEAR_TEXT =
  "他走进屋里，雨还在下。\n\n“你回来了。”她说。\n\n他没有答话，把伞靠在门边。\n\n灯亮着，桌上有一碗凉了的面。\n\n他坐下来，慢慢吃完。"
const FAR_TEXT =
  "在一个极其漫长而复杂的黄昏里，当所有关于往事的叙述都被迫挤进同一个句子之中并且不断叠加修饰成分的时候，人们往往会发现自己已经无法再像从前那样用简短干脆的方式去描述当时的心情与处境了。"

/**
 * 按提示词分流：情节要点提炼 ⇒ 要点 JSON；试写 ⇒ probe(prompt)；其余 ⇒ 画像 JSON。
 * 用提示词里的【基线画像】/【候选画像】区分角色，而不是数调用次数。
 */
function routedModel(probe: (prompt: string) => string, outlines = ["他回家，她在等。", "他吃完那碗面。"]) {
  return vi.fn(async (prompt: string) => {
    if (prompt.includes(OUTLINE_MARKER)) return JSON.stringify({ outlines })
    if (prompt.includes("只输出正文")) return probe(prompt)
    return profileJson()
  })
}

/** 第二轮用的章节：比首轮多两章，过得了新素材闸门。 */
const secondRoundBodies = async () => makeBodies(5)

beforeEach(() => {
  mem.clear()
})

describe("开关与节律", () => {
  it("开关关闭时一次模型调用都没有", async () => {
    await saveStyleEvolutionState(PROJECT, { ...emptyState(), enabled: false })
    const callModel = vi.fn(async () => profileJson())
    const collectChapterBodies = vi.fn(async () => makeBodies())

    const result = await runStyleEvolutionRound(PROJECT, deps({ callModel, collectChapterBodies }))

    expect(result.status).toBe("skipped-disabled")
    expect(callModel).not.toHaveBeenCalled()
    expect(collectChapterBodies).not.toHaveBeenCalled()
  })

  it("没到阈值时只记一次打开、不动模型", async () => {
    await saveStyleEvolutionState(PROJECT, { ...emptyState(), enabled: true })
    const callModel = vi.fn(async () => profileJson())

    const result = await runStyleEvolutionRound(PROJECT, deps({ callModel }))
    expect(result.status).toBe("skipped-not-due")
    expect(callModel).not.toHaveBeenCalled()

    // 计数 +1 必须已经落盘（不是只改了内存）
    const onDisk = await loadStyleEvolutionState(PROJECT)
    expect(onDisk.openDayCount).toBe(1)
    expect(onDisk.lastOpenDate).toBe(DAY)
  })

  /*
   * ★ 这条是「重入窗口」的正面验证。
   *
   * `hydrateDeferredProjectState` 是 void、没有 in-flight 锁，用户切书
   * A→B→A 就会再进一次。若 `lastAttemptedOn` 在**跑完模型之后**才落盘，
   * 那 40 秒里重入的那一次会把同一天算成两天，并起第二个并发轮次。
   * 所以这里在模型回调**内部**读盘，断言那一刻落盘的就已经是今天。
   */
  it("达到阈值时，在跑模型之前就把 lastAttemptedOn 落盘", async () => {
    await primeDueState()
    let observed: string | null = null

    const callModel = vi.fn(async () => {
      const onDisk = await loadStyleEvolutionState(PROJECT)
      observed = onDisk.lastAttemptedOn
      return profileJson()
    })

    await runStyleEvolutionRound(PROJECT, deps({ callModel }))

    expect(callModel).toHaveBeenCalled()
    expect(observed).toBe(DAY)
  })

  it("同一天再进一次不会再跑一轮（切书 A→B→A 不会重复烧 token）", async () => {
    await primeDueState()
    const callModel = vi.fn(async () => profileJson())

    const first = await runStyleEvolutionRound(PROJECT, deps({ callModel }))
    expect(first.status).toBe("completed")

    const second = await runStyleEvolutionRound(PROJECT, deps({ callModel }))
    expect(second.status).toBe("skipped-not-due")
    // 两轮加起来只跑了第一轮的那些调用
    const callsAfterSecond = callModel.mock.calls.length
    expect(callsAfterSecond).toBeLessThanOrEqual(2)
  })
})

describe("样本不足", () => {
  it("章节太少 ⇒ incomplete，不写预设、不推进计数、也不写轮次记录", async () => {
    await primeDueState()
    const callModel = vi.fn(async () => profileJson())

    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({ callModel, collectChapterBodies: async () => makeBodies(2, 600) }),
    )

    expect(result.status).toBe("incomplete")
    expect(callModel).not.toHaveBeenCalled()

    const state = await loadStyleEvolutionState(PROJECT)
    // 计数停在阈值之上：下一个打开日会自动重试
    expect(state.openDayCount).toBeGreaterThanOrEqual(3)
    expect(state.rounds).toEqual([])

    const styles = await loadWritingStyleStore(PROJECT)
    expect(styles.styles).toEqual([])
  })

  it("总字数不足 ⇒ incomplete（几行字算不出文风）", async () => {
    await primeDueState()
    const total = MIN_TOTAL_CHARS - 1
    const bodies = [makeBody("a", Math.floor(total / 3)), makeBody("b", Math.floor(total / 3)), makeBody("c", 10)]

    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({ collectChapterBodies: async () => bodies }),
    )
    expect(result.status).toBe("incomplete")
  })
})

describe("首轮：建立基线（bootstrap）", () => {
  it("没有基线时写候选预设、记 bootstrap、计数归零并抽新阈值", async () => {
    await primeDueState()

    const result = await runStyleEvolutionRound(PROJECT, deps())

    expect(result.status).toBe("completed")
    expect(result.outcome).toBe("bootstrap")

    const styles = await loadWritingStyleStore(PROJECT)
    expect(styles.styles).toHaveLength(1)
    expect(styles.styles[0].sourceBook).toContain("自动进化")
    // 用户明确要求：改进后先给我看再启用 ⇒ 写出来但**不许自动启用**
    expect(styles.enabledStyleId).toBeNull()

    const state = await loadStyleEvolutionState(PROJECT)
    expect(state.rounds).toHaveLength(1)
    expect(state.rounds[0].outcome).toBe("bootstrap")
    expect(state.openDayCount).toBe(0)
    expect([3, 4, 5]).toContain(state.nextThreshold)
  })

  it("候选 sourceBook 每轮唯一（否则会原地覆盖正在生效的画像）", async () => {
    await primeDueState()
    await runStyleEvolutionRound(PROJECT, deps())

    // 第二轮的 sourceBook 必须与第一轮不同
    let state = await loadStyleEvolutionState(PROJECT)
    state = { ...state, enabled: true, openDayCount: 3, lastOpenDate: "2026-10-20", lastAttemptedOn: "2026-10-20" }
    await saveStyleEvolutionState(PROJECT, state)

    const second = await runStyleEvolutionRound(
      PROJECT,
      deps({
        now: "2026-10-21",
        collectChapterBodies: secondRoundBodies,
        callModel: routedModel((prompt) => (prompt.includes("基线画像") ? FAR_TEXT : NEAR_TEXT)),
      }),
    )
    expect(second.outcome).toBe("kept")

    const styles = await loadWritingStyleStore(PROJECT)
    const sourceBooks = styles.styles.map((s) => s.sourceBook)
    expect(new Set(sourceBooks).size).toBe(sourceBooks.length)
    expect(sourceBooks.length).toBeGreaterThanOrEqual(1)
  })
})

describe("候选画像校验（垃圾一律作废，不落盘）", () => {
  it("模型返回的不是 JSON ⇒ incomplete，不写预设、不推进计数", async () => {
    await primeDueState()
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({ callModel: async () => "抱歉，我无法完成这个请求。" }),
    )

    expect(result.status).toBe("incomplete")
    expect((await loadWritingStyleStore(PROJECT)).styles).toEqual([])
    expect((await loadStyleEvolutionState(PROJECT)).openDayCount).toBeGreaterThanOrEqual(3)
  })

  it("合法 JSON 但 integratedDna 为空 ⇒ incomplete", async () => {
    await primeDueState()
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({ callModel: async () => profileJson({ integratedDna: "   " }) }),
    )
    expect(result.status).toBe("incomplete")
  })

  it("generatedAt 非有限数 ⇒ incomplete", async () => {
    await primeDueState()
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({ callModel: async () => profileJson({ generatedAt: "昨天" }) }),
    )
    expect(result.status).toBe("incomplete")
  })

  it("模型调用抛错 ⇒ incomplete，错误不外抛，计数不推进", async () => {
    await primeDueState()
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({
        callModel: async () => {
          throw new Error("网络断了")
        },
      }),
    )
    expect(result.status).toBe("incomplete")
    expect((await loadStyleEvolutionState(PROJECT)).openDayCount).toBeGreaterThanOrEqual(3)
  })

  /*
   * ★ 挡住「顺手补个 workbenchStyle」这个更糟的做法。
   *
   * writing-style-store 的两个注入分支是 if/else：一旦 profile.workbenchStyle
   * 存在，constitution 与 integratedDna **都不再注入**。所以一个 rules 为空的
   * workbenchStyle 会让注入内容缩成几行标题 —— 界面一切正常，内容却悄悄变空。
   * 本功能明确不产出它（见规格 01 节）。
   */
  it("写出的候选不携带空 rules 的 workbenchStyle（否则会静默丢掉正文）", async () => {
    await primeDueState()
    await runStyleEvolutionRound(PROJECT, deps())

    const styles = await loadWritingStyleStore(PROJECT)
    const profile = styles.styles[0].profile as unknown as Record<string, unknown>
    if (profile.workbenchStyle !== undefined) {
      const wb = profile.workbenchStyle as { rules?: unknown[]; styleFingerprint?: unknown }
      const usable = Array.isArray(wb.rules) && wb.rules.length > 0 && Boolean(wb.styleFingerprint)
      expect(usable, "workbenchStyle 必须要么真的可用，要么完全不设").toBe(true)
    }
    // 无论哪种情况，进化出来的正文都必须能注入
    expect(String(profile.integratedDna ?? "")).not.toBe("")
  })
})

describe("棘轮：keep / revert", () => {
  /** 先跑一轮 bootstrap，让盘上有一个「上一轮候选」当基线。 */
  async function bootstrapOnce() {
    await primeDueState()
    await runStyleEvolutionRound(PROJECT, deps())
  }

  /** 让第二轮该跑。 */
  async function makeSecondRoundDue() {
    const state = await loadStyleEvolutionState(PROJECT)
    await saveStyleEvolutionState(PROJECT, {
      ...state,
      enabled: true,
      openDayCount: 3,
      lastOpenDate: "2026-10-20",
      lastAttemptedOn: "2026-10-20",
    })
  }

  it("探测与判定都跑完但候选更远 ⇒ reverted，不写预设，计数仍归零", async () => {
    await bootstrapOnce()
    await makeSecondRoundDue()

    // 目标来自用户章节（短句、多对白、小段落）：基线写成同一路写法，候选写成一坨长句无对白。
    const callModel = routedModel((prompt) => (prompt.includes("基线画像") ? NEAR_TEXT : FAR_TEXT))

    const before = await loadWritingStyleStore(PROJECT)
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({ callModel, now: "2026-10-21", collectChapterBodies: secondRoundBodies }),
    )

    expect(result.status).toBe("completed")
    expect(result.outcome).toBe("reverted")

    // 不写新预设（数量不变）
    const after = await loadWritingStyleStore(PROJECT)
    expect(after.styles.length).toBe(before.styles.length)

    // 完整跑完 ⇒ 计数归零
    const state = await loadStyleEvolutionState(PROJECT)
    expect(state.openDayCount).toBe(0)
    expect(state.rounds[state.rounds.length - 1].outcome).toBe("reverted")
  })

  it("基线试写为空 ⇒ incomplete（拿不到可比对象，不许硬判）", async () => {
    await bootstrapOnce()
    await makeSecondRoundDue()

    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({
        now: "2026-10-21",
        collectChapterBodies: secondRoundBodies,
        callModel: routedModel(() => ""),
      }),
    )

    expect(result.status).toBe("incomplete")
    expect(result.outcome).toBeUndefined()
    /*
     * 没跑成 ⇒ 计数**不被归零**，而是停在阈值之上。
     * 断言恰好等于某个数字会很脆（阈值是抽出来的），这里断言真正的不变量：
     * 计数仍 ≥ 阈值 ⇒ 下一个打开日 advanceOpenDay 会自动再次判真、自动重试。
     */
    const state = await loadStyleEvolutionState(PROJECT)
    expect(state.openDayCount).toBeGreaterThanOrEqual(state.nextThreshold)
  })

  it("候选试写为空（基线正常）⇒ incomplete，且不写候选预设", async () => {
    await bootstrapOnce()
    await makeSecondRoundDue()
    const before = await loadWritingStyleStore(PROJECT)

    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({
        now: "2026-10-21",
        collectChapterBodies: secondRoundBodies,
        // 基线探针正常，候选探针一个字都不吐
        callModel: routedModel((prompt) => (prompt.includes("基线画像") ? NEAR_TEXT : "   ")),
      }),
    )

    expect(result.status).toBe("incomplete")
    // 关键：绝不能因为「量不出来」就当成改进
    const after = await loadWritingStyleStore(PROJECT)
    expect(after.styles).toHaveLength(before.styles.length)
  })
})

describe("候选清理：被启用的那条绝不能删", () => {
  async function bootstrapOnce() {
    await primeDueState()
    await runStyleEvolutionRound(PROJECT, deps())
  }

  async function makeSecondRoundDue() {
    const state = await loadStyleEvolutionState(PROJECT)
    await saveStyleEvolutionState(PROJECT, {
      ...state,
      enabled: true,
      openDayCount: 3,
      lastOpenDate: "2026-10-20",
      lastAttemptedOn: "2026-10-20",
    })
  }

  /** 让第二轮判 keep：候选探针与目标一致、基线探针离目标很远。 */
  function keepCallModel() {
    // 基线探针故意跑偏（一坨长句、无对白）；候选探针写成正常中文（短句 + 对白）
    return routedModel((prompt) => (prompt.includes("基线画像") ? FAR_TEXT : NEAR_TEXT))
  }

  it("上一轮候选未被启用 ⇒ 被清理掉，盘上不留垃圾", async () => {
    await bootstrapOnce()
    await makeSecondRoundDue()
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({ callModel: keepCallModel(), now: "2026-10-21", collectChapterBodies: secondRoundBodies }),
    )

    /*
     * 必须先确认这一轮真的走了 keep 分支。
     * 否则 revert 分支根本不写候选，`styles.length` 会天然很小，
     * 断言「≤2」和「sourceBook 唯一」都会白白通过 —— 等于没测到清理。
     */
    expect(result.outcome).toBe("kept")

    const styles = await loadWritingStyleStore(PROJECT)
    // 只剩本轮候选：上一轮那条既没被启用、又不是本轮候选，必须已被清掉
    expect(styles.styles).toHaveLength(1)
    expect(styles.styles[0].sourceBook).toContain("第 2 轮")
  })

  /*
   * ★★ 全功能最危险的一格：用户启用了候选之后，下一轮**绝不能**删掉它。
   * `removeWritingStylePresets` 在删掉当前启用项时会把 enabledStyleId 置 null
   * ⇒ 一次「清理」就把用户的文风整个关掉（从「有文风」变成「完全没有」）。
   */
  it("上一轮候选已被用户启用 ⇒ 必须保留，且 enabledStyleId 不被置空", async () => {
    await bootstrapOnce()

    // 用户启用了第一轮的候选
    const afterBootstrap = await loadWritingStyleStore(PROJECT)
    const enabledId = afterBootstrap.styles[0].id
    await setEnabledWritingStyle(PROJECT, enabledId)

    await makeSecondRoundDue()
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({ callModel: keepCallModel(), now: "2026-10-21", collectChapterBodies: secondRoundBodies }),
    )
    expect(result.outcome).toBe("kept")

    const styles = await loadWritingStyleStore(PROJECT)
    // 用户启用的那条 + 本轮新候选 = 2 条（本条候选**不能**把启用项挤掉）
    expect(styles.styles).toHaveLength(2)
    expect(styles.styles.some((s) => s.id === enabledId)).toBe(true)
    // 而且它必须仍然是启用状态
    expect(styles.enabledStyleId).toBe(enabledId)
  })
})

describe("取样：只看最近的章节", () => {
  it("超过 RECENT_CHAPTERS 章时只留最后几章", () => {
    const chapters = selectRecentChapters(
      Array.from({ length: RECENT_CHAPTERS + 4 }, (_, i) => ({ key: `c${i}`, body: `第${i}章` })),
    )
    expect(chapters).toHaveLength(RECENT_CHAPTERS)
    expect(chapters[0].key).toBe("c4")
    expect(chapters[chapters.length - 1].key).toBe(`c${RECENT_CHAPTERS + 3}`)
  })

  it("分析提示词里每一章都有内容（不再只截最早的 12000 字）", () => {
    const fit = Array.from({ length: 6 }, (_, i) => `章节标记${i}` + "字".repeat(5000))
    const text = buildFitText(fit)
    for (let i = 0; i < 6; i += 1) expect(text).toContain(`章节标记${i}`)
    expect(text.length).toBeLessThanOrEqual(12000 + 6 * 20)
  })

  it("引擎实际送进分析提示词的是最近的章节", async () => {
    await primeDueState()
    const prompts: string[] = []
    const bodies = Array.from({ length: 12 }, (_, i) => `【章${i}】` + makeBody(String(i), 600))
    await runStyleEvolutionRound(
      PROJECT,
      deps({
        collectChapterBodies: async () => bodies,
        callModel: vi.fn(async (prompt: string) => {
          prompts.push(prompt)
          return profileJson()
        }),
      }),
    )
    expect(prompts[0]).not.toContain("【章0】")
    expect(prompts[0]).toContain("【章11】")
  })

  it("基线画像写进分析提示词；首轮不写", () => {
    const withBase = buildAnalysisPrompt({ fitBodies: ["a"], targetMetricsText: "m", baselineProfileText: "基线X" })
    const noBase = buildAnalysisPrompt({ fitBodies: ["a"], targetMetricsText: "m", baselineProfileText: null })
    expect(withBase).toContain("基线X")
    expect(noBase).not.toContain("当前正在用的画像")
  })

  it("检验片段：两章各取一段；只有一章时切成两段", () => {
    expect(pickProbePassages([makeBody("a", 1200), makeBody("b", 1200)])).toHaveLength(2)
    expect(pickProbePassages([makeBody("a", 1200)])).toHaveLength(2)
    expect(pickProbePassages([])).toEqual([])
  })
})

describe("取样：排除 AI 为主的章节", () => {
  const chapter = (i: number, aiRatio: number | null) => ({ key: `c${i}`, body: `第${i}章`, aiRatio })

  it("AI 字占比 > 85% 的章节被排除；未知占比按作者文本保留", () => {
    const result = selectAuthoredRecentChapters([
      chapter(0, 0.1), chapter(1, 0.95), chapter(2, null), chapter(3, 0.85), chapter(4, 1),
    ])
    expect(result.chapters.map((c) => c.key)).toEqual(["c0", "c2", "c3"])
    expect(result.note).toBeUndefined()
  })

  it("排除后不够 3 章 ⇒ 退回全部章节并带提醒", () => {
    const result = selectAuthoredRecentChapters([chapter(0, 0.1), chapter(1, 0.95), chapter(2, 0.99)])
    expect(result.chapters).toHaveLength(3)
    expect(result.note).toBe(AI_SAMPLE_FALLBACK_NOTE)
  })

  it("引擎把提醒带进结果；送进模型的是作者章节", async () => {
    await primeDueState()
    const prompts: string[] = []
    const chapters = [
      ...Array.from({ length: 3 }, (_, i) => ({ key: `h${i}`, body: `【作者${i}】` + makeBody(String(i), 600), aiRatio: 0 })),
      { key: "ai", body: "【AI章】" + makeBody("x", 600), aiRatio: 1 },
    ]
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({
        collectChapterBodies: async () => chapters,
        callModel: vi.fn(async (prompt: string) => {
          prompts.push(prompt)
          return profileJson()
        }),
      }),
    )
    expect(result.sampleNote).toBeUndefined()
    expect(prompts[0]).not.toContain("【AI章】")

  })

  it("只能退回 AI 章节时，结果里带 sampleNote", async () => {
    await primeDueState()
    const chapters = Array.from({ length: 3 }, (_, i) => ({ key: `a${i}`, body: makeBody(String(i), 600), aiRatio: 1 }))
    const result = await runStyleEvolutionRound(PROJECT, deps({ collectChapterBodies: async () => chapters }))
    expect(result.status).toBe("completed")
    expect(result.sampleNote).toBe(AI_SAMPLE_FALLBACK_NOTE)
  })
})

describe("新素材闸门", () => {
  async function bootstrapThenDue() {
    await primeDueState()
    await runStyleEvolutionRound(PROJECT, deps())
    const state = await loadStyleEvolutionState(PROJECT)
    expect(state.lastSampledChapterKeys.length).toBeGreaterThan(0)
    await saveStyleEvolutionState(PROJECT, {
      ...state,
      openDayCount: 3,
      lastOpenDate: "2026-10-20",
      lastAttemptedOn: "2026-10-20",
    })
  }

  it("章节没变 ⇒ skipped-no-new-material，不调模型，计数保留到下次", async () => {
    await bootstrapThenDue()
    const callModel = vi.fn(async () => profileJson())

    const result = await runStyleEvolutionRound(PROJECT, deps({ callModel, now: "2026-10-21" }))

    expect(result.status).toBe("skipped-no-new-material")
    expect(callModel).not.toHaveBeenCalled()
    const state = await loadStyleEvolutionState(PROJECT)
    expect(state.openDayCount).toBeGreaterThanOrEqual(state.nextThreshold)
  })

  it("只多了一章 ⇒ 仍然跳过", async () => {
    await bootstrapThenDue()
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({ now: "2026-10-21", collectChapterBodies: async () => makeBodies(4) }),
    )
    expect(result.status).toBe("skipped-no-new-material")
  })

  it("多了两章 ⇒ 正常跑", async () => {
    await bootstrapThenDue()
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({
        now: "2026-10-21",
        collectChapterBodies: secondRoundBodies,
        callModel: routedModel(() => NEAR_TEXT),
      }),
    )
    expect(result.status).toBe("completed")
  })
})

describe("受控试写与配对判定", () => {
  async function bootstrapThenDue() {
    await primeDueState()
    await runStyleEvolutionRound(PROJECT, deps())
    const state = await loadStyleEvolutionState(PROJECT)
    await saveStyleEvolutionState(PROJECT, {
      ...state,
      openDayCount: 3,
      lastOpenDate: "2026-10-20",
      lastAttemptedOn: "2026-10-20",
    })
  }

  it("两份画像拿到的是同一份情节要点", async () => {
    await bootstrapThenDue()
    const probes: string[] = []
    await runStyleEvolutionRound(
      PROJECT,
      deps({
        now: "2026-10-21",
        collectChapterBodies: secondRoundBodies,
        callModel: routedModel((prompt) => {
          probes.push(prompt)
          return NEAR_TEXT
        }, ["要点甲", "要点乙"]),
      }),
    )
    expect(probes).toHaveLength(4)
    expect(probes.filter((p) => p.includes("要点甲"))).toHaveLength(2)
    expect(probes.filter((p) => p.includes("要点乙"))).toHaveLength(2)
    expect(probes.filter((p) => p.includes("要点甲") && p.includes("基线画像"))).toHaveLength(1)
    expect(probes.filter((p) => p.includes("要点甲") && p.includes("候选画像"))).toHaveLength(1)
  })

  it("要点提炼失败 ⇒ incomplete，不写候选", async () => {
    await bootstrapThenDue()
    const before = await loadWritingStyleStore(PROJECT)
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({
        now: "2026-10-21",
        collectChapterBodies: secondRoundBodies,
        callModel: vi.fn(async (prompt: string) => {
          if (prompt.includes(OUTLINE_MARKER)) return "不是 JSON"
          if (prompt.includes("只输出正文")) return NEAR_TEXT
          return profileJson()
        }),
      }),
    )
    expect(result.status).toBe("incomplete")
    expect((await loadWritingStyleStore(PROJECT)).styles).toHaveLength(before.styles.length)
  })

  it("只赢一组 ⇒ reverted（单次试写的偶然不算改进）", async () => {
    await bootstrapThenDue()
    const result = await runStyleEvolutionRound(
      PROJECT,
      deps({
        now: "2026-10-21",
        collectChapterBodies: secondRoundBodies,
        callModel: routedModel((prompt) => {
          const first = prompt.includes("要点甲")
          if (prompt.includes("基线画像")) return first ? FAR_TEXT : NEAR_TEXT
          return first ? NEAR_TEXT : FAR_TEXT
        }, ["要点甲", "要点乙"]),
      }),
    )
    expect(result.status).toBe("completed")
    expect(result.outcome).toBe("reverted")
  })

  it("基线优先用当前启用的文风，而不是上一轮候选", async () => {
    await bootstrapThenDue()
    const { upsertWritingStylePreset } = await import("./writing-style-store")
    const enabled = await upsertWritingStylePreset(PROJECT, {
      name: "用户自己的文风",
      sourceBook: "用户手动",
      profile: JSON.parse(profileJson({ integratedDna: "## 语言特征\n用户启用的独有标记\n\n## 风格硬约束\n1. x" })),
    })
    await setEnabledWritingStyle(PROJECT, enabled.id)

    const baselinePrompts: string[] = []
    await runStyleEvolutionRound(
      PROJECT,
      deps({
        now: "2026-10-21",
        collectChapterBodies: secondRoundBodies,
        callModel: routedModel((prompt) => {
          if (prompt.includes("基线画像")) baselinePrompts.push(prompt)
          return NEAR_TEXT
        }),
      }),
    )
    expect(baselinePrompts.length).toBeGreaterThan(0)
    expect(baselinePrompts.every((p) => p.includes("用户启用的独有标记"))).toBe(true)
  })

  it("跑完后不再缓存跨轮的探针指标", async () => {
    await bootstrapThenDue()
    await runStyleEvolutionRound(
      PROJECT,
      deps({ now: "2026-10-21", collectChapterBodies: secondRoundBodies, callModel: routedModel(() => NEAR_TEXT) }),
    )
    expect((await loadStyleEvolutionState(PROJECT)).probe).toBeNull()
  })
})
