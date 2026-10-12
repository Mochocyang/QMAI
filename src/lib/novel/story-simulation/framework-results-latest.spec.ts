import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  loadLatestSimulationResult,
  loadSimulationResults,
} from "./framework-store"

/**
 * 内存文件系统（只实现 framework-store 真正用到的那几个函数）。
 *
 * 除了文件表，还记一份**读过的路径**：`loadLatestSimulationResult` 的存在意义
 * 就是「只读 1 个文件」，不把读次数记下来，这条契约就只能靠读源码相信。
 */
const io = vi.hoisted(() => ({
  files: new Map<string, string>(),
  reads: [] as string[],
}))

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    io.reads.push(path)
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFile: async (path: string, text: string) => { io.files.set(path, text) },
  writeFileAtomic: async (path: string, text: string) => { io.files.set(path, text) },
  createDirectory: async () => {},
  deleteFile: async (path: string) => { io.files.delete(path) },
  fileExists: async (path: string) =>
    io.files.has(path) || [...io.files.keys()].some((key) => key.startsWith(`${path}/`)),
  listDirectory: async (path: string) => {
    const prefix = `${path}/`
    const seen = new Set<string>()
    const entries: { name: string; path: string; is_dir: boolean }[] = []
    // ⚠️ 按**插入顺序**遍历：故意与「文件名倒序」不同，
    // 这样「取 entries[0]」这种偷懒实现会在这里露馅。
    for (const key of io.files.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const name = rest.split("/")[0]
      if (seen.has(name)) continue
      seen.add(name)
      entries.push({ name, path: `${prefix}${name}`, is_dir: rest.includes("/") })
    }
    return entries
  },
}))

const PROJECT = "/project"
const FRAMEWORK_ID = "fw-1"
const RESULTS_DIR = `${PROJECT}/.qmai/simulations/results/${FRAMEWORK_ID}`

/** 一份最小可解析的结果文件；其余字段走 store 里的兜底。 */
function resultPayload(createdAt: string, recommendation = "推荐语"): string {
  return JSON.stringify({
    report: {
      frameworkId: FRAMEWORK_ID,
      mode: "hybrid",
      characterAnalyses: [],
      branches: [],
      recommendation,
      createdAt,
    },
  })
}

describe("loadLatestSimulationResult（只取最新一条）", () => {
  beforeEach(() => {
    io.files.clear()
    io.reads.length = 0
  })

  /*
   * `saveSimulationResult` 把文件名生成为 `result-${Date.now()}`（等宽时间戳），
   * 所以「文件名倒序的第一条」就是最新的一条。
   * 这里故意让**文件名顺序**与**目录遍历顺序**相反，并让 report.createdAt
   * 与文件名顺序也相反 —— 只有真的按文件名排序才能选对。
   */
  it("按文件名（时间戳）取最新，而不是取目录里的第一条", async () => {
    io.files.set(`${RESULTS_DIR}/result-1000000000000.json`, resultPayload("2026-09-09T00:00:00.000Z"))
    io.files.set(`${RESULTS_DIR}/result-2000000000000.json`, resultPayload("2026-01-01T00:00:00.000Z"))

    const latest = await loadLatestSimulationResult(PROJECT, FRAMEWORK_ID)

    expect(latest?.id).toBe("result-2000000000000")
  })

  it("只解析一个文件（这是它相对 loadSimulationResults 的意义）", async () => {
    io.files.set(`${RESULTS_DIR}/result-1000.json`, resultPayload("2026-01-01T00:00:00.000Z"))
    io.files.set(`${RESULTS_DIR}/result-2000.json`, resultPayload("2026-01-02T00:00:00.000Z"))
    io.files.set(`${RESULTS_DIR}/result-3000.json`, resultPayload("2026-01-03T00:00:00.000Z"))

    io.reads.length = 0
    await loadLatestSimulationResult(PROJECT, FRAMEWORK_ID)

    expect(io.reads).toHaveLength(1)
    expect(io.reads[0]).toContain("result-3000.json")
  })

  it("没有结果目录时返回 null（不抛错）", async () => {
    await expect(loadLatestSimulationResult(PROJECT, FRAMEWORK_ID)).resolves.toBeNull()
  })

  it("目录里只有 .md 时返回 null（只认 .json）", async () => {
    io.files.set(`${RESULTS_DIR}/result-1000.md`, "# 推演结果")
    await expect(loadLatestSimulationResult(PROJECT, FRAMEWORK_ID)).resolves.toBeNull()
  })

  it("文件坏掉时返回 null，而不是让落地页崩掉", async () => {
    io.files.set(`${RESULTS_DIR}/result-1000.json`, "{ 这不是 JSON")
    await expect(loadLatestSimulationResult(PROJECT, FRAMEWORK_ID)).resolves.toBeNull()
  })

  it("JSON 里没有 report 时返回 null（半截文件不该被当成一条记录）", async () => {
    io.files.set(`${RESULTS_DIR}/result-1000.json`, JSON.stringify({ draft: null }))
    await expect(loadLatestSimulationResult(PROJECT, FRAMEWORK_ID)).resolves.toBeNull()
  })

  it("带回 report 与兜底字段", async () => {
    io.files.set(`${RESULTS_DIR}/result-1000.json`, resultPayload("2026-01-01T00:00:00.000Z", "先压后扬"))

    const latest = await loadLatestSimulationResult(PROJECT, FRAMEWORK_ID)

    expect(latest).toMatchObject({
      id: "result-1000",
      status: "complete",
      draft: null,
      timelineEvents: [],
    })
    expect(latest?.report.recommendation).toBe("先压后扬")
  })
})

describe("loadSimulationResults（全量，行为不变）", () => {
  beforeEach(() => {
    io.files.clear()
    io.reads.length = 0
  })

  it("仍按 report.createdAt 降序（不是文件名顺序）", async () => {
    io.files.set(`${RESULTS_DIR}/result-1000000000000.json`, resultPayload("2026-09-09T00:00:00.000Z"))
    io.files.set(`${RESULTS_DIR}/result-2000000000000.json`, resultPayload("2026-01-01T00:00:00.000Z"))

    const all = await loadSimulationResults(PROJECT, FRAMEWORK_ID)

    // 文件名最大的那条 report 时间反而更早 —— 全量接口按 report.createdAt 排，所以它在后
    expect(all.map((item) => item.id)).toEqual([
      "result-1000000000000",
      "result-2000000000000",
    ])
  })
})
