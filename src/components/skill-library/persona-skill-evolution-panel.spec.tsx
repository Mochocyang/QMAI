// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { loadPersonaSkillEvolutionState } from "@/lib/novel/persona-skill-evolution-store"
import { PersonaSkillEvolutionPanel } from "./persona-skill-evolution-panel"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/*
 * 内存文件表 + mock `@/commands/fs`：本仓库既有的组件测试范式
 * （同 style-evolution-panel.spec.tsx / persona-skill-view.spec.tsx）。
 */
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
  listDirectory: async () => [],
}))

const project = "C:/project"
const evolutionFile = `${project}/.qmai/persona-skill-evolution.json`

/** 一份「攒了 2 个打开日、跑过一轮」的真实状态，用来验证开关不会把它抹掉。 */
function primedState(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    enabled: false,
    lastOpenDate: "2026-10-11",
    lastAttemptedOn: "2026-10-11",
    openDayCount: 2,
    nextThreshold: 4,
    lastAnalyzedOn: "2026-10-01",
    lastIndexedUpdatedAt: "2026-10-10T00:00:00.000Z",
    rounds: [
      {
        at: "2026-10-01",
        round: 1,
        outcome: "reverted",
        reason: "所有候选都被配对评审否决（这正是棘轮：改不动就保持原样）",
        votes: ["林清越 0-3（弃权 0） reverted：候选与原文冲突"],
        characterNames: ["林清越"],
      },
    ],
    ...overrides,
  }
}

let host: HTMLElement | null = null
let root: Root | null = null

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderPanel() {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<PersonaSkillEvolutionPanel />)
  })
  await flush()
}

describe("PersonaSkillEvolutionPanel", () => {
  beforeEach(() => {
    io.files.clear()
    useWikiStore.getState().setProject({ id: "p1", name: "测试项目", path: project })
    return async () => {
      await act(async () => {
        root?.unmount()
      })
      host?.remove()
      host = null
      root = null
    }
  })

  it("渲染标题与 role=switch 开关，状态从盘上读出", async () => {
    io.files.set(evolutionFile, JSON.stringify(primedState({ enabled: true })))
    await renderPanel()

    const toggle = host!.querySelector('[data-testid="persona-skill-evolution-toggle"]')
    expect(toggle).not.toBeNull()
    expect(toggle!.getAttribute("role")).toBe("switch")
    expect(toggle!.getAttribute("aria-checked")).toBe("true")
    expect(host!.textContent).toContain("人物 Skill 自进化")
    // 说明文字讲清三件事：达尔文式循环、消耗 token、历史版本可回退
    expect(host!.textContent).toContain("达尔文式循环")
    expect(host!.textContent).toContain("消耗 token")
    expect(host!.textContent).toContain("历史版本")
  })

  it("点开关翻转 enabled，且**完整状态**写回——节律与轮次历史不许被抹掉", async () => {
    io.files.set(evolutionFile, JSON.stringify(primedState()))
    await renderPanel()

    const toggle = host!.querySelector('[data-testid="persona-skill-evolution-toggle"]')!
    await act(async () => {
      ;(toggle as HTMLButtonElement).click()
    })
    await flush()

    const state = await loadPersonaSkillEvolutionState(project)
    expect(state.enabled).toBe(true)
    // 下面这几个字段如果丢了，等于用户点一次开关就清零进度
    expect(state.openDayCount).toBe(2)
    expect(state.nextThreshold).toBe(4)
    expect(state.rounds).toHaveLength(1)
    expect(state.lastIndexedUpdatedAt).toBe("2026-10-10T00:00:00.000Z")

    // 面板随写盘刷新（本 store 不走 bumpDataVersion，靠自己的订阅通道）
    expect(toggle.getAttribute("aria-checked")).toBe("true")
  })

  it("没有打开项目时不渲染任何东西", async () => {
    useWikiStore.getState().setProject(null)
    await renderPanel()
    expect(host!.querySelector('[data-testid="persona-skill-evolution-panel"]')).toBeNull()
  })
})
