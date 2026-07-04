import { describe, expect, it } from "vitest"
import {
  getNodeStage,
  pickStagedEvent,
  type EventStage,
  type StagedEvent,
  type StagedEventPool,
} from "./event-pool-generator"

function makeEvent(id: string, text: string, stage: EventStage): StagedEvent {
  return { id, text, stage }
}

function makeTestPool(): StagedEventPool {
  const setup = [
    makeEvent("s1", "起阶段事件1", "setup"),
    makeEvent("s2", "起阶段事件2", "setup"),
    makeEvent("s3", "起阶段事件3", "setup"),
  ]
  const rising = [
    makeEvent("r1", "承阶段事件1", "rising"),
    makeEvent("r2", "承阶段事件2", "rising"),
    makeEvent("r3", "承阶段事件3", "rising"),
  ]
  const climax = [
    makeEvent("c1", "转阶段事件1", "climax"),
    makeEvent("c2", "转阶段事件2", "climax"),
    makeEvent("c3", "转阶段事件3", "climax"),
  ]
  const resolution = [
    makeEvent("re1", "合阶段事件1", "resolution"),
    makeEvent("re2", "合阶段事件2", "resolution"),
    makeEvent("re3", "合阶段事件3", "resolution"),
  ]
  const all = [...setup, ...rising, ...climax, ...resolution]
  return { byStage: { setup, rising, climax, resolution }, all }
}

describe("getNodeStage", () => {
  it("4节点：节点0为setup，节点3为resolution，中间为rising", () => {
    expect(getNodeStage(0, 4)).toBe("setup")
    expect(getNodeStage(1, 4)).toBe("rising")
    expect(getNodeStage(2, 4)).toBe("rising")
    expect(getNodeStage(3, 4)).toBe("resolution")
  })

  it("6节点：节点0为setup，节点5为resolution，4-5阈值为climax", () => {
    expect(getNodeStage(0, 6)).toBe("setup")
    expect(getNodeStage(1, 6)).toBe("rising")
    expect(getNodeStage(2, 6)).toBe("rising")
    expect(getNodeStage(3, 6)).toBe("rising")
    expect(getNodeStage(4, 6)).toBe("climax")
    expect(getNodeStage(5, 6)).toBe("resolution")
  })

  it("8节点：节点0为setup，节点7为resolution，6-7为climax（但7是resolution）", () => {
    expect(getNodeStage(0, 8)).toBe("setup")
    expect(getNodeStage(1, 8)).toBe("rising")
    expect(getNodeStage(2, 8)).toBe("rising")
    expect(getNodeStage(3, 8)).toBe("rising")
    expect(getNodeStage(4, 8)).toBe("rising")
    expect(getNodeStage(5, 8)).toBe("rising")
    expect(getNodeStage(6, 8)).toBe("climax")
    expect(getNodeStage(7, 8)).toBe("resolution")
  })

  it("边界：nodeIndex === 0 始终是 setup", () => {
    expect(getNodeStage(0, 1)).toBe("setup")
    expect(getNodeStage(0, 2)).toBe("setup")
    expect(getNodeStage(0, 10)).toBe("setup")
  })

  it("边界：nodeIndex === totalNodes - 1 始终是 resolution", () => {
    expect(getNodeStage(0, 1)).toBe("setup")
    expect(getNodeStage(1, 2)).toBe("resolution")
    expect(getNodeStage(9, 10)).toBe("resolution")
  })
})

describe("pickStagedEvent", () => {
  it("优先从当前阶段池抽取", () => {
    const pool = makeTestPool()
    const usedIds = new Set<string>()
    const result = pickStagedEvent(pool, usedIds, 0, 4)

    expect(result).not.toBeNull()
    expect(result?.stage).toBe("setup")
    expect(usedIds.has(result!.id)).toBe(false)
  })

  it("阶段池耗尽后回退全局池", () => {
    const pool = makeTestPool()
    const usedIds = new Set<string>(["s1", "s2", "s3"])

    const result = pickStagedEvent(pool, usedIds, 0, 4)

    expect(result).not.toBeNull()
    expect(result?.stage).not.toBe("setup")
    expect(usedIds.has(result!.id)).toBe(false)
  })

  it("全局池耗尽返回 null", () => {
    const pool = makeTestPool()
    const allIds = pool.all.map((e) => e.id)
    const usedIds = new Set<string>(allIds)

    const result = pickStagedEvent(pool, usedIds, 0, 4)

    expect(result).toBeNull()
  })

  it("各阶段抽取不重复（usedIds 生效）", () => {
    const pool = makeTestPool()
    const usedIds = new Set<string>()
    const pickedIds = new Set<string>()

    for (let i = 0; i < 12; i++) {
      const result = pickStagedEvent(pool, usedIds, 0, 4)
      if (result) {
        expect(pickedIds.has(result.id)).toBe(false)
        pickedIds.add(result.id)
        usedIds.add(result.id)
      }
    }

    expect(pickedIds.size).toBe(12)
    expect(pickStagedEvent(pool, usedIds, 0, 4)).toBeNull()
  })

  it("不同节点阶段从对应阶段抽取", () => {
    const pool = makeTestPool()

    const setupResult = pickStagedEvent(pool, new Set(), 0, 4)
    expect(setupResult?.stage).toBe("setup")

    const risingResult = pickStagedEvent(pool, new Set(), 1, 4)
    expect(risingResult?.stage).toBe("rising")

    const resolutionResult = pickStagedEvent(pool, new Set(), 3, 4)
    expect(resolutionResult?.stage).toBe("resolution")
  })

  it("空池返回 null", () => {
    const emptyPool: StagedEventPool = {
      byStage: { setup: [], rising: [], climax: [], resolution: [] },
      all: [],
    }

    const result = pickStagedEvent(emptyPool, new Set(), 0, 4)
    expect(result).toBeNull()
  })
})
