import { beforeEach, describe, expect, it, vi } from "vitest"

const io = vi.hoisted(() => {
  const files = new Map<string, string>()
  return { files }
})

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    io.files.set(path, contents)
  },
  createDirectory: async () => {},
}))

import {
  emptyPersonaEvolutionState,
  loadPersonaSkillEvolutionState,
  MAX_ROUND_HISTORY,
  savePersonaSkillEvolutionState,
  subscribePersonaSkillEvolution,
  type PersonaSkillEvolutionState,
} from "./persona-skill-evolution-store"

const project = "C:/project"
const storeFile = `${project}/.qmai/persona-skill-evolution.json`

function seed(contents: unknown) {
  io.files.set(storeFile, typeof contents === "string" ? contents : JSON.stringify(contents))
}

describe("loadPersonaSkillEvolutionState", () => {
  beforeEach(() => {
    io.files.clear()
  })

  it("文件缺失或坏 JSON 时回落到默认关闭的空状态", async () => {
    expect(await loadPersonaSkillEvolutionState(project)).toEqual(emptyPersonaEvolutionState())
    seed("{ 这不是 JSON")
    const state = await loadPersonaSkillEvolutionState(project)
    expect(state.enabled).toBe(false)
    expect(state.rounds).toEqual([])
  })

  it("enabled 只有显式 true 才算开：字符串 \"false\"、数字 1 都不行", async () => {
    seed({ enabled: "false", nextThreshold: 3 })
    expect((await loadPersonaSkillEvolutionState(project)).enabled).toBe(false)
    seed({ enabled: 1, nextThreshold: 3 })
    expect((await loadPersonaSkillEvolutionState(project)).enabled).toBe(false)
    seed({ enabled: true, nextThreshold: 3 })
    expect((await loadPersonaSkillEvolutionState(project)).enabled).toBe(true)
  })

  it("阈值非法值一律夹回 3：0 会让每次打开都分析，是最危险的静默绕过", async () => {
    seed({ enabled: true, nextThreshold: 0 })
    expect((await loadPersonaSkillEvolutionState(project)).nextThreshold).toBe(3)
    seed({ enabled: true, nextThreshold: 7 })
    expect((await loadPersonaSkillEvolutionState(project)).nextThreshold).toBe(3)
  })

  it("轮次历史截断到上限，坏条目（无 at / 非法 outcome）被丢弃", async () => {
    const rounds = Array.from({ length: MAX_ROUND_HISTORY + 10 }, (_, index) => ({
      at: "2026-10-12",
      round: index + 1,
      outcome: "kept",
    }))
    seed({ enabled: true, nextThreshold: 3, rounds: [...rounds, { round: 999 }, { at: "2026-10-12" }] })
    const state = await loadPersonaSkillEvolutionState(project)
    expect(state.rounds).toHaveLength(MAX_ROUND_HISTORY)
    expect(state.rounds.every((round) => round.round >= 1)).toBe(true)
  })
})

describe("savePersonaSkillEvolutionState 与订阅", () => {
  beforeEach(() => {
    io.files.clear()
  })

  it("写入前夹取一次：落盘的永远是合法值", async () => {
    const broken = {
      ...emptyPersonaEvolutionState(),
      enabled: "yes" as unknown as boolean,
      openDayCount: -5,
      nextThreshold: 9 as unknown as 3,
    }
    await savePersonaSkillEvolutionState(project, broken as PersonaSkillEvolutionState)

    const state = await loadPersonaSkillEvolutionState(project)
    expect(state.enabled).toBe(false)
    expect(state.openDayCount).toBe(0)
    expect(state.nextThreshold).toBe(3)
  })

  it("落盘后通知订阅者，且只通知本项目；取消订阅后不再通知", async () => {
    const seenProjects: string[] = []
    const unsubscribe = subscribePersonaSkillEvolution((changed) => {
      seenProjects.push(changed)
    })

    await savePersonaSkillEvolutionState(project, emptyPersonaEvolutionState())
    expect(seenProjects).toEqual([project])

    unsubscribe()
    await savePersonaSkillEvolutionState(project, emptyPersonaEvolutionState())
    expect(seenProjects).toEqual([project])
  })
})
