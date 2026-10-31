import { describe, expect, it, vi } from "vitest"

const io = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    io.files.set(path, contents)
  },
  fileExists: async (path: string) => io.files.has(path),
  createDirectory: async () => {},
}))

import { loadPersonaSkillEvolutionState } from "./persona-skill-evolution-store"
import { enablePersonaEvolutionOnFirstBuild } from "./persona-evolution-autostart"

const project = "C:/project"
const storeFile = `${project}/.qmai/persona-skill-evolution.json`

describe("enablePersonaEvolutionOnFirstBuild", () => {
  it("项目还没有进化状态文件时，建档后自动开启", async () => {
    const enabled = await enablePersonaEvolutionOnFirstBuild(project)
    expect(enabled).toBe(true)
    expect(JSON.parse(io.files.get(storeFile)!).enabled).toBe(true)
  })

  it("已经是开启状态时保持开启，且不重复写盘", async () => {
    io.files.set(storeFile, JSON.stringify({ version: 1, enabled: true, rounds: [] }))
    const before = io.files.get(storeFile)
    expect(await enablePersonaEvolutionOnFirstBuild(project)).toBe(true)
    expect(io.files.get(storeFile)).toBe(before)
  })

  it("用户手动关掉过就尊重用户：不擅自打开", async () => {
    // 关键约束：只在「从未开启过」时自动打开。
    // 用户明确关掉过一次（文件已存在且 enabled=false），再打开等于无视他的选择。
    io.files.set(storeFile, JSON.stringify({ version: 1, enabled: false, rounds: [], openDayCount: 2 }))
    expect(await enablePersonaEvolutionOnFirstBuild(project)).toBe(false)
    expect(JSON.parse(io.files.get(storeFile)!).enabled).toBe(false)
  })

  it("文件损坏时不抛，且不动用户配置（保守不覆盖）", async () => {
    // 文件损坏时无法分辨「从没启用」还是「用户关掉过」，
    // 此时宁可不开，也不能把一个可能是用户设置的文件覆盖掉。
    io.files.set(storeFile, "{坏 JSON")
    await expect(enablePersonaEvolutionOnFirstBuild(project)).resolves.toBe(false)
    expect(io.files.get(storeFile)).toBe("{坏 JSON")
  })

  it("保留已有轮次历史，不清空", async () => {
    io.files.set(storeFile, JSON.stringify({
      version: 1, enabled: true, rounds: [{ at: "2026-10-01", round: 1, outcome: "kept" }],
    }))
    await enablePersonaEvolutionOnFirstBuild(project)
    const state = await loadPersonaSkillEvolutionState(project)
    expect(state.enabled).toBe(true)
    expect(state.rounds).toHaveLength(1)
  })
})
