// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { loadStyleEvolutionState } from "@/lib/novel/style-evolution-store"
import { StyleEvolutionPanel } from "./style-evolution-panel"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/*
 * 内存文件表 + mock `@/commands/fs`：本仓库既有的组件测试范式
 * （见 `persona-skill-view.spec.tsx:14-42` 与 `unified-skill-library-view.spec.tsx:28-35`）。
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
const evolutionFile = `${project}/.qmai/style-evolution.json`

/** 一份「已经攒了 2 个打开日、跑过一轮」的真实状态，用来验证开关不会把它抹掉。 */
function primedState(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    enabled: false,
    lastOpenDate: "2026-10-11",
    lastAttemptedOn: "2026-10-11",
    openDayCount: 2,
    nextThreshold: 4,
    lastAnalyzedOn: "2026-10-01",
    probe: {
      stylePresetId: "style-base",
      sourceBook: "我的文风 · 自动进化 · 第 1 轮",
      at: "2026-10-01",
      metrics: { shortSentenceRatio: 0.7, avgSentenceChars: 12.13 },
    },
    rounds: [
      {
        at: "2026-10-01",
        round: 1,
        outcome: "kept",
        stylePresetId: "style-base",
        distanceCandidate: 0.0123,
        distanceBase: 0.0456,
        sourceBook: "我的文风 · 自动进化 · 第 1 轮",
      },
    ],
    ...overrides,
  }
}

function writeEvolution(overrides: Record<string, unknown> = {}) {
  io.files.set(evolutionFile, JSON.stringify(primedState(overrides)))
}

function readEvolution(): Record<string, unknown> {
  return JSON.parse(io.files.get(evolutionFile)!)
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderPanel() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<StyleEvolutionPanel />)
  })
  await flushEffects()
  return { container, root }
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount())
  document.body.removeChild(container)
}

function testId(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}

async function click(element: HTMLElement | null) {
  await act(async () => {
    element?.click()
  })
  await flushEffects()
}

describe("StyleEvolutionPanel", () => {
  beforeEach(() => {
    io.files.clear()
    useWikiStore.getState().setProject({ id: "p1", name: "测试项目", path: project })
  })

  it("默认关闭", async () => {
    writeEvolution({ enabled: false })
    const { container, root } = await renderPanel()
    expect(testId(container, "style-evolution-toggle")?.getAttribute("aria-pressed")).toBe("false")
    expect(testId(container, "style-evolution-toggle")?.textContent).toBe("已关闭")
    cleanup(root, container)
  })

  it("开关写进 style-evolution.json", async () => {
    writeEvolution({ enabled: false })
    const { container, root } = await renderPanel()

    await click(testId(container, "style-evolution-toggle"))

    expect(readEvolution().enabled).toBe(true)
    expect(testId(container, "style-evolution-toggle")?.getAttribute("aria-pressed")).toBe("true")

    // 再点一次应关回去（不是单程开关）
    await click(testId(container, "style-evolution-toggle"))
    expect(readEvolution().enabled).toBe(false)

    cleanup(root, container)
  })

  /*
   * ★ 这条是本面板**唯一**有真实破坏力的风险点，必须钉住。
   *
   * 开关的实现有两种写法，差别巨大：
   *   对：读出完整状态 → `{ ...current, enabled }` 写回
   *   错：`{ ...emptyState(), enabled }` 写回
   * 后者会把 openDayCount / nextThreshold / rounds / probe 一起抹掉 ——
   * 用户只是点了一下开关，攒了好几天的打开日进度和已有基线就全没了，
   * 而且**没有任何报错**。删掉面板上那些统计数字之后，这种损失在界面上
   * 更是完全看不出来，所以只能靠这条测试兜住。
   */
  it("开关不抹掉已攒的进度与基线（openDayCount / nextThreshold / rounds / probe 全保留）", async () => {
    writeEvolution()
    /*
     * 基准取「经 store 规范化后的状态」，不取我手写的那份原始 JSON：
     * 读盘时 `sanitizeMetrics` 会把 17 个指标键补齐（缺的填 0），
     * 拿原始 JSON 比会因这个补齐而假红，掩盖真正的丢失。
     */
    const before = await loadStyleEvolutionState(project)
    const { container, root } = await renderPanel()

    await click(testId(container, "style-evolution-toggle"))

    const after = await loadStyleEvolutionState(project)
    expect(after.enabled).toBe(true)
    expect(after.openDayCount).toBe(before.openDayCount)
    expect(after.nextThreshold).toBe(before.nextThreshold)
    expect(after.lastAnalyzedOn).toBe(before.lastAnalyzedOn)
    expect(after.lastOpenDate).toBe(before.lastOpenDate)
    expect(after.rounds).toEqual(before.rounds)
    expect(after.probe).toEqual(before.probe)
    // 再明确一次「确实有东西可丢」，否则上面的相等可能只是两边都空
    expect(before.probe).not.toBeNull()
    expect(before.rounds).toHaveLength(1)
    expect(before.openDayCount).toBe(2)

    cleanup(root, container)
  })

  it("状态文件不存在时退化成默认关闭，而不是崩掉或误开", async () => {
    // 刻意不写文件：这正是「用户从没开过这个开关」的真实路径
    const { container, root } = await renderPanel()
    expect(testId(container, "style-evolution-panel")).not.toBeNull()
    expect(testId(container, "style-evolution-toggle")?.getAttribute("aria-pressed")).toBe("false")
    cleanup(root, container)
  })

  /*
   * 用户明确要求：这处只留「一块说明 + 一个开关」，其余都不显示。
   *
   * 这条断言是**需求本身**，不是实现细节 —— 之前那些统计、结论、候选按钮、
   * 轮次历史都被点名去掉了。留成测试是为了防止以后有人「顺手补回来」。
   */
  it("只显示说明与开关，不再显示进度统计 / 上一轮结论 / 候选按钮 / 轮次历史", async () => {
    writeEvolution({
      enabled: true,
      rounds: [
        { at: "2026-10-01", round: 1, outcome: "kept", stylePresetId: "style-base" },
        {
          at: "2026-10-11",
          round: 2,
          outcome: "kept",
          stylePresetId: "style-cand",
          distanceCandidate: 0.0123,
          distanceBase: 0.0456,
        },
      ],
    })
    const { container, root } = await renderPanel()

    // 该有的：面板本体、开关
    expect(testId(container, "style-evolution-panel")).not.toBeNull()
    expect(testId(container, "style-evolution-toggle")).not.toBeNull()

    // 不该有的：12 个已删除的展示元素一个都不许回来
    const removed = [
      "style-evolution-remaining",
      "style-evolution-days",
      "style-evolution-threshold",
      "style-evolution-baseline",
      "style-evolution-last-round",
      "style-evolution-conclusion",
      "style-evolution-compare",
      "style-evolution-empty",
      "style-evolution-candidate",
      "style-evolution-candidate-name",
      "style-evolution-enable-candidate",
      "style-evolution-rollback",
      "style-evolution-refusal",
      "style-evolution-round-1",
      "style-evolution-round-2",
    ]
    for (const id of removed) {
      expect(testId(container, id), `${id} 不该再出现`).toBeNull()
    }

    cleanup(root, container)
  })

  /*
   * ★ 布局不变量：说明文字**不许**和开关挤在同一行。
   *
   * 真机第一版就是这个毛病：标题、说明、开关同在一个 flex 行里（justify-between），
   * 说明被压成一路顶到右侧开关底下的一堵墙，放大截图才看得出来。
   * DOM 上没法直接断言「好不好看」，但可以断言造成它的那个结构：
   * 开关所在的那一行里不该有任何 <p>。
   */
  it("说明文字与开关分行：开关那一行里不许有说明段落", async () => {
    writeEvolution()
    const { container, root } = await renderPanel()

    const toggle = testId(container, "style-evolution-toggle")
    expect(toggle).not.toBeNull()
    const row = toggle!.parentElement
    expect(row).not.toBeNull()

    // 开关那一行只该有标题和开关，没有段落
    expect(row!.querySelectorAll("p")).toHaveLength(0)
    expect(row!.textContent).not.toContain("打开日")

    // 说明段落必须存在，且在开关那一行之外
    const panel = testId(container, "style-evolution-panel")!
    const paragraphs = panel.querySelectorAll("p")
    expect(paragraphs.length).toBeGreaterThan(0)
    for (const p of Array.from(paragraphs)) {
      expect(row!.contains(p)).toBe(false)
    }
    // 说明里那段关键话确实在
    expect(panel.textContent).toContain("自动分析一次")

    cleanup(root, container)
  })

  it("说明文字要讲清关键约定：多久一次、结果要手动启用、默认关闭", async () => {
    writeEvolution()
    const { container, root } = await renderPanel()
    const text = container.textContent ?? ""

    expect(text).toContain("3~5")
    expect(text).toContain("打开日")
    // 最容易被误解的一条：进化结果不会自动生效
    expect(text).toContain("需要你点一下才会启用")
    expect(text).toContain("默认关闭")

    cleanup(root, container)
  })

  /*
   * ★ 精确文本断言：钉住**逐字**的内容，包括空格。
   *
   * 为什么必须写到这么死：说明文字是裸 JSX 文本时，源码里为了排版而换的行
   * 会被 JSX 折叠成一个空格，渲染成「才保留候选。 改进结果」这种句中多一个空格
   * 的样子（真机截图放大后才看得出来，代码评审时几乎必漏）。
   * 下面两条只要多一个空格就会红 —— 这就是用它替代「toContain 几个关键词」的理由。
   */
  it("说明文字逐字正确，中文标点后不多出空格（JSX 换行折叠的坑）", async () => {
    writeEvolution()
    const { container, root } = await renderPanel()
    const text = container.textContent ?? ""

    // 必须保留的那个半角空格：在「让 AI」之后（中英之间）
    expect(text).toContain(
      "每 3~5 个「打开日」自动分析一次。它拿你自己写的正文当标尺，让 AI 在现有文风画像上做一版改进，只有确实更接近你行文的版本才会被保留成候选。",
    )
    expect(text).toContain(
      "候选会作为一份新的文风预设出现在下面的文风库里，需要你点一下才会启用——不会自动替换正在用的文风。同一打开日只尝试一次；默认关闭。",
    )

    // 反向断言：全角标点后面不该跟空格（JSX 折叠换行会在这里插空格）
    for (const bad of ["。 ", "， ", "； ", "： ", "」 ", "「 "]) {
      expect(text.includes(bad), `不该出现「${bad.trim()}+空格」`).toBe(false)
    }

    cleanup(root, container)
  })
})
