import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  SIMULATION_SESSION_VERSION,
  buildSimulationSessionFile,
  parseSimulationSessionFile,
  loadSimulationSession,
  saveSimulationSession,
  simulationSessionPath,
} from "@/lib/novel/story-simulation/simulation-session"

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFileAtomic: vi.fn(async (_path: string, _contents: string) => {}),
  createDirectory: vi.fn(async (_path: string) => {}),
  fileExists: vi.fn(async (_path: string) => true),
}))

vi.mock("@/commands/fs", () => mocks)

const PROJECT = "/project"

function validConfig() {
  return {
    mode: "free-emergence" as const,
    userIdea: "让主角在黑市遇到旧友",
    targetWords: 30000,
    sourceChapters: 20,
    simulationRounds: 5,
    directorEnabled: true,
  }
}

describe("simulation session 文件内容", () => {
  it("带版本号与时间戳，便于日后判定能否兼容", () => {
    const file = buildSimulationSessionFile(validConfig(), "2026-07-06T00:00:00.000Z")

    expect(file.version).toBe(SIMULATION_SESSION_VERSION)
    expect(file.savedAt).toBe("2026-07-06T00:00:00.000Z")
    expect(file.mode).toBe("free-emergence")
    expect(file.directorEnabled).toBe(true)
  })

  it("路径固定在 .qmai 下，不写进别处", () => {
    expect(simulationSessionPath(PROJECT)).toBe(
      `${PROJECT}/.qmai/simulations/session.json`,
    )
  })
})

describe("parseSimulationSessionFile", () => {
  function raw(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      ...buildSimulationSessionFile(validConfig(), "2026-07-06T00:00:00.000Z"),
      ...overrides,
    })
  }

  it("合法内容可原样解析回来", () => {
    const parsed = parseSimulationSessionFile(raw())
    expect(parsed?.mode).toBe("free-emergence")
    expect(parsed?.targetWords).toBe(30000)
  })

  it("坏 JSON 返回 null 而不是抛错", () => {
    expect(parseSimulationSessionFile("{ 这不是 json")).toBeNull()
  })

  it("版本不匹配返回 null（旧文件不该灌进新 store）", () => {
    expect(parseSimulationSessionFile(raw({ version: 999 }))).toBeNull()
  })

  it("模式非法返回 null", () => {
    expect(parseSimulationSessionFile(raw({ mode: "not-a-mode" }))).toBeNull()
  })

  it("字段类型不对返回 null，不把脏数据写进 store", () => {
    expect(parseSimulationSessionFile(raw({ targetWords: "三万" }))).toBeNull()
    expect(parseSimulationSessionFile(raw({ directorEnabled: "yes" }))).toBeNull()
    expect(parseSimulationSessionFile(raw({ simulationRounds: null }))).toBeNull()
  })

  it("userIdea 允许为空串", () => {
    expect(parseSimulationSessionFile(raw({ userIdea: "" }))?.userIdea).toBe("")
  })
})

describe("saveSimulationSession / loadSimulationSession", () => {
  beforeEach(() => {
    mocks.readFile.mockReset()
    mocks.writeFileAtomic.mockClear()
    mocks.createDirectory.mockClear()
  })

  it("保存时原子写入 .qmai/simulations/session.json", async () => {
    await saveSimulationSession(PROJECT, validConfig())

    expect(mocks.writeFileAtomic).toHaveBeenCalledTimes(1)
    const [path, contents] = mocks.writeFileAtomic.mock.calls[0]
    expect(path).toBe(simulationSessionPath(PROJECT))
    expect(JSON.parse(contents).mode).toBe("free-emergence")
  })

  it("读取时文件不存在则返回 null（首次使用不是错误）", async () => {
    mocks.readFile.mockRejectedValueOnce(new Error("ENOENT"))

    expect(await loadSimulationSession(PROJECT)).toBeNull()
  })

  it("读取到损坏文件则返回 null，不阻断界面加载", async () => {
    mocks.readFile.mockResolvedValueOnce("{{{")

    expect(await loadSimulationSession(PROJECT)).toBeNull()
  })

  it("读取合法文件返回配置", async () => {
    mocks.readFile.mockResolvedValueOnce(
      JSON.stringify(
        buildSimulationSessionFile(validConfig(), "2026-07-06T00:00:00.000Z"),
      ),
    )

    const loaded = await loadSimulationSession(PROJECT)
    expect(loaded?.simulationRounds).toBe(5)
  })
})
