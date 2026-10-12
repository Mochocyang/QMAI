// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Mock } from "vitest"
import { SimulationConfigPanel } from "./simulation-config-panel"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import { estimateSimulationCalls } from "@/lib/novel/story-simulation/types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/stores/story-simulation-store", async () => {
  const { create } = await import("zustand")
  const store = create((set) => ({
    mode: "hybrid",
    userIdea: "",
    targetWords: 10000,
    sourceChapters: 10,
    simulationRounds: 0,
    directorEnabled: false,
    extractionResult: null,
    currentFramework: null,
    setMode: (mode: string) => set({ mode }),
    setUserIdea: (userIdea: string) => set({ userIdea }),
    setTargetWords: (targetWords: number) => set({ targetWords }),
    setSourceChapters: (sourceChapters: number) => set({ sourceChapters }),
    setSimulationRounds: (simulationRounds: number) => set({ simulationRounds }),
    setDirectorEnabled: (directorEnabled: boolean) => set({ directorEnabled }),
  }))
  return { useStorySimulationStore: store }
})

const store = useStorySimulationStore as unknown as {
  setState: (partial: Record<string, unknown>) => void
  getState: () => Record<string, unknown>
}

/** 提取结果只用来推断角色数（配置阶段拿不到真实 agent 列表）。 */
function extractionWithCharacters(count: number) {
  return {
    characters: Array.from({ length: count }, (_, i) => ({
      id: `c${i}`,
      name: `角色${i}`,
    })),
  }
}

let container: HTMLDivElement
let root: Root
let onStart: Mock<() => void>

function render() {
  act(() => {
    root.render(<SimulationConfigPanel onStart={onStart} />)
  })
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(label),
  ) as HTMLButtonElement | undefined
}

function costCheckbox(): HTMLInputElement | undefined {
  return Array.from(container.querySelectorAll("input[type=checkbox]")).find(
    (input) => (input as HTMLInputElement).id !== "director-enabled",
  ) as HTMLInputElement | undefined
}

/** 用与实现同一个估算函数算出期望值，断言时只关心「界面是否把它显示出来」。 */
function expectedTotal(overrides: Record<string, unknown> = {}) {
  const state = store.getState() as Record<string, any>
  return estimateSimulationCalls({
    targetWords: state.targetWords,
    simulationRounds: state.simulationRounds,
    mode: state.mode,
    directorEnabled: state.directorEnabled,
    characterCount: state.extractionResult?.characters?.length,
    ...overrides,
  }).total
}

describe("SimulationConfigPanel 成本护栏", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStart = vi.fn<() => void>()
    store.setState({
      mode: "hybrid",
      userIdea: "",
      targetWords: 10000,
      sourceChapters: 10,
      simulationRounds: 0,
      directorEnabled: false,
      extractionResult: null,
      currentFramework: null,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("开跑前显示预计模型调用次数", () => {
    render()

    const total = expectedTotal()
    // 默认配置（hybrid / 1 万字 / 无提取结果）就该报出量级
    expect(total).toBeGreaterThan(40)
    expect(container.textContent).toContain("预计约")
    expect(container.textContent).toContain(`${total} 次模型调用`)
  })

  it("预估超过阈值时要求显式确认，未确认不能开跑", () => {
    render()

    const checkbox = costCheckbox()
    expect(checkbox).toBeDefined()

    const start = findButton("storySimulation.startExtract")
    expect(start).toBeDefined()
    // 未勾选 → 禁用
    expect(start!.disabled).toBe(true)

    act(() => {
      checkbox!.click()
    })

    // 勾选 → 放行，且点击会真的触发 onStart
    const startAfterAck = findButton("storySimulation.startExtract")!
    expect(startAfterAck.disabled).toBe(false)
    act(() => {
      startAfterAck.click()
    })
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it("预留在阈值以内时不要求确认，直接可开跑", () => {
    // 1 个角色 / 2 轮 / event-driven → 合计 29 次，低于阈值 40
    store.setState({
      mode: "event-driven",
      simulationRounds: 2,
      extractionResult: extractionWithCharacters(1),
    })
    render()

    expect(expectedTotal()).toBeLessThanOrEqual(40)
    expect(costCheckbox()).toBeUndefined()
    const start = findButton("storySimulation.startExtract")
    expect(start!.disabled).toBe(false)
  })

  it("配置改动导致预估值上涨时，先前那次确认作废", () => {
    store.setState({
      mode: "event-driven",
      simulationRounds: 2,
      extractionResult: extractionWithCharacters(1),
    })
    render()

    // 小配置无需确认
    expect(costCheckbox()).toBeUndefined()

    // 把字数调大 → 预估值越过阈值，必须重新确认
    act(() => {
      store.setState({ targetWords: 50000 })
    })

    const checkbox = costCheckbox()
    expect(checkbox).toBeDefined()
    expect(checkbox!.checked).toBe(false)
    expect(findButton("storySimulation.startExtract")!.disabled).toBe(true)
  })

  it("勾选导演 Agent 会把导演评估算进预估", () => {
    store.setState({
      mode: "event-driven",
      simulationRounds: 2,
      extractionResult: extractionWithCharacters(1),
    })
    render()
    const before = expectedTotal()

    act(() => {
      store.setState({ directorEnabled: true })
    })

    // 引擎只对 ni < totalNodes - 1 的节点评估 → 4 节点多 3 次
    expect(expectedTotal()).toBe(before + 3)
    expect(container.textContent).toContain(`${expectedTotal()} 次模型调用`)
  })
})
