import { describe, expect, it } from "vitest"
import {
  DEFAULT_ESTIMATED_CHARACTER_COUNT,
  SIMULATION_CALL_WARN_THRESHOLD,
  estimateSimulationCalls,
} from "@/lib/novel/story-simulation/types"

/**
 * 主推演是全软件最昂贵的一次操作（中等项目 175~415 次模型调用、几十分钟等待），
 * 而配置页此前没有任何预估或确认 —— 反倒是便宜得多的「舞台情景」有护栏
 * （SCENARIO_COST_WARN_THRESHOLD = 40）。这个估算函数就是补上那道护栏。
 */
describe("estimateSimulationCalls", () => {
  it("按 节点数 × 轮数 × 活跃角色 × 每轮调用数 估算（hybrid / 自动轮次）", () => {
    const estimate = estimateSimulationCalls({
      targetWords: 10000,
      simulationRounds: 0,
      mode: "hybrid",
      characterCount: 5,
    })

    // 1 万字 → 4 节点；自动轮数 max(2, 1) = 2；hybrid 乘数 1.2 → 2 轮
    expect(estimate.nodeCount).toBe(4)
    expect(estimate.roundsPerNode).toBe(2)
    // hybrid 活跃比例 0.85 → ceil(5 × 0.85) = 5
    expect(estimate.activeAgents).toBe(5)
    // P1-9 后早段走普通路径（每轮 1 次）：每轮新增 5 条可见事件，
    // 两轮可见数为 0/5，都在内联窗口 10 之内 → 全部普通路径。
    // 4 × 2 × 5 × 1 = 40
    expect(estimate.reactTurns).toBe(0)
    expect(estimate.agentCalls).toBe(40)
    // hybrid 的 strictNodeProgression 为 false，不做节点目标判定
    expect(estimate.embeddingCalls).toBe(0)
    // 固定开销：报告 1 次 + 逐节点草稿 4 次
    expect(estimate.fixedCalls).toBe(5)
    expect(estimate.total).toBe(45)
  })

  it("strict 模式把节点目标判定的 embedding 算进去", () => {
    const estimate = estimateSimulationCalls({
      targetWords: 30000,
      simulationRounds: 3,
      mode: "event-driven",
      characterCount: 5,
    })

    // 3 万字 → 6 节点；指定 3 轮；event-driven 乘数 0.8 → round(2.4) = 2 轮
    expect(estimate.nodeCount).toBe(6)
    expect(estimate.roundsPerNode).toBe(2)
    // 活跃比例 1 → 5 个角色全上
    expect(estimate.activeAgents).toBe(5)
    // 每轮新增 5 条可见事件，两轮可见数 0/5 都在窗口内 → 全普通路径
    // 6 × 2 × 5 × 1 = 60
    expect(estimate.agentCalls).toBe(60)
    // expectedOutcome 每节点缓存一次（6）+ 事件文本每轮一次（6 × 2）
    expect(estimate.embeddingCalls).toBe(18)
    expect(estimate.total).toBe(85)
  })

  it("启用导演 Agent 时每个非末节点多一次评估调用", () => {
    const withoutDirector = estimateSimulationCalls({
      targetWords: 30000,
      simulationRounds: 3,
      mode: "event-driven",
      characterCount: 5,
    })
    const withDirector = estimateSimulationCalls({
      targetWords: 30000,
      simulationRounds: 3,
      mode: "event-driven",
      characterCount: 5,
      directorEnabled: true,
    })

    // 引擎里导演只对 ni < totalNodes - 1 的节点评估
    expect(withDirector.directorCalls).toBe(5)
    expect(withoutDirector.directorCalls).toBe(0)
    expect(withDirector.total - withoutDirector.total).toBe(5)
  })

  it("配置阶段拿不到角色数时用保守默认值，且至少按 1 个角色算", () => {
    const withDefault = estimateSimulationCalls({
      targetWords: 10000,
      simulationRounds: 0,
      mode: "hybrid",
    })
    const withZero = estimateSimulationCalls({
      targetWords: 10000,
      simulationRounds: 0,
      mode: "hybrid",
      characterCount: 0,
    })

    expect(withDefault.activeAgents).toBe(
      Math.ceil(DEFAULT_ESTIMATED_CHARACTER_COUNT * 0.85),
    )
    expect(withZero.activeAgents).toBe(1)
  })

  it("决策树模式（活跃比例 0.5）活跃角色减半", () => {
    const estimate = estimateSimulationCalls({
      targetWords: 10000,
      simulationRounds: 4,
      mode: "decision-tree",
      characterCount: 6,
    })

    // decision-tree 乘数 1.0 → 4 轮；活跃比例 0.5 → ceil(6 × 0.5) = 3
    expect(estimate.roundsPerNode).toBe(4)
    expect(estimate.activeAgents).toBe(3)
    // 每轮新增 3 条，四轮可见数 0/3/6/9 都在窗口内 → 全普通路径：4 × 4 × 3 × 1
    expect(estimate.reactTurns).toBe(0)
    expect(estimate.agentCalls).toBe(48)
  })

  it("阈值与舞台情景同量级，且主推演很容易超过它", () => {
    expect(SIMULATION_CALL_WARN_THRESHOLD).toBe(40)

    // 最小配置（1 万字 / 2 轮 / 5 角色）就已经超过 40
    const smallest = estimateSimulationCalls({
      targetWords: 10000,
      simulationRounds: 2,
      mode: "event-driven",
      characterCount: 5,
    })
    expect(smallest.total).toBeGreaterThan(SIMULATION_CALL_WARN_THRESHOLD)
  })

  it("按 P1-9 的路径策略估算：早段普通路径每轮 1 次，可见历史超出窗口后才升级", () => {
    const estimate = estimateSimulationCalls({
      targetWords: 10000,
      simulationRounds: 0,
      mode: "hybrid",
      characterCount: 1,
    })

    // 4 节点 × 2 轮 × 1 角色
    expect(estimate.nodeCount).toBe(4)
    expect(estimate.roundsPerNode).toBe(2)
    expect(estimate.activeAgents).toBe(1)
    // 单角色每轮产生 1 条可见事件：第 0 轮 0 条、第 1 轮 1 条，都 ≤ 内联窗口 10，
    // 因此两轮都走普通路径 → 每轮 1 次调用，共 8 次。
    expect(estimate.reactTurns).toBe(0)
    expect(estimate.agentCalls).toBe(8)
  })

  it("角色多、轮次长时，后段会升级到 ReAct，估值随之高于纯普通路径", () => {
    const manyAgents = estimateSimulationCalls({
      targetWords: 30000,
      simulationRounds: 8,
      mode: "event-driven",
      characterCount: 5,
    })
    const oneAgent = estimateSimulationCalls({
      targetWords: 30000,
      simulationRounds: 8,
      mode: "event-driven",
      characterCount: 5,
    })

    // event-driven：5 个角色全上、每轮各产生 1 条可见事件 → 每轮新增 5 条，
    // 第 0、1、2 轮可见数 0/5/10 走普通路径，第 3 轮起 15 > 10 升级。
    expect(manyAgents.reactTurns).toBeGreaterThan(0)
    // 升级部分比普通路径贵，故总调用数高于「全部按 1 次/轮」的下限
    expect(manyAgents.agentCalls).toBeGreaterThan(
      manyAgents.nodeCount * manyAgents.roundsPerNode * manyAgents.activeAgents,
    )
    expect(oneAgent.agentCalls).toBe(manyAgents.agentCalls)
  })
})
