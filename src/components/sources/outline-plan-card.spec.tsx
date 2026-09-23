// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OutlinePlanCard } from "./outline-plan-card"
import type { OutlinePlanProtocol } from "@/lib/novel/outline-plan-protocol"

const roots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  while (roots.length) {
    const mounted = roots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
})

function protocol(overrides: Partial<OutlinePlanProtocol> = {}): OutlinePlanProtocol {
  return {
    status: "ready",
    module: "章节细纲",
    elements: [
      { key: "chapterRange", value: "第 11-15 章", source: "user", satisfied: true },
      { key: "pov", value: "第三人称", source: "project", satisfied: true },
      { key: "chapterPosition", value: "", source: "inferred", satisfied: false },
    ],
    missing: [],
    questions: [],
    plan: {
      summary: "先补第 11-15 章章纲",
      steps: [
        { id: "s1", title: "读取卷纲", detail: "确认本卷目标" },
        { id: "s2", title: "生成章纲", detail: "按 15 节结构" },
      ],
      files: [{
        targetFolder: "章纲",
        fileName: "章纲_第11章.md",
        fileType: "chapter-outline",
        writeMode: "create",
        elements: ["chapterGoal"],
      }],
      order: "先卷后章",
      risks: ["时间线可能断裂"],
      openQuestions: ["第 13 章是否安排反转"],
    },
    ...overrides,
  }
}

async function renderCard(props: Partial<React.ComponentProps<typeof OutlinePlanCard>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push({ root, container })
  const onConfirm = props.onConfirm ?? vi.fn(async () => true)
  const onSupplement = props.onSupplement ?? vi.fn()
  const onCancel = props.onCancel ?? vi.fn()
  await act(async () => {
    root.render(
      <OutlinePlanCard
        protocol={protocol()}
        onConfirm={onConfirm}
        onSupplement={onSupplement}
        onCancel={onCancel}
        {...props}
      />,
    )
  })
  const button = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
  return { container, onConfirm, onSupplement, onCancel, button }
}

describe("OutlinePlanCard", () => {
  it("展示要素、步骤、待写文件、顺序、风险和遗留问题", async () => {
    const { container } = await renderCard()

    expect(container.textContent).toContain("「章节细纲」生成计划，确认后才开始写")
    expect(container.textContent).toContain("第 11-15 章")
    expect(container.textContent).toContain("project")
    expect(container.textContent).not.toContain("chapterPosition")
    expect(container.textContent).toContain("读取卷纲：确认本卷目标")
    expect(container.textContent).toContain("章纲/章纲_第11章.md")
    expect(container.textContent).toContain("chapter-outline · create")
    expect(container.textContent).toContain("先卷后章")
    expect(container.textContent).toContain("时间线可能断裂")
    expect(container.textContent).toContain("第 13 章是否安排反转")
  })

  it("确认时把渲染后的计划正文回传", async () => {
    const { button, onConfirm } = await renderCard()

    await act(async () => {
      button("确认生成计划").click()
      await Promise.resolve()
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    const planText = (onConfirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(planText).toContain("## 生成步骤")
    expect(planText).toContain("章纲/章纲_第11章.md")
  })

  it("修改计划后按修改内容确认", async () => {
    const { container, button, onConfirm } = await renderCard()

    await act(async () => button("修改生成计划").click())
    const textarea = container.querySelector('[aria-label="编辑生成计划"]') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(button("修改生成计划")).toBeNull()

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
        ?.call(textarea, "## 生成步骤\n1. 只生成第 11 章")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(button("确认生成计划").textContent).toContain("按修改后的计划生成")

    await act(async () => {
      button("确认生成计划").click()
      await Promise.resolve()
    })

    expect(onConfirm).toHaveBeenCalledWith("## 生成步骤\n1. 只生成第 11 章")
  })

  it("补充信息与取消直接回调，不进入生成", async () => {
    const { button, onSupplement, onCancel, onConfirm } = await renderCard()

    await act(async () => button("补充生成要素").click())
    await act(async () => button("取消生成计划").click())

    expect(onSupplement).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("确认进行中防止重复提交", async () => {
    let finish!: (value: boolean) => void
    const pending = new Promise<boolean>((resolve) => { finish = resolve })
    const onConfirm = vi.fn(() => pending)
    const { button } = await renderCard({ onConfirm })

    await act(async () => {
      button("确认生成计划").click()
      button("确认生成计划").click()
      await Promise.resolve()
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(button("确认生成计划").disabled).toBe(true)
    expect(button("确认生成计划").getAttribute("aria-busy")).toBe("true")

    await act(async () => finish(true))
    expect(button("确认生成计划").getAttribute("aria-busy")).toBeNull()
  })

  it("卡片已用过或会话忙时四个按钮全部置灰并给出中文原因", async () => {
    const { button, onConfirm } = await renderCard({
      disabled: true,
      disabledReason: "该计划已处理过，请在下方继续对话。",
    })

    for (const label of ["确认生成计划", "修改生成计划", "补充生成要素", "取消生成计划"]) {
      expect(button(label).disabled).toBe(true)
      expect(button(label).title).toBe("该计划已处理过，请在下方继续对话。")
    }
    await act(async () => button("确认生成计划").click())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("协议不是 ready 或没有计划时不渲染", async () => {
    const withoutPlan = await renderCard({ protocol: protocol({ plan: undefined }) })
    expect(withoutPlan.container.textContent).toBe("")

    const needsInput = await renderCard({ protocol: protocol({ status: "needs_input" }) })
    expect(needsInput.container.textContent).toBe("")
  })
})
