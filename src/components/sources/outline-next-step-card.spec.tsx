// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NextStepCard } from "./outline-next-step-card"

const roots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

async function renderCard(props: Partial<React.ComponentProps<typeof NextStepCard>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push({ root, container })
  const onSelectRecommendation = props.onSelectRecommendation ?? vi.fn(async () => true)
  await act(async () => {
    root.render(
      <NextStepCard
        recommendation={{
          completedModule: "人物弧光",
          completedScope: "主要人物的动机与转变",
          recommendations: [
            { id: "A", label: "继续完善人物弧光", reason: "人物动机仍可加强" },
            { id: "B", label: "检查伏笔闭环", reason: "避免遗漏" },
          ],
        }}
        onSelectRecommendation={onSelectRecommendation}
        {...props}
      />,
    )
  })
  return { container, onSelectRecommendation }
}

afterEach(async () => {
  while (roots.length) {
    const mounted = roots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
})

describe("NextStepCard", () => {
  it("点击推荐项时把普通文本 label 原样交给当前会话发送行为，并在完成前防止重复点击", async () => {
    let finish!: (value: boolean) => void
    const pending = new Promise<boolean>((resolve) => { finish = resolve })
    const onSelectRecommendation = vi.fn(() => pending)
    const { container } = await renderCard({ onSelectRecommendation })
    const button = Array.from(container.querySelectorAll("button"))[0] as HTMLButtonElement

    await act(async () => {
      button.click()
      button.click()
      await Promise.resolve()
    })

    expect(onSelectRecommendation).toHaveBeenCalledTimes(1)
    expect(onSelectRecommendation).toHaveBeenCalledWith("A", "继续完善人物弧光")
    expect(button.disabled).toBe(true)
    expect(button.getAttribute("aria-busy")).toBe("true")

    await act(async () => finish(true))
    expect(button.disabled).toBe(false)
    expect(button.getAttribute("aria-busy")).toBeNull()
  })

  it("发送失败后恢复按钮，允许用户再次点击", async () => {
    const onSelectRecommendation = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { container } = await renderCard({ onSelectRecommendation })
    const button = Array.from(container.querySelectorAll("button"))[0] as HTMLButtonElement

    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve() })
    expect(button.disabled).toBe(false)
    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve() })
    expect(onSelectRecommendation).toHaveBeenCalledTimes(2)
  })

  it("当前会话生成中时禁用全部推荐按钮并提供中文原因", async () => {
    const { container, onSelectRecommendation } = await renderCard({
      disabled: true,
      disabledReason: "当前会话正在生成，请等待生成完成后再选择下一步。",
    })
    const buttons = Array.from(container.querySelectorAll("button")) as HTMLButtonElement[]

    expect(buttons.every((button) => button.disabled)).toBe(true)
    expect(buttons.every((button) => button.title === "当前会话正在生成，请等待生成完成后再选择下一步。")).toBe(true)
    await act(async () => buttons[0].click())
    expect(onSelectRecommendation).not.toHaveBeenCalled()
  })
  it("HTML/Markdown label stays plain text and is returned unchanged", async () => {
    const label = "<script>alert(1)</script> **\u7ee7\u7eed**"
    const onSelectRecommendation = vi.fn(async () => true)
    const { container } = await renderCard({
      recommendation: {
        completedModule: "伏笔",
        completedScope: "伏笔埋设与回收",
        recommendations: [{ id: "safe", label, reason: "plain text" }],
      },
      onSelectRecommendation,
    })
    const button = container.querySelector("button") as HTMLButtonElement

    expect(container.querySelector("script")).toBeNull()
    expect(button.textContent).toContain(label)
    await act(async () => {
      button.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onSelectRecommendation).toHaveBeenCalledWith("safe", label)
  })

})
