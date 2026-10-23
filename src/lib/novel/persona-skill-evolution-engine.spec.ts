import { describe, expect, it } from "vitest"
import {
  buildPersonaEvolutionCandidatePrompt,
  buildPersonaPairJudgePrompt,
  parsePersonaEvolutionCandidate,
  parsePersonaPairJudgement,
  runPersonaSkillEvolutionRound,
  type PersonaSkillEvolutionIO,
} from "./persona-skill-evolution-engine"
import {
  emptyPersonaEvolutionState,
  type PersonaSkillEvolutionState,
} from "./persona-skill-evolution-store"
import type { PersonaSkillIndex, PersonaSkillMeta } from "./persona-skill-types"

const TODAY = "2026-10-12"

function meta(overrides: Partial<PersonaSkillMeta> = {}): PersonaSkillMeta {
  return {
    id: "林清越",
    characterName: "林清越",
    aliases: [],
    roleType: "男主",
    tier: "major",
    pinned: false,
    status: "active",
    firstChapter: 1,
    lastChapter: 5,
    appearanceCount: 5,
    createdChapter: 1,
    lastLearnedChapter: 5,
    skillRevision: 3,
    editedByUser: false,
    hasResearch: false,
    updatedAt: "2026-10-12T01:00:00.000Z",
    ...overrides,
  }
}

/**
 * 「到期」的节律状态：昨天是第 2 个打开日、阈值 3 —— 今天一打开就该分析。
 * 与文风节律同构，不再复测 advanceOpenDay 本身的穷举（那边已经钉死）。
 */
function dueState(overrides: Partial<PersonaSkillEvolutionState> = {}): PersonaSkillEvolutionState {
  return {
    ...emptyPersonaEvolutionState(),
    enabled: true,
    lastOpenDate: "2026-10-11",
    openDayCount: 2,
    nextThreshold: 3,
    ...overrides,
  }
}

const DOCUMENT = [
  "# 林清越 · 人物 Skill",
  "",
  "## 怎么说话",
  "句子短。",
  "",
  "## 怎么想",
  "先算代价。",
  "",
  "## 怎么判断",
  "看人先看手。",
  "",
  "## 什么不做",
  "不拿无辜者交换。",
  "",
  "## 知道局限",
  "不知道沈砚的身份。",
].join("\n")

const CANDIDATE = {
  problems: ["怎么说话只有一句，缺句式示例"],
  fields: {
    怎么说话: "句子短，先问后答。被逼急了会连说三个「好」。",
    怎么想: "先算代价，再算人情。",
    怎么判断: "看人先看手。",
    什么不做: "不拿无辜者交换。",
    知道局限: "不知道沈砚的身份。",
  },
  reasons: { 怎么说话: "补句式示例，修可演性" },
  sample: {
    anchor: "码头对峙",
    base: "他冷冷地看着对方。",
    candidate: "他先看对方的手，再看脸，才开口。",
  },
}

const EVIDENCE = [{ chapterNumber: 5, text: "林清越站在码头上，先看对方的手，再开口。" }]

interface HarnessOptions {
  state?: PersonaSkillEvolutionState
  index?: PersonaSkillMeta[]
  document?: string
  candidate?: typeof CANDIDATE | null
  /** 评委按顺序吐票；循环取用。传 null 表示评委调用失败（弃权）。 */
  judgements?: Array<Parameters<PersonaSkillEvolutionIO["judgePair"]> extends never ? never : Awaited<ReturnType<PersonaSkillEvolutionIO["judgePair"]>>>
  failGenerate?: boolean
  failApply?: boolean
}

function harness(options: HarnessOptions = {}) {
  const saved: PersonaSkillEvolutionState[] = []
  const applied: Array<{ id: string; document: string }> = []
  let judgeIndex = 0

  const io: PersonaSkillEvolutionIO = {
    loadState: async () => options.state ?? dueState(),
    saveState: async (state) => {
      saved.push(state)
    },
    loadIndex: async (): Promise<PersonaSkillIndex> => ({
      version: 1,
      skills: options.index ?? [meta()],
    }),
    loadDocument: async () => options.document ?? DOCUMENT,
    loadEvidence: async () => EVIDENCE,
    generateCandidate: async () => {
      if (options.failGenerate) throw new Error("模型超时")
      return options.candidate === undefined ? CANDIDATE : options.candidate
    },
    judgePair: async () => {
      const list = options.judgements
      if (!list || list.length === 0) return null
      const judgement = list[judgeIndex % list.length]
      judgeIndex += 1
      return judgement
    },
    applyCandidate: async (id, document) => {
      if (options.failApply) throw new Error("写盘失败")
      applied.push({ id, document })
      // harness 的索引是常量快照：落盘不改 updatedAt，回传当前值即可。
      // 「真实落盘改了 updatedAt」的路径由下面单独一条用例覆盖。
      const target = (options.index ?? [meta()]).find((item) => item.id === id)
      return { updatedAt: target?.updatedAt ?? meta().updatedAt }
    },
  }

  return { io, saved, applied }
}

describe("runPersonaSkillEvolutionRound — 节律与闸门", () => {
  it("开关关闭时直接跳过，不推进任何计数", async () => {
    const { io, saved } = harness({ state: dueState({ enabled: false }) })
    const result = await runPersonaSkillEvolutionRound(io, { now: TODAY })

    expect(result.status).toBe("skipped-disabled")
    expect(saved).toHaveLength(0)
  })

  it("未到打开日阈值时跳过，但节律计数要落盘", async () => {
    const { io, saved } = harness({
      state: dueState({ lastOpenDate: "2026-10-11", openDayCount: 0 }),
    })
    const result = await runPersonaSkillEvolutionRound(io, { now: TODAY })

    expect(result.status).toBe("skipped-not-due")
    expect(saved).toHaveLength(1)
    expect(saved[0].openDayCount).toBe(1)
    expect(saved[0].lastAttemptedOn).toBe("")
  })

  it("所有人物的当前学习版都处理过了：跳过（新素材闸门）", async () => {
    // processedAt 记下了每个人的 updatedAt —— 没有未处理的新学习，进化只会
    // 把上一轮的结论再演一遍。
    const { io, saved } = harness({
      state: dueState({ processedAt: { 林清越: "2026-10-12T01:00:00.000Z" } }),
    })
    const result = await runPersonaSkillEvolutionRound(io, { now: TODAY })

    expect(result.status).toBe("skipped-no-new-material")
    expect(saved).toHaveLength(1)
    expect(saved[0].lastAnalyzedOn).toBeNull()
  })
})

describe("runPersonaSkillEvolutionRound — 棘轮", () => {
  it("多数评委判 candidate 更好：候选落盘、历史快照、节律收尾", async () => {
    const { io, saved, applied } = harness({
      judgements: [
        { verdict: "candidate", margin: "clear", reason: "补了句式示例" },
        { verdict: "candidate", margin: "slight", reason: "更贴合原文" },
        { verdict: "base", margin: "slight", reason: "旧版更简洁" },
      ],
    })
    const result = await runPersonaSkillEvolutionRound(io, { now: TODAY })

    expect(result.status).toBe("completed")
    expect(result.outcome).toBe("kept")
    expect(applied).toHaveLength(1)
    expect(applied[0].id).toBe("林清越")
    // 候选文档是渲染后的完整 SKILL.md（含标题与五字段），不是裸 JSON
    expect(applied[0].document).toContain("# 林清越 · 人物 Skill")
    expect(applied[0].document).toContain("被逼急了会连说三个「好」")

    const final = saved[saved.length - 1]
    expect(final.rounds).toHaveLength(1)
    expect(final.rounds[0].outcome).toBe("kept")
    expect(final.rounds[0].characterNames).toEqual(["林清越"])
    expect(final.rounds[0].votes?.[0]).toContain("林清越 2-1")
    // completeRound：计数归零、抽新阈值、记录分析日
    expect(final.openDayCount).toBe(0)
    expect(final.lastAnalyzedOn).toBe(TODAY)
    expect([3, 4, 5]).toContain(final.nextThreshold)
    // 逐人记账：这一版处理过了（否则下一轮会拿同一份候选再审一遍）
    expect(final.processedAt["林清越"]).toBe("2026-10-12T01:00:00.000Z")
  })

  it("升级落盘后记的是**新** updatedAt：下一轮不会把同一个人再进化一次", async () => {
    // 真实 applyCandidate 会把索引里的 updatedAt 改成「现在」。引擎若仍记旧值，
    // 新素材闸门永远认为「这一版没处理过」→ 每个节律周期都重写同一个人的
    // 说话方式，而且每轮都拿同样的证据、重新诊断一遍。
    const NEW_UPDATED_AT = "2026-10-12T09:00:00.000Z"
    const { io, applied } = harness({
      judgements: [{ verdict: "candidate", margin: "clear", reason: "更可演" }],
    })
    let skills: PersonaSkillMeta[] = [meta()]
    let latest = dueState()
    const realIO: PersonaSkillEvolutionIO = {
      ...io,
      loadState: async () => latest,
      saveState: async (state) => {
        latest = state
      },
      loadIndex: async (): Promise<PersonaSkillIndex> => ({ version: 1, skills: [...skills] }),
      applyCandidate: async (id, document) => {
        applied.push({ id, document })
        skills = skills.map((item) => (item.id === id ? { ...item, updatedAt: NEW_UPDATED_AT } : item))
        return { updatedAt: NEW_UPDATED_AT }
      },
    }

    const first = await runPersonaSkillEvolutionRound(realIO, { now: TODAY })
    expect(first.status).toBe("completed")
    expect(applied).toHaveLength(1)
    expect(first.state.processedAt["林清越"]).toBe(NEW_UPDATED_AT)

    // 下一个打开日、节律强行到期：没有新学习 → 直接歇，不再动同一份档案
    latest = {
      ...latest,
      lastOpenDate: "2026-10-12",
      lastAttemptedOn: "",
      openDayCount: 3,
      nextThreshold: 3,
    }
    const second = await runPersonaSkillEvolutionRound(realIO, { now: "2026-10-13" })
    expect(second.status).toBe("skipped-no-new-material")
    expect(applied).toHaveLength(1)
  })

  it("多数评委判旧版更好：棘轮回退，一个字节都不落盘，但轮次照记", async () => {
    const { io, saved, applied } = harness({
      judgements: [
        { verdict: "base", margin: "clear", reason: "候选与原文冲突" },
        { verdict: "base", margin: "clear", reason: "候选编造了没发生的情节" },
        { verdict: "candidate", margin: "slight", reason: "稍具体" },
      ],
    })
    const result = await runPersonaSkillEvolutionRound(io, { now: TODAY })

    expect(result.status).toBe("completed")
    expect(result.outcome).toBe("reverted")
    expect(applied).toHaveLength(0)
    const final = saved[saved.length - 1]
    expect(final.rounds[0].outcome).toBe("reverted")
    expect(final.openDayCount).toBe(0)
  })

  it("平局不算退步（达尔文乐观棘轮）：1 better + 1 worse + 1 tie 仍保留", async () => {
    const { io, applied } = harness({
      judgements: [
        { verdict: "candidate", margin: "slight", reason: "更好" },
        { verdict: "base", margin: "slight", reason: "更差" },
        { verdict: "tie", margin: "slight", reason: "差不多" },
      ],
    })
    const result = await runPersonaSkillEvolutionRound(io, { now: TODAY })

    expect(result.outcome).toBe("kept")
    expect(applied).toHaveLength(1)
  })

  it("有效评委不足 2 个时不动档案：拿不出可信的多数决", async () => {
    const { io, saved, applied } = harness({ judgements: [null, null, null] })
    const result = await runPersonaSkillEvolutionRound(io, { now: TODAY })

    expect(result.status).toBe("completed")
    expect(applied).toHaveLength(0)
    const final = saved[saved.length - 1]
    expect(final.rounds[0].outcome).toBe("reverted")
    expect(final.rounds[0].votes?.[0]).toContain("有效评委不足")
  })
})

describe("runPersonaSkillEvolutionRound — 护栏", () => {
  it("被用户手改过的档案不参与进化：它不进待处理队列", async () => {
    const { io, saved, applied } = harness({
      index: [meta({ editedByUser: true })],
    })
    const result = await runPersonaSkillEvolutionRound(io, { now: TODAY })

    // 手改者从不 pending ⇒ 新素材闸门判「无事可做」。incomplete 分支留给
    // 「闸门通过但选不出人」的防御性未来分叉。
    expect(result.status).toBe("skipped-no-new-material")
    expect(applied).toHaveLength(0)
    // 节律不推进（闸门跳过不计轮）
    const final = saved[saved.length - 1]
    expect(final.openDayCount).toBe(3)
    expect(final.lastAnalyzedOn).toBeNull()
  })

  it("手改与正常档案混合时：只进化正常那份，手改的不动也不记录", async () => {
    const { io, saved, applied } = harness({
      judgements: [{ verdict: "candidate", margin: "clear", reason: "更好" }],
      index: [meta({ id: "手改的", characterName: "手改的", editedByUser: true }), meta({ id: "正常的", characterName: "正常的" })],
    })
    const result = await runPersonaSkillEvolutionRound(io, { now: TODAY })

    expect(result.status).toBe("completed")
    expect(result.outcome).toBe("kept")
    expect(applied).toHaveLength(1)
    expect(applied[0].id).toBe("正常的")
    const final = saved[saved.length - 1]
    expect(Object.keys(final.processedAt)).toEqual(["正常的"])
  })

  it("候选体积超限（注水/整份重写）判废", async () => {
    const bloated = {
      ...CANDIDATE,
      fields: Object.fromEntries(
        Object.entries(CANDIDATE.fields).map(([key, value]) => [key, `${value}${"注水".repeat(600)}`]),
      ) as typeof CANDIDATE.fields,
    }
    const { io, applied } = harness({ candidate: bloated })
    const result = await runPersonaSkillEvolutionRound(io, { now: TODAY })

    expect(result.status).toBe("completed")
    expect(applied).toHaveLength(0)
    expect(result.votes?.[0]).toContain("候选体积超限")
  })

  it("生成阶段抛错收敛为 incomplete，不推进节律", async () => {
    const { io, saved, applied } = harness({ failGenerate: true })
    const result = await runPersonaSkillEvolutionRound(io, { now: TODAY })

    expect(result.status).toBe("incomplete")
    expect(result.reason).toContain("人物 Skill 进化失败")
    expect(applied).toHaveLength(0)
    const final = saved[saved.length - 1]
    expect(final.openDayCount).toBe(3)
    expect(final.lastAttemptedOn).toBe(TODAY)
  })
})

describe("runPersonaSkillEvolutionRound — 选择与配对", () => {
  it("每轮最多 2 个人物，排序：pinned → major → 出场多", async () => {
    const seen: string[] = []
    const { io, applied } = harness({
      judgements: [
        { verdict: "candidate", margin: "clear", reason: "更好" },
        { verdict: "candidate", margin: "slight", reason: "更好" },
        { verdict: "candidate", margin: "slight", reason: "更好" },
      ],
      index: [
        meta({ id: "甲", characterName: "甲", pinned: false, tier: "minor", appearanceCount: 9 }),
        meta({ id: "乙", characterName: "乙", pinned: true, tier: "minor", appearanceCount: 1 }),
        meta({ id: "丙", characterName: "丙", pinned: false, tier: "major", appearanceCount: 3 }),
        meta({ id: "丁", characterName: "丁", pinned: false, tier: "major", appearanceCount: 8 }),
      ],
    })
    const wrappedIO: PersonaSkillEvolutionIO = {
      ...io,
      loadDocument: async () => DOCUMENT,
      generateCandidate: async (input) => {
        seen.push(input.characterName)
        return CANDIDATE
      },
    }
    await runPersonaSkillEvolutionRound(wrappedIO, { now: TODAY })

    expect(seen).toEqual(["乙", "丁"])
    expect(applied).toHaveLength(2)
  })

  it("同批 4 人不挨饿：第一轮消化 2 人，剩余 2 人下一轮仍是待处理", async () => {
    // 一轮章节学习同时更新 4 个人（updatedAt 相同），进化每轮只取 2 个。
    // 旧实现用全索引 max(updatedAt) 当基线，基线一次推到最前，第 3、4 人
    // 永远轮不到；逐人 processedAt 记账后，剩 2 人保持待处理。
    const seen: string[] = []
    const index = [
      meta({ id: "甲", characterName: "甲", lastLearnedChapter: 4 }),
      meta({ id: "乙", characterName: "乙", lastLearnedChapter: 4 }),
      meta({ id: "丙", characterName: "丙", lastLearnedChapter: 4 }),
      meta({ id: "丁", characterName: "丁", lastLearnedChapter: 4 }),
    ]
    const { io } = harness({
      judgements: [{ verdict: "candidate", margin: "clear", reason: "更好" }],
      index,
    })
    const trackingIO: PersonaSkillEvolutionIO = {
      ...io,
      generateCandidate: async (input) => {
        seen.push(input.characterName)
        return CANDIDATE
      },
    }

    const first = await runPersonaSkillEvolutionRound(trackingIO, { now: TODAY })
    expect(seen).toEqual(["丙", "丁"])
    expect(first.state.processedAt).toEqual({
      丙: "2026-10-12T01:00:00.000Z",
      丁: "2026-10-12T01:00:00.000Z",
    })

    // 第二轮：带着第一轮的 processedAt 再跑，选中的正是剩下的两人。
    // completeRound 抽的新阈值是随机的（3~5），这里固定成 3 让它当天到期。
    const secondSeen: string[] = []
    const secondIO: PersonaSkillEvolutionIO = {
      ...trackingIO,
      loadState: async () => ({
        ...first.state,
        openDayCount: 3,
        nextThreshold: 3,
        lastAttemptedOn: "",
        lastOpenDate: TODAY,
      }),
      generateCandidate: async (input) => {
        secondSeen.push(input.characterName)
        return CANDIDATE
      },
    }
    const second = await runPersonaSkillEvolutionRound(secondIO, { now: TODAY })
    expect(second.status).toBe("completed")
    expect(secondSeen).toEqual(["甲", "乙"])
  })

  it("消失 50 章后回归的角色（lastLearnedChapter 最新）优先获得进化机会", async () => {
    // 回归者带着最新鲜的章节素材回来，老资历的主角下轮还有机会，
    // 回归者错过就要再等一个 3~5 天的节律周期。三人竞争两个名额：
    // 若按出场次数排序，回归者（6 次）会输给老配角（30 次）；
    // 按 lastLearnedChapter 排，回归者（54）抢到第二个名额。
    const seen: string[] = []
    const { io } = harness({
      judgements: [{ verdict: "candidate", margin: "clear", reason: "更好" }],
      index: [
        meta({ id: "主角", characterName: "主角", pinned: true, lastLearnedChapter: 53, appearanceCount: 50 }),
        meta({ id: "老配角", characterName: "老配角", lastLearnedChapter: 53, appearanceCount: 30 }),
        meta({ id: "回归者", characterName: "回归者", lastLearnedChapter: 54, appearanceCount: 6 }),
      ],
    })
    const trackingIO: PersonaSkillEvolutionIO = {
      ...io,
      generateCandidate: async (input) => {
        seen.push(input.characterName)
        return CANDIDATE
      },
    }
    await runPersonaSkillEvolutionRound(trackingIO, { now: TODAY })

    expect(seen).toEqual(["主角", "回归者"])
  })

  it("证据加载取的是最近出场章本身（currentChapter = lastChapter + 1）", async () => {
    const requested: number[][] = []
    const { io } = harness()
    const wrappedIO: PersonaSkillEvolutionIO = {
      ...io,
      loadEvidence: async (_name, _aliases, chapters) => {
        requested.push([...chapters])
        return EVIDENCE
      },
    }
    await runPersonaSkillEvolutionRound(wrappedIO, { now: TODAY })
    expect(requested).toEqual([[5, 1]])
  })
})

describe("解析器", () => {
  it("候选解析：容忍围栏与前后杂质，五字段缺一不可", () => {
    const raw = [
      '好的，以下是改进后的档案：',
      "```json",
      JSON.stringify({ problems: ["缺示例"], fields: { 怎么说话: "句子短。", 怎么想: "先算代价。", 怎么判断: "看手。", 什么不做: "不交换。", 知道局限: "不知道。" }, reasons: {}, sample: { anchor: "码头", base: "a", candidate: "b" } }),
      "```",
    ].join("\n")
    const parsed = parsePersonaEvolutionCandidate(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.fields["怎么说话"]).toBe("句子短。")

    const missingField = parsePersonaEvolutionCandidate(
      JSON.stringify({ problems: [], fields: { 怎么说话: "句子短。" }, sample: { anchor: "a", base: "b", candidate: "c" } }),
    )
    expect(missingField).toBeNull()

    const missingSample = parsePersonaEvolutionCandidate(
      JSON.stringify({ problems: [], fields: { 怎么说话: "a", 怎么想: "b", 怎么判断: "c", 什么不做: "d", 知道局限: "e" } }),
    )
    expect(missingSample).toBeNull()
  })

  it("评委解析：verdict 非法时弃权，margin 非法回落 slight", () => {
    expect(parsePersonaPairJudgement('{"verdict":"candidate","margin":"clear","reason":"r"}')).toEqual({
      verdict: "candidate",
      margin: "clear",
      reason: "r",
    })
    expect(parsePersonaPairJudgement('{"verdict":"更好的","margin":"clear","reason":"r"}')).toBeNull()
    const loose = parsePersonaPairJudgement('{"verdict":"tie","margin":"很大","reason":"r"}')
    expect(loose!.margin).toBe("slight")
  })
})

describe("提示词", () => {
  it("生成提示词先诊断后改，且带出场原文锚点", () => {
    const prompt = buildPersonaEvolutionCandidatePrompt({
      characterName: "林清越",
      aliases: ["阿越"],
      document: DOCUMENT,
      evidence: EVIDENCE,
    })
    expect(prompt).toContain("【当前档案（整份，含档案页；本轮只改下面列出的 5 个演技字段）】")
    expect(prompt).toContain("先诊断，第二步再改进")
    expect(prompt).toContain("【第 5 章出场原文】")
    expect(prompt).toContain("不得引入出场原文之外的新设定")
    // 档案字段在文档里，但只要求改 5 个演技字段 —— 提示词必须说清，
    // 否则模型可能把「外貌 / 势力组织」也当成要改的内容塞回来。
    expect(prompt).toContain("不在本轮范围内")
    expect(prompt).toContain('"sample"')
  })

  it("评审提示词同一次调用内给出两版与演绎对照", () => {
    const prompt = buildPersonaPairJudgePrompt({
      characterName: "林清越",
      document: DOCUMENT,
      candidate: CANDIDATE,
      evidence: EVIDENCE,
    })
    expect(prompt).toContain("【A 版（现行档案中的五个演技字段）】")
    expect(prompt).toContain("【B 版（候选档案）】")
    expect(prompt).toContain("按 A 版写")
    expect(prompt).toContain("按 B 版写")
    expect(prompt).toContain("码头对峙")
    expect(prompt).toContain('{"verdict":"base|candidate|tie"')
  })

  it("评审的 A 版只截五个演技字段：不能拿 16 段的旧档案比 5 段的候选", () => {
    // 档案页新增 11 个字段后，A 版若给整份文档，评委是在比「信息量」而不是
    // 比「这一场怎么演他」—— 好候选会被「旧版更完整」系统性否决。
    const withProfile = [
      DOCUMENT,
      "",
      "## 性别",
      "",
      "男",
      "",
      "## 势力组织",
      "",
      "青云会",
      "",
      "## 关系网",
      "",
      "沈砚：旧识（互相提防）",
    ].join("\n")
    const prompt = buildPersonaPairJudgePrompt({
      characterName: "林清越",
      document: withProfile,
      candidate: CANDIDATE,
      evidence: EVIDENCE,
    })
    expect(prompt).not.toContain("青云会")
    expect(prompt).not.toContain("旧识（互相提防）")
    expect(prompt).toContain("句子短。")
  })
})
