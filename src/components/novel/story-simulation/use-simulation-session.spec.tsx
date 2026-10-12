// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useSimulationSession } from "./use-simulation-session"
import { useStorySimulationStore } from "@/stores/story-simulation-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  loadSimulationSession: vi.fn(),
  saveSimulationSession: vi.fn(
    async (_path: string, _config: Record<string, unknown>) => {},
  ),
}))

vi.mock("@/lib/novel/story-simulation/simulation-session", () => mocks)

const store = useStorySimulationStore

const DEFAULTS = {
  mode: "hybrid" as const,
  userIdea: "",
  targetWords: 10000,
  sourceChapters: 10,
  simulationRounds: 0,
  directorEnabled: false,
}

function Probe({ projectPath }: { projectPath: string | undefined }) {
  useSimulationSession(projectPath)
  return null
}

let container: HTMLDivElement
let root: Root

/** 挂载并等水合的 Promise 结算。 */
async function mount(projectPath: string | undefined) {
  await act(async () => {
    root.render(<Probe projectPath={projectPath} />)
  })
  // 水合是 async 的：再多跑两轮微任务，确保 setState 已落到 store
  await act(async () => {
    await Promise.resolve()
  })
}

function currentConfig() {
  const s = store.getState()
  return {
    mode: s.mode,
    userIdea: s.userIdea,
    targetWords: s.targetWords,
    sourceChapters: s.sourceChapters,
    simulationRounds: s.simulationRounds,
    directorEnabled: s.directorEnabled,
  }
}

describe("useSimulationSession", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.loadSimulationSession.mockReset()
    mocks.saveSimulationSession.mockClear()
    store.setState({ ...DEFAULTS })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("挂载时把磁盘上的会话配置灌进 store", async () => {
    mocks.loadSimulationSession.mockResolvedValue({
      version: 1,
      savedAt: "2026-07-06T00:00:00.000Z",
      mode: "free-emergence",
      userIdea: "让主角在黑市遇到旧友",
      targetWords: 30000,
      sourceChapters: 20,
      simulationRounds: 5,
      directorEnabled: true,
    })

    await mount("/project")

    expect(currentConfig()).toEqual({
      mode: "free-emergence",
      userIdea: "让主角在黑市遇到旧友",
      targetWords: 30000,
      sourceChapters: 20,
      simulationRounds: 5,
      directorEnabled: true,
    })
  })

  it("没有会话文件时保持默认配置，且不产生无谓写入", async () => {
    mocks.loadSimulationSession.mockResolvedValue(null)

    await mount("/project")

    expect(currentConfig()).toEqual(DEFAULTS)
    // 首次使用不该立刻在磁盘上留一个文件
    expect(mocks.saveSimulationSession).not.toHaveBeenCalled()
  })

  it("水合只是把磁盘内容读回来，不会立刻把同一份内容再写回去", async () => {
    mocks.loadSimulationSession.mockResolvedValue({
      version: 1,
      savedAt: "2026-07-06T00:00:00.000Z",
      ...DEFAULTS,
      mode: "decision-tree",
      targetWords: 50000,
    })

    await mount("/project")

    expect(store.getState().mode).toBe("decision-tree")
    expect(mocks.saveSimulationSession).not.toHaveBeenCalled()
  })

  it("水合完成后用户改配置会触发保存", async () => {
    mocks.loadSimulationSession.mockResolvedValue(null)
    await mount("/project")

    await act(async () => {
      store.getState().setMode("decision-tree")
      store.getState().setTargetWords(50000)
    })

    expect(mocks.saveSimulationSession).toHaveBeenCalledTimes(1)
    const [path, config] = mocks.saveSimulationSession.mock.calls[0]
    expect(path).toBe("/project")
    expect(config.mode).toBe("decision-tree")
    expect(config.targetWords).toBe(50000)
  })

  it("连续改动只在最后落一次盘（中间态不写）", async () => {
    mocks.loadSimulationSession.mockResolvedValue(null)
    await mount("/project")

    await act(async () => {
      store.getState().setTargetWords(20000)
      store.getState().setTargetWords(30000)
      store.getState().setTargetWords(40000)
    })

    const writes = mocks.saveSimulationSession.mock.calls
    expect(writes.length).toBeGreaterThanOrEqual(1)
    const last = writes[writes.length - 1][1]
    expect(last.targetWords).toBe(40000)
  })

  it("水合尚未完成时绝不写盘，避免用默认值覆盖磁盘上的会话", async () => {
    let resolveLoad: (value: unknown) => void = () => {}
    mocks.loadSimulationSession.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve
      }),
    )

    await act(async () => {
      root.render(<Probe projectPath="/project" />)
    })

    // 读取还悬着，此时用户已经在拖配置
    await act(async () => {
      store.getState().setTargetWords(99999)
    })
    expect(mocks.saveSimulationSession).not.toHaveBeenCalled()

    // 水合完成后才允许写盘
    await act(async () => {
      resolveLoad(null)
      await Promise.resolve()
    })
    expect(mocks.saveSimulationSession).toHaveBeenCalled()
  })

  it("没有 projectPath 时既不读取也不写入", async () => {
    await mount(undefined)

    expect(mocks.loadSimulationSession).not.toHaveBeenCalled()
    expect(mocks.saveSimulationSession).not.toHaveBeenCalled()
  })

  it("切换项目路径会用新项目的会话重新水合", async () => {
    mocks.loadSimulationSession.mockResolvedValueOnce({
      version: 1,
      savedAt: "2026-07-06T00:00:00.000Z",
      ...DEFAULTS,
      targetWords: 30000,
    })
    await mount("/project-a")
    expect(store.getState().targetWords).toBe(30000)

    mocks.loadSimulationSession.mockResolvedValueOnce({
      version: 1,
      savedAt: "2026-07-06T00:00:00.000Z",
      ...DEFAULTS,
      targetWords: 50000,
    })
    await mount("/project-b")

    expect(mocks.loadSimulationSession).toHaveBeenLastCalledWith("/project-b")
    expect(store.getState().targetWords).toBe(50000)
  })

  it("保存失败只是记日志，不把异常抛给组件树", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.loadSimulationSession.mockResolvedValue(null)
    mocks.saveSimulationSession.mockRejectedValueOnce(new Error("磁盘满了"))
    await mount("/project")

    await act(async () => {
      store.getState().setTargetWords(20000)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
