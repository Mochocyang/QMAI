// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useWritingStatsStore } from "@/stores/writing-stats-store"
import {
  WritingStatusBar,
  formatWordCount,
  writingGoalPercent,
  writingGoalRingClass,
} from "./ui-test-statusbar"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

/** 越过 2.5s 的落盘节流，不让真的定时器悬在测试结束时。 */
vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async () => { throw new Error("文件不存在") }),
  fileExists: vi.fn(async () => false),
  writeFileAtomic: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
  listDirectory: vi.fn(async () => []),
}))

async function mount() {
  await act(async () => { root.render(<WritingStatusBar />) })
}

function metric(name: string): string {
  const node = container.querySelector(`[data-metric="${name}"]`)
  expect(node, `应有「${name}」这一项`).not.toBeNull()
  return node!.textContent?.trim() ?? ""
}

function footer(): HTMLElement {
  const node = container.querySelector<HTMLElement>("footer.ui-test-statusbar")
  expect(node, "应渲染底部写作字数状态栏").not.toBeNull()
  return node!
}

beforeEach(() => {
  useWritingStatsStore.getState().reset()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  useWritingStatsStore.getState().reset()
  vi.clearAllMocks()
})

describe("纯函数", () => {
  it("千分位：null 显示破折号，负数钳到 0", () => {
    expect(formatWordCount(0)).toBe("0")
    expect(formatWordCount(1837250)).toBe("1,837,250")
    expect(formatWordCount(null)).toBe("—")
    expect(formatWordCount(Number.NaN)).toBe("—")
    expect(formatWordCount(-5)).toBe("0")
  })

  it("完成率：目标为 0 时是 0，超过目标不封顶", () => {
    expect(writingGoalPercent(0, 3000)).toBe(0)
    expect(writingGoalPercent(1500, 3000)).toBe(50)
    expect(writingGoalPercent(3000, 3000)).toBe(100)
    // 写超了要如实显示，而不是被截成 100
    expect(writingGoalPercent(4500, 3000)).toBe(150)
    expect(writingGoalPercent(100, 0)).toBe(0)
  })

  it("环色三档", () => {
    expect(writingGoalRingClass(0)).toBe("text-[#ef4444]")
    expect(writingGoalRingClass(0.59)).toBe("text-[#ef4444]")
    expect(writingGoalRingClass(0.6)).toBe("text-[#f59e0b]")
    expect(writingGoalRingClass(0.99)).toBe("text-[#f59e0b]")
    expect(writingGoalRingClass(1)).toBe("text-[#22c55e]")
    expect(writingGoalRingClass(2)).toBe("text-[#22c55e]")
  })
})

describe("四项数据常显", () => {
  it("未初始化时总字数显示占位而不是 0（避免「这本书是空的」的误导）", async () => {
    await mount()
    expect(metric("total")).toBe("—")
    expect(metric("target")).toBe("3,000")
    expect(metric("ai")).toBe("0")
    expect(metric("human")).toBe("0")
  })

  it("四项标签与数值都渲染在栏上，不需要任何点击展开", async () => {
    useWritingStatsStore.setState({ totalChars: 1234567, humanChars: 800, aiChars: 4200 })
    await mount()
    const text = footer().textContent ?? ""
    for (const label of ["总字数", "今日目标", "今日 AI 生成", "手写"]) {
      expect(text, `状态栏应常显「${label}」`).toContain(label)
    }
    expect(metric("total")).toBe("1,234,567")
    expect(metric("human")).toBe("800")
    expect(metric("ai")).toBe("4,200")
  })

  it("圆环画出完成率百分比，并在 title 里给出全部数字", async () => {
    useWritingStatsStore.setState({ humanChars: 500, aiChars: 1000, dailyTargetChars: 3000 })
    await mount()
    const ring = container.querySelector("svg[role='img']")
    expect(ring).not.toBeNull()
    expect(ring!.getAttribute("aria-label")).toContain("50%")
    expect(ring!.querySelector("title")?.textContent).toContain("1500 / 3000")
    // 环内的数字
    expect(ring!.querySelector("text")?.textContent).toBe("50")
    // 进度弧：stroke-dashoffset = 周长的一半
    const arcs = ring!.querySelectorAll("circle")
    expect(arcs).toHaveLength(2)
    const circumference = Number(arcs[1]!.getAttribute("stroke-dasharray"))
    const offset = Number(arcs[1]!.getAttribute("stroke-dashoffset"))
    expect(offset).toBeCloseTo(circumference / 2, 4)
  })

  it("写超目标时环画满一圈，但百分比如实显示超过 100", async () => {
    useWritingStatsStore.setState({ humanChars: 9000, dailyTargetChars: 3000 })
    await mount()
    const ring = container.querySelector("svg[role='img']")!
    expect(ring.querySelector("text")?.textContent).toBe("300")
    const arcs = ring.querySelectorAll("circle")
    expect(Number(arcs[1]!.getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 4)
  })
})

describe("在栏上直接改今日目标", () => {
  it("点数字出现输入框，回车提交并写进 store", async () => {
    await mount()
    const button = container.querySelector<HTMLButtonElement>(".ui-test-statusbar-target")
    expect(button, "目标数字应可点击").not.toBeNull()
    expect(button!.getAttribute("aria-label")).toContain("点击修改")

    await act(async () => { button!.click() })
    const input = container.querySelector<HTMLInputElement>(".ui-test-statusbar-target-input")
    expect(input, "点击后应出现输入框").not.toBeNull()

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setter.call(input!, "5000")
      input!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(useWritingStatsStore.getState().dailyTargetChars).toBe(5000)
    expect(metric("target")).toBe("5,000")
    expect(container.querySelector(".ui-test-statusbar-target-input")).toBeNull()
  })

  it("Esc 放弃修改，目标保持原值", async () => {
    await mount()
    await act(async () => { container.querySelector<HTMLButtonElement>(".ui-test-statusbar-target")!.click() })
    const input = container.querySelector<HTMLInputElement>(".ui-test-statusbar-target-input")!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setter.call(input, "9999")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(useWritingStatsStore.getState().dailyTargetChars).toBe(3000)
  })

  it("只接受数字，字母与符号被过滤掉", async () => {
    await mount()
    await act(async () => { container.querySelector<HTMLButtonElement>(".ui-test-statusbar-target")!.click() })
    const input = container.querySelector<HTMLInputElement>(".ui-test-statusbar-target-input")!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setter.call(input, "3a0b0c0")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(input.value).toBe("3000")
  })

  it("空输入不算修改，不会把目标悄悄改成最小值", async () => {
    await mount()
    await act(async () => { container.querySelector<HTMLButtonElement>(".ui-test-statusbar-target")!.click() })
    const input = container.querySelector<HTMLInputElement>(".ui-test-statusbar-target-input")!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setter.call(input, "")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { input.dispatchEvent(new Event("blur", { bubbles: true })) })
    expect(useWritingStatsStore.getState().dailyTargetChars).toBe(3000)
  })

  it("越界输入被夹到合法区间，避免出现「目标 50 亿字」这种无法完成的环", async () => {
    await mount()
    await act(async () => { container.querySelector<HTMLButtonElement>(".ui-test-statusbar-target")!.click() })
    const input = container.querySelector<HTMLInputElement>(".ui-test-statusbar-target-input")!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setter.call(input, "999999999")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    expect(useWritingStatsStore.getState().dailyTargetChars).toBe(100_000)
  })
})

describe("实时跟随 store", () => {
  it("记账后数字立刻更新，不需要重挂组件", async () => {
    await mount()
    expect(metric("human")).toBe("0")
    await act(async () => {
      useWritingStatsStore.setState({ humanChars: 42, aiChars: 7 })
    })
    expect(metric("human")).toBe("42")
    expect(metric("ai")).toBe("7")
    // 42 + 7 = 49 / 3000 ≈ 2%
    expect(container.querySelector("svg[role='img'] text")?.textContent).toBe("2")
  })
})
