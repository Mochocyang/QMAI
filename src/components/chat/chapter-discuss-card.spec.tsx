// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChapterDiscussCard } from "./chapter-discuss-card"
import type {
  ChapterDiscussDirection,
  ChapterDiscussProtocol,
} from "@/lib/novel/chapter-discuss-protocol"

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

function direction(overrides: Partial<ChapterDiscussDirection> = {}): ChapterDiscussDirection {
  return {
    id: "d1",
    storyType: "复仇线",
    title: "血债血偿",
    summary: "前".repeat(200),
    ...overrides,
  }
}

function protocol(overrides: Partial<ChapterDiscussProtocol> = {}): ChapterDiscussProtocol {
  return {
    status: "needs_choice",
    module: "第3章",
    judgment: "需要在第三章完成一次转折",
    directions: [
      direction({ id: "d1", storyType: "复仇线" }),
      direction({ id: "d2", storyType: "悬念反转", title: "真凶另有其人" }),
      direction({ id: "d3", storyType: "情感升温", title: "并肩之夜" }),
    ],
    preferenceId: "d2",
    preferenceReason: "最能承接前文伏笔",
    ...overrides,
  }
}

async function renderCard(props: Partial<React.ComponentProps<typeof ChapterDiscussCard>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push({ root, container })
  const onSelect = props.onSelect ?? vi.fn()
  const onRegenerate = props.onRegenerate ?? vi.fn()
  const onCustom = props.onCustom ?? vi.fn()
  await act(async () => {
    root.render(
      <ChapterDiscussCard
        protocol={protocol()}
        onSelect={onSelect}
        onRegenerate={onRegenerate}
        onCustom={onCustom}
        {...props}
      />,
    )
  })
  const options = () => Array.from(container.querySelectorAll('[role="option"]')) as HTMLButtonElement[]
  const selectButton = () => container.querySelector('[aria-label="选定该方向开始写"]') as HTMLButtonElement | null
  const regenerateButton = () => container.querySelector('[aria-label="换一批"]') as HTMLButtonElement | null
  const customToggle = () => container.querySelector('[aria-label="其他想法"]') as HTMLButtonElement | null
  const ideaInput = () => container.querySelector('[aria-label="输入你的想法"]') as HTMLTextAreaElement | null
  const customSubmit = () => container.querySelector('[aria-label="按这个想法重新推演"]') as HTMLButtonElement | null
  return {
    container, options, selectButton, regenerateButton,
    customToggle, ideaInput, customSubmit,
    onSelect, onRegenerate, onCustom,
  }
}

describe("ChapterDiscussCard", () => {
  it("renders one option per direction with its story type", async () => {
    const { container, options } = await renderCard()
    expect(options()).toHaveLength(3)
    expect(container.textContent).toContain("复仇线")
    expect(container.textContent).toContain("悬念反转")
    expect(container.textContent).toContain("情感升温")
    expect(container.textContent).toContain("AI 推荐")
    expect(container.textContent).not.toContain("chapter_discuss")
  })

  it("requires a selection before confirming, then reports the chosen direction", async () => {
    const onSelect = vi.fn()
    const { options, selectButton } = await renderCard({ onSelect })
    expect(selectButton()!.disabled).toBe(true)

    await act(async () => options()[1].click())
    expect(selectButton()!.disabled).toBe(false)

    await act(async () => selectButton()!.click())
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: "d2", storyType: "悬念反转" })
  })

  it("regenerates the whole batch", async () => {
    const onRegenerate = vi.fn()
    const { regenerateButton } = await renderCard({ onRegenerate })
    await act(async () => regenerateButton()!.click())
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it("reveals an idea input and submits the author's own idea", async () => {
    const onCustom = vi.fn()
    const { customToggle, ideaInput, customSubmit } = await renderCard({ onCustom })

    // 未点开时不应有输入框
    expect(ideaInput()).toBeNull()

    await act(async () => customToggle()!.click())
    expect(ideaInput()).not.toBeNull()
    // 空内容不可提交
    expect(customSubmit()!.disabled).toBe(true)

    await act(async () => {
      const input = ideaInput()!
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!
      setter.call(input, "我想让主角这次主动认输")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(customSubmit()!.disabled).toBe(false)
    await act(async () => customSubmit()!.click())
    expect(onCustom).toHaveBeenCalledTimes(1)
    expect(onCustom.mock.calls[0][0]).toBe("我想让主角这次主动认输")
  })

  it("offers the idea input on the insufficient card too", async () => {
    const onCustom = vi.fn()
    const { customToggle, ideaInput } = await renderCard({
      protocol: protocol({ status: "insufficient", directions: [], judgment: "前两章信息不足" }),
      onCustom,
    })
    await act(async () => customToggle()!.click())
    expect(ideaInput()).not.toBeNull()
  })

  it("disables the idea input once the round was decided", async () => {
    const onCustom = vi.fn()
    const { customToggle } = await renderCard({ decided: "custom", onCustom })
    expect(customToggle()!.disabled).toBe(true)
  })

  it("disables the whole card once a decision was made", async () => {
    const onSelect = vi.fn()
    const onRegenerate = vi.fn()
    const { options, selectButton, regenerateButton } = await renderCard({
      decided: "selected",
      onSelect,
      onRegenerate,
    })
    expect(options()[0].disabled).toBe(true)
    expect(selectButton()!.disabled).toBe(true)
    expect(regenerateButton()!.disabled).toBe(true)
    await act(async () => options()[0].click())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("disables the card via the disabled prop", async () => {
    const { options, selectButton } = await renderCard({ disabled: true, disabledReason: "生成中" })
    expect(options()[0].disabled).toBe(true)
    expect(selectButton()!.disabled).toBe(true)
  })

  it("renders the insufficient state with only a regenerate action", async () => {
    const onRegenerate = vi.fn()
    const { container, options, selectButton, regenerateButton } = await renderCard({
      protocol: protocol({ status: "insufficient", directions: [], judgment: "前两章信息不足" }),
      onRegenerate,
    })
    expect(options()).toHaveLength(0)
    expect(selectButton()).toBeNull()
    expect(container.textContent).toContain("前文不足以推演")
    await act(async () => regenerateButton()!.click())
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })
})
