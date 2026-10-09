// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { OutlineSaveReportPanel } from "./outline-save-report"
import type { OutlineSaveReport } from "@/stores/outline-chat-store"

const mounted: Array<{ container: HTMLDivElement; root: Root }> = []

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

async function renderReport(report: OutlineSaveReport): Promise<HTMLElement> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  await act(async () => {
    root.render(<OutlineSaveReportPanel report={report} />)
  })
  return container
}

function buildReport(overrides: Partial<OutlineSaveReport> = {}): OutlineSaveReport {
  return {
    fileName: "修真界卷级架构.md",
    fileType: "volume-outline",
    problems: ["第 1 个故事缺少字段 beats。", "第 1 个故事缺少环节「起①」。"],
    repairAttempted: true,
    ...overrides,
  }
}

describe("OutlineSaveReportPanel（校验问题显示在生成结果下方）", () => {
  it("报出条数、待保存文件与全部明细，不再把明细塞进浮层", async () => {
    const problems = Array.from({ length: 138 }, (_, i) => `第 ${i + 1} 项问题。`)
    const container = await renderReport(buildReport({ problems }))
    const text = container.textContent ?? ""

    // 条数与文件名在折叠外层就能看到
    expect(text).toContain("卷纲内容不完整（138 项）")
    expect(text).toContain("修真界卷级架构.md")
    // 明细逐条可读（默认折叠但已渲染，不截断、不带省略号）
    expect(text).toContain("第 1 项问题。")
    expect(text).toContain("第 138 项问题。")
    expect(text).not.toContain("…")
    // 保留「照样保存」的出口
    expect(text).toContain("可以保存当前内容，或让 AI 重新生成")
  })

  it("已自动补全过仍不通过时，明确说出来（而不是让用户以为没补过）", async () => {
    const container = await renderReport(buildReport({ repairAttempted: true }))
    expect(container.textContent).toContain("已自动补全过一次仍未通过")
  })

  it("章纲走同一组件，文字按类型切换", async () => {
    const container = await renderReport(buildReport({ fileType: "chapter-outline" }))
    expect(container.textContent).toContain("章纲内容不完整（2 项）")
    expect(container.textContent).not.toContain("卷纲内容不完整")
  })
})
